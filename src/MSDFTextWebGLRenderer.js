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

    console.log('[MSDFTextWebGLRenderer] Called with', characterCount, 'characters');

    if (characterCount === 0) {
        console.log('[MSDFTextWebGLRenderer] No characters to render');
        return;
    }

    const camera = drawingContext.camera;
    camera.addToRenderList(src);

    // Get batch handler instance (already resolved in constructor)
    const batchHandler = src.customRenderNodes.BatchHandler || src.defaultRenderNodes.BatchHandler;

    console.log('[MSDFTextWebGLRenderer] Batch handler:', batchHandler);

    if (!batchHandler) {
        console.warn('MSDFText: No batch handler found');
        console.log('[MSDFTextWebGLRenderer] customRenderNodes:', src.customRenderNodes);
        console.log('[MSDFTextWebGLRenderer] defaultRenderNodes:', src.defaultRenderNodes);
        return;
    }

    // Get MSDF texture
    const texture = src._texture;
    console.log('[MSDFTextWebGLRenderer] Texture:', texture);
    if (!texture) {
        console.warn('MSDFText: No texture found');
        return;
    }

    // Get calculation matrix (combines object transform, camera, and parent)
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
    console.log('[MSDFTextWebGLRenderer] Batching', characterCount, 'characters');
    let batchedCount = 0;
    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];

        // Skip spaces and zero-width characters
        if (!char || char.w === 0 || char.h === 0) {
            console.log('[MSDFTextWebGLRenderer] Skipping character', i, '(zero size)');
            continue;
        }

        console.log('[MSDFTextWebGLRenderer] Batching character', i, ':', char);

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
    console.log('[MSDFTextWebGLRenderer] Batched', batchedCount, 'characters');

    // IMPORTANT: Flush the batch to actually draw to screen
    // Without this, batches only flush when full (16384 instances)
    if (batchedCount > 0) {
        console.log('[MSDFTextWebGLRenderer] Flushing batch...');
        batchHandler.run(drawingContext);
    }
}

export default MSDFTextWebGLRenderer;
