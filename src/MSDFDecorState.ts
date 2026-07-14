/**
 * Per-decoration render state, exposed to the decoration callback.
 *
 * One of these per *rect* — an underline, a strikethrough, or a highlight pill.
 * The renderer seeds them from the rects the last rebuild merged, hands the array
 * to `decorationCallback(rects, text)`, and reads them straight back into the GPU
 * buffer: a `rects` element *is* the source of truth for that quad.
 *
 * **Rects are not glyphs, and the difference is why this lane is smaller.** A
 * glyph has an identity — `srcIndex` — that survives a re-wrap, a font change and
 * a style edit, which is what lets `editGlyphs()` hand the array to the user to
 * own. A rect has none: it is a *merge artifact* of "consecutive characters, same
 * line, same resolved spec, same font, same inherited colour", so a change of wrap
 * width can turn one rect into two and there is nothing stable for a user to
 * re-apply their edits to. So there is no manual mode here, no reset event, and
 * no persistence — a decoration callback is transient, re-seeded every frame, and
 * recomputes its effect from the caller's own clock. It can afford to be: a text
 * has a handful of rects, and seeding all of them costs less than seeding one
 * glyph.
 *
 * The provenance fields are what make an effect addressable. `srcStart`/`srcEnd`
 * say which characters of the source string this rect covers, and
 * `glyphStart`/`glyphEnd` are the *window into the glyph array* it was merged
 * from — so following the glyphs under a rule is a loop, not a search.
 *
 * Every appearance channel is per-corner, because the shader's solid lane reads
 * them per-corner exactly as the glyph lane does: a pill can be blurred on one
 * side, an underline can fade out along its length.
 *
 * **A rect is one quad, so a callback can reach any parallelogram — and no
 * curve.** A rule can be moved, scaled, tilted, tapered and skewed; it can follow
 * a line of glyphs that was sheared or rotated *as a line*, exactly, because that
 * is a linear map of its baseline. It cannot follow a per-glyph wave. See
 * {@link DecorationState.offsetX}.
 */

import type { Corners } from './MSDFColor';

export interface DecorationState {
    /**
     * Which back-to-front pass this rect draws in: `PASS_HIGHLIGHT` (behind
     * everything, the text's own shadow included), `PASS_UNDERLINE` (under the
     * fill, over the shadow) or `PASS_STRIKE` (over the fill).
     *
     * Readonly: what makes a rule an underline rather than a strikethrough is
     * where it sits, not which slot it draws in, so moving it between slots would
     * only ever buy a fight with the glyphs it is supposed to be under.
     */
    readonly pass: number;
    /** Visual line this rect sits on. */
    readonly line: number;
    /** First source-string index this rect covers. `text[srcStart]` is its first character. */
    readonly srcStart: number;
    /** One past the last source-string index this rect covers. */
    readonly srcEnd: number;
    /**
     * Index of the first glyph this rect was merged from — a direct index into the
     * glyph array (`parent.glyphs`), not a source index, so following a rule's own
     * glyphs needs no search. `parent.glyphs` is `null` in static glyph mode, so an
     * effect that reads them needs a display callback or `editGlyphs()` as well.
     */
    readonly glyphStart: number;
    /** One past the last glyph index this rect was merged from. */
    readonly glyphEnd: number;
    /** Slot in the text's font list — the texture and unit range this rect batches with. */
    readonly fontIdx: number;

    /** Whether this rect is drawn at all. `false` skips the quad entirely. */
    visible: boolean;

    /** Left edge in text space (seeded from layout). */
    x: number;
    /** Top edge in text space (seeded from layout). */
    y: number;
    /** Width in text-space pixels. */
    w: number;
    /** Height in text-space pixels. */
    h: number;

    /**
     * Horizontal scale about the rect's centre. `0` hides it.
     *
     * Exact under the box SDF, and that is not an accident: {@link radius},
     * {@link borderWidth} and {@link softness} are fractions of the rect's own
     * half-thickness, so a scaled pill keeps `radius: 1` a stadium — the shape
     * scales with the quad, as it should.
     */
    scaleX: number;
    /** Vertical scale about the rect's centre. `0` hides it. See {@link scaleX}. */
    scaleY: number;
    /** Rotation about the rect's centre, in radians. Exact under the box SDF. */
    rotation: number;

