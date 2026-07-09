/**
 * Rich-text style engine for {@link MSDFText} — the pure, `this`-free half of
 * the styling feature. Turns a public {@link StyleSpec} into a GPU-ready
 * {@link ResolvedStyle} (parsed once at creation), finds keyword/whole-word
 * match spans, and stamps a resolved style onto a seeded {@link GlyphState}.
 *
 * The Class in `MSDFText.ts` owns the three run stores (segments / rules /
 * ranges) and calls into here; nothing in this module reads instance state.
 */

import * as Phaser from "phaser";
import type { Corners } from './MSDFColor';
import type { GlyphState } from './MSDFGlyphState';
import type {
    ColorValue,
    DecorationSpec,
    HighlightSpec,
    PerCorner,
    StyleSpec,
    RuleStyleSpec,
    SegmentSpec,
    TextStyleOpts
} from './MSDFTextTypes';

/** Convert any {@link ColorValue} to a packed `0xRRGGBB` number. */
export function toColorInt(value: ColorValue): number {
    return (Phaser.Display.Color.ValueToColor as any)(value).color;
}

/**
 * An underline / strikethrough, pre-parsed. `color`/`alpha` absent mean "inherit
 * the resolved fill", which is also what makes the rect split at every colour
 * change in the span it covers.
 */
export interface ResolvedDecoration {
    color?: Corners;   // packed 0xRRGGBB per corner
    alpha?: Corners;   // 0-1 per corner
    thickness: number; // multiplier on the font's underlineThickness
    offset: number;    // em-relative shift from the default position
}

/**
 * A highlight pill, pre-parsed. Unlike a decoration, a highlight never inherits
 * the fill colour — a block of text-coloured paint behind the text would hide
 * it — so every colour here is resolved, and rects merge on line and spec
 * identity alone.
 *
 * `radius`, `borderWidth` and `softness` are fractions of the pill's own
 * half-thickness, which is the unit the shader's box SDF works in; the padding
 * is em-relative (× the object's `fontSize`) so a fitted or resized text keeps
 * its proportions.
 */
export interface ResolvedHighlight {
    color: Corners;        // face, packed 0xRRGGBB per corner
    alpha: Corners;        // face alpha, 0-1 per corner
    innerColor: Corners;   // two-tone inner end of the border ramp (face alpha 0 only)
    borderColor: Corners;
    borderAlpha: Corners;
    borderWidth: Corners;  // 0-1 of the half-thickness; 1 fills the pill
    radius: Corners;       // 0-1 of the half-thickness; 1 is a stadium
    softness: Corners;     // 0-1 of the half-thickness; 0 is a 1px antialiased edge
    padLeft: number;       // em
    padRight: number;
    padTop: number;
    padBottom: number;
}

/**
 * A {@link StyleSpec} pre-parsed once (at creation) into GPU-ready values, so
 * per-frame seeding does no colour parsing or scale expansion. Absent fields
 * mean "inherit the seeded base" — only present keys are applied to a glyph.
 * Colour is packed `0xRRGGBB` (per corner); alpha is `0-1` (per corner).
 *
 * Three lanes. Most fields are **appearance**: they are stamped onto a
 * `GlyphState` by {@link applyStyleToGlyph}. `fontScale` and `font` are
 * **structural** — they feed the layout pass instead and never reach a glyph
 * state. The two decorations are appearance-lane but glyph-independent: they
 * resolve per source character and merge into rects, so they never reach a glyph
 * state either. A decoration of `null` is an explicit "off", distinct from an
 * absent key.
 *
 * `font` stays a **cache key**, not a resolved `MSDFFont`: this module is
 * `this`-free and has no scene, and a rule outlives any one text object. The key
 * is resolved against the `msdfFont` cache in `MSDFText.buildFontMap`.
 */
export interface ResolvedStyle {
    fillColor?: Corners;   // packed 0xRRGGBB per corner
    fillAlpha?: Corners;   // 0-1 per corner
    weight?: Corners;      // distance-field units per corner
    outlineColor?: number;
    outlineInnerColor?: number;
    outlineAlpha?: number;
    outlineWidth?: Corners;
    outlineRounded?: boolean;
    shadowColor?: number;
    shadowInnerColor?: number;
    shadowAlpha?: number;
    shadowSoftness?: Corners;
    shadowX?: number;
    shadowY?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    skew?: number;
    underline?: ResolvedDecoration | null;      // decoration lane
    strikethrough?: ResolvedDecoration | null;  // decoration lane
    highlight?: ResolvedHighlight | null;       // decoration lane
    fontScale?: number;    // structural — layout input, not glyph state
    font?: string;         // structural — msdfFont cache key, resolved at layout
}

