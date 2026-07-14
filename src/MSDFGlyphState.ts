/**
 * Per-glyph render state, exposed to display callbacks and to `editGlyphs()`.
 *
 * Each renderable glyph has one of these. The renderer seeds the numeric fields
 * with the text object's effective colour/alpha/position before the user gets
 * them, then reads them back to fill the GPU buffer — there is no intermediate
 * copy, so a `glyphs` array element *is* the source of truth for that glyph.
 *
 * Colour is `0xRRGGBB` (a clean V8 SMI) and alpha is a separate `0-1` float, on
 * three independent aspects — `fill`, `shadow`, `outline` — so you can change
 * one channel of one aspect without disturbing the others. The scalar helpers
 * cover the common "all four corners the same" case; reach into the per-corner
 * `Corners` objects only for gradients.
 *
 * The one thing a glyph's alpha is *not* is the object's `alpha`. That is a
 * modulation the renderer multiplies in when it packs, so it composes with
 * whatever is written here instead of being overwritten by it: fading a text out
 * fades its glyphs, its runs' shadows and its pills, whoever last set their alpha.
 *
 * `weight` and every effect channel on the two layers — `outline.width` /
 * `.rounded` / `.softness`, `shadow.softness` / `.spread` / `.rounded` — are
 * per-corner too, because they ride the same interpolated vertex attribute: a
 * faux-bold gradient, a directional outline, a soft-on-one-side shadow, a shadow
 * that spreads to one side, or an outline that melts from sharp to round across
 * the glyph all cost nothing extra. The interpolation is linear across the quad's
 * bounding box, not along the letter contour, so think "directional ramp", not
 * "contour-following pulse".
 *
 * The transform lane is likewise per-corner at its far end: `offsetX` / `offsetY`
 * displace the quad's four corners directly, which is strictly more than `scale`,
 * `rotation` and `skew` can express between them (they only ever produce
 * parallelograms). See `offsetX` for what that buys and the one artifact it costs.
 *
 * The shape is frozen and reused across frames: keep colour fields integer and
 * alpha fields fractional so V8 holds the hidden class and field representations
 * stable across the (potentially thousands of) per-glyph iterations.
 */

import type { Corners } from './MSDFColor';

/** Fill, shadow and outline each expose a per-corner colour + alpha. */
export interface GlyphAspect {
    /** Per-corner colour, packed `0xRRGGBB`. */
    color: Corners;
    /** Per-corner alpha, `0-1`. */
    alpha: Corners;
}

export interface GlyphShadow extends GlyphAspect {
    /**
     * Per-corner colour of the shadow's inner edge, where it meets the glyph
     * (seeded from `shadowInnerColor`, which defaults to the shadow colour).
     * The shadow ramps from `color` at its outer edge to this — a white-hot glow
     * core inside a coloured halo. Equal colours are a no-op.
     */
    innerColor: Corners;
    /** Per-glyph shadow X offset in pixels (seeded from `shadowX`). */
    x: number;
    /** Per-glyph shadow Y offset in pixels (seeded from `shadowY`). */
    y: number;
    /**
     * Per-corner shadow blur in distance-field units (seeded from
     * `shadowSoftness`). `0` is a hard edge. Needs an MTSDF atlas; forced to `0`
     * on a plain MSDF font. Bounded by the atlas `distanceRange`.
     */
    softness: Corners;
    /**
     * Per-corner dilation of the shadow's silhouette before it is blurred, in
     * distance-field units (seeded from `shadowSpread`) — Photoshop's *spread*
     * next to its *size*. `0` traces the glyph exactly. Fattens a shadow without
     * mushing it, which {@link softness} alone cannot do; works on plain MSDF
     * atlases, since it dilates the same field a thick outline does. Saturates at
     * half the atlas `distanceRange`, like `outline.width` — and, like a thick
     * outline, a *hard* spread past ~0.3 of the range starts to be eaten by the
     * shader's background-haze guard. Any softness at all lifts that guard.
     */
    spread: Corners;
    /**
     * Per-corner rounding of the shadow's silhouette, `0` (sharp, from
     * `median(rgb)`) to `1` (rounded, from the true SDF). Seeded to `1` or `0`
     * from `shadowRounded`, which **defaults on** — rounding is a no-op until
     * {@link spread} or {@link softness} lifts the silhouette off the glyph
     * contour, and where it does bite, a sharp dilation grows mitre spikes at
     * every corner. Set `0` for those spikes. Needs an MTSDF atlas; forced to `0`
     * on a plain MSDF font.
     */
    rounded: Corners;
}

