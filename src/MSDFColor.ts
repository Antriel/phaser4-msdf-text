/**
 * Colour packing helpers shared by the renderer and the per-glyph seed path.
 *
 * The batch buffer stores each vertex colour as a normalized `UNSIGNED_BYTE`
 * vec4 — red in the low byte, so the fragment shader samples `.rgb`/`.a`
 * directly. We keep colour as `0xRRGGBB` (a clean V8 SMI) and alpha as a
 * separate `0-1` float everywhere up to the final pack, which avoids the boxed
 * `0xAARRGGBB` doubles and the divide/repack roundtrip the old ARGB path needed.
 */

/** A value per glyph quad corner. */
export interface Corners {
    topLeft: number;
    topRight: number;
    bottomLeft: number;
    bottomRight: number;
}

/** Packed per-corner u32 colours in the batch's ABGR layout, ready for `batch()`. */
export interface PackedCorners {
    colorTopLeft: number;
    colorTopRight: number;
    colorBottomLeft: number;
    colorBottomRight: number;
}

/**
 * Pack a `0xRRGGBB` colour and a `0-1` alpha into the ABGR u32 the batch buffer
 * expects (`(a<<24)|(b<<16)|(g<<8)|r`). Alpha is clamped so callers can hand us
 * raw products without worrying about overshoot.
 */
export function packColor(rgb: number, alpha: number): number {
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    const a = alpha <= 0 ? 0 : alpha >= 1 ? 255 : (alpha * 255) | 0;
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
