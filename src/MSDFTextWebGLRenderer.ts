/**
 * MSDF Text WebGL Renderer
 *
 * Iterates each character of an MSDFText and submits it to the MSDF batch
 * handler, optionally running a per-character display callback. Renders shadow
 * pass first (if enabled), then main text pass on top.
 *
 * Per-corner tint comes from `Components.Tint` (`tintTopLeft`, etc.) multiplied
 * by `_color` and per-corner alpha (`_alphaTL` etc.). Only `tintMode === MULTIPLY`
 * is honored — the MSDF shader doesn't implement FILL/ADD/SCREEN/OVERLAY/HARD_LIGHT.
 */

import Phaser from 'phaser';
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
 * Pack a corner: 0xRRGGBB tint × float color (0-1) × float alpha (0-1) → ABGR u32.
 */
function packCornerTint(
    cornerTint: number,
    colorR: number, colorG: number, colorB: number, colorA: number,
    cornerAlpha: number
): number {
    const tintR = ((cornerTint >> 16) & 0xff) / 255;
    const tintG = ((cornerTint >> 8) & 0xff) / 255;
    const tintB = (cornerTint & 0xff) / 255;

    const r = Math.floor(colorR * tintR * 255);
    const g = Math.floor(colorG * tintG * 255);
    const b = Math.floor(colorB * tintB * 255);
    const a = Math.floor(colorA * cornerAlpha * 255);

    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
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

    // Outline state — flush if it changed since the last batch.
    if (src.hasOutline()) {
        const outline = src._outlineColor;
        const width = src._outlineWidth;
        if (batchHandler.hasOutlineChanged(width, outline.r, outline.g, outline.b, outline.a)) {
            batchHandler.run(drawingContext);
        }
        batchHandler.setOutline(width, outline.r, outline.g, outline.b, outline.a);
    } else {
        if (batchHandler.hasOutlineChanged(0, 0, 0, 0, 0)) {
            batchHandler.run(drawingContext);
        }
        batchHandler.setOutline(0, 0, 0, 0, 0);
    }

    // Combine per-corner tint (Components.Tint), per-corner alpha (Components.Alpha),
    // and the base text color (_color) into four packed ABGR u32 corner values.
    const textColor = src._color;
    const cR = textColor.r;
    const cG = textColor.g;
    const cB = textColor.b;
    const cA = textColor.a;

    const tintTL = packCornerTint(src.tintTopLeft,     cR, cG, cB, cA, src._alphaTL);
    const tintTR = packCornerTint(src.tintTopRight,    cR, cG, cB, cA, src._alphaTR);
    const tintBL = packCornerTint(src.tintBottomLeft,  cR, cG, cB, cA, src._alphaBL);
    const tintBR = packCornerTint(src.tintBottomRight, cR, cG, cB, cA, src._alphaBR);

    tempTintData.tintTopLeft = tintTL;
    tempTintData.tintTopRight = tintTR;
    tempTintData.tintBottomLeft = tintBL;
    tempTintData.tintBottomRight = tintBR;

    const hasCallback = src.displayCallback && typeof src.displayCallback === 'function';

    // Shadow pass — render shadow behind the text.
    if (src.hasShadow()) {
        const shadowOffset = src._shadowOffset;
        const shadowColor = src._shadowColor;
        const shadowAlpha = src._shadowAlpha;

        const shadowOffsetX = originOffsetX + shadowOffset.x;
        const shadowOffsetY = originOffsetY + shadowOffset.y;

        // Shadow tint is solid; modulate by each corner's alpha so it follows
        // per-corner alpha on the text.
        const shadowTintData = {
            tintTopLeft:     packCornerTint(0xffffff, shadowColor.r, shadowColor.g, shadowColor.b, shadowAlpha, src._alphaTL),
            tintTopRight:    packCornerTint(0xffffff, shadowColor.r, shadowColor.g, shadowColor.b, shadowAlpha, src._alphaTR),
            tintBottomLeft:  packCornerTint(0xffffff, shadowColor.r, shadowColor.g, shadowColor.b, shadowAlpha, src._alphaBL),
            tintBottomRight: packCornerTint(0xffffff, shadowColor.r, shadowColor.g, shadowColor.b, shadowAlpha, src._alphaBR)
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

                callbackData.x = originalX + shadowOffset.x;
                callbackData.y = originalY + shadowOffset.y;
                callbackData.scale = char.scale || 1;
                callbackData.rotation = char.rotation || 0;
                callbackData.data = char.data;

                callbackData.tint.topLeft = shadowTintData.tintTopLeft;
                callbackData.tint.topRight = shadowTintData.tintTopRight;
                callbackData.tint.bottomLeft = shadowTintData.tintBottomLeft;
                callbackData.tint.bottomRight = shadowTintData.tintBottomRight;

                const result = src.displayCallback(callbackData);

                const posChanged = result.x !== (originalX + shadowOffset.x) || result.y !== (originalY + shadowOffset.y);
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

                const tintChanged = result.tint.topLeft !== shadowTintData.tintTopLeft ||
                    result.tint.topRight !== shadowTintData.tintTopRight ||
                    result.tint.bottomLeft !== shadowTintData.tintBottomLeft ||
                    result.tint.bottomRight !== shadowTintData.tintBottomRight;

                if (tintChanged) {
                    shadowTint = {
                        tintTopLeft: result.tint.topLeft,
                        tintTopRight: result.tint.topRight,
                        tintBottomLeft: result.tint.bottomLeft,
                        tintBottomRight: result.tint.bottomRight
                    };
                }
            }

            BatchMSDFChar(drawingContext, batchHandler, texture, shadowCharData, shadowOffX, shadowOffY, shadowMatrix, shadowTint);
        }
    }

    // Main text pass.
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

            callbackData.tint.topLeft = tintTL;
            callbackData.tint.topRight = tintTR;
            callbackData.tint.bottomLeft = tintBL;
            callbackData.tint.bottomRight = tintBR;

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

                const tintChanged =
                    result.tint.topLeft !== tintTL ||
                    result.tint.topRight !== tintTR ||
                    result.tint.bottomLeft !== tintBL ||
                    result.tint.bottomRight !== tintBR;

                if (tintChanged) {
                    charTint = {
                        tintTopLeft: result.tint.topLeft,
                        tintTopRight: result.tint.topRight,
                        tintBottomLeft: result.tint.bottomLeft,
                        tintBottomRight: result.tint.bottomRight
                    };
                }
            }
        }

        BatchMSDFChar(drawingContext, batchHandler, texture, charData, offX, offY, charMatrix, charTint);
    }
}

export default MSDFTextWebGLRenderer;
export { MSDFTextWebGLRenderer };
