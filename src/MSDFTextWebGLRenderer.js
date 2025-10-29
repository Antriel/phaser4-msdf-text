/**
 * MSDF Text WebGL Renderer
 *
 * Renders MSDFText Game Objects with WebGL using batched rendering.
 * This renderer iterates through all characters in the text and batches them
 * for efficient rendering in 1-2 draw calls instead of one per character.
 *
 * Based on BitmapTextWebGLRenderer from Phaser 4.
 */

import BatchMSDFChar from './BatchMSDFChar.js';
import GetCalcMatrix from 'phaser/src/gameobjects/GetCalcMatrix';

/**
 * Temporary tint data object (reused to avoid allocations)
 */
const tempTintData = {
    tintTopLeft: 0xffffffff,
    tintTopRight: 0xffffffff,
    tintBottomLeft: 0xffffffff,
    tintBottomRight: 0xffffffff
};

/**
 * Render MSDF Text to WebGL
 *
 * @param {Phaser.Renderer.WebGL.WebGLRenderer} renderer - The WebGL renderer
 * @param {MSDFText} src - The MSDFText Game Object being rendered
 * @param {Phaser.Renderer.WebGL.DrawingContext} drawingContext - The current drawing context
 * @param {Phaser.GameObjects.Components.TransformMatrix} parentMatrix - Parent transform matrix
 */
function MSDFTextWebGLRenderer(renderer, src, drawingContext, parentMatrix) {
    const characters = src._characters;
    const characterCount = characters ? characters.length : 0;

    if (characterCount === 0) {
        return;
    }

    const camera = drawingContext.camera;
    camera.addToRenderList(src);

    // Get batch handler instance (already resolved in constructor)
    const batchHandler = src.customRenderNodes.BatchHandler || src.defaultRenderNodes.BatchHandler;

    if (!batchHandler) {
        console.warn('MSDFText: No batch handler found');
        return;
    }

    // Get MSDF texture
    const texture = src._texture;
    if (!texture) {
        console.warn('MSDFText: No texture found');
        return;
    }

    // Get transform matrix combining object, parent, and camera transforms
    const matrixResult = GetCalcMatrix(src, camera, parentMatrix);
    const calcMatrix = matrixResult.calc;

    // Setup MSDF-specific parameters on batch handler
    if (batchHandler.setPxRange) {
        batchHandler.setPxRange(src._pxRange || 4);
    }

    // Combine text color and tint into final tint value
    // Text color comes from MSDFText (setColor/setColorHex)
    // GameObject tint/alpha comes from Phaser properties
    const textColor = src._color;
    const alpha = src.alpha !== undefined ? src.alpha : 1.0;
    const tint = src.tint !== undefined ? src.tint : 0xFFFFFF;

    // Extract RGB from tint (note: Phaser stores as 0xRRGGBB)
    const tintR = ((tint >> 16) & 0xFF) / 255;
    const tintG = ((tint >> 8) & 0xFF) / 255;
    const tintB = (tint & 0xFF) / 255;

    // Multiply text color by tint (both in 0-1 range)
    const finalR = Math.floor(textColor.r * tintR * 255);
    const finalG = Math.floor(textColor.g * tintG * 255);
    const finalB = Math.floor(textColor.b * tintB * 255);
    const finalA = Math.floor(textColor.a * alpha * 255);

    // Pack into ABGR format for WebGL (little-endian U32)
    const tintValue = (finalA << 24) | (finalB << 16) | (finalG << 8) | finalR;

    tempTintData.tintTopLeft = tintValue;
    tempTintData.tintTopRight = tintValue;
    tempTintData.tintBottomLeft = tintValue;
    tempTintData.tintBottomRight = tintValue;

    // Batch all characters
    let batchedCount = 0;
    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];

        // Skip spaces and zero-width characters
        if (!char || char.w === 0 || char.h === 0) {
            continue;
        }

        // Batch this character
        BatchMSDFChar(
            drawingContext,
            batchHandler,
            texture,
            char,
            calcMatrix,
            tempTintData
        );
        batchedCount++;
    }

}

export default MSDFTextWebGLRenderer;
