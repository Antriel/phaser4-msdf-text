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
import type { ColorValue, PerCorner, StyleSpec, RuleStyleSpec, SegmentSpec, TextStyleOpts } from './MSDFTextTypes';

/** Convert any {@link ColorValue} to a packed `0xRRGGBB` number. */
export function toColorInt(value: ColorValue): number {
    return (Phaser.Display.Color.ValueToColor as any)(value).color;
}

/**
 * A {@link StyleSpec} pre-parsed once (at creation) into GPU-ready values, so
 * per-frame seeding does no colour parsing or scale expansion. Absent fields
 * mean "inherit the seeded base" — only present keys are applied to a glyph.
 * Colour is packed `0xRRGGBB` (per corner); alpha is `0-1` (per corner).
 *
 * All fields but `fontScale` are **appearance**: they are stamped onto a
 * `GlyphState` by {@link applyStyleToGlyph}. `fontScale` is **structural** — it
 * feeds the layout pass instead and never reaches a glyph state.
 */
export interface ResolvedStyle {
    fillColor?: Corners;   // packed 0xRRGGBB per corner
    fillAlpha?: Corners;   // 0-1 per corner
    outlineColor?: number;
    outlineAlpha?: number;
    shadowColor?: number;
    shadowAlpha?: number;
    shadowX?: number;
    shadowY?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    skew?: number;
    fontScale?: number;    // structural — layout input, not glyph state
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

/** Parse a scalar-or-per-corner alpha into `0-1` corners. */
function resolveAlphaCorners(value: number | PerCorner<number>): Corners {
    if (isPerCorner(value)) {
        const v = value as PerCorner<number>;
        return { topLeft: v.topLeft, topRight: v.topRight, bottomLeft: v.bottomLeft, bottomRight: v.bottomRight };
    }
    const a = value as number;
    return { topLeft: a, topRight: a, bottomLeft: a, bottomRight: a };
}

/** One-time dev warning for a `fontScale` that isn't a positive number. */
let warnedFontScale = false;

/** Normalise a {@link RuleStyleSpec} into a {@link ResolvedStyle} (present keys only). */
export function resolveStyle(spec: RuleStyleSpec): ResolvedStyle {
    const r: ResolvedStyle = {};
    if (spec.color !== undefined) r.fillColor = resolveColorCorners(spec.color);
    if (spec.alpha !== undefined) r.fillAlpha = resolveAlphaCorners(spec.alpha);
    if (spec.outline) {
        if (spec.outline.color !== undefined) r.outlineColor = toColorInt(spec.outline.color);
        if (spec.outline.alpha !== undefined) r.outlineAlpha = spec.outline.alpha;
    }
    if (spec.shadow) {
        if (spec.shadow.color !== undefined) r.shadowColor = toColorInt(spec.shadow.color);
        if (spec.shadow.alpha !== undefined) r.shadowAlpha = spec.shadow.alpha;
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
    return r;
}

/** Whether a spec carries at least one override (appearance or structural). */
export function hasStyleKeys(spec: SegmentSpec): boolean {
    return spec.color !== undefined || spec.alpha !== undefined ||
        spec.outline !== undefined || spec.shadow !== undefined ||
        spec.scale !== undefined || spec.scaleX !== undefined || spec.scaleY !== undefined ||
        spec.rotation !== undefined || spec.skew !== undefined ||
        spec.fontScale !== undefined;
}

/**
 * Whether a resolved style stamps anything onto a {@link GlyphState}. A run that
 * carries only the structural `fontScale` changes the layout but seeds nothing,
 * so it must not, on its own, force the per-glyph state array into existence.
 */
export function styleHasAppearanceKeys(s: ResolvedStyle): boolean {
    return s.fillColor !== undefined || s.fillAlpha !== undefined ||
        s.outlineColor !== undefined || s.outlineAlpha !== undefined ||
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
    return s.shadowColor !== undefined || s.shadowAlpha !== undefined ||
        s.shadowX !== undefined || s.shadowY !== undefined;
}

/** Apply a resolved style's present keys onto one glyph state (overwrite). */
export function applyStyleToGlyph(g: GlyphState, s: ResolvedStyle): void {
    if (s.fillColor) {
        const t = g.fill.color, v = s.fillColor;
        t.topLeft = v.topLeft; t.topRight = v.topRight; t.bottomLeft = v.bottomLeft; t.bottomRight = v.bottomRight;
    }
    if (s.fillAlpha) {
        const a = g.fill.alpha, v = s.fillAlpha;
        a.topLeft = v.topLeft; a.topRight = v.topRight; a.bottomLeft = v.bottomLeft; a.bottomRight = v.bottomRight;
    }
    if (s.outlineColor !== undefined) {
        const t = g.outline.color;
        t.topLeft = t.topRight = t.bottomLeft = t.bottomRight = s.outlineColor;
    }
    if (s.outlineAlpha !== undefined) {
        const a = g.outline.alpha;
        a.topLeft = a.topRight = a.bottomLeft = a.bottomRight = s.outlineAlpha;
    }
    if (s.shadowColor !== undefined) {
        const t = g.shadow.color;
        t.topLeft = t.topRight = t.bottomLeft = t.bottomRight = s.shadowColor;
    }
    if (s.shadowAlpha !== undefined) {
        const a = g.shadow.alpha;
        a.topLeft = a.topRight = a.bottomLeft = a.bottomRight = s.shadowAlpha;
    }
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