/** A styled source-index span. `start`/`length` index the plain `_text`. */
export interface StyleRun {
    start: number;
    length: number;
    style: ResolvedStyle;
}

/** A cached whole/substring match span (a rule's runs share the rule's style). */
export interface RuleMatch {
    start: number;
    length: number;
}

/** A persistent keyword rule: its `runs` are re-cached on every text change. */
export interface StyleRule {
    match: string;
    opts: Required<TextStyleOpts>;
    style: ResolvedStyle;
    runs: RuleMatch[];
}

/** Whether `value` is a {@link PerCorner} (has the four corner keys). */
function isPerCorner(value: any): boolean {
    return value !== null && typeof value === 'object' && 'topLeft' in value;
}

/** Parse a scalar-or-per-corner colour into packed `0xRRGGBB` corners. */
function resolveColorCorners(value: ColorValue | PerCorner<ColorValue>): Corners {
    if (isPerCorner(value)) {
        const v = value as PerCorner<ColorValue>;
        return {
            topLeft: toColorInt(v.topLeft),
            topRight: toColorInt(v.topRight),
            bottomLeft: toColorInt(v.bottomLeft),
            bottomRight: toColorInt(v.bottomRight)
        };
    }
    const c = toColorInt(value as ColorValue);
    return { topLeft: c, topRight: c, bottomLeft: c, bottomRight: c };
}

/** Parse a scalar-or-per-corner number into `Corners`. */
function resolveNumberCorners(value: number | PerCorner<number>): Corners {
    if (isPerCorner(value)) {
        const v = value as PerCorner<number>;
        return { topLeft: v.topLeft, topRight: v.topRight, bottomLeft: v.bottomLeft, bottomRight: v.bottomRight };
    }
    const a = value as number;
    return { topLeft: a, topRight: a, bottomLeft: a, bottomRight: a };
}

/**
 * Parse an underline / strikethrough spec. `undefined` means the layer says
 * nothing (inherit); `false` is an explicit off, which is why it resolves to
 * `null` rather than folding back into `undefined`.
 */
export function resolveDecoration(spec: boolean | DecorationSpec | undefined): ResolvedDecoration | null | undefined {
    if (spec === undefined) return undefined;
    if (spec === false) return null;
    if (spec === true) return { thickness: 1, offset: 0 };

    const r: ResolvedDecoration = {
        thickness: spec.thickness !== undefined ? spec.thickness : 1,
        offset: spec.offset !== undefined ? spec.offset : 0
    };
    if (spec.color !== undefined) r.color = resolveColorCorners(spec.color);
    if (spec.alpha !== undefined) r.alpha = resolveNumberCorners(spec.alpha);
    return r;
}

/** The default highlight: marker yellow, square, opaque, unpadded. */
const HIGHLIGHT_COLOR = 0xffff00;
/** The default border colour. Invisible until `borderWidth` opens it. */
const HIGHLIGHT_BORDER_COLOR = 0x000000;

/** Clamp a per-corner `0-1` fraction in place, and return it. */
function clampCorners(c: Corners): Corners {
    c.topLeft = c.topLeft <= 0 ? 0 : c.topLeft >= 1 ? 1 : c.topLeft;
    c.topRight = c.topRight <= 0 ? 0 : c.topRight >= 1 ? 1 : c.topRight;
    c.bottomLeft = c.bottomLeft <= 0 ? 0 : c.bottomLeft >= 1 ? 1 : c.bottomLeft;
    c.bottomRight = c.bottomRight <= 0 ? 0 : c.bottomRight >= 1 ? 1 : c.bottomRight;
    return c;
}

/** A `Corners` with the same value on all four. */
function uniformCorners(v: number): Corners {
    return { topLeft: v, topRight: v, bottomLeft: v, bottomRight: v };
}

