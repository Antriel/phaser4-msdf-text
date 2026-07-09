/**
 * Vertex-attribute packing helpers shared by the renderer and the per-glyph
 * seed path.
 *
 * The batch buffer stores each vertex colour as a normalized `UNSIGNED_BYTE`
 * vec4 — red in the low byte, so the fragment shader samples `.rgb`/`.a`
 * directly. We keep colour as `0xRRGGBB` (a clean V8 SMI) and alpha as a
 * separate `0-1` float everywhere up to the final pack, which avoids the boxed
 * `0xAARRGGBB` doubles and the divide/repack roundtrip the old ARGB path needed.
 *
 * The `params` attribute uses the same byte order: `weight` in the low byte,
 * then `flags`, `outlineWidth`, `shadowSoftness`. Its numeric channels are
 * **fractions of the atlas `distanceRange`**, normalized on the CPU by the
 * glyph's own font, which is what makes them font-independent (a glyph from a
 * `distanceRange 4` atlas and one from a `distanceRange 8` atlas both encode
 * "outline = 0.15 of the range") and what lets `distanceRange` cancel out of
 * every shader branch. The shader in `MSDFBatchHandler.ts` decodes with the
 * exact inverse of {@link packParams} — there is no second source of truth.
 */

/** A value per glyph quad corner. */
export interface Corners {
    topLeft: number;
    topRight: number;
    bottomLeft: number;
    bottomRight: number;
}

/** Packed per-corner u32 attribute values, ready for `batch()`. */
export interface PackedCorners {
    topLeft: number;
    topRight: number;
    bottomLeft: number;
    bottomRight: number;
}

/** `params.g` bit: take the outline/shadow edge from the true SDF (MTSDF only). */
export const PARAM_ROUNDED = 1;
/** `params.g` bit: full coverage, no distance field — underline/strike rects. */
export const PARAM_SOLID = 2;

/** Round to a `0-255` byte, saturating at both ends. */
function toByte(value: number): number {
    return value <= 0 ? 0 : value >= 255 ? 255 : (value + 0.5) | 0;
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

/**
 * Pack the four `params` channels into the u32 the batch buffer expects.
 *
 * Each numeric channel spans only the interval where it does anything, so no
 * precision is wasted:
 *
 * - `weight` — the fill's distance threshold shifts by this much, so only
 *   `±0.5` of the range clears the field's own clamp. Neutral is byte `128`,
 *   which decodes to `128/255 ≈ 0.50196`, *not* `0.5` — the shader subtracts
 *   the same constant, or every glyph would pick up a hair of faux bold.
 * - `flags` — a bitfield ({@link PARAM_ROUNDED} | {@link PARAM_SOLID}). It
 *   cannot survive interpolation, so callers must write the **same** value to
 *   all four corners of a quad. GLSL ES 1.00 has no `flat` qualifier.
 * - `outlineWidth` — the outline edge is `fillEdge - width` against a field
 *   that clamps at 0, so only `[0, 0.5]` of the range does anything. The byte
 *   covers exactly that, at double precision.
 * - `shadowSoftness` — genuinely useful over the full `[0, 1]` of the range.
 *
 * @param weightNorm Faux-bold threshold shift, as a signed fraction of `distanceRange`.
 * @param flags      Per-glyph bitfield, identical across the quad's four corners.
 * @param widthNorm  Outline width, as a fraction of `distanceRange` (`0` = none).
 * @param softNorm   Shadow blur, as a fraction of `distanceRange` (`0` = hard edge).
 */
export function packParams(weightNorm: number, flags: number, widthNorm: number, softNorm: number): number {
    const w = toByte(weightNorm * 255 + 128);
    const f = flags & 0xff;
    const b = toByte(widthNorm * 510);
    const a = toByte(softNorm * 255);
    return ((a << 24) | (b << 16) | (f << 8) | w) >>> 0;
}
