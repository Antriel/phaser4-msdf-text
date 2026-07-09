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
 * then `rounded`, `outlineWidth`, `shadowSoftness`. All four are continuous, so
 * all four are per-corner for free. Its numeric channels are
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

/**
 * The largest `weight` byte a real glyph may carry. `255` is reserved as the
 * {@link SOLID_PARAMS} sentinel, and the shader splits the two at `254`, so both
 * sides keep a full byte of guard band — wide enough that a `mediump` varying
 * can never interpolate a bold glyph across the threshold.
 *
 * The cost is the top `2/255` of the faux-bold range (`weightNorm` saturates at
 * `≈0.4902` instead of `0.5`). At that end the fill edge has already collapsed
 * onto the field's own clamp and neighbouring letters overlap, so the sacrifice
 * is invisible — see the sentinel discussion in `design/future-ideas.md`.
 */
const WEIGHT_MAX_BYTE = 253;

/**
 * The whole `params` value for an underline / strikethrough rect: coverage `1`,
 * no distance field, no outline. `weight = 255` *is* the signal — a solid quad
 * never reads `weight`, `outlineWidth` or `shadowSoftness`, because the shader
 * short-circuits its coverage before touching them.
 *
 * A constant is safe under interpolation for the same reason the old bitfield
 * was not: a rect's four corners carry identical values by construction, so
 * there is nothing to interpolate.
 */
export const SOLID_PARAMS = 0x000000ff;

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
 *   the same constant, or every glyph would pick up a hair of faux bold. The
 *   top of the byte is clipped to {@link WEIGHT_MAX_BYTE}, reserving `255` for
 *   the {@link SOLID_PARAMS} sentinel.
 * - `rounded` — how far the outline / shadow edge slides from `median(rgb)`
 *   towards the true SDF (MTSDF only). The shader `mix()`es on it, so the whole
 *   `[0, 1]` is meaningful and intermediate corners blend sharp into round.
 * - `outlineWidth` — the outline edge is `fillEdge - width` against a field
 *   that clamps at 0, so only `[0, 0.5]` of the range does anything. The byte
 *   covers exactly that, at double precision.
 * - `shadowSoftness` — genuinely useful over the full `[0, 1]` of the range.
 *
 * @param weightNorm  Faux-bold threshold shift, as a signed fraction of `distanceRange`.
 * @param roundedNorm Sharp (`0`) to fully rounded (`1`) outline / shadow edge.
 * @param widthNorm   Outline width, as a fraction of `distanceRange` (`0` = none).
 * @param softNorm    Shadow blur, as a fraction of `distanceRange` (`0` = hard edge).
 */
export function packParams(weightNorm: number, roundedNorm: number, widthNorm: number, softNorm: number): number {
    const raw = toByte(weightNorm * 255 + 128);
    const w = raw > WEIGHT_MAX_BYTE ? WEIGHT_MAX_BYTE : raw;
    const g = toByte(roundedNorm * 255);
    const b = toByte(widthNorm * 510);
    const a = toByte(softNorm * 255);
    return ((a << 24) | (b << 16) | (g << 8) | w) >>> 0;
}
