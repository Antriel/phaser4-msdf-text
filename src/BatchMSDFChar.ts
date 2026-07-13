/**
 * Submits one MSDF character quad to the batch handler.
 *
 * Computes transformed quad vertices for the character and forwards them to
 * MSDFBatchHandler.batch(). Mirrors Phaser's BatchChar.js for BitmapText.
 *
 * Each vertex carries three packed u32s: `colorData` (the fill), `outlineData`
 * (the outline colour — also where a shadow quad's colour rides, since shadows
 * are drawn as outline-only quads) and `params` (weight / rounded / outline
 * width / shadow softness; see `MSDFColor.packParams`).
 */

import type { MSDFBatchHandlerInstance } from './MSDFBatchHandler';
import type { Corners, PackedCorners } from './MSDFColor';

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

/**
 * `deformX`/`deformY` (with `em`) displace the four corners *before* the matrix,
 * so a deform lands in the quad's own local space and the glyph's scale/rotation
 * apply on top of it. `null` is the undeformed case and skips the work entirely.
 *
 * Moving the corners independently is what takes the quad off the affine
 * manifold — the two triangles keep their own affine UV maps, so a
 * non-parallelogram creases the texture along the shared diagonal. That is a
 * known, accepted cost (see `GlyphState.offsetX`), not an oversight.
 */
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
    params: PackedCorners,
    deformX: Corners | null,
    deformY: Corners | null,
    em: number
): void {
    const x = char.x + offsetX;
    const y = char.y + offsetY;
    const xw = x + char.w;
    const yh = y + char.h;

    const { a, b, c, d, e, f } = calcMatrix;

    // Untransformed corners: TL, BL, BR, TR.
    let x0 = x, y0 = y;
    let x1 = x, y1 = yh;
    let x2 = xw, y2 = yh;
    let x3 = xw, y3 = y;

    if (deformX !== null) {
        const dy = deformY!;
        x0 += deformX.topLeft * em; y0 += dy.topLeft * em;
        x1 += deformX.bottomLeft * em; y1 += dy.bottomLeft * em;
        x2 += deformX.bottomRight * em; y2 += dy.bottomRight * em;
        x3 += deformX.topRight * em; y3 += dy.topRight * em;
    }

    const tx0 = x0 * a + y0 * c + e;
    const ty0 = x0 * b + y0 * d + f;
    const tx1 = x1 * a + y1 * c + e;
    const ty1 = x1 * b + y1 * d + f;
    const tx2 = x2 * a + y2 * c + e;
    const ty2 = x2 * b + y2 * d + f;
    const tx3 = x3 * a + y3 * c + e;
    const ty3 = x3 * b + y3 * d + f;

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
