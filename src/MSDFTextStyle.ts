/**
 * Rich-text style engine for {@link MSDFText} — the pure, `this`-free half of
 * the styling feature. Turns a public {@link StyleSpec} into a GPU-ready
 * {@link ResolvedStyle} (parsed once at creation), turns a public
 * {@link StyleTarget} into a {@link ResolvedTarget} that can re-derive its match
 * spans against any text, and stamps a resolved style onto a seeded
 * {@link GlyphState}.
 *
 * The Class in `MSDFText.ts` owns the two run stores (segments / overlays) and
 * calls into here; nothing in this module reads instance state.
 */

import * as Phaser from "phaser";
import type { Corners } from './MSDFColor';
import type { GlyphState } from './MSDFGlyphState';
import type {
    ColorValue,
    DecorationSpec,
    HighlightSpec,
    MatchTarget,
    PerCorner,
    SegmentTarget,
    SpanTarget,
    StyleMatcher,
    StyleSpec,
    StyleTarget,
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

/**
 * A styled source-index span. `start`/`length` index the plain `_text`.
 *
 * `id` is set only on a segment run, and only when the segment was named. Such a
 * run is kept even with an empty `style` — it carries no paint, it is a target
 * for a `segment` anchor to find.
 */
export interface StyleRun {
    start: number;
    length: number;
    style: ResolvedStyle;
    id?: string;
}

/** A cached match span (an overlay's runs all share the overlay's style). */
export interface RuleMatch {
    start: number;
    length: number;
}

/**
 * A {@link StyleTarget} normalised once at creation. The `kind` is what decides
 * an overlay's lifetime: `span` is position-anchored (dropped on any text
 * change); the other four are content-anchored (re-derived, so they survive).
 */
export type ResolvedTarget =
    | { kind: 'match'; needle: string; opts: Required<TextStyleOpts> }
    | { kind: 'regexp'; re: RegExp; opts: Required<TextStyleOpts> }
    | { kind: 'segment'; id: string }
    | { kind: 'fn'; fn: StyleMatcher }
    | { kind: 'span'; start: number; length: number };

/**
 * One `addStyle` overlay: an anchor, a style, and the spans the anchor currently
 * resolves to. `runs` is re-derived on every text change for a content anchor;
 * a position anchor is spliced out of the store and marked `dead`, which is what
 * its handle checks.
 */
export interface StyleOverlay {
    anchor: ResolvedTarget;
    style: ResolvedStyle;
    runs: RuleMatch[];
    dead: boolean;
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

/** Normalise a {@link StyleSpec} into a {@link ResolvedStyle} (present keys only). */
export function resolveStyle(spec: StyleSpec): ResolvedStyle {
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
export function hasStyleKeys(spec: StyleSpec): boolean {
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

// ============================================================================
// Anchors — turning a public `StyleTarget` into spans over the current text
// ============================================================================

/** Whether `ch` is a word character (used for whole-word matching). */
function isWordChar(ch: string): boolean {
    return ch !== '' && /[A-Za-z0-9_]/.test(ch);
}

/** Whether the span `[idx, idx+len)` of `text` has non-word neighbours. */
function isWholeWord(text: string, idx: number, len: number): boolean {
    const before = idx > 0 ? text[idx - 1] : '';
    const after = idx + len < text.length ? text[idx + len] : '';
    return !isWordChar(before) && !isWordChar(after);
}

/**
 * Collect matches under the shared `all` / `nth` policy: `nth` targets a single
 * occurrence (counting only spans that already passed the whole-word gate),
 * otherwise every occurrence or just the first. `push` returns `true` when the
 * caller should stop scanning.
 */
function makeCollector(runs: RuleMatch[], opts: Required<TextStyleOpts>) {
    let count = 0;
    return (start: number, length: number): boolean => {
        if (opts.nth >= 0) {
            if (count === opts.nth) { runs.push({ start, length }); return true; }
            count++;
            return false;
        }
        runs.push({ start, length });
        return !opts.all;
    };
}

/**
 * Find substring spans of `needle` in `text` per `opts`. Whole-word matches
 * require non-word (or string-boundary) neighbours.
 */
export function matchRuns(text: string, needle: string, opts: Required<TextStyleOpts>): RuleMatch[] {
    const runs: RuleMatch[] = [];
    const len = needle.length;
    if (len === 0) return runs;

    const hay = opts.caseSensitive ? text : text.toLowerCase();
    const pat = opts.caseSensitive ? needle : needle.toLowerCase();
    const take = makeCollector(runs, opts);

    let from = 0;
    for (;;) {
        const idx = hay.indexOf(pat, from);
        if (idx < 0) break;
        if (!opts.wholeWord || isWholeWord(text, idx, len)) {
            if (take(idx, len)) break;
        }
        from = idx + len;
    }
    return runs;
}

/**
 * Find pattern spans of `re` in `text` per `opts`. `re` is the normalised copy
 * built by {@link resolveTarget} — always global, so `exec` walks the string —
 * and its `lastIndex` is reset here rather than trusted from the last derive.
 *
 * Zero-length matches are skipped (they would style nothing and, without the
 * manual `lastIndex` bump, never terminate). `caseSensitive` has no meaning here:
 * the pattern's own `i` flag governs.
 */
export function regexpRuns(text: string, re: RegExp, opts: Required<TextStyleOpts>): RuleMatch[] {
    const runs: RuleMatch[] = [];
    const take = makeCollector(runs, opts);

    re.lastIndex = 0;
    for (;;) {
        const m = re.exec(text);
        if (m === null) break;
        const len = m[0].length;
        if (len === 0) { re.lastIndex++; continue; }
        if (!opts.wholeWord || isWholeWord(text, m.index, len)) {
            if (take(m.index, len)) break;
        }
    }
    return runs;
}

/** The spans of every segment run carrying `id`, in segment order. */
export function segmentRuns(segments: StyleRun[], id: string): RuleMatch[] {
    const runs: RuleMatch[] = [];
    for (let i = 0; i < segments.length; i++) {
        if (segments[i].id === id) runs.push({ start: segments[i].start, length: segments[i].length });
    }
    return runs;
}

/**
 * The spans an anchor resolves to against the current content. Most anchors read
 * the plain `text`; a `segment` anchor reads the segment runs instead, which is
 * why both are passed. The caller must have installed both *before* calling —
 * `setRichText` assigns `_segmentRuns` first, `setText` clears them first.
 *
 * A `fn` anchor is the caller's own code: its spans are taken as returned, and
 * anything it throws propagates to whoever changed the text. `onTextChanged`
 * keeps the overlay store structurally sound across that, but the overlays it
 * had not reached keep the spans they had.
 */
export function deriveRuns(anchor: ResolvedTarget, text: string, segments: StyleRun[]): RuleMatch[] {
    switch (anchor.kind) {
        case 'match': return matchRuns(text, anchor.needle, anchor.opts);
        case 'regexp': return regexpRuns(text, anchor.re, anchor.opts);
        case 'segment': return segmentRuns(segments, anchor.id);
        case 'fn': return anchor.fn(text);
        case 'span': return [{ start: anchor.start, length: anchor.length }];
    }
}

/** Whether an anchor re-derives its spans on a text change (rather than dying). */
export function isContentAnchored(anchor: ResolvedTarget): boolean {
    return anchor.kind !== 'span';
}

/** Fill in the match-option defaults. `nth: -1` means "not targeting one occurrence". */
function resolveOpts(opts: TextStyleOpts): Required<TextStyleOpts> {
    return {
        all: opts.all !== undefined ? opts.all : true,
        nth: opts.nth !== undefined ? opts.nth : -1,
        wholeWord: !!opts.wholeWord,
        caseSensitive: opts.caseSensitive !== undefined ? opts.caseSensitive : true
    };
}

/**
 * Normalise a `RegExp` into a global, non-sticky copy. `g` and `y` change where
 * `exec` starts and whether it may skip ahead — both are ours to control, so the
 * caller's are dropped rather than honoured, and the caller's own object is never
 * mutated (its `lastIndex` is observable).
 */
function normalizeRegExp(re: RegExp): RegExp {
    return new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'g');
}

/** One-time dev warning for a target that is none of the supported shapes. */
let warnedTarget = false;

/**
 * Normalise a public {@link StyleTarget} into a {@link ResolvedTarget}. An
 * unrecognised target degenerates to an empty, content-anchored matcher — inert
 * rather than throwing, since a live handle is still returned for it.
 */
export function resolveTarget(target: StyleTarget): ResolvedTarget {
    if (typeof target === 'string') {
        return { kind: 'match', needle: target, opts: resolveOpts({}) };
    }
    if (target instanceof RegExp) {
        return { kind: 'regexp', re: normalizeRegExp(target), opts: resolveOpts({}) };
    }
    if (typeof target === 'function') {
        return { kind: 'fn', fn: target as StyleMatcher };
    }
    if (target && typeof target === 'object') {
        const m = (target as MatchTarget).match;
        if (typeof m === 'string') {
            return { kind: 'match', needle: m, opts: resolveOpts(target as MatchTarget) };
        }
        if (m instanceof RegExp) {
            return { kind: 'regexp', re: normalizeRegExp(m), opts: resolveOpts(target as MatchTarget) };
        }
        const id = (target as SegmentTarget).segment;
        if (typeof id === 'string' && id.length > 0) {
            return { kind: 'segment', id };
        }
        const span = target as SpanTarget;
        if (typeof span.start === 'number' && typeof span.length === 'number') {
            return { kind: 'span', start: span.start, length: span.length };
        }
    }
    if (!warnedTarget) {
        warnedTarget = true;
        console.warn(
            '[MSDFText] addStyle: the target must be a string, a RegExp, ' +
            '`{ match, ... }`, `{ segment }`, `{ start, length }`, or a ' +
            `\`(text) => spans\` function; got ${JSON.stringify(target)}. ` +
            'The overlay styles nothing.'
        );
    }
    return { kind: 'fn', fn: () => [] };
}