/**
 * Parse a highlight spec. Tri-state like {@link resolveDecoration}: `undefined`
 * means the layer says nothing, `false` is an explicit off (`null`), `true` is
 * the plain marker default.
 *
 * Defaults worth knowing. `borderAlpha` is `1`, not `0` — a zero `borderWidth`
 * already erases the ring at pack time (the same rule `packOutlineAspect` applies
 * to glyph outlines), so nothing shows until a width opens it, and a caller who
 * sets a width gets a visible border without also naming an alpha. `innerColor`
 * defaults to `borderColor`, which makes the two-tone ramp an identity.
 */
export function resolveHighlight(spec: boolean | HighlightSpec | undefined): ResolvedHighlight | null | undefined {
    if (spec === undefined) return undefined;
    if (spec === false) return null;
    const s: HighlightSpec = spec === true ? {} : spec;

    const borderColor = s.borderColor !== undefined
        ? resolveColorCorners(s.borderColor)
        : uniformCorners(HIGHLIGHT_BORDER_COLOR);

    // Padding: a scalar pads every side; `x`/`y` pad an axis; a named side wins.
    let l = 0, r = 0, t = 0, b = 0;
    const pad = s.padding;
    if (typeof pad === 'number') {
        l = r = t = b = pad;
    } else if (pad) {
        if (pad.x !== undefined) l = r = pad.x;
        if (pad.y !== undefined) t = b = pad.y;
        if (pad.left !== undefined) l = pad.left;
        if (pad.right !== undefined) r = pad.right;
        if (pad.top !== undefined) t = pad.top;
        if (pad.bottom !== undefined) b = pad.bottom;
    }

    return {
        color: s.color !== undefined ? resolveColorCorners(s.color) : uniformCorners(HIGHLIGHT_COLOR),
        alpha: s.alpha !== undefined ? resolveNumberCorners(s.alpha) : uniformCorners(1),
        innerColor: s.innerColor !== undefined ? resolveColorCorners(s.innerColor) : borderColor,
        borderColor: borderColor,
        borderAlpha: s.borderAlpha !== undefined ? resolveNumberCorners(s.borderAlpha) : uniformCorners(1),
        borderWidth: clampCorners(s.borderWidth !== undefined ? resolveNumberCorners(s.borderWidth) : uniformCorners(0)),
        radius: clampCorners(s.radius !== undefined ? resolveNumberCorners(s.radius) : uniformCorners(0)),
        softness: clampCorners(s.softness !== undefined ? resolveNumberCorners(s.softness) : uniformCorners(0)),
        padLeft: l,
        padRight: r,
        padTop: t,
        padBottom: b
    };
}

/** One-time dev warning for a `fontScale` that isn't a positive number. */
let warnedFontScale = false;

/** One-time dev warning for a `font` that isn't a non-empty cache key. */
let warnedFont = false;

