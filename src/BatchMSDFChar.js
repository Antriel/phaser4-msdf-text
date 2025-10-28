/**
 * Batch MSDF Character
 *
 * Renders one character of MSDF text to WebGL by submitting it to the batch handler.
 * This function computes the transformed quad vertices for a character and calls
 * the batch handler to accumulate it in the vertex buffer.
 *
 * Based on Phaser's BatchChar.js for BitmapText.
 *
 * @param {Phaser.Renderer.WebGL.DrawingContext} drawingContext - The current drawing context
 * @param {object} batchHandler - The MSDFBatchHandler instance
 * @param {object} texture - The MSDF texture wrapper
 * @param {object} char - Character data with position, size, and UV coordinates
 * @param {object} calcMatrix - Transform matrix for positioning
 * @param {object} tintData - Tint color data
 */
function BatchMSDFChar(drawingContext, batchHandler, texture, char, calcMatrix, tintData) {
    // Extract character position and size
    const x = char.x;
    const y = char.y;
    const w = char.w;
    const h = char.h;

    // Calculate quad corners
    const xw = x + w;
    const yh = y + h;

    // Extract transform matrix components
    const a = calcMatrix.a;
    const b = calcMatrix.b;
    const c = calcMatrix.c;
    const d = calcMatrix.d;
    const e = calcMatrix.e;
    const f = calcMatrix.f;

    // Transform quad corners to world space
    // Top-left (x0, y0)
    const tx0 = x * a + y * c + e;
    const ty0 = x * b + y * d + f;

    // Bottom-left (x1, y1)
    const tx1 = x * a + yh * c + e;
    const ty1 = x * b + yh * d + f;

    // Bottom-right (x2, y2)
    const tx2 = xw * a + yh * c + e;
    const ty2 = xw * b + yh * d + f;

    // Top-right (x3, y3)
    const tx3 = xw * a + y * c + e;
    const ty3 = xw * b + y * d + f;

    // Extract UV coordinates (already mapped to character region in atlas)
    const u0 = char.u0;
    const v0 = char.v0;
    const u1 = char.u1;
    const v1 = char.v1;

    // Extract tint colors (packed RGBA as U32)
    const tintTL = tintData.tintTopLeft;
    const tintBL = tintData.tintBottomLeft;
    const tintTR = tintData.tintTopRight;
    const tintBR = tintData.tintBottomRight;

    // Batch the character quad
    // NOTE: MSDFBatchHandler expects: BL, TL, TR, BR
    batchHandler.batch(
        drawingContext,
        texture,
        tx1, ty1,  // Bottom-left (was tx0, ty0)
        tx0, ty0,  // Top-left (was tx1, ty1)
        tx3, ty3,  // Top-right (was tx2, ty2)
        tx2, ty2,  // Bottom-right (was tx3, ty3)
        u0, v0,    // UV top-left
        u1, v1,    // UV bottom-right
        tintBL, tintTL, tintTR, tintBR  // Tint colors (reordered to match vertices)
    );
}

export default BatchMSDFChar;
