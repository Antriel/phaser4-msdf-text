/**
 * MSDF Text WebGL Renderer
 *
 * Iterates each character of an MSDFText and submits it to the MSDF batch
 * handler, optionally running a per-character display callback. Renders shadow
 * pass first (if enabled), then main text pass on top.
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

    const texture = src._texture;
    if (!texture) {
        return;
    }

    const matrixResult = GetCalcMatrix(src, camera, parentMatrix);
    const calcMatrix = matrixResult.calc;

    batchHandler.setPxRange(src._pxRange || 4);

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

    // Combine text color, GameObject tint, and alpha into a packed ABGR u32.
    const textColor = src._color;
    const alpha = src.alpha !== undefined ? src.alpha : 1.0;
    const tint = src.tint !== undefined ? src.tint : 0xFFFFFF;

    const tintR = ((tint >> 16) & 0xFF) / 255;
    const tintG = ((tint >> 8) & 0xFF) / 255;
    const tintB = (tint & 0xFF) / 255;

    const finalR = Math.floor(textColor.r * tintR * 255);
    const finalG = Math.floor(textColor.g * tintG * 255);
    const finalB = Math.floor(textColor.b * tintB * 255);
    const finalA = Math.floor(textColor.a * alpha * 255);

    const tintValue = (finalA << 24) | (finalB << 16) | (finalG << 8) | finalR;

    tempTintData.tintTopLeft = tintValue;
    tempTintData.tintTopRight = tintValue;
    tempTintData.tintBottomLeft = tintValue;
    tempTintData.tintBottomRight = tintValue;

    const hasCallback = src.displayCallback && typeof src.displayCallback === 'function';

    // Shadow pass — render shadow behind the text.
    if (src.hasShadow()) {
        const shadowOffset = src._shadowOffset;
        const shadowColor = src._shadowColor;
        const shadowAlpha = src._shadowAlpha;

        const shadowR = Math.floor(shadowColor.r * 255);
        const shadowG = Math.floor(shadowColor.g * 255);
        const shadowB = Math.floor(shadowColor.b * 255);
        const shadowA = Math.floor(shadowAlpha * 255);
        const shadowTintValue = (shadowA << 24) | (shadowB << 16) | (shadowG << 8) | shadowR;

        const shadowTintData = {
            tintTopLeft: shadowTintValue,
            tintTopRight: shadowTintValue,
            tintBottomLeft: shadowTintValue,
            tintBottomRight: shadowTintValue
        };

        for (let i = 0; i < characterCount; i++) {
            const char = characters[i];
            if (!char || char.w === 0 || char.h === 0) {
                continue;
            }

            tempCharData.x = char.x + shadowOffset.x;
            tempCharData.y = char.y + shadowOffset.y;
            tempCharData.w = char.w;
            tempCharData.h = char.h;
            tempCharData.u0 = char.u0;
            tempCharData.v0 = char.v0;
            tempCharData.u1 = char.u1;
            tempCharData.v1 = char.v1;

            let shadowCharData: typeof tempCharData = tempCharData;
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

                callbackData.tint.topLeft = shadowTintValue;
                callbackData.tint.topRight = shadowTintValue;
                callbackData.tint.bottomLeft = shadowTintValue;
                callbackData.tint.bottomRight = shadowTintValue;

                const result = src.displayCallback(callbackData);

                const posChanged = result.x !== (originalX + shadowOffset.x) || result.y !== (originalY + shadowOffset.y);
                const scaleChanged = result.scale !== 1;
                const rotationChanged = result.rotation !== 0;

                if (posChanged || scaleChanged || rotationChanged) {
                    const centerX = char.w / 2;
                    const centerY = char.h / 2;

                    tempCharMatrix.copyFrom(calcMatrix);
                    tempCharMatrix.translate(result.x + centerX, result.y + centerY);

                    if (rotationChanged) {
                        tempCharMatrix.rotate(result.rotation);
                    }

                    if (scaleChanged) {
                        tempCharMatrix.scale(result.scale, result.scale);
                    }

                    shadowCharData = { ...tempCharData };
                    shadowCharData.x = -centerX;
                    shadowCharData.y = -centerY;
                    shadowMatrix = tempCharMatrix;
                } else if (posChanged) {
                    shadowCharData = { ...tempCharData };
                    shadowCharData.x = result.x;
                    shadowCharData.y = result.y;
                }

                const tintChanged = result.tint.topLeft !== shadowTintValue ||
                    result.tint.topRight !== shadowTintValue ||
                    result.tint.bottomLeft !== shadowTintValue ||
                    result.tint.bottomRight !== shadowTintValue;

                if (tintChanged) {
                    shadowTint = {
                        tintTopLeft: result.tint.topLeft,
                        tintTopRight: result.tint.topRight,
                        tintBottomLeft: result.tint.bottomLeft,
                        tintBottomRight: result.tint.bottomRight
                    };
                }
            }

            BatchMSDFChar(drawingContext, batchHandler, texture, shadowCharData, shadowMatrix, shadowTint);
        }
    }

    // Main text pass.
    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];
        if (!char || char.w === 0 || char.h === 0) {
            continue;
        }

        let charData: any = char;
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

            callbackData.tint.topLeft = tintValue;
            callbackData.tint.topRight = tintValue;
            callbackData.tint.bottomLeft = tintValue;
            callbackData.tint.bottomRight = tintValue;

            const result = src.displayCallback(callbackData);

            if (result) {
                const posChanged = result.x !== originalX || result.y !== originalY;
                const scaleChanged = result.scale !== 1;
                const rotationChanged = result.rotation !== 0;

                if (posChanged || scaleChanged || rotationChanged) {
                    tempCharData.w = char.w;
                    tempCharData.h = char.h;
                    tempCharData.u0 = char.u0;
                    tempCharData.v0 = char.v0;
                    tempCharData.u1 = char.u1;
                    tempCharData.v1 = char.v1;

                    if (scaleChanged || rotationChanged) {
                        const centerX = char.w / 2;
                        const centerY = char.h / 2;

                        tempCharMatrix.copyFrom(calcMatrix);
                        tempCharMatrix.translate(result.x + centerX, result.y + centerY);

                        if (rotationChanged) {
                            tempCharMatrix.rotate(result.rotation);
                        }

                        if (scaleChanged) {
                            tempCharMatrix.scale(result.scale, result.scale);
                        }

                        charMatrix = tempCharMatrix;
                        tempCharData.x = -centerX;
                        tempCharData.y = -centerY;
                    } else {
                        tempCharData.x = result.x;
                        tempCharData.y = result.y;
                    }

                    charData = tempCharData;
                }

                const tintChanged =
                    result.tint.topLeft !== tintValue ||
                    result.tint.topRight !== tintValue ||
                    result.tint.bottomLeft !== tintValue ||
                    result.tint.bottomRight !== tintValue;

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

        BatchMSDFChar(drawingContext, batchHandler, texture, charData, charMatrix, charTint);
    }
}

export default MSDFTextWebGLRenderer;
export { MSDFTextWebGLRenderer };