export interface GlyphOutline extends GlyphAspect {
    /**
     * Per-corner colour of the outline's inner edge, where it meets the glyph
     * (seeded from `outlineInnerColor`, which defaults to the outline colour).
     * The outline ramps from `color` at its outer edge to this across the band.
     * Equal colours are a no-op. **Requires `outlineLayered`** — a combined
     * fill+outline quad needs its colour attribute for the fill, so there is
     * nowhere to put a second colour. Setting the object-level
     * `outlineInnerColor` turns layering on for you.
     */
    innerColor: Corners;
    /**
     * Per-corner outline width in distance-field units (seeded from
     * `outlineWidth`). `0` disables this glyph's outline entirely — the colour
     * and alpha are then ignored. Saturates at half the atlas `distanceRange`.
     */
    width: Corners;
    /**
     * Per-corner rounding of this glyph's outer outline corners, `0` (sharp,
     * from `median(rgb)`) to `1` (fully rounded, from the true SDF). Seeded to
     * `1` or `0` from `outlineRounded`; intermediate values blend the two edges,
     * so a gradient across the corners melts a sharp outline into a round one.
     * Needs an MTSDF atlas; forced to `0` on a plain MSDF font.
     */
    rounded: Corners;
    /**
     * Per-corner blur of the outline's outer edge, in distance-field units
     * (seeded from `outlineSoftness`). `0` is the plain 1-screen-pixel edge.
     *
     * The blur is centred on the outline edge, so its inner half hides under the
     * opaque fill and only the outer edge visibly softens — a glow that costs no
     * shadow pass and no second quad. With {@link width} at `0` the whole outline
     * *is* that glow, hugging the letterform. Needs an MTSDF atlas; forced to `0`
     * on a plain MSDF font.
     */
    softness: Corners;
}

export interface GlyphState {
    /** Index of this glyph among the renderable glyphs (0-based). */
    readonly index: number;
    /** Character code of this glyph. */
    readonly charCode: number;
    /**
     * Index of this glyph's character in the original `text` string (before word
     * wrapping). `text[srcIndex]` is this glyph's character. Monotonic across the
     * glyph array but non-contiguous (spaces/newlines produce no glyph).
     */
    readonly srcIndex: number;
    /** Visual line index, counting both wrapped (soft) and original (hard) breaks. */
    readonly line: number;
    /** Source paragraph index: how many original `'\n'` precede this glyph (soft breaks don't count). */
    readonly srcLine: number;

    /** Width of this glyph's quad in text-space pixels (before {@link scaleX}). */
    readonly width: number;
    /** Height of this glyph's quad in text-space pixels (before {@link scaleY}). */
    readonly height: number;
    /**
     * This glyph's effective font size in pixels — the object's `fontSize` times
     * its run's `fontScale`. The unit {@link offsetX} / {@link offsetY} /
     * {@link skewPivot} are measured in, and the scale factor to reach for when a
     * deform should read the same on every glyph of a run regardless of how wide
     * the letter is.
     */
    readonly em: number;
    /**
     * Distance from this glyph's quad top ({@link y}) down to its layout baseline,
     * in pixels. `y + baselineOffset` is the baseline a shear pivots on at
     * `skewPivot === 0`; the whole line shares that value.
     */
    readonly baselineOffset: number;

    /**
     * The extra advance the layout inserted **before** this glyph, in pixels — the
     * `space` pad of its run (or of the spacing callback), already multiplied by
     * this glyph's {@link em}. `0` on almost every glyph: only a run's first
     * character carries one.
     *
     * Readonly, because it is layout *output* here. A pad is real advance — it moves
     * the pen, so it feeds wrap, line width, alignment and the decoration rects —
     * which makes it a layout *input* on the other side of the boundary, where
     * `StyleSpec.space` and `setSpacingCallback` live. Writing it per frame would
     * mean relaying out the text per frame. To animate spacing, displace
     * {@link offsetX} instead (an advance is its prefix sum) and let the line keep
     * its wrap and its alignment.
     *
     * What it is *for* is reading: a deform that has to know how much room it was
     * given, or a callback that wants to draw into the gap it asked a run for.
     */
    readonly padBefore: number;
    /** The extra advance inserted **after** this glyph, in pixels. See {@link padBefore}. */
    readonly padAfter: number;

