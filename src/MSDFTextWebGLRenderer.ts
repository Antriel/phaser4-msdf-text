/**
 * MSDF Text WebGL Renderer
 *
 * Iterates each character of an MSDFText and submits it to the MSDF batch
 * handler, optionally running a per-character display callback. Renders shadow
 * pass first (if enabled), then main text pass on top.
 *
 * Per-corner tint comes from `Components.Tint` (`tintTopLeft`, etc.) multiplied
 * by the base colour `_color` and per-corner alpha (`_alphaTL` etc.). The MSDF
 * shader only multiplies, so `tintFill` / non-multiply tint modes are ignored.
 *
 * Display callbacks see tint the Phaser-idiomatic way: each `tint` corner is a
 * `0xAARRGGBB` value (as `Utils.getTintAppendFloatAlpha` produces) and `color`
 * is a `0xRRGGBB` shorthand for all four corners. The renderer repacks whatever
 * the callback returns into the batch's ABGR layout and re-applies the object's
 * per-corner alpha, so a callback can't override alpha through `tint`.
 */

import * as Phaser from "phaser";
import BatchMSDFChar from './BatchMSDFChar';
import type { MSDFBatchHandlerInstance } from './MSDFBatchHandler';

const GetCalcMatrix = (Phaser as any).GameObjects.GetCalcMatrix;
const TransformMatrix = (Phaser as any).GameObjects.Components.TransformMatrix;

const tempTintData = {
    tintTopLeft: 0xffffffff,
    tintTopRight: 0xffffffff,
    tintBottomLeft: 0xffffffff,
    tintBottomRight: 0xffffffff
};

// Reusable per-character tint buffers for the display-callback paths, so a
// callback can recolour a glyph without allocating four corners each frame.
const callbackTintData = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };
const shadowCallbackTintData = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };

const tempCharData = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    u0: 0,
    v0: 0,
    u1: 0,
    v1: 0
};

const tempCharMatrix = new TransformMatrix();

/**
 * Pack an effective `0xRRGGBB` colour and a 0-1 alpha into the ABGR u32 the MSDF
 * batch buffer expects — red in the low byte, so the shader samples `.rgb`
 * directly. (Phaser's own batches pack `0xAARRGGBB` and swizzle `.bgr` in the
 * shader instead; same result, the work is split differently.)
 */