    /**
     * Per-corner X displacement of this rect's quad, in **pixels** — text space,
     * which is the rect's own space (a rect has no letterform, so unlike
     * `GlyphState.offsetX` there is nothing to normalize against and no em).
     *
     * This is what lets a rule follow a transformed line of text: shear or rotate
     * a whole line and its baseline maps linearly, which is exactly a
     * parallelogram, which the four corners reach exactly. It cannot reach a
     * *curve* — a rect is one quad, so a rule under a per-glyph wave can be
     * tilted and tapered towards the wave but never bent along it.
     *
     * **A non-parallelogram warps the box SDF's units.** The shader recovers the
     * rect's pixel size from the screen-space derivative of its UVs, and on a
     * tapered quad that derivative varies across the rect — so `radius`,
     * `borderWidth` and `softness`, being fractions of the local half-thickness,
     * drift along the taper, and a dashed rule's caps warp with it (the dashes stay
     * evenly spaced — the fold is in UV space and is untouched). On a plain
     * hard-edged rule, where all three are zero, the only casualty is the
     * antialiasing width, which is invisible. A translate, a scale and a rotation
     * are all exact; only the taper drifts, and a tapering pill whose radius
     * follows its local thickness is generally what you would have asked for.
     */
    offsetX: Corners;
    /** Per-corner Y displacement of this rect's quad, in pixels. See {@link offsetX}. */
    offsetY: Corners;

    /**
     * Per-corner face colour, `0xRRGGBB`. A rule that inherited the text's colour
     * is seeded with the *resolved* value, so the callback never sees a sentinel —
     * and writing it here overrides the inheritance for this frame.
     */
    color: Corners;
    /**
     * Per-corner alpha of the **whole rect**, `0-1` — {@link faceAlpha} and
     * {@link borderAlpha} are both multiplied by it at pack time. This is the knob
     * that fades a rect as a shape, and the only one that is safe to drive from
     * nothing to full on any rect: a hollow two-tone pill (whose `faceAlpha` is `0`
     * *by design*) fades as a blob under it, because zero times anything is still
     * the zero byte the ramp's gate is looking for.
     *
     * A rule seeds its resolved (or inherited) alpha here and an identity
     * `faceAlpha`, so on every rect kind this means "how visible it is".
     */
    alpha: Corners;
    /**
     * Per-corner face alpha, `0-1`, independent of the ring — the pill's face layer
     * only. At `0` the face is gone and the quad's colour slot is freed for
     * {@link innerColor}, so a borderless pill vanishes while a bordered one becomes
     * a ring that ramps to its inner colour: the same two-tone gate a glyph's shadow
     * uses. A rule has no ring, so this is seeded to `1` and {@link alpha} is its
     * whole alpha.
     */
    faceAlpha: Corners;
    /**
     * Per-corner inner end of the border's colour ramp, `0xRRGGBB`. Read only where
     * the face's *packed* alpha is zero — i.e. where {@link faceAlpha} or
     * {@link alpha} is. Equal to {@link borderColor} is a no-op.
     */
    innerColor: Corners;

    /** Per-corner border-ring colour, `0xRRGGBB`. Pills only; a rule has no ring. */
    borderColor: Corners;
    /**
     * Per-corner border-ring alpha, `0-1`, independent of the face. Ignored wherever
     * {@link borderWidth} is `0`.
     */
    borderAlpha: Corners;
    /**
     * Per-corner border-ring width, as a fraction of the rect's half-thickness
     * (`min(w, h) / 2`). `0` is no ring; `1` is a ring that fills the whole rect.
     *
     * **Ignored on a dashed rule**, whose middle byte is spent on {@link dashDuty}
     * instead — the shader zeroes the border there, or a duty cycle would inset
     * every dash by a phantom ring.
     */
    borderWidth: Corners;
    /**
     * Per-corner corner radius, as a fraction of the half-thickness. `0` is a
     * square corner, `1` a stadium at any size. On a dashed rule this rounds the
     * *dash caps*, so a `1` on a dash as long as the rule is thick is a dot.
     */
    radius: Corners;
    /**
     * Per-corner edge blur, as a fraction of the half-thickness. `0` is a
     * 1-screen-pixel antialiased edge.
     *
     * It fades **inward**, because a rect's quad ends exactly at its box and an
     * outward blur would be clipped in half. Give a glow room with the spec's
     * `padding` (which may be negative), or by growing {@link w} / {@link h} here.
     */
    softness: Corners;

    /**
     * How many dashes this rect is cut into. `0` is a solid rule or a pill.
     *
     * It costs no vertex byte — a dashed rect spans one unit of U *per dash*, and
     * the shader folds U into a single cell — so it is free to animate, and it is
     * also the switch that decides how the other bytes are read: at `> 0` the
     * middle channel is {@link dashDuty} rather than {@link borderWidth}. Setting
     * it on a solid rule therefore dashes it outright.
     */
    dashCount: number;
    /**
     * Per-corner dash length as a fraction of the period. Only read when
     * {@link dashCount} is `> 0`. Seeded to the spec's duty, or to `0.5` on a rule
     * that has no dash spec, so switching {@link dashCount} on gives an even dash
     * rather than a hairline.
     */
    dashDuty: Corners;
    /**
     * Marching-ants phase, in whole dash periods — seeded from the text's own
     * `dashPhase`, and per-rect here, so two rules can march at different speeds.
     * Periodic, so accumulating it for ever is exact.
     */
    dashPhase: number;