    /**
     * Draw a **different letterform** in this glyph's slot. `0` (the default) draws
     * the character the text says it is; any other char code substitutes that
     * glyph, taken from *this* glyph's own run font. Use {@link setGlyph}, which
     * also accepts a string.
     *
     * The substitution is render-time only: the slot keeps the original's pen
     * position and advance, so **the layout does not move**. That is the point —
     * a scramble/decode reveal, slot-machine letters, a glitch that swaps a letter
     * for three frames all want the letterforms to churn *in place*. Doing this by
     * calling `setText` every frame instead would relayout the text and make the
     * line breathe as the letters change width.
     *
     * The consequence of a fixed slot is that a substitute wider than the original
     * overhangs it, and a narrower one leaves a gap. A monospaced font — or a
     * scramble drawn from characters of similar width — hides that entirely.
     *
     * A code the run's font does not have falls back to the original character
     * (never to another run's font — the no-cross-font-fallback rule holds here as
     * everywhere). {@link width} / {@link height} keep describing the **layout
     * box**, not the substitute's quad, so a deform written as a field over text
     * space stays anchored to the slot while the letters churn.
     */
    glyph: number;

    /**
     * Whether this glyph is drawn at all. `false` skips its quad in every pass —
     * fill, outline silhouette and shadow — before any of them is packed.
     *
     * Not the same as a zero alpha or a zero scale, which both still submit the
     * quad and let the GPU blend or rasterize nothing: an unrevealed glyph in a
     * typewriter costs three quads that way and none of them this way. Reach for
     * alpha when the glyph is *fading*, and for this when it is *absent*.
     *
     * A hidden glyph keeps its layout: it does not close the gap it leaves, and
     * the decorations under it (which follow the layout, not the glyphs) still
     * draw. Hide those with the decoration callback.
     */
    visible: boolean;

    /** Glyph X in text space (seeded from layout). */
    x: number;
    /** Glyph Y in text space (seeded from layout). */
    y: number;
    /** Horizontal glyph scale about its centre. `0` hides it. */
    scaleX: number;
    /** Vertical glyph scale about its centre. `0` hides it. */
    scaleY: number;
    /** Glyph rotation about its centre, in radians. */
    rotation: number;
    /**
     * Horizontal baseline shear (`dx/dy`) — faux italic. Positive leans the top
     * of the glyph to the right. Stored as a raw factor (not radians / degrees)
     * to avoid a per-glyph `tan`. The pivot is the glyph's *layout* baseline (see
     * {@link skewPivot}), so a whole line slants consistently. Seeded to `0`;
     * animatable like rotation.
     */
    skew: number;
    /**
     * Where {@link skew} pivots, as an offset from the layout baseline in
     * {@link em} units, positive **down**. `0` (the default) pivots on the
     * baseline itself; `0.2` or so puts it under the descenders, which shears a
     * glyph about its visual base rather than its baseline.
     *
     * Measured from the baseline rather than as a fraction of the glyph's own box
     * on purpose: the baseline is the one anchor a line *shares*, so any constant
     * value keeps every glyph on a line pivoting about the same horizontal line
     * and the line slants as one. A fraction of the box would pivot a `g` and an
     * `x` about different lines and shear them apart — and could not name the
     * baseline at all, since the baseline sits at a different fraction of every
     * glyph's box.
     */
    skewPivot: number;
    /**
     * Per-corner X displacement of this glyph's quad, in {@link em} units. Applied
     * in the glyph's own local frame, so {@link scaleX} / {@link scaleY} /
     * {@link rotation} apply *on top of* it — the deform is part of the letterform,
     * not part of the transform.
     *
     * This is the general primitive under the transform lane: any affine map of a
     * rectangle is a parallelogram, so scale, rotation and skew together only ever
     * move these four corners *subject to opposite edges staying parallel*. Writing
     * the corners directly drops that constraint — trapezia, keystones, jelly
     * wobble, drooping/melting glyphs, per-glyph jitter. It subsumes {@link skew}
     * at every {@link skewPivot} (a shear moves corner *i* by `-k·(yᵢ - pivot)`,
     * which is a constant per corner), and even the vertical shear the transform
     * lane cannot reach at all.
     *
     * **The quad stays two triangles**, and UVs interpolate affinely across each,
     * so a *non-parallelogram* deform creases the texture along the quad's diagonal
     * — the letterform's straight strokes kink where the triangles meet. It is
     * invisible on a mild or moving deform and obvious on a hard static keystone.
     * There is no perspective correction here; that would need a homogeneous `q`
     * per vertex, and it was deliberately not built.
     *
     * Em-relative (not box-relative) so that one value displaces a narrow `i` and a
     * wide `W` by the same number of pixels — which is what lets a deform written as
     * a *field over text space* (evaluate `f(x, y)` at each corner's absolute
     * position) warp a whole line coherently, since adjacent glyphs' corners then
     * land on the same curve without having to be matched up by hand.
     *
     * The deform is a render-time displacement: it does not move the layout, the
     * text's bounds or its decorations, so a wobbling glyph can escape the text box
     * exactly as a rotated one can.
     */
    offsetX: Corners;
    /** Per-corner Y displacement of this glyph's quad, in {@link em} units. See {@link offsetX}. */
    offsetY: Corners;
    /**
     * Per-corner faux bold, in distance-field units — it shifts the glyph's
     * distance threshold, so positive fattens and negative thins. The outline and
     * shadow edges move with it. Widens the glyph **without changing its
     * advance**, so letters can touch at high weight. Bounded by half the atlas
     * `distanceRange`, like `outline.width`.
     */
    weight: Corners;

