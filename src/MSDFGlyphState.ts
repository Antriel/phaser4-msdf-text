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
    /** Per-glyph shadow X offset in pixels (seeded from `shadowX`). */
    x: number;
    /** Per-glyph shadow Y offset in pixels (seeded from `shadowY`). */
    y: number;
}

export interface GlyphState {
    /** Index of this glyph among the renderable glyphs (0-based). */
    readonly index: number;
    /** Character code of this glyph. */
    readonly charCode: number;

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

    /** Fill colour/alpha — the glyph face. */
    fill: GlyphAspect;
    /** Drop-shadow colour/alpha/offset for this glyph (ignored if the text has no shadow). */
    shadow: GlyphShadow;
    /** Outline colour/alpha for this glyph (ignored if the text has no outline). */
    outline: GlyphAspect;

    /** Set both axes of glyph scale. `setScale(v)` is uniform; `setScale(x, y)` is independent. */
    setScale(x: number, y?: number): void;
    /** Set the fill colour (`0xRRGGBB`) on all four corners. */
    setFillColor(rgb: number): void;
    /** Set the fill alpha (`0-1`) on all four corners. */
    setFillAlpha(alpha: number): void;
    /** Set the shadow colour (`0xRRGGBB`) on all four corners. */
    setShadowColor(rgb: number): void;
    /** Set the shadow alpha (`0-1`) on all four corners. */
    setShadowAlpha(alpha: number): void;
    /** Set the outline colour (`0xRRGGBB`) on all four corners. */
    setOutlineColor(rgb: number): void;
    /** Set the outline alpha (`0-1`) on all four corners. */
    setOutlineAlpha(alpha: number): void;
}

function corners(value: number): Corners {
    return { topLeft: value, topRight: value, bottomLeft: value, bottomRight: value };
}

// Shared method implementations — one function object each, assigned to every
// glyph state, so there is no per-glyph closure allocation.
function setScale(this: GlyphState, x: number, y?: number): void {
    this.scaleX = x;
    this.scaleY = y === undefined ? x : y;
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
function setShadowAlpha(this: GlyphState, alpha: number): void {
    const a = this.shadow.alpha;
    a.topLeft = a.topRight = a.bottomLeft = a.bottomRight = alpha;
}
function setOutlineColor(this: GlyphState, rgb: number): void {
    const t = this.outline.color;
    t.topLeft = t.topRight = t.bottomLeft = t.bottomRight = rgb;
}
function setOutlineAlpha(this: GlyphState, alpha: number): void {
    const a = this.outline.alpha;
    a.topLeft = a.topRight = a.bottomLeft = a.bottomRight = alpha;
}

/** Create a fresh glyph state with a stable, fully-populated shape. */
export function createGlyphState(): GlyphState {
    return {
        index: 0,
        charCode: 0,
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        fill: { color: corners(0xffffff), alpha: corners(1) },
        shadow: { color: corners(0), alpha: corners(1), x: 0, y: 0 },
        outline: { color: corners(0), alpha: corners(1) },
        setScale,
        setFillColor,
        setFillAlpha,
        setShadowColor,
        setShadowAlpha,
        setOutlineColor,
        setOutlineAlpha
    };
}
