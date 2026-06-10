/**
 * MSDF Text WebGL Renderer
 *
 * Iterates each character of an MSDFText and submits it to the MSDF batch
 * handler. Passes run back-to-front: drop shadow first, then the text itself.
 * An outline is drawn either in a single combined pass (`uMode` 1) or, when
 * `outlineLayered` is set, as two passes — every glyph's outline silhouette
 * first, then every glyph's fill on top — so a thick outline can't overlap a
 * neighbouring glyph. Each pass sets `uMode` (and its uniforms) via
 * `configurePass`, which flushes the pending batch whenever they change.
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
import { MSDFMode, type MSDFBatchHandlerInstance } from './MSDFBatchHandler';

const GetCalcMatrix = (Phaser as any).GameObjects.GetCalcMatrix;
const TransformMatrix = (Phaser as any).GameObjects.Components.TransformMatrix;

interface TintData {
    tintTopLeft: number;
    tintTopRight: number;
    tintBottomLeft: number;
    tintBottomRight: number;
}

// Reusable per-pass tint buffers. The text pass (fill / combined / silhouette)
// and the shadow pass each get their own so a layered render — which runs the
// text pass twice — doesn't clobber the other pass's data mid-frame.
const textTintData: TintData = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };
const shadowTintData: TintData = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };
// Reusable buffers for the display-callback paths, so a callback can recolour a
// glyph without allocating four corners each frame.
const textCallbackTintData: TintData = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };
const shadowCallbackTintData: TintData = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };

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

/**
 * Select the shader mode (and its uniforms) for the next pass, flushing any
 * pending batch first if anything changed — uniforms are applied per draw, so
 * already-queued quads must render with the old values before we switch.
 */
function configurePass(
    batchHandler: MSDFBatchHandlerInstance,
    drawingContext: any,
    mode: number,
    outlineWidth: number,
    oR: number, oG: number, oB: number, oA: number,
    rounded: number,
    shadowSoftness: number
): void {
    if (batchHandler.hasModeChanged(mode) ||
        batchHandler.hasOutlineChanged(outlineWidth, oR, oG, oB, oA, rounded) ||
        batchHandler.hasShadowSoftnessChanged(shadowSoftness)) {
        batchHandler.run(drawingContext);
    }
    batchHandler.setMode(mode);
    batchHandler.setOutline(outlineWidth, oR, oG, oB, oA, rounded);
    batchHandler.setShadowSoftness(shadowSoftness);
}

/**
 * Submit every glyph of one pass to the batch. Shared by the shadow, combined,
 * silhouette and fill passes — they differ only in mode/uniforms (set by the
 * caller via `configurePass`) and in the tint/offset arguments here.
 *
 * `extraOffsetX/Y` is the shadow offset (0 for the text passes); it is folded
 * into the no-callback position and into the position the callback sees, so a
 * callback returning its input unchanged reproduces the pass offset exactly.
 * `originOffsetX/Y` (the displayOrigin shift) is applied to callback-repositioned
 * glyphs. Seed colours/alphas feed the callback and the no-callback default
 * tint; for the silhouette pass the tint is unused (colour comes from the
 * outline uniform) but the callback still runs so glyph positions stay in sync.
 */