    /** Fill colour/alpha — the glyph face. */
    fill: GlyphAspect;
    /** Drop-shadow colour/alpha/offset/softness for this glyph. */
    shadow: GlyphShadow;
    /** Outline colour/alpha/width/rounded for this glyph. */
    outline: GlyphOutline;

    /**
     * Draw a different letterform in this slot — see {@link glyph}. Takes a
     * character (`setGlyph('X')`) or a char code; `setGlyph(0)` restores the
     * glyph's own character.
     */
    setGlyph(char: number | string): void;
    /** Set both axes of glyph scale. `setScale(v)` is uniform; `setScale(x, y)` is independent. */
    setScale(x: number, y?: number): void;
    /**
     * Clear the per-corner deform ({@link offsetX} / {@link offsetY}) back to zero.
     * There is deliberately no "set all four corners" helper: displacing every
     * corner equally is just a translate, which {@link x} / {@link y} already do.
     */
    clearOffset(): void;
    /** Set the faux-bold weight on all four corners. */
    setWeight(weight: number): void;
    /** Set the fill colour (`0xRRGGBB`) on all four corners. */
    setFillColor(rgb: number): void;
    /** Set the fill alpha (`0-1`) on all four corners. */
    setFillAlpha(alpha: number): void;
    /** Set the shadow colour (`0xRRGGBB`) on all four corners. */
    setShadowColor(rgb: number): void;
    /** Set the shadow's inner-edge colour (`0xRRGGBB`) on all four corners. */
    setShadowInnerColor(rgb: number): void;
    /** Set the shadow alpha (`0-1`) on all four corners. */
    setShadowAlpha(alpha: number): void;
    /** Set the shadow softness (distance-field units) on all four corners. */
    setShadowSoftness(softness: number): void;
    /** Set the shadow spread (distance-field units) on all four corners. */
    setShadowSpread(spread: number): void;
    /** Set the shadow rounding (`0` sharp to `1` round) on all four corners. */
    setShadowRounded(rounded: number): void;
    /** Set the outline colour (`0xRRGGBB`) on all four corners. */
    setOutlineColor(rgb: number): void;
    /** Set the outline's inner-edge colour (`0xRRGGBB`) on all four corners. */
    setOutlineInnerColor(rgb: number): void;
    /** Set the outline alpha (`0-1`) on all four corners. */
    setOutlineAlpha(alpha: number): void;
    /** Set the outline width (distance-field units) on all four corners. */
    setOutlineWidth(width: number): void;
    /** Set the outline rounding (`0` sharp to `1` round) on all four corners. */
    setOutlineRounded(rounded: number): void;
    /** Set the outline softness (distance-field units) on all four corners. */
    setOutlineSoftness(softness: number): void;
}

function corners(value: number): Corners {
    return { topLeft: value, topRight: value, bottomLeft: value, bottomRight: value };
}

