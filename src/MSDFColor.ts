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
 *
 * `solid` is a sentinel **value**, not a bit, so it can name more than one thing.
 * {@link packDashParams} claims a second one — byte `254`, a *dashed* rect — and
 * with it the middle channel, which becomes a **duty cycle** instead of a border
 * width. It needs no byte for the dash *count*, because a dashed rect spans that
 * many cells of its own U coordinate rather than the usual `0..1`: the count (and
 * the marching-ants phase with it) rides the UVs at full float precision, and
 * `screenTexSize.x` — the derivative the shader already computes — comes out as
 * one dash period in pixels. Telling `254` from `255` is safe for exactly the
 * reason `solid` is: both are written to all four corners by construction.
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
 * The two `weight` bytes that mean "this quad is a rect, not a glyph": `255` is a
 * plain box or pill ({@link packSolidParams}), `254` a dashed one
 * ({@link packDashParams}). The shader takes the solid lane at `≥ 253` and tells
 * the two variants apart at `254.5`.
 */
const SOLID_SENTINEL = 255;
const DASH_SENTINEL = 254;

/**
 * The largest `weight` byte a real glyph may carry — one full byte below the
 * shader's `253` solid threshold, so a `mediump` varying can never interpolate a
 * bold glyph across it. (The two sentinels above sit half a byte either side of
 * their own threshold, which needs no guard: both are written to all four corners
 * by construction, so there is nothing to interpolate.)
 *
 * The cost is the top `3/255` of the faux-bold range (`weightNorm` saturates at
 * `≈0.4863` instead of `0.5`). At that end the fill edge has already collapsed
 * onto the field's own clamp and neighbouring letters overlap, so the sacrifice
 * is invisible — see the sentinel discussion in `design/future-ideas.md`.
 */
const WEIGHT_MAX_BYTE = 252;

/**
 * The `params` value for a plain, square-cornered rect: the solid sentinel, and
 * the other three channels zero — no corner radius, no border, no softness, which
 * is a hard-edged box. Equal to `packSolidParams(0, 0, 0)`; kept as a constant
 * because an undashed underline or strikethrough is exactly that and never needs
 * to pack anything.
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
 *   top of the byte is clipped to {@link WEIGHT_MAX_BYTE}, reserving the top of
 *   the range for the rect sentinels.
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
    return ((a << 24) | (b << 16) | (g << 8) | SOLID_SENTINEL) >>> 0;
}

/**
 * Pack the four `params` channels of a **dashed** rect — the second solid
 * variant. `radius` and `softness` keep the meaning {@link packSolidParams} gives
 * them, and the middle channel becomes the dash's **duty cycle** rather than a
 * border width (a dashed rule has no ring to draw, and the shader zeroes the
 * border on this variant so a duty byte can never inset the face).
 *
 * The dash **count** takes no byte at all. A dashed rect spans that many cells of
 * its own U coordinate instead of the usual `0..1`, so the shader recovers one
 * period in pixels from the derivative it already computes and folds U into a
 * single cell with `fract`. Count and phase therefore ride the vertex UVs at full
 * float precision, which is what leaves room here for a duty cycle *and* keeps
 * marching ants free: sliding the U origin costs nothing at submit time.
 *
 * The fold is seamless because `roundedBox` is even in x about the cell centre —
 * `fract` 0 and `fract` 1 are the same distance — so a dash may be cut by the
 * rect's own edge without a sliver appearing where U wraps.
 *
 * @param radiusNorm Cap rounding, `0` (square) to `1` (a stadium — a round dot at
 *                   a short enough `dutyNorm`). Fraction of the dash's own
 *                   half-thickness, `min(dashLength, thickness) / 2`.
 * @param dutyNorm   Dash length as a fraction of the period. Must be `> 0` (a
 *                   zero-length dash leaves a 1px hairline per cell) and `< 1`
 *                   (at `1` the dashes touch, and the crease where they meet
 *                   reads as a half-covered seam).
 * @param softNorm   Edge blur, as for a pill: fades inward, `0` is a 1-screen-pixel
 *                   antialiased edge.
 */
export function packDashParams(radiusNorm: number, dutyNorm: number, softNorm: number): number {
    const g = toByte(radiusNorm * 255);
    const b = toByte(dutyNorm * 255);
    const a = toByte(softNorm * 255);
    return ((a << 24) | (b << 16) | (g << 8) | DASH_SENTINEL) >>> 0;
}