function submitTextChars(
    src: any,
    characters: any[],
    characterCount: number,
    drawingContext: any,
    batchHandler: MSDFBatchHandlerInstance,
    texture: any,
    hasCallback: boolean,
    calcMatrix: any,
    originOffsetX: number,
    originOffsetY: number,
    extraOffsetX: number,
    extraOffsetY: number,
    defaultTint: TintData,
    seedRgbTL: number, seedRgbTR: number, seedRgbBL: number, seedRgbBR: number,
    alphaTL: number, alphaTR: number, alphaBL: number, alphaBR: number,
    cbTint: TintData
): void {
    const baseOffsetX = originOffsetX + extraOffsetX;
    const baseOffsetY = originOffsetY + extraOffsetY;

    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];
        if (!char || char.w === 0 || char.h === 0) {
            continue;
        }

        let charData: any = char;
        let offX = baseOffsetX;
        let offY = baseOffsetY;
        let charMatrix = calcMatrix;
        let charTint: TintData = defaultTint;

        if (hasCallback) {
            const callbackData = src.callbackData;
            callbackData.index = i;
            callbackData.charCode = char.charCode || 0;
            const originalX = char.originalX !== undefined ? char.originalX : char.x;
            const originalY = char.originalY !== undefined ? char.originalY : char.y;
            callbackData.x = originalX + extraOffsetX;
            callbackData.y = originalY + extraOffsetY;
            callbackData.scale = char.scale || 1;
            callbackData.rotation = char.rotation || 0;
            callbackData.data = char.data;

            callbackData.color = 0;
            callbackData.tint.topLeft = appendAlpha(seedRgbTL, alphaTL);
            callbackData.tint.topRight = appendAlpha(seedRgbTR, alphaTR);
            callbackData.tint.bottomLeft = appendAlpha(seedRgbBL, alphaBL);
            callbackData.tint.bottomRight = appendAlpha(seedRgbBR, alphaBR);

            const result = src.displayCallback(callbackData);

            if (result) {
                const posChanged = result.x !== (originalX + extraOffsetX) || result.y !== (originalY + extraOffsetY);
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
                    // The shadow offset is already baked into result.x/y via the
                    // seed above, so only the origin shift remains to apply.
                    tempCharData.x = result.x;
                    tempCharData.y = result.y;
                    tempCharData.w = char.w;
                    tempCharData.h = char.h;
                    tempCharData.u0 = char.u0;
                    tempCharData.v0 = char.v0;
                    tempCharData.u1 = char.u1;
                    tempCharData.v1 = char.v1;
                    charData = tempCharData;
                    offX = originOffsetX;
                    offY = originOffsetY;
                }

                // Repack whatever the callback left in `color` / `tint` into the
                // batch's ABGR layout, re-applying each corner's alpha.
                if (result.color) {
                    const rgb = result.color & 0xffffff;
                    cbTint.tintTopLeft = packBatchTint(rgb, alphaTL);
                    cbTint.tintTopRight = packBatchTint(rgb, alphaTR);
                    cbTint.tintBottomLeft = packBatchTint(rgb, alphaBL);
                    cbTint.tintBottomRight = packBatchTint(rgb, alphaBR);
                } else {
                    cbTint.tintTopLeft = packBatchTint(result.tint.topLeft & 0xffffff, alphaTL);
                    cbTint.tintTopRight = packBatchTint(result.tint.topRight & 0xffffff, alphaTR);
                    cbTint.tintBottomLeft = packBatchTint(result.tint.bottomLeft & 0xffffff, alphaBL);
                    cbTint.tintBottomRight = packBatchTint(result.tint.bottomRight & 0xffffff, alphaBR);
                }
                charTint = cbTint;
            }
        }

        BatchMSDFChar(drawingContext, batchHandler, texture, charData, offX, offY, charMatrix, charTint);
    }
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

    // Outline uniform values, shared by the combined and silhouette passes.
    const hasOutline = src.hasOutline();
    const outlineWidth = src.outlineWidth;
    const oColor = src.outlineColor;
    const oR = ((oColor >> 16) & 0xff) / 255;
    const oG = ((oColor >> 8) & 0xff) / 255;
    const oB = (oColor & 0xff) / 255;
    // The outline colour is a per-batch uniform, so the object's alpha (per-vertex
    // on the fill) must be folded in here — otherwise the outline stays opaque
    // while the glyph fill fades out.
    const oA = src.outlineAlpha * src.alpha;
    const outlineRounded = (isMtsdf && src.outlineRounded) ? 1 : 0;
    const layered = hasOutline && src.outlineLayered;

    // Effective per-corner colour for the text pass: each Tint-component corner
    // (0xRRGGBB) times the base text colour (`_color`). The effective per-corner
    // alpha is kept separate so a display callback can recolour a glyph without
    // having to know — or preserve — the object's alpha. `_alphaTL` etc. already
    // include the object's global alpha (Phaser's Alpha component mirrors it).
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

    textTintData.tintTopLeft = packBatchTint(rgbTL, alphaTL);
    textTintData.tintTopRight = packBatchTint(rgbTR, alphaTR);
    textTintData.tintBottomLeft = packBatchTint(rgbBL, alphaBL);
    textTintData.tintBottomRight = packBatchTint(rgbBR, alphaBR);

    const hasCallback = src.displayCallback && typeof src.displayCallback === 'function';

    // ── Shadow pass — render shadow behind the text. ────────────────────────
    if (src.hasDropShadow()) {
        const dsx = src.dropShadowX;
        const dsy = src.dropShadowY;
        const sColor = src.dropShadowColor;
        const shadowAlpha = src.dropShadowAlpha;

        // A hard shadow is just a glyph in shadow colour (PLAIN); only a soft
        // shadow needs the dedicated mode and its true-SDF blur.
        const shadowMode = shadowSoftness > 0 ? MSDFMode.SOFT_SHADOW : MSDFMode.PLAIN;
        configurePass(batchHandler, drawingContext, shadowMode, 0, 0, 0, 0, 0, 0, shadowSoftness);

        // Shadow tint is a solid colour; the effective per-corner alpha follows
        // the text's per-corner alpha so the shadow fades with it.
        const shadowAlphaTL = shadowAlpha * src._alphaTL;
        const shadowAlphaTR = shadowAlpha * src._alphaTR;
        const shadowAlphaBL = shadowAlpha * src._alphaBL;
        const shadowAlphaBR = shadowAlpha * src._alphaBR;

        shadowTintData.tintTopLeft = packBatchTint(sColor, shadowAlphaTL);
        shadowTintData.tintTopRight = packBatchTint(sColor, shadowAlphaTR);
        shadowTintData.tintBottomLeft = packBatchTint(sColor, shadowAlphaBL);
        shadowTintData.tintBottomRight = packBatchTint(sColor, shadowAlphaBR);

        submitTextChars(
            src, characters, characterCount, drawingContext, batchHandler, texture, hasCallback,
            calcMatrix, originOffsetX, originOffsetY, dsx, dsy,
            shadowTintData,
            sColor, sColor, sColor, sColor,
            shadowAlphaTL, shadowAlphaTR, shadowAlphaBL, shadowAlphaBR,
            shadowCallbackTintData
        );
    }

    // ── Outline silhouette pass (layered only) — every glyph's outline blob, ─
    // drawn before any fill so neighbouring outlines can't cover a glyph's fill.
    if (layered) {
        configurePass(batchHandler, drawingContext, MSDFMode.OUTLINE_SILHOUETTE, outlineWidth, oR, oG, oB, oA, outlineRounded, 0);
        submitTextChars(
            src, characters, characterCount, drawingContext, batchHandler, texture, hasCallback,
            calcMatrix, originOffsetX, originOffsetY, 0, 0,
            textTintData,
            rgbTL, rgbTR, rgbBL, rgbBR,
            alphaTL, alphaTR, alphaBL, alphaBR,
            textCallbackTintData
        );
    }

    // ── Text pass — combined outline+fill, or the plain fill of a layered ────
    // outline / a font with no outline.
    const textMode = layered ? MSDFMode.PLAIN
        : hasOutline ? MSDFMode.OUTLINE_COMBINED
        : MSDFMode.PLAIN;
    // The fill pass of a layered outline carries no outline of its own.
    const passOutlineWidth = (textMode === MSDFMode.OUTLINE_COMBINED) ? outlineWidth : 0;
    configurePass(batchHandler, drawingContext, textMode, passOutlineWidth, oR, oG, oB, oA, outlineRounded, 0);
    submitTextChars(
        src, characters, characterCount, drawingContext, batchHandler, texture, hasCallback,
        calcMatrix, originOffsetX, originOffsetY, 0, 0,
        textTintData,
        rgbTL, rgbTR, rgbBL, rgbBR,
        alphaTL, alphaTR, alphaBL, alphaBR,
        textCallbackTintData
    );
}

export default MSDFTextWebGLRenderer;
export { MSDFTextWebGLRenderer };