// Shared method implementations — one function object each, assigned to every
// glyph state, so there is no per-glyph closure allocation.
function setGlyph(this: GlyphState, char: number | string): void {
    this.glyph = typeof char === 'string' ? (char.length > 0 ? char.charCodeAt(0) : 0) : char;
}
function setScale(this: GlyphState, x: number, y?: number): void {
    this.scaleX = x;
    this.scaleY = y === undefined ? x : y;
}
function clearOffset(this: GlyphState): void {
    const x = this.offsetX, y = this.offsetY;
    x.topLeft = x.topRight = x.bottomLeft = x.bottomRight = 0;
    y.topLeft = y.topRight = y.bottomLeft = y.bottomRight = 0;
}
function setWeight(this: GlyphState, weight: number): void {
    const w = this.weight;
    w.topLeft = w.topRight = w.bottomLeft = w.bottomRight = weight;
}
function setFillColor(this: GlyphState, rgb: number): void {
    const t = this.fill.color;
    t.topLeft = t.topRight = t.bottomLeft = t.bottomRight = rgb;
}
function setFillAlpha(this: GlyphState, alpha: number): void {
    const a = this.fill.alpha;
    a.topLeft = a.topRight = a.bottomLeft = a.bottomRight = alpha;
}
function setShadowColor(this: GlyphState, rgb: number): void {
    const t = this.shadow.color;
    t.topLeft = t.topRight = t.bottomLeft = t.bottomRight = rgb;
}
function setShadowInnerColor(this: GlyphState, rgb: number): void {
    const t = this.shadow.innerColor;
    t.topLeft = t.topRight = t.bottomLeft = t.bottomRight = rgb;
}
function setShadowAlpha(this: GlyphState, alpha: number): void {
    const a = this.shadow.alpha;
    a.topLeft = a.topRight = a.bottomLeft = a.bottomRight = alpha;
}
function setShadowSoftness(this: GlyphState, softness: number): void {
    const s = this.shadow.softness;
    s.topLeft = s.topRight = s.bottomLeft = s.bottomRight = softness;
}
function setShadowSpread(this: GlyphState, spread: number): void {
    const s = this.shadow.spread;
    s.topLeft = s.topRight = s.bottomLeft = s.bottomRight = spread;
}
function setShadowRounded(this: GlyphState, rounded: number): void {
    const r = this.shadow.rounded;
    r.topLeft = r.topRight = r.bottomLeft = r.bottomRight = rounded;
}
function setOutlineColor(this: GlyphState, rgb: number): void {
    const t = this.outline.color;
    t.topLeft = t.topRight = t.bottomLeft = t.bottomRight = rgb;
}
function setOutlineInnerColor(this: GlyphState, rgb: number): void {
    const t = this.outline.innerColor;
    t.topLeft = t.topRight = t.bottomLeft = t.bottomRight = rgb;
}
function setOutlineAlpha(this: GlyphState, alpha: number): void {
    const a = this.outline.alpha;
    a.topLeft = a.topRight = a.bottomLeft = a.bottomRight = alpha;
}
function setOutlineWidth(this: GlyphState, width: number): void {
    const w = this.outline.width;
    w.topLeft = w.topRight = w.bottomLeft = w.bottomRight = width;
}
function setOutlineRounded(this: GlyphState, rounded: number): void {
    const r = this.outline.rounded;
    r.topLeft = r.topRight = r.bottomLeft = r.bottomRight = rounded;
}
function setOutlineSoftness(this: GlyphState, softness: number): void {
    const s = this.outline.softness;
    s.topLeft = s.topRight = s.bottomLeft = s.bottomRight = softness;
}

/** Create a fresh glyph state with a stable, fully-populated shape. */
export function createGlyphState(): GlyphState {
    return {
        index: 0,
        charCode: 0,
        srcIndex: 0,
        line: 0,
        srcLine: 0,
        width: 0,
        height: 0,
        em: 0,
        baselineOffset: 0,
        padBefore: 0,
        padAfter: 0,
        glyph: 0,
        visible: true,
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        skew: 0,
        skewPivot: 0,
        offsetX: corners(0),
        offsetY: corners(0),
        weight: corners(0),
        fill: { color: corners(0xffffff), alpha: corners(1) },
        shadow: {
            color: corners(0), innerColor: corners(0), alpha: corners(1),
            x: 0, y: 0, softness: corners(0), spread: corners(0), rounded: corners(0)
        },
        outline: {
            color: corners(0), innerColor: corners(0), alpha: corners(1),
            width: corners(0), rounded: corners(0), softness: corners(0)
        },
        setGlyph,
        setScale,
        clearOffset,
        setWeight,
        setFillColor,
        setFillAlpha,
        setShadowColor,
        setShadowInnerColor,
        setShadowAlpha,
        setShadowSoftness,
        setShadowSpread,
        setShadowRounded,
        setOutlineColor,
        setOutlineInnerColor,
        setOutlineAlpha,
        setOutlineWidth,
        setOutlineRounded,
        setOutlineSoftness
    };
}
