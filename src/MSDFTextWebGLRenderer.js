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
 * Temporary character data object for callbacks (reused to avoid allocations)
 */
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

/**
 * Temporary matrix for per-character transforms (reused to avoid allocations)
 */
const tempCharMatrix = new Phaser.GameObjects.Components.TransformMatrix();

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

    // Check if we have a display callback
    const hasCallback = src.displayCallback && typeof src.displayCallback === 'function';

    // Batch all characters
    let batchedCount = 0;
    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];

        // Skip spaces and zero-width characters
        if (!char || char.w === 0 || char.h === 0) {
            continue;
        }

        // Prepare character data for rendering
        let charData = char;
        let charMatrix = calcMatrix;
        let charTint = tempTintData;

        // Invoke display callback if present
        if (hasCallback) {
            // Populate callback data
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

            // Set default tint values
            callbackData.tint.topLeft = tintValue;
            callbackData.tint.topRight = tintValue;
            callbackData.tint.bottomLeft = tintValue;
            callbackData.tint.bottomRight = tintValue;

            // Invoke callback
            const result = src.displayCallback(callbackData);

            // Apply callback modifications
            if (result) {
                // Check if position, scale, or rotation changed (compare to ORIGINAL values)
                const posChanged = result.x !== originalX || result.y !== originalY;
                const scaleChanged = result.scale !== 1;
                const rotationChanged = result.rotation !== 0;

                if (posChanged || scaleChanged || rotationChanged) {
                    // Copy character data
                    tempCharData.w = char.w;
                    tempCharData.h = char.h;
                    tempCharData.u0 = char.u0;
                    tempCharData.v0 = char.v0;
                    tempCharData.u1 = char.u1;
                    tempCharData.v1 = char.v1;

                    // Apply scale and rotation via matrix
                    if (scaleChanged || rotationChanged) {
                        // Calculate character center offset
                        const centerX = char.w / 2;
                        const centerY = char.h / 2;

                        // Start with parent transform
                        tempCharMatrix.copyFrom(calcMatrix);

                        // Translate to character position + center
                        tempCharMatrix.translate(result.x + centerX, result.y + centerY);

                        // Apply rotation (around center)
                        if (rotationChanged) {
                            tempCharMatrix.rotate(result.rotation);
                        }

                        // Apply scale (from center)
                        if (scaleChanged) {
                            tempCharMatrix.scale(result.scale, result.scale);
                        }

                        charMatrix = tempCharMatrix;

                        // Offset character quad so it draws centered on the transform
                        tempCharData.x = -centerX;
                        tempCharData.y = -centerY;
                    } else {
                        // Just position change, update directly
                        tempCharData.x = result.x;
                        tempCharData.y = result.y;
                    }

                    charData = tempCharData;
                }

                // Apply per-character tint if modified
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

        // Batch this character
        BatchMSDFChar(
            drawingContext,
            batchHandler,
            texture,
            charData,
            charMatrix,
            charTint
        );
        batchedCount++;
    }

}

export default MSDFTextWebGLRenderer;
