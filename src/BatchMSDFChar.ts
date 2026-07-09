/**
 * Submits one MSDF character quad to the batch handler.
 *
 * Computes transformed quad vertices for the character and forwards them to
 * MSDFBatchHandler.batch(). Mirrors Phaser's BatchChar.js for BitmapText.
 *
 * Each vertex carries three packed u32s: `colorData` (the fill), `outlineData`
 * (the outline colour — also where a shadow quad's colour rides, since shadows
 * are drawn as outline-only quads) and `params` (weight / flags / outline width
 * / shadow softness; see `MSDFColor.packParams`).
 */

import type { MSDFBatchHandlerInstance } from './MSDFBatchHandler';
import type { PackedCorners } from './MSDFColor';

interface CharQuad {
    x: number;
    y: number;
    w: number;
    h: number;
    u0: number;
    v0: number;
    u1: number;
    v1: number;
}

interface CalcMatrix {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

function BatchMSDFChar(
    drawingContext: any,
    batchHandler: MSDFBatchHandlerInstance,
    texture: any,
    char: CharQuad,
    offsetX: number,
    offsetY: number,
    calcMatrix: CalcMatrix,
    colorData: PackedCorners,
    outlineData: PackedCorners,
    params: PackedCorners
): void {
    const x = char.x + offsetX;
    const y = char.y + offsetY;
    const xw = x + char.w;
    const yh = y + char.h;

    const { a, b, c, d, e, f } = calcMatrix;

    const tx0 = x * a + y * c + e;
    const ty0 = x * b + y * d + f;
    const tx1 = x * a + yh * c + e;
    const ty1 = x * b + yh * d + f;
    const tx2 = xw * a + yh * c + e;
    const ty2 = xw * b + yh * d + f;
    const tx3 = xw * a + y * c + e;
    const ty3 = xw * b + y * d + f;

    // MSDFBatchHandler expects: BL, TL, TR, BR
    batchHandler.batch(
        drawingContext,
        texture,
        tx1, ty1,
        tx0, ty0,
        tx3, ty3,
        tx2, ty2,
        char.u0, char.v0,
        char.u1, char.v1,
        colorData.bottomLeft,
        colorData.topLeft,
        colorData.topRight,
        colorData.bottomRight,
        outlineData.bottomLeft,
        outlineData.topLeft,
        outlineData.topRight,
        outlineData.bottomRight,
        params.bottomLeft,
        params.topLeft,
        params.topRight,
        params.bottomRight
    );
}

export default BatchMSDFChar;
export { BatchMSDFChar };