/** Normalise a {@link RuleStyleSpec} into a {@link ResolvedStyle} (present keys only). */
export function resolveStyle(spec: RuleStyleSpec): ResolvedStyle {
    const r: ResolvedStyle = {};
    if (spec.color !== undefined) r.fillColor = resolveColorCorners(spec.color);
    if (spec.alpha !== undefined) r.fillAlpha = resolveNumberCorners(spec.alpha);
    if (spec.weight !== undefined) r.weight = resolveNumberCorners(spec.weight);
    if (spec.outline) {
        if (spec.outline.color !== undefined) r.outlineColor = toColorInt(spec.outline.color);
        if (spec.outline.innerColor !== undefined) r.outlineInnerColor = toColorInt(spec.outline.innerColor);
        if (spec.outline.alpha !== undefined) r.outlineAlpha = spec.outline.alpha;
        if (spec.outline.width !== undefined) r.outlineWidth = resolveNumberCorners(spec.outline.width);
        if (spec.outline.rounded !== undefined) r.outlineRounded = !!spec.outline.rounded;
    }
    if (spec.shadow) {
        if (spec.shadow.color !== undefined) r.shadowColor = toColorInt(spec.shadow.color);
        if (spec.shadow.innerColor !== undefined) r.shadowInnerColor = toColorInt(spec.shadow.innerColor);
        if (spec.shadow.alpha !== undefined) r.shadowAlpha = spec.shadow.alpha;
        if (spec.shadow.softness !== undefined) r.shadowSoftness = resolveNumberCorners(spec.shadow.softness);
        if (spec.shadow.x !== undefined) r.shadowX = spec.shadow.x;
        if (spec.shadow.y !== undefined) r.shadowY = spec.shadow.y;
    }
    // `scale` is the uniform base; `scaleX`/`scaleY` override per axis.
    let sx: number | undefined;
    let sy: number | undefined;
    if (spec.scale !== undefined) { sx = spec.scale; sy = spec.scale; }
    if (spec.scaleX !== undefined) sx = spec.scaleX;
    if (spec.scaleY !== undefined) sy = spec.scaleY;
    if (sx !== undefined) r.scaleX = sx;
    if (sy !== undefined) r.scaleY = sy;
    if (spec.rotation !== undefined) r.rotation = spec.rotation;
    if (spec.skew !== undefined) r.skew = spec.skew;

    const underline = resolveDecoration(spec.underline);
    if (underline !== undefined) r.underline = underline;
    const strikethrough = resolveDecoration(spec.strikethrough);
    if (strikethrough !== undefined) r.strikethrough = strikethrough;
    const highlight = resolveHighlight(spec.highlight);
    if (highlight !== undefined) r.highlight = highlight;

    // Structural. A non-positive multiplier would collapse or mirror the run's
    // metrics, so drop it rather than let it corrupt the layout.
    if (spec.fontScale !== undefined) {
        if (spec.fontScale > 0) {
            r.fontScale = spec.fontScale;
        } else if (!warnedFontScale) {
            warnedFontScale = true;
            console.warn(
                `[MSDFText] "fontScale" must be a positive multiplier of the ` +
                `object's fontSize; got ${spec.fontScale}. Ignoring it.`
            );
        }
    }

    // Structural. Kept as a key; whether it names a loaded font is a question
    // only the text object's scene cache can answer (see `buildFontMap`).
    if (spec.font !== undefined) {
        if (typeof spec.font === 'string' && spec.font.length > 0) {
            r.font = spec.font;
        } else if (!warnedFont) {
            warnedFont = true;
            console.warn(
                `[MSDFText] "font" must be a non-empty msdfFont cache key; got ` +
                `${JSON.stringify(spec.font)}. Ignoring it.`
            );
        }
    }
    return r;
}

/** Whether a spec carries at least one override (appearance, decoration or structural). */
export function hasStyleKeys(spec: SegmentSpec): boolean {
    return spec.color !== undefined || spec.alpha !== undefined || spec.weight !== undefined ||
        spec.outline !== undefined || spec.shadow !== undefined ||
        spec.scale !== undefined || spec.scaleX !== undefined || spec.scaleY !== undefined ||
        spec.rotation !== undefined || spec.skew !== undefined ||
        spec.underline !== undefined || spec.strikethrough !== undefined ||
        spec.highlight !== undefined ||
        spec.fontScale !== undefined || spec.font !== undefined;
}

/**
 * Whether a resolved style stamps anything onto a {@link GlyphState}. A run that
 * carries only the structural `fontScale` / `font` changes the layout but seeds
 * nothing, and a run that carries only a decoration paints a rect but seeds
 * nothing — so neither must, on its own, force the per-glyph state array into
 * existence.
 */
export function styleHasAppearanceKeys(s: ResolvedStyle): boolean {
    return s.fillColor !== undefined || s.fillAlpha !== undefined || s.weight !== undefined ||
        s.outlineColor !== undefined || s.outlineInnerColor !== undefined ||
        s.outlineAlpha !== undefined ||
        s.outlineWidth !== undefined || s.outlineRounded !== undefined ||
        s.scaleX !== undefined || s.scaleY !== undefined ||
        s.rotation !== undefined || s.skew !== undefined ||
        styleHasShadowKeys(s);
}

/**
 * Whether a resolved style sets any shadow key. Used to decide whether the
 * renderer must run the shadow pass in per-glyph mode even when the text object
 * itself has no shadow — a styled run can give individual glyphs a drop shadow.
 */
export function styleHasShadowKeys(s: ResolvedStyle): boolean {
    return s.shadowColor !== undefined || s.shadowInnerColor !== undefined ||
        s.shadowAlpha !== undefined ||
        s.shadowSoftness !== undefined || s.shadowX !== undefined || s.shadowY !== undefined;
}

