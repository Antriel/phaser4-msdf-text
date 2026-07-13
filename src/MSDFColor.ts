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
 * then `rounded`, `width`, `softness`. All four are continuous, so all four are
 * per-corner for free. Its numeric channels are
 * **fractions of the atlas `distanceRange`**, normalized on the CPU by the
 * glyph's own font, which is what makes them font-independent (a glyph from a
 * `distanceRange 4` atlas and one from a `distanceRange 8` atlas both encode
 * "outline = 0.15 of the range") and what lets `distanceRange` cancel out of
 * every shader branch. The shader in `MSDFBatchHandler.ts` decodes with the
 * exact inverse of {@link packParams} — there is no second source of truth.
 *
 * The upper two channels describe the *outline / shadow layer*, not one named
 * effect, which is why each serves two: `width` is how far outside the fill edge
 * that layer's edge sits — an outline's thickness on a fill quad, a shadow's
 * **spread** (silhouette dilation) on a shadow quad, whose fill is off and whose
 * blur is centred on that same edge. `softness` blurs that layer wherever it is
 * set, so a fill quad carrying one is an outline that glows, in one quad, with no
 * shadow pass at all. One decode either way — no channel selects how another is
 * read, which is the rule that keeps a per-corner ramp from straddling a
 * threshold mid-quad.
 *
 * A **solid** quad ({@link packSolidParams}) reinterprets the upper three
 * channels: `rounded` becomes a corner radius, `outlineWidth` a border width and
 * `shadowSoftness` an edge blur, each a fraction of the rect's own half-thickness
 * rather than of any `distanceRange`. Re-decoding a channel from an interpolated
 * selector is exactly what this format forbids, but `weight = 255` is not
 * interpolated: a rect writes it to all four corners by construction, so it is
 * uniform across the quad in the same way, and for the same reason, the `solid`
 * short-circuit itself is.
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
 * The `params` value for a plain, square-cornered rect: `weight = 255` is the
 * solid sentinel, and the other three channels are zero — no corner radius, no
 * border, no softness, which is a hard-edged box. Equal to
 * `packSolidParams(0, 0, 0)`; kept as a constant because underline and
 * strikethrough rects are exactly that and never need to pack anything.
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
 * - `width` — the layer's edge is `fillEdge - width` against a field that clamps
 *   at 0, so only `[0, 0.5]` of the range does anything. The byte covers exactly
 *   that, at double precision.
 * - `softness` — genuinely useful over the full `[0, 1]` of the range.
 *
 * @param weightNorm  Faux-bold threshold shift, as a signed fraction of `distanceRange`.
 * @param roundedNorm Sharp (`0`) to fully rounded (`1`) outline / shadow edge.
 * @param widthNorm   How far the outline / shadow layer's edge sits outside the
 *   fill edge, as a fraction of `distanceRange` — an outline's width, or a
 *   shadow's spread (`0` = neither: the layer's edge is the glyph's).
 * @param softNorm    Blur of that layer, as a fraction of `distanceRange` (`0` =
 *   hard edge). Blurs a shadow or an outline alike.
 */
export function packParams(weightNorm: number, roundedNorm: number, widthNorm: number, softNorm: number): number {
    const raw = toByte(weightNorm * 255 + 128);
    const w = raw > WEIGHT_MAX_BYTE ? WEIGHT_MAX_BYTE : raw;
    const g = toByte(roundedNorm * 255);
    const b = toByte(widthNorm * 510);
    const a = toByte(softNorm * 255);
    return ((a << 24) | (b << 16) | (g << 8) | w) >>> 0;
}

/**
 * Pack the four `params` channels of a **solid** quad — a decoration rect or a
 * highlight pill. `weight` is the {@link SOLID_PARAMS} sentinel; the other three
 * describe a rounded box, evaluated by the shader against the rect's own `0..1`
 * UVs rather than against the atlas.
 *
 * All three are fractions of the rect's **half-thickness** (`min(w, h) / 2`,
 * recovered in the shader from `fwidth(texCoord)`), which is the only length a
 * quad knows about itself. That makes them resolution- and size-independent: a
 * radius of `1` is a stadium at any pixel size, and the pill scales with the
 * camera exactly as the text does.
 *
 * They are continuous, so — like every glyph channel — they are per-corner for
 * free: a radius that differs per corner rounds each corner by its own amount
 * (the interpolated value near a corner is dominated by that corner's), and a
 * per-corner softness blurs one side of a pill while the other stays crisp.
 *
 * @param radiusNorm Corner radius; `0` square, `1` a stadium/capsule.
 * @param borderNorm Border ring width; `0` no border, `1` a ring that fills the pill.
 * @param softNorm   Edge blur, fading **inward** from the box (a rect has no bleed
 *                   room outside its quad); `0` a 1-screen-pixel antialiased edge.
 */
export function packSolidParams(radiusNorm: number, borderNorm: number, softNorm: number): number {
    const g = toByte(radiusNorm * 255);
    const b = toByte(borderNorm * 255);
    const a = toByte(softNorm * 255);
    return ((a << 24) | (b << 16) | (g << 8) | 0xff) >>> 0;
}