function packBatchTint(rgb: number, alpha: number): number {
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    const a = Math.floor(alpha * 255);
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * Multiply a `0xRRGGBB` corner tint by the base text colour floats (0-1),
 * yielding the effective `0xRRGGBB` for that corner.
 */
function multiplyTint(cornerTint: number, colorR: number, colorG: number, colorB: number): number {
    const r = Math.floor(((cornerTint >> 16) & 0xff) * colorR);
    const g = Math.floor(((cornerTint >> 8) & 0xff) * colorG);
    const b = Math.floor((cornerTint & 0xff) * colorB);
    return (r << 16) | (g << 8) | b;
}

/**
 * Append a 0-1 alpha as the high byte of a `0xRRGGBB` colour, producing the
 * `0xAARRGGBB` value display callbacks see — mirrors Phaser's
 * `Utils.getTintAppendFloatAlpha`, so a BitmapText callback ports unchanged.
 */
function appendAlpha(rgb: number, alpha: number): number {
    return (((Math.floor(alpha * 255) & 0xff) << 24) | rgb) >>> 0;
}

function MSDFTextWebGLRenderer(
    _renderer: any,
    src: any,
    drawingContext: any,
    parentMatrix: any
): void {
    const characters = src._characters;
    const characterCount = characters ? characters.length : 0;

    if (characterCount === 0) {
        return;
    }

    const camera = drawingContext.camera;
    camera.addToRenderList(src);

    const batchHandler: MSDFBatchHandlerInstance | undefined =
        src.customRenderNodes.BatchHandler || src.defaultRenderNodes.BatchHandler;

    if (!batchHandler) {
        return;
    }

    const texture = src.frame ? src.frame.glTexture : null;
    if (!texture) {
        return;
    }

    const matrixResult = GetCalcMatrix(src, camera, parentMatrix);
    const calcMatrix = matrixResult.calc;

    // Subtract displayOrigin so origin maps to the text's bounding box.
    const originOffsetX = -src.displayOriginX;
    const originOffsetY = -src.displayOriginY;

    batchHandler.setPxRange(src.fontData.distanceField.distanceRange);
    batchHandler.setAtlasSize(src.fontData.atlasSize.width, src.fontData.atlasSize.height);

    // Rounded outlines and soft shadows read the true-SDF alpha channel, which
    // only carries usable data on MTSDF atlases. On a plain MSDF font they are
    // forced off here so the effects degrade to the standard look.
    const isMtsdf = src.fontData.distanceField.fieldType === 'mtsdf';
    const shadowSoftness = (isMtsdf && src.dropShadowSoftness > 0) ? src.dropShadowSoftness : 0;

    // Outline state — flush if it changed since the last batch.
    if (src.hasOutline()) {
        const width = src.outlineWidth;
        const oColor = src.outlineColor;
        const oR = ((oColor >> 16) & 0xff) / 255;
        const oG = ((oColor >> 8) & 0xff) / 255;
        const oB = (oColor & 0xff) / 255;
        // The outline colour is a per-batch uniform, so the object's alpha
        // (per-vertex on the fill) must be folded in here — otherwise the
        // outline stays opaque while the glyph fill fades out.
        const oA = src.outlineAlpha * src.alpha;
        const rounded = (isMtsdf && src.outlineRounded) ? 1 : 0;
        if (batchHandler.hasOutlineChanged(width, oR, oG, oB, oA, rounded)) {
            batchHandler.run(drawingContext);
        }
        batchHandler.setOutline(width, oR, oG, oB, oA, rounded);
    } else {
        if (batchHandler.hasOutlineChanged(0, 0, 0, 0, 0, 0)) {
            batchHandler.run(drawingContext);
        }
        batchHandler.setOutline(0, 0, 0, 0, 0, 0);
    }

    // Effective per-corner colour for the main pass: each Tint-component corner
    // (0xRRGGBB) times the base text colour (`_color`). The effective per-corner
    // alpha is kept separate so a display callback can recolour a glyph without
    // having to know — or preserve — the object's alpha.
    const textColor = src._color;
    const cR = textColor.r;
    const cG = textColor.g;
    const cB = textColor.b;
    const cA = textColor.a;

    const rgbTL = multiplyTint(src.tintTopLeft, cR, cG, cB);
    const rgbTR = multiplyTint(src.tintTopRight, cR, cG, cB);
    const rgbBL = multiplyTint(src.tintBottomLeft, cR, cG, cB);
    const rgbBR = multiplyTint(src.tintBottomRight, cR, cG, cB);

    const alphaTL = cA * src._alphaTL;
    const alphaTR = cA * src._alphaTR;
    const alphaBL = cA * src._alphaBL;
    const alphaBR = cA * src._alphaBR;

    tempTintData.tintTopLeft = packBatchTint(rgbTL, alphaTL);
    tempTintData.tintTopRight = packBatchTint(rgbTR, alphaTR);
    tempTintData.tintBottomLeft = packBatchTint(rgbBL, alphaBL);
    tempTintData.tintBottomRight = packBatchTint(rgbBR, alphaBR);

    const hasCallback = src.displayCallback && typeof src.displayCallback === 'function';

    // Shadow pass — render shadow behind the text.
    if (src.hasDropShadow()) {
        const dsx = src.dropShadowX;
        const dsy = src.dropShadowY;
        const sColor = src.dropShadowColor;
        const shadowAlpha = src.dropShadowAlpha;

        const shadowOffsetX = originOffsetX + dsx;
        const shadowOffsetY = originOffsetY + dsy;

        // Shadow softness is a per-pass uniform; flush any pending batch so the
        // shadow quads render with it before the main pass resets it to 0.
        if (batchHandler.hasShadowSoftnessChanged(shadowSoftness)) {
            batchHandler.run(drawingContext);
        }
        batchHandler.setShadowSoftness(shadowSoftness);

        // Shadow tint is a solid colour; the effective per-corner alpha follows
        // the text's per-corner alpha so the shadow fades with it.
        const shadowAlphaTL = shadowAlpha * src._alphaTL;
        const shadowAlphaTR = shadowAlpha * src._alphaTR;
        const shadowAlphaBL = shadowAlpha * src._alphaBL;
        const shadowAlphaBR = shadowAlpha * src._alphaBR;

        const shadowTintData = {
            tintTopLeft:     packBatchTint(sColor, shadowAlphaTL),
            tintTopRight:    packBatchTint(sColor, shadowAlphaTR),
            tintBottomLeft:  packBatchTint(sColor, shadowAlphaBL),
            tintBottomRight: packBatchTint(sColor, shadowAlphaBR)
        };

        for (let i = 0; i < characterCount; i++) {
            const char = characters[i];
            if (!char || char.w === 0 || char.h === 0) {
                continue;
            }

            let shadowCharData: typeof tempCharData | any = char;
            let shadowOffX = shadowOffsetX;
            let shadowOffY = shadowOffsetY;
            let shadowMatrix = calcMatrix;
            let shadowTint = shadowTintData;

            if (hasCallback) {
                const callbackData = src.callbackData;
                callbackData.index = i;
                callbackData.charCode = char.charCode || 0;
                const originalX = char.originalX !== undefined ? char.originalX : char.x;
                const originalY = char.originalY !== undefined ? char.originalY : char.y;

                callbackData.x = originalX + dsx;
                callbackData.y = originalY + dsy;
                callbackData.scale = char.scale || 1;
                callbackData.rotation = char.rotation || 0;
                callbackData.data = char.data;

                callbackData.color = 0;
                callbackData.tint.topLeft = appendAlpha(sColor, shadowAlphaTL);
                callbackData.tint.topRight = appendAlpha(sColor, shadowAlphaTR);
                callbackData.tint.bottomLeft = appendAlpha(sColor, shadowAlphaBL);
                callbackData.tint.bottomRight = appendAlpha(sColor, shadowAlphaBR);

                const result = src.displayCallback(callbackData);

                const posChanged = result.x !== (originalX + dsx) || result.y !== (originalY + dsy);
                const scaleChanged = result.scale !== 1;
                const rotationChanged = result.rotation !== 0;

                if (scaleChanged || rotationChanged) {
                    const centerX = char.w / 2;
                    const centerY = char.h / 2;

                    tempCharMatrix.copyFrom(calcMatrix);
                    tempCharMatrix.translate(result.x + centerX + originOffsetX, result.y + centerY + originOffsetY);

                    if (rotationChanged) {
                        tempCharMatrix.rotate(result.rotation);
                    }
                    if (scaleChanged) {
                        tempCharMatrix.scale(result.scale, result.scale);
                    }

                    tempCharData.x = -centerX;
                    tempCharData.y = -centerY;
                    tempCharData.w = char.w;
                    tempCharData.h = char.h;
                    tempCharData.u0 = char.u0;
                    tempCharData.v0 = char.v0;
                    tempCharData.u1 = char.u1;
                    tempCharData.v1 = char.v1;
                    shadowCharData = tempCharData;
                    shadowMatrix = tempCharMatrix;
                    shadowOffX = 0;
                    shadowOffY = 0;
                } else if (posChanged) {
                    tempCharData.x = result.x;
                    tempCharData.y = result.y;
                    tempCharData.w = char.w;
                    tempCharData.h = char.h;
                    tempCharData.u0 = char.u0;
                    tempCharData.v0 = char.v0;
                    tempCharData.u1 = char.u1;
                    tempCharData.v1 = char.v1;
                    shadowCharData = tempCharData;
                    shadowOffX = originOffsetX;
                    shadowOffY = originOffsetY;
                }

                // Repack whatever the callback left in `color` / `tint` into the
                // batch's ABGR layout, re-applying each corner's shadow alpha.
                if (result.color) {
                    const rgb = result.color & 0xffffff;
                    shadowCallbackTintData.tintTopLeft = packBatchTint(rgb, shadowAlphaTL);
                    shadowCallbackTintData.tintTopRight = packBatchTint(rgb, shadowAlphaTR);
                    shadowCallbackTintData.tintBottomLeft = packBatchTint(rgb, shadowAlphaBL);
                    shadowCallbackTintData.tintBottomRight = packBatchTint(rgb, shadowAlphaBR);
                } else {
                    shadowCallbackTintData.tintTopLeft = packBatchTint(result.tint.topLeft & 0xffffff, shadowAlphaTL);
                    shadowCallbackTintData.tintTopRight = packBatchTint(result.tint.topRight & 0xffffff, shadowAlphaTR);
                    shadowCallbackTintData.tintBottomLeft = packBatchTint(result.tint.bottomLeft & 0xffffff, shadowAlphaBL);
                    shadowCallbackTintData.tintBottomRight = packBatchTint(result.tint.bottomRight & 0xffffff, shadowAlphaBR);
                }
                shadowTint = shadowCallbackTintData;
            }

            BatchMSDFChar(drawingContext, batchHandler, texture, shadowCharData, shadowOffX, shadowOffY, shadowMatrix, shadowTint);
        }
    }

    // Main text pass — reset shadow softness so text uses the crisp MSDF path.
    if (batchHandler.hasShadowSoftnessChanged(0)) {
        batchHandler.run(drawingContext);
    }
    batchHandler.setShadowSoftness(0);

    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];
        if (!char || char.w === 0 || char.h === 0) {
            continue;
        }

        let charData: any = char;
        let offX = originOffsetX;
        let offY = originOffsetY;
        let charMatrix = calcMatrix;
        let charTint = tempTintData;

        if (hasCallback) {
            const callbackData = src.callbackData;
            callbackData.index = i;
            callbackData.charCode = char.charCode || 0;
            const originalX = char.originalX !== undefined ? char.originalX : char.x;
            const originalY = char.originalY !== undefined ? char.originalY : char.y;
            callbackData.x = originalX;
            callbackData.y = originalY;
            callbackData.scale = char.scale || 1;
            callbackData.rotation = char.rotation || 0;
            callbackData.data = char.data;

            callbackData.color = 0;
            callbackData.tint.topLeft = appendAlpha(rgbTL, alphaTL);
            callbackData.tint.topRight = appendAlpha(rgbTR, alphaTR);
            callbackData.tint.bottomLeft = appendAlpha(rgbBL, alphaBL);
            callbackData.tint.bottomRight = appendAlpha(rgbBR, alphaBR);

            const result = src.displayCallback(callbackData);

            if (result) {
                const posChanged = result.x !== originalX || result.y !== originalY;
                const scaleChanged = result.scale !== 1;
                const rotationChanged = result.rotation !== 0;

                if (scaleChanged || rotationChanged) {
                    const centerX = char.w / 2;
                    const centerY = char.h / 2;

                    tempCharMatrix.copyFrom(calcMatrix);
                    tempCharMatrix.translate(result.x + centerX + originOffsetX, result.y + centerY + originOffsetY);

                    if (rotationChanged) {
                        tempCharMatrix.rotate(result.rotation);
                    }
                    if (scaleChanged) {
                        tempCharMatrix.scale(result.scale, result.scale);
                    }

                    tempCharData.x = -centerX;
                    tempCharData.y = -centerY;
                    tempCharData.w = char.w;
                    tempCharData.h = char.h;
                    tempCharData.u0 = char.u0;
                    tempCharData.v0 = char.v0;
                    tempCharData.u1 = char.u1;
                    tempCharData.v1 = char.v1;
                    charData = tempCharData;
                    charMatrix = tempCharMatrix;
                    offX = 0;
                    offY = 0;
                } else if (posChanged) {
                    tempCharData.x = result.x;
                    tempCharData.y = result.y;
                    tempCharData.w = char.w;
                    tempCharData.h = char.h;
                    tempCharData.u0 = char.u0;
                    tempCharData.v0 = char.v0;
                    tempCharData.u1 = char.u1;
                    tempCharData.v1 = char.v1;
                    charData = tempCharData;
                }

                // Repack whatever the callback left in `color` / `tint` into the
                // batch's ABGR layout, re-applying each corner's alpha.
                if (result.color) {
                    const rgb = result.color & 0xffffff;
                    callbackTintData.tintTopLeft = packBatchTint(rgb, alphaTL);
                    callbackTintData.tintTopRight = packBatchTint(rgb, alphaTR);
                    callbackTintData.tintBottomLeft = packBatchTint(rgb, alphaBL);
                    callbackTintData.tintBottomRight = packBatchTint(rgb, alphaBR);
                } else {
                    callbackTintData.tintTopLeft = packBatchTint(result.tint.topLeft & 0xffffff, alphaTL);
                    callbackTintData.tintTopRight = packBatchTint(result.tint.topRight & 0xffffff, alphaTR);
                    callbackTintData.tintBottomLeft = packBatchTint(result.tint.bottomLeft & 0xffffff, alphaBL);
                    callbackTintData.tintBottomRight = packBatchTint(result.tint.bottomRight & 0xffffff, alphaBR);
                }
                charTint = callbackTintData;
            }
        }

        BatchMSDFChar(drawingContext, batchHandler, texture, charData, offX, offY, charMatrix, charTint);
    }
}

export default MSDFTextWebGLRenderer;
export { MSDFTextWebGLRenderer };