    /** Set both axes of scale. `setScale(v)` is uniform; `setScale(x, y)` is independent. */
    setScale(x: number, y?: number): void;
    /** Clear the per-corner deform ({@link offsetX} / {@link offsetY}) back to zero. */
    clearOffset(): void;
    /** Set the face colour (`0xRRGGBB`) on all four corners. */
    setColor(rgb: number): void;
    /** Set the whole rect's alpha (`0-1`) on all four corners. See {@link alpha}. */
    setAlpha(alpha: number): void;
    /** Set the face-only alpha (`0-1`) on all four corners. See {@link faceAlpha}. */
    setFaceAlpha(alpha: number): void;
    /** Set the border ramp's inner colour (`0xRRGGBB`) on all four corners. */
    setInnerColor(rgb: number): void;
    /** Set the border colour (`0xRRGGBB`) on all four corners. */
    setBorderColor(rgb: number): void;
    /** Set the border alpha (`0-1`) on all four corners. */
    setBorderAlpha(alpha: number): void;
    /** Set the border width (fraction of the half-thickness) on all four corners. */
    setBorderWidth(width: number): void;
    /** Set the corner radius (fraction of the half-thickness) on all four corners. */
    setRadius(radius: number): void;
    /** Set the edge blur (fraction of the half-thickness) on all four corners. */
    setSoftness(softness: number): void;
    /** Set the dash duty cycle on all four corners. */
    setDashDuty(duty: number): void;
}

function corners(value: number): Corners {
    return { topLeft: value, topRight: value, bottomLeft: value, bottomRight: value };
}

// Shared method implementations — one function object each, assigned to every
// rect state, so there is no per-rect closure allocation.
function setScale(this: DecorationState, x: number, y?: number): void {
    this.scaleX = x;
    this.scaleY = y === undefined ? x : y;
}
function clearOffset(this: DecorationState): void {
    const x = this.offsetX, y = this.offsetY;
    x.topLeft = x.topRight = x.bottomLeft = x.bottomRight = 0;
    y.topLeft = y.topRight = y.bottomLeft = y.bottomRight = 0;
}
function setAll(c: Corners, value: number): void {
    c.topLeft = c.topRight = c.bottomLeft = c.bottomRight = value;
}
function setColor(this: DecorationState, rgb: number): void { setAll(this.color, rgb); }
function setAlpha(this: DecorationState, alpha: number): void { setAll(this.alpha, alpha); }
function setFaceAlpha(this: DecorationState, alpha: number): void { setAll(this.faceAlpha, alpha); }
function setInnerColor(this: DecorationState, rgb: number): void { setAll(this.innerColor, rgb); }
function setBorderColor(this: DecorationState, rgb: number): void { setAll(this.borderColor, rgb); }
function setBorderAlpha(this: DecorationState, alpha: number): void { setAll(this.borderAlpha, alpha); }
function setBorderWidth(this: DecorationState, width: number): void { setAll(this.borderWidth, width); }
function setRadius(this: DecorationState, radius: number): void { setAll(this.radius, radius); }
function setSoftness(this: DecorationState, softness: number): void { setAll(this.softness, softness); }
function setDashDuty(this: DecorationState, duty: number): void { setAll(this.dashDuty, duty); }

/** Create a fresh rect state with a stable, fully-populated shape. */
export function createDecorState(): DecorationState {
    return {
        pass: 0,
        line: 0,
        srcStart: 0,
        srcEnd: 0,
        glyphStart: 0,
        glyphEnd: 0,
        fontIdx: 0,
        visible: true,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        offsetX: corners(0),
        offsetY: corners(0),
        color: corners(0xffffff),
        alpha: corners(1),
        faceAlpha: corners(1),
        innerColor: corners(0xffffff),
        borderColor: corners(0),
        borderAlpha: corners(1),
        borderWidth: corners(0),
        radius: corners(0),
        softness: corners(0),
        dashCount: 0,
        dashDuty: corners(0.5),
        dashPhase: 0,
        setScale,
        clearOffset,
        setColor,
        setAlpha,
        setFaceAlpha,
        setInnerColor,
        setBorderColor,
        setBorderAlpha,
        setBorderWidth,
        setRadius,
        setSoftness,
        setDashDuty
    };
}
