/**
 * Submits one MSDF character quad to the batch handler.
 *
 * Computes transformed quad vertices for the character and forwards them to
 * MSDFBatchHandler.batch(). Mirrors Phaser's BatchChar.js for BitmapText.
 */

import type { MSDFBatchHandlerInstance } from './MSDFBatchHandler';

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

interface TintData {
    tintTopLeft: number;
    tintTopRight: number;
    tintBottomLeft: number;
    tintBottomRight: number;
}

function BatchMSDFChar(
    drawingContext: any,
    batchHandler: MSDFBatchHandlerInstance,
    texture: any,
    char: CharQuad,
    offsetX: number,
    offsetY: number,
    calcMatrix: CalcMatrix,
    tintData: TintData
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
        tintData.tintBottomLeft,
        tintData.tintTopLeft,
        tintData.tintTopRight,
        tintData.tintBottomRight
    );
}

export default BatchMSDFChar;
export { BatchMSDFChar };
