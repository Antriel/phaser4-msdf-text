/**
 * MSDF Text WebGL Renderer
 *
 * Renders MSDFText Game Objects with WebGL using batched rendering.
 * This renderer iterates through all characters in the text and batches them
 * for efficient rendering in 1-2 draw calls instead of one per character.
 *
 * Based on BitmapTextWebGLRenderer from Phaser 4.
 */

const BatchMSDFChar = require('./BatchMSDFChar');

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

    // Get batch handler (custom MSDF batch handler)
    const batchHandler = src.customRenderNodes && src.customRenderNodes.BatchHandler
        ? src.customRenderNodes.BatchHandler
        : src.defaultRenderNodes && src.defaultRenderNodes.BatchHandler;

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

    // Get calculation matrix (combines object transform, camera, and parent)
    const GetCalcMatrix = require('phaser/src/gameobjects/GetCalcMatrix');
    const calcMatrix = GetCalcMatrix(src, camera, parentMatrix, !drawingContext.useCanvas).calc;

    // Setup MSDF-specific parameters on batch handler
    if (batchHandler.setPxRange) {
        batchHandler.setPxRange(src._pxRange || 4);
    }
    if (batchHandler.setTextColor) {
        const color = src._color;
        batchHandler.setTextColor(color.r, color.g, color.b, color.a);
    }

    // Get tint color
    const alpha = src.alpha;
    const tint = src.tint;
    const tintValue = ((tint & 0xFF) << 16) | (tint & 0xFF00) | ((tint >> 16) & 0xFF) | (Math.floor(alpha * 255) << 24);

    tempTintData.tintTopLeft = tintValue;
    tempTintData.tintTopRight = tintValue;
    tempTintData.tintBottomLeft = tintValue;
    tempTintData.tintBottomRight = tintValue;

    // Batch all characters
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
    }
}

module.exports = MSDFTextWebGLRenderer;