/** Whether a resolved style sets an underline, strikethrough or highlight (on *or* off). */
export function styleHasDecorationKeys(s: ResolvedStyle): boolean {
    return s.underline !== undefined || s.strikethrough !== undefined || s.highlight !== undefined;
}

/** Copy a resolved corner set onto a glyph's corner set. */
function copyCorners(target: Corners, source: Corners): void {
    target.topLeft = source.topLeft;
    target.topRight = source.topRight;
    target.bottomLeft = source.bottomLeft;
    target.bottomRight = source.bottomRight;
}

/** Set all four of a glyph's corners to one value. */
function setCorners(target: Corners, value: number): void {
    target.topLeft = target.topRight = target.bottomLeft = target.bottomRight = value;
}

/** Apply a resolved style's present keys onto one glyph state (overwrite). */
export function applyStyleToGlyph(g: GlyphState, s: ResolvedStyle): void {
    if (s.fillColor) copyCorners(g.fill.color, s.fillColor);
    if (s.fillAlpha) copyCorners(g.fill.alpha, s.fillAlpha);
    if (s.weight) copyCorners(g.weight, s.weight);
    // A layer that recolours the outline/shadow but says nothing about the inner
    // end of the ramp means a *solid* colour, so `color` seeds `innerColor` here
    // exactly as it does at the object level — otherwise a run that only changes
    // `outline.color` would ramp into whatever inner colour the object had.
    if (s.outlineColor !== undefined) {
        setCorners(g.outline.color, s.outlineColor);
        setCorners(g.outline.innerColor, s.outlineColor);
    }
    if (s.outlineInnerColor !== undefined) setCorners(g.outline.innerColor, s.outlineInnerColor);
    if (s.outlineAlpha !== undefined) setCorners(g.outline.alpha, s.outlineAlpha);
    if (s.outlineWidth) copyCorners(g.outline.width, s.outlineWidth);
    if (s.outlineRounded !== undefined) setCorners(g.outline.rounded, s.outlineRounded ? 1 : 0);
    if (s.shadowColor !== undefined) {
        setCorners(g.shadow.color, s.shadowColor);
        setCorners(g.shadow.innerColor, s.shadowColor);
    }
    if (s.shadowInnerColor !== undefined) setCorners(g.shadow.innerColor, s.shadowInnerColor);
    if (s.shadowAlpha !== undefined) setCorners(g.shadow.alpha, s.shadowAlpha);
    if (s.shadowSoftness) copyCorners(g.shadow.softness, s.shadowSoftness);
    if (s.shadowX !== undefined) g.shadow.x = s.shadowX;
    if (s.shadowY !== undefined) g.shadow.y = s.shadowY;
    if (s.scaleX !== undefined) g.scaleX = s.scaleX;
    if (s.scaleY !== undefined) g.scaleY = s.scaleY;
    if (s.rotation !== undefined) g.rotation = s.rotation;
    if (s.skew !== undefined) g.skew = s.skew;
}

/** Whether `ch` is a word character (used for whole-word matching). */
function isWordChar(ch: string): boolean {
    return ch !== '' && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Find match spans of `needle` in `text` per `opts`. Whole-word matches require
 * non-word (or string-boundary) neighbours; `nth` targets a single occurrence
 * (counting only matches that pass the whole-word gate); otherwise all/first.
 */
export function matchRuns(text: string, needle: string, opts: Required<TextStyleOpts>): RuleMatch[] {
    const runs: RuleMatch[] = [];
    const len = needle.length;
    if (len === 0) return runs;

    const hay = opts.caseSensitive ? text : text.toLowerCase();
    const pat = opts.caseSensitive ? needle : needle.toLowerCase();

    let from = 0;
    let count = 0;
    for (;;) {
        const idx = hay.indexOf(pat, from);
        if (idx < 0) break;
        const before = idx > 0 ? text[idx - 1] : '';
        const after = idx + len < text.length ? text[idx + len] : '';
        const ok = !opts.wholeWord || (!isWordChar(before) && !isWordChar(after));
        if (ok) {
            if (opts.nth >= 0) {
                if (count === opts.nth) { runs.push({ start: idx, length: len }); break; }
                count++;
            } else {
                runs.push({ start: idx, length: len });
                if (!opts.all) break;
            }
        }
        from = idx + len;
    }
    return runs;
}
