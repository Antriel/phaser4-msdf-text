/**
 * Public types for {@link MSDFText}.
 *
 * The runtime lives in `MSDFText.ts`; this module holds only the type surface —
 * the value types callers pass in, the style/fit option bags, and the
 * `MSDFTextInstance` interface used to annotate instances (instead of the
 * `MSDFText` Class constructor). `MSDFText.ts` re-exports everything here, so the
 * public import path stays `'./MSDFText'`.
 */

import * as Phaser from "phaser";
import type { MSDFFont } from './MSDFFont';
import type { GlyphState } from './MSDFGlyphState';
import type { DecorationState } from './MSDFDecorState';

/**
 * Any value accepted by Phaser.Display.Color.ValueToColor:
 * - number: packed 0xRRGGBB
 * - string: '#rrggbb', '#rgb', or 'rgb(r,g,b)'
 * - object: { r, g, b, a? } with channels in 0-255 (also accepts Phaser.Display.Color)
 */
export type ColorValue = number | string | Phaser.Types.Display.InputColorObject | Phaser.Display.Color;

/** Line alignment for multi-line text. */
export type MSDFAlign = 'left' | 'center' | 'right';

/** A per-corner value — the four corners of a glyph quad. */
export interface PerCorner<T> {
    topLeft: T;
    topRight: T;
    bottomLeft: T;
    bottomRight: T;
}

/**
 * A dash pattern for an underline or strikethrough — the rule is cut into evenly
 * spaced dashes instead of being drawn solid. Passing `true` instead of this
 * object takes the defaults below.
 *
 * `length` and `gap` are em-relative to the **run's own size**, like
 * {@link DecorationSpec.offset}, so a dashed rule keeps its proportions under a
 * `fontScale` run or a `fitInside`. The requested period (`length + gap`) is
 * rounded to fit each rect a whole number of times, so a rule always begins and
 * ends the same way; a rect narrower than one and a half periods becomes a single
 * centred dash.
 *
 * Dots are a corner of the same shape, not a second feature: a `radius` of `1`
 * rounds a dash into a stadium, and a `length` at or below the rule's thickness
 * makes that stadium a circle.
 *
 * The whole pattern is **one quad**, however many dashes it draws — the count
 * rides the rect's UVs, not a vertex byte — so a dashed rule costs no more to draw
 * than a solid one, and {@link MSDFTextInstance.dashPhase} can slide it every
 * frame without rebuilding anything.
 */
export interface DashSpec {
    /** Dash length, em-relative (× the run's font size). Default `0.14`. Must be `> 0`. */
    length?: number;
    /** Gap between dashes, em-relative (× the run's font size). Default `0.09`. Must be `> 0`. */
    gap?: number;
    /**
     * Cap rounding, `0` (square) to `1` (a stadium), as a fraction of the dash's
     * own half-thickness. Default `0`. With a short `length`, `1` is a round dot.
     */
    radius?: number;
    /**
     * Edge blur, `0` (a 1-screen-pixel antialiased edge) to `1`, as a fraction of
     * the dash's half-thickness. Default `0`. Fades inward, like a pill's.
     */
    softness?: number;
}

/**
 * An underline or strikethrough. Passing `true` instead of this object inherits
 * everything; passing `false` switches the decoration off for the run.
 *
 * Decorations follow the **layout**, not the glyphs: per-glyph `scale`,
 * `rotation` and `skew` move a glyph without moving the rule under it. They also
 * cast no shadow and take no outline, and `displayCallback` cannot see or
 * animate them — they are resolved from the style layers only. The one exception
 * is {@link MSDFTextInstance.dashPhase}, which slides a dash pattern at submit
 * time and so is tweenable without a rebuild.
 */
export interface DecorationSpec {
    /** Rule colour. Default: inherit the run's resolved fill colour. */
    color?: ColorValue | PerCorner<ColorValue>;
    /** Rule alpha (0-1). Default: inherit the run's resolved fill alpha. */
    alpha?: number | PerCorner<number>;
    /** Multiplier on the font's `underlineThickness`. Default `1`. */
    thickness?: number;
    /** Em-relative shift from the default position; positive moves down. Default `0`. */
    offset?: number;
    /**
     * Cut the rule into dashes (or dots). `true` takes the {@link DashSpec}
     * defaults; omitting it (or `false`) draws a solid rule. A `length` or `gap`
     * of `0` is not a dash pattern, so it falls back to solid.
     */
    dash?: boolean | DashSpec;
}

/**
 * Extra advance at a run's two edges — the {@link StyleSpec.space} object form.
 * Either side may be omitted; a bare number instead of this object sets both.
 */
export interface SpaceSpec {
    /** Extra advance before the run's first character, em-relative. Default `0`. */
    before?: number;
    /** Extra advance after the run's last character, em-relative. Default `0`. */
    after?: number;
}

/** Em-relative padding around a highlight pill (× the object's `fontSize`). */
export interface HighlightPadding {
    /** Both horizontal sides. */
    x?: number;
    /** Both vertical sides. */
    y?: number;
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
}

/**
 * A highlight pill — a rounded, optionally soft, optionally bordered box painted
 * *behind* a run of text. Passing `true` instead of this object draws the plain
 * default (opaque marker yellow, square corners, no padding); `false` switches
 * the highlight off for the run.
 *
 * The pill is a `solid` quad, so it batches with the glyphs: a highlighted text
 * is still one draw call. It spans the run's glyph boxes horizontally and the
 * tallest ascender / deepest descender on the line vertically, plus `padding`.
 * Like underline and strikethrough it follows the **layout**, not the glyphs —
 * per-glyph `scale`, `rotation` and `skew` move a glyph without moving the pill
 * behind it, and `displayCallback` cannot see it. Highlights draw behind
 * everything, including the text's own drop shadow.
 *
 * `radius`, `borderWidth` and `softness` are fractions of the pill's **half-
 * thickness** (`min(width, height) / 2`), so they are size-independent: `radius:
 * 1` is a stadium at any font size. All three are continuous, hence per-corner —
 * a pill can round only its left corners, or blur only its top edge.
 *
 * Unlike a decoration, a highlight never inherits the text's fill colour (a slab
 * of text-coloured paint behind the text would hide it), so a colour tween on the
 * object does not drag the pill along.
 */
export interface HighlightSpec {
    /** Face colour — a scalar or a per-corner gradient. Default marker yellow. */
    color?: ColorValue | PerCorner<ColorValue>;
    /** Face alpha (0-1). Default `1`. A face alpha of `0` frees {@link innerColor}. */
    alpha?: number | PerCorner<number>;
    /** Corner radius, `0` (square) to `1` (a stadium). Default `0`. */
    radius?: number | PerCorner<number>;
    /**
     * Edge blur, `0` (a 1-screen-pixel antialiased edge) to `1`. Default `0`.
     * Softens the face and the border together — a marker-pen wash, or a glow.
     *
     * The blur fades **inward** from the pill's box, which is therefore the outer
     * bound of everything the pill draws. (A rect's quad ends exactly at its box,
     * so an outward blur would be clipped in half.) Give a glow its room with
     * `padding`.
     */
    softness?: number | PerCorner<number>;
    /**
     * Border ring width, `0` (no ring) to `1` (a ring that fills the pill).
     * Default `0`. At `0` the ring's alpha is zeroed, exactly as a glyph outline's
     * is at zero width.
     */
    borderWidth?: number | PerCorner<number>;
    /** Border colour. Default black — invisible until `borderWidth` opens it. */
    borderColor?: ColorValue | PerCorner<ColorValue>;
    /** Border alpha (0-1). Default `1`. */
    borderAlpha?: number | PerCorner<number>;
    /**
     * Colour at the border's inner edge: the ring ramps to it from `borderColor`
     * across its own width. Requires a face `alpha` of `0` — the inner colour
     * rides the face's colour slot, which an opaque face has already spent (the
     * same constraint that makes a two-tone glyph outline force `outlineLayered`).
     *
     * A pill with `alpha: 0`, `borderWidth: 1` and a `softness` is therefore a
     * two-tone glow blob: the ring fills the whole pill and ramps from
     * `borderColor` at the blurred rim to `innerColor` at its core. With no face to
     * inset, `borderWidth` becomes purely the ramp's depth — lower it to reach the
     * inner colour sooner.
     */
    innerColor?: ColorValue | PerCorner<ColorValue>;
    /**
     * Padding around the run, em-relative (× the object's `fontSize`). Default `0`.
     *
     * The unpadded box spans the run's glyph advances horizontally and its tallest
     * ascender to deepest descender vertically. **Negative padding is legal** and
     * crops inward from there — useful to pull a slab down towards the x-height, or
     * to tighten a pill onto letterforms that leave a lot of vertical air. A pill
     * cropped to nothing simply isn't emitted.
     */
    padding?: number | HighlightPadding;
}

/**
 * A per-run style override for the rich-text API — the one spec shared by every
 * declarative layer ({@link MSDFTextInstance.setRichText} segments and
 * {@link MSDFTextInstance.addStyle} overlays). Every field is optional; only the
 * keys present override the glyph's seeded base (which inherits the text
 * object's colour/alpha/weight/outline/shadow). Colours, alphas and the
 * continuous effect channels (`weight`, `outline.width`, `shadow.softness`)
 * accept a scalar (all four corners the same) or a {@link PerCorner} (a gradient
 * across the glyph quad).
 *
 * **Specs are layout inputs; the glyph array is layout output.** Any spec layer
 * may carry any key, and each key lane has its own cost:
 *
 * - *appearance* (colour, alpha, weight, outline, shadow, scale, rotation, skew)
 *   → a coalesced per-glyph re-seed before the next render. These seed
 *   `GlyphState`, compose with `displayCallback`, and are animatable.
 * - *decoration* (`underline`, `strikethrough`, `highlight`) → a coalesced rect
 *   rebuild. They resolve per source character and never reach `GlyphState`.
 * - *structural* (`fontScale`, `font`) → a **relayout**, on any layer, including
 *   through a {@link StyleHandle}'s `update`. They feed the layout pass and never
 *   reach `GlyphState`.
 *
 * The imperative per-glyph surface (`displayCallback`, `editGlyphs`) operates on
 * already-laid-out glyphs and is appearance-only by construction: `GlyphState`
 * has no structural fields.
 */
export interface StyleSpec {
    /** Fill colour — a scalar or a per-corner gradient. */
    color?: ColorValue | PerCorner<ColorValue>;
    /** Fill alpha (0-1) — a scalar or a per-corner gradient. */
    alpha?: number | PerCorner<number>;
    /**
     * Faux bold in distance-field units — positive fattens, negative thins.
     * Widens the glyph **without changing its advance**, so letters can touch at
     * high weight. Bounded by half the atlas `distanceRange`, like outline width.
     */
    weight?: number | PerCorner<number>;
    /**
     * Outline override. A `width` of `0` disables this run's outline — unless a
     * `softness` gives it a body, which makes it a glow hugging the letterform.
     */
    outline?: {
        /** Outline colour — also the run's `innerColor` unless that is set too. */
        color?: ColorValue;
        /**
         * Colour at the outline's inner edge, where it meets the glyph: the
         * outline ramps to it from `color` across the band. Requires the object's
         * `outlineLayered` (or its `outlineInnerColor`, which turns layering on).
         */
        innerColor?: ColorValue;
        alpha?: number;
        /** Outline width in distance-field units — a scalar or a per-corner ramp. */
        width?: number | PerCorner<number>;
        /**
         * How far to round the outer corners off the true SDF (MTSDF atlas
         * only): `0` (sharp) to `1` (round), a boolean for those two ends, or a
         * per-corner ramp — an outline melting from sharp to round across a
         * glyph.
         */
        rounded?: number | boolean | PerCorner<number>;
        /**
         * Blur the outline's outer edge, in distance-field units — a scalar or a
         * per-corner ramp (MTSDF atlas only). The blur straddles the outline
         * edge, so its inner half hides under the fill and only the outside
         * softens. With `width` at `0` the outline *is* the glow, and it rides
         * the fill's own quad — no shadow pass, no second set of quads.
         */
        softness?: number | PerCorner<number>;
    };
    /**
     * Shadow override.
     *
     * **A styled shadow needs an `alpha`**, unless the text object itself has a
     * shadow for the run to inherit one from. Glyphs are seeded with a shadow
     * alpha of `0` (so unstyled glyphs draw nothing when the shadow pass runs for
     * a styled run's sake), and a spec applies only the keys it names — so
     * `shadow: { color: 0xff0000, x: 2, y: 2 }` lands its colour and offset on an
     * invisible aspect.
     */
    shadow?: {
        /** Shadow colour — also the run's `innerColor` unless that is set too. */
        color?: ColorValue;
        /**
         * Colour at the shadow's inner edge, where it meets the glyph: the blur
         * ramps to it from `color`. A hot inner colour on a soft, zero-offset
         * shadow is a two-tone glow.
         */
        innerColor?: ColorValue;
        /** Shadow alpha (0-1). Required for a shadow the object doesn't already have. */
        alpha?: number;
        x?: number;
        y?: number;
        /** Shadow blur in distance-field units — a scalar or a per-corner ramp (MTSDF atlas only). */
        softness?: number | PerCorner<number>;
        /**
         * Dilate the shadow's silhouette before blurring it, in distance-field
         * units — a scalar or a per-corner ramp. Fattens a shadow without mushing
         * it, and is the only route to a fat *hard* shadow. Needs no MTSDF atlas.
         */
        spread?: number | PerCorner<number>;
        /**
         * How far to round the dilated/blurred silhouette off the true SDF
         * (MTSDF atlas only): `0` (sharp) to `1` (round), a boolean, or a
         * per-corner ramp. Defaults **on** at the object level; drop it towards
         * `0` for the mitre spikes a sharp dilation of `median(rgb)` grows at
         * every corner.
         */
        rounded?: number | boolean | PerCorner<number>;
    };
    /** Uniform glyph scale about the centre. */
    scale?: number;
    /** Horizontal glyph scale (overrides `scale` on the X axis). */
    scaleX?: number;
    /** Vertical glyph scale (overrides `scale` on the Y axis). */
    scaleY?: number;
    /** Glyph rotation about the centre, in radians. */
    rotation?: number;
    /** Baseline shear (`dx/dy`) — faux italic. Positive leans right. */
    skew?: number;
    /**
     * Where {@link skew} pivots, as an offset from the layout baseline in **em**,
     * positive down. `0` (the default) pivots on the baseline; a small positive
     * value puts the pivot under the descenders, shearing each glyph about its
     * visual base. Measured from the line's shared baseline, so any value keeps a
     * mixed-size line slanting as one line.
     */
    skewPivot?: number;
    /** Underline this run. `true` inherits everything; see {@link DecorationSpec}. */
    underline?: boolean | DecorationSpec;
    /** Strike this run through. `true` inherits everything; see {@link DecorationSpec}. */
    strikethrough?: boolean | DecorationSpec;
    /** Paint a pill behind this run. `true` is plain marker yellow; see {@link HighlightSpec}. */
    highlight?: boolean | HighlightSpec;

    /**
     * Per-run font size as a **multiplier** on the object's `fontSize` (e.g.
     * `1.5` for a heading run, `0.75` for fine print). Must be `> 0`; other
     * values are ignored with a one-time dev warning.
     *
     * A multiplier rather than absolute pixels so `setFontSize` and `fitInside`
     * stay coherent: the run keeps its proportion at any object size, and
     * `fitInside`'s binary search stays monotone.
     *
     * **Structural** — it changes wrap, advance and line height, so setting it
     * (including via `handle.update`) triggers a relayout, not a re-seed. Kerning
     * is skipped across a boundary where the size changes. Deliberately named
     * apart from the appearance-lane `scale`, which stretches the rendered glyph
     * about its centre without touching layout.
     */
    fontScale?: number;

    /**
     * Per-run font: a key into the `msdfFont` cache, i.e. a font already loaded
     * with `this.load.msdfFont(key, ...)`. An unknown key falls back to the
     * object's own font, with a one-time dev warning.
     *
     * **Structural** — the run's advances, kerning, ascender and line height all
     * come from its own font, so setting it (including via `handle.update`)
     * triggers a relayout, not a re-seed. A line's height and baseline take the
     * largest metric among the runs on it, so mixed-font runs align by baseline.
     *
     * Two rules to know:
     *
     * - **No kerning across a font boundary**, and no glyph fallback: a
     *   character absent from *its run's* font is skipped, exactly as a missing
     *   character is on a single-font text. It is not borrowed from the object's
     *   font or any other run's.
     * - A run whose font uses a **different atlas texture** ends the current
     *   draw call. Text-scale glyph counts make that cheap, but if you mix fonts
     *   heavily and care, generate one merged atlas (`msdf-atlas-gen` with
     *   `-and`-separated inputs) so every run shares a texture.
     */
    font?: string;

    /**
     * Extra advance at the run's **edges** — a scalar for both sides, or
     * `{ before, after }` for one at a time. **Negative tightens**, which is half
     * the point: it is the manual fix for the two gaps a mixed-font line always
     * has, where one face's side bearings meet another's and no kern pair exists
     * to reconcile them.
     *
     * ```ts
     * { text: 'Bangers ', font: 'Bangers', space: { after: 0.12 } }  // open a gap
     * { text: 'Mono ', font: 'JetBrainsMono', space: { after: -0.15 } }  // close one
     * ```
     *
     * Em-relative to the **run's own size** (`fontSize × fontScale`), like
     * {@link DecorationSpec.offset} — so a display-size run's gaps grow with it,
     * and every gap survives `setFontSize` and `fitInside` in proportion (an
     * absolute-pixel pad would not, exactly as it would not for `fontScale`).
     *
     * **Structural** — the pads are real advance, so they feed wrap, line width,
     * alignment and the decoration rects, and setting one (including via
     * `handle.update`) costs a relayout rather than a re-seed.
     *
     * Two edges, not a gap between runs: `before` lands on the run's first
     * character and `after` on its last, so two adjacent runs each asking for
     * space at the boundary between them both get it (they occupy different
     * characters, and their pads add). Two *overlapping* rules asking for the same
     * edge do not add — the later layer wins, as everywhere else. A pad rides its
     * character's advance, so one on a character absent from its run's font, or on
     * a line break, is dropped with it; one at the end of a line is real width, and
     * so nudges a centred line, exactly as `letterSpacing`'s trailing slot does.
     *
     * For a value that differs per character, see
     * {@link MSDFTextInstance.setSpacingCallback} — the same two maps, written by a
     * function instead of by a span.
     */
    space?: number | SpaceSpec;
}

/** A styled run of text for {@link MSDFTextInstance.setRichText}. */
export interface SegmentSpec extends StyleSpec {
    /** The run's text. Concatenated (in order) into the object's plain text. */
    text: string;

    /**
     * A name for this run, so an overlay can address it later:
     * `addStyle({ segment: id }, style)`. Ids need not be unique — an overlay
     * anchored to one covers **every** segment carrying it, in order.
     *
     * The point is that the overlay outlives the segment: a `setRichText` that
     * replaces the content but keeps the id moves the overlay to the new span,
     * so a named piece can be recoloured or animated without re-declaring it,
     * and without re-calling `setRichText` (which drops every position-anchored
     * overlay as collateral).
     *
     * A named segment survives even with no style keys of its own — it exists to
     * be a target.
     */
    id?: string;
}

/** One rich-text segment: a bare string (unstyled) or a styled {@link SegmentSpec}. */
export type Segment = string | SegmentSpec;

/** Match options for the object form of a {@link StyleTarget}. */
export interface TextStyleOpts {
    /** Style every occurrence. Default `true`. Ignored when `nth` is given. */
    all?: boolean;
    /** Style only the nth occurrence (0-based). Overrides `all`. */
    nth?: number;
    /** Require whole-word matches (word-char boundaries). Default `false`. */
    wholeWord?: boolean;
    /**
     * Case-sensitive matching. Default `true`. Ignored for a `RegExp` `match`,
     * whose own `i` flag governs.
     */
    caseSensitive?: boolean;
}

/** A {@link StyleTarget} that matches by content, with options. */
export interface MatchTarget extends TextStyleOpts {
    /** Substring or pattern to match against the current text. */
    match: string | RegExp;
}

/** A {@link StyleTarget} anchored to fixed indices into the current text. */
export interface SpanTarget {
    /** Index into the plain `text` of the first styled character. */
    start: number;
    /** Number of source characters covered. */
    length: number;
}

/**
 * A {@link StyleTarget} anchored to the named {@link SegmentSpec}s of the last
 * {@link MSDFTextInstance.setRichText} call.
 *
 * Content-anchored, and unusual in that its content is the *segments*, not the
 * string: it re-derives whenever they do. While no segment carries the id the
 * overlay is alive but empty — it draws nothing and revives if a later
 * `setRichText` brings the id back. A plain `setText` clears the segments, so it
 * empties the same way.
 */
export interface SegmentTarget {
    /** The {@link SegmentSpec.id} to style. */
    segment: string;
}

/**
 * A custom {@link StyleTarget}: given the current plain text, return the spans to
 * style. Re-run on every text change, like any other content anchor — a parser's
 * token spans, "every emoji", "every third word" are all one-liners here.
 *
 * **Experimental.** The spans are taken as returned — overlapping or out-of-range
 * ones are yours to avoid (they are clamped, never clipped back to you). Anything
 * the matcher throws propagates out of whatever changed the text (`setText`,
 * `setRichText`, `addStyle`); the overlay store stays consistent, but overlays
 * the re-derive had not reached keep their previous spans.
 */
export type StyleMatcher = (text: string) => SpanTarget[];

/**
 * What an {@link MSDFTextInstance.addStyle} overlay is anchored to. The anchor
 * kind — not the method — decides the overlay's lifetime:
 *
 * - **Content-anchored** (`string`, `RegExp`, {@link MatchTarget},
 *   {@link SegmentTarget}, {@link StyleMatcher}) — the spans are re-derived on
 *   every text change, so the overlay survives `setText` and `setRichText`.
 * - **Position-anchored** ({@link SpanTarget}) — the spans index the text the
 *   caller passed them against, so **any** text change drops the overlay and kills
 *   its handle (no clamping).
 *
 * A bare `string` matches every occurrence (substring, case-sensitive); use the
 * {@link MatchTarget} form for `nth` / `all` / `wholeWord` / `caseSensitive`. A
 * `RegExp` matches every occurrence of the pattern; its `g` and `y` flags are
 * ignored (all matches are found either way) and zero-length matches are skipped.
 * {@link SegmentTarget} addresses a named `setRichText` segment rather than the
 * string it contributed.
 */
export type StyleTarget = string | RegExp | MatchTarget | SegmentTarget | SpanTarget | StyleMatcher;

/**
 * A live handle to an overlay added with {@link MSDFTextInstance.addStyle}.
 * `update` **replaces** the style (it is not a merge); changes coalesce into a
 * single re-seed before the next render, unless the style carries a structural
 * key (`fontScale`/`font`), which costs a relayout instead.
 *
 * A position-anchored overlay's handle dies on any text change, as does any
 * handle after `remove()` or `clearStyles()`; `update` on a dead handle no-ops
 * with a one-time dev warning.
 */
export interface StyleHandle {
    /** Replace the overlay's style. */
    update(style: StyleSpec): void;
    /** Drop the overlay. */
    remove(): void;
}

/**
 * A box to fit text into, for {@link MSDFTextInstance.fitInside}.
 *
 * `width`/`height` are required. `x`/`y` are optional and must be supplied
 * *together*: with both, the fitted block is also placed inside the box using
 * `hAlign`/`vAlign`; with neither, the text is only resized (not moved). A rect
 * with only one of `x`/`y` is treated as size-only (dev-warn). Structurally
 * compatible with `Phaser.Geom.Rectangle`, so a real Phaser rect can be passed
 * directly.
 */
export interface RectLike {
    x?: number;
    y?: number;
    width: number;
    height: number;
}

/** Options for {@link MSDFTextInstance.fitInside}. */
export interface FitOptions {
    /** Upper bound on font size. Default: the current `fontSize` (shrink-only). */
    maxFontSize?: number;
    /** Lower bound; only a non-degenerate floor (must be `> 0`). Default: 1. */
    minFontSize?: number;
    /** Horizontal placement of the block within the box. Default `'left'`. */
    hAlign?: 'left' | 'center' | 'right';
    /** Vertical placement of the block within the box. Default `'top'`. */
    vAlign?: 'top' | 'middle' | 'bottom';
    /** Binary-search stop tolerance in px. Default `0.25`. */
    precision?: number;
}

/**
 * One visual line's layout, as the last rebuild resolved it. See
 * {@link MSDFTextInstance.lines}.
 *
 * All values are in the text object's local space — the same space as
 * {@link GlyphState.x} / {@link GlyphState.y} — so a glyph can be placed against
 * its own line without any conversion.
 */
export interface LineInfo {
    /** Visual line index, counting wrapped (soft) and original (hard) breaks alike. */
    readonly index: number;
    /**
     * Left edge of this line, after alignment. Always `0` when `align` is
     * `'left'`; a centred or right-aligned line is inset from the block's left
     * edge by the amount it is shorter than the longest line.
     */
    readonly x: number;
    /** Laid-out width of this line, excluding the alignment inset. */
    readonly width: number;
    /**
     * Y of this line's highest ascender — the top of its tallest glyph box, not
     * of its ink. With mixed sizes or fonts this is the largest ascender on the
     * line, which is the one every glyph on it is aligned against.
     */
    readonly top: number;
    /** Y of the baseline every glyph on this line sits on. */
    readonly baselineY: number;
    /**
     * Y of the bottom of this line's box — `top` plus the tallest `lineHeight` on
     * the line. This is the *line box*, so for most fonts it sits a little below
     * the deepest descender, and it excludes `lineSpacing`.
     */
    readonly bottom: number;
}

/**
 * Display callback signature.
 *
 * Called once per frame (not once per glyph) with the full array of per-glyph
 * {@link GlyphState} objects — already seeded with the text's effective colour,
 * alpha and layout — and the parent text object. Mutate the glyphs in place;
 * the return value is ignored. The same array instance is reused every frame.
 *
 * It is driven by the render function, so it does **not** run while the text is
 * culled, invisible or off-camera. Recompute a glyph's state from a clock or a
 * tweened field rather than integrating it inside the callback, or an
 * off-screen text will freeze mid-animation and resume out of phase.
 */
export type DisplayCallback = (glyphs: GlyphState[], parent: MSDFTextInstance) => void;

/**
 * Decoration callback signature.
 *
 * Called once per frame with every decoration rect the text laid out — its
 * underlines, strikethroughs and highlight pills, in one array — already seeded
 * from the rebuild and from the text's live colour. Mutate them in place.
 *
 * It runs **after** {@link DisplayCallback}, so `parent.glyphs` holds the finished
 * glyph states and a rect can follow the glyphs it was merged from
 * ({@link DecorationState.glyphStart} / `glyphEnd` index straight into that array).
 * Like the display callback, it is transient — the array is re-seeded every frame,
 * so recompute from a clock rather than accumulating inside it — and it is driven
 * by the render function, so it does not run while the text is culled or invisible.
 */
export type DecorationCallback = (rects: DecorationState[], parent: MSDFTextInstance) => void;

/**
 * The two edge-pad maps a {@link SpacingCallback} writes into, both indexed by
 * position in the **source** text (`text[i]` is the character `before[i]` /
 * `after[i]` pad), both in em of that character's own size.
 *
 * They arrive pre-filled by the {@link StyleSpec.space} keys of every segment and
 * overlay, so a callback can add to what the styles asked for (`+=`), override it
 * (`=`), or read it and leave it alone.
 */
export interface SpacingPads {
    /** Extra advance before character `i`. */
    readonly before: Float32Array;
    /** Extra advance after character `i`. */
    readonly after: Float32Array;
}

/**
 * Spacing callback signature — the per-character lane of {@link StyleSpec.space}.
 *
 * Unlike {@link DisplayCallback} and {@link DecorationCallback}, this runs at
 * **rebuild** time, not once per frame: the pads are a layout input (they feed
 * wrap, line width, alignment and the decoration rects), so they must be known
 * before the text is laid out, and they cost a relayout to change. It is re-run on
 * every rebuild against the current string — so, like a {@link StyleMatcher}
 * anchor, it survives `setText` and `setRichText` instead of dying with the
 * indices it was written against.
 *
 * ```ts
 * text.setSpacingCallback((pad, src) => {
 *   for (let i = 0; i < src.length; i++) {
 *     if (src[i] === ',') pad.after[i] += 0.06;                        // a rule
 *     if (src[i] === 'A' && src[i + 1] === 'V') pad.after[i] -= 0.04;  // a kern pair
 *   }
 * });
 * ```
 *
 * Do not drive an animation from here — a per-frame pad change is a per-frame
 * relayout. Animate `GlyphState.offsetX` in a display callback instead: an advance
 * is its prefix sum, and doing it there leaves the line's wrap and alignment (and
 * its underline) where they are, which is what kinetic type wants anyway.
 */
export type SpacingCallback = (pad: SpacingPads, text: string, parent: MSDFTextInstance) => void;

// Re-export so consumers can type their callbacks against the per-quad state.
export type { GlyphState } from './MSDFGlyphState';
export type { DecorationState } from './MSDFDecorState';

/**
 * Type interface for MSDFText instances.
 *
 * Use this for type annotations instead of the `MSDFText` Class constructor.
 * It describes only the public surface — internal backing fields (`_text`,
 * `_dirty`, …) are deliberately omitted.
 */
export interface MSDFTextInstance extends
    Phaser.GameObjects.GameObject,
    Phaser.GameObjects.Components.Alpha,
    Phaser.GameObjects.Components.BlendMode,
    Phaser.GameObjects.Components.Depth,
    Phaser.GameObjects.Components.Filters,
    Phaser.GameObjects.Components.GetBounds,
    Phaser.GameObjects.Components.Origin,
    Phaser.GameObjects.Components.ScrollFactor,
    Phaser.GameObjects.Components.Texture,
    Phaser.GameObjects.Components.Transform,
    Phaser.GameObjects.Components.Visible {

    /** Key of the MSDF font in the `msdfFont` cache. Use `setFont` to change it. */
    readonly font: string;
    /** Parsed runtime font data. */
    readonly fontData: MSDFFont;

    /**
     * The font governing source character `index` — {@link fontData} unless a
     * rich-text run put another face there. Out-of-range indices give the base
     * font, so `fontAt(i) !== fontAt(i + 1)` is a safe font-boundary test at either
     * end of the string.
     *
     * The resolved structural state, in other words, keyed the way a
     * {@link SpacingCallback} is keyed — which is what it is for: a spacing rule
     * that cannot see the fonts cannot space a font boundary, and a font boundary
     * is exactly where spacing has no kern pair to fall back on.
     */
    fontAt(index: number): MSDFFont;
    /** The `fontScale` multiplier governing source character `index` (`1` if none). */
    fontScaleAt(index: number): number;
    /** Character code that word wrapping breaks on. Defaults to 32 (space). */
    wordWrapCharCode: number;

    /**
     * Faux bold in distance-field units — it shifts every glyph's distance
     * threshold, so positive fattens and negative thins. The outline and shadow
     * edges move with it.
     *
     * This widens glyphs **without changing their advance**, so at a high weight
     * letters can touch; the shift saturates at half the atlas `distanceRange`,
     * exactly like `outlineWidth`. A plain field (no layout side effects), so it
     * can be assigned or tweened directly. Default `0`.
     */
    weight: number;

    // Outline — plain fields (no layout side effects), so they can be assigned
    // or tweened directly. `setOutline` is a chainable convenience wrapper.
    /**
     * Outline width in distance-field units. `0` disables the outline — unless
     * {@link outlineSoftness} gives it a body of its own.
     */
    outlineWidth: number;
    /** Outline color, packed `0xRRGGBB`. */
    outlineColor: number;
    /**
     * Colour at the outline's inner edge, packed `0xRRGGBB`, or `-1` (the
     * default) to inherit `outlineColor` and draw a single-colour outline.
     *
     * A real colour makes the outline ramp from `outlineColor` at its outer edge
     * to this where it meets the glyph, and **forces `outlineLayered`** — the
     * inner colour rides the quad's fill-colour attribute, which a combined
     * fill+outline quad has already spent. Works on plain MSDF atlases.
     * {@link setOutlineInnerColor} is the colour-parsing wrapper.
     */
    outlineInnerColor: number;
    /** Outline alpha, 0-1. */
    outlineAlpha: number;
    /**
     * How far to round the outline's outer corners off the true SDF, from `0`
     * (sharp — the corner-preserving `median(rgb)` the fill uses, and the
     * default) to `1` (fully rounded). MTSDF atlas only.
     *
     * A continuous knob, not a flag: intermediates blend the two edges, so it
     * tweens. Assigning a boolean is accepted and lands on the same two ends.
     * The letterform's *fill* stays sharp at every value — only the outline's
     * own edge rounds.
     */
    get outlineRounded(): number;
    set outlineRounded(value: number | boolean);
    /**
     * Blur the outline's outer edge, in distance-field units — so it scales with
     * the text, like `outlineWidth` (MTSDF atlas only). `0` (the default) is the
     * plain crisp edge.
     *
     * The blur is centred on the outline edge, so its inner half hides under the
     * opaque fill and only the outside visibly softens — which is what a soft
     * outline should look like. With `outlineWidth` at `0` the outline *is* the
     * blur: a glow hugging the letterform, drawn in the fill's own quad, with no
     * shadow pass and no second set of glyph quads. Pair it with
     * {@link outlineInnerColor} for a neon tube.
     */
    outlineSoftness: number;
    /**
     * Draw the outline in two passes — every glyph's outline silhouette first,
     * then every glyph's fill on top — so a thick outline never overlaps the
     * neighbouring glyph. Costs a second set of glyph quads (≈2× the outline's
     * fragment work) and composites the outline under the fill, so partially
     * transparent text shows the outline faintly through the fill. Leave `false`
     * (the default, single combined pass) unless the outline is thick enough to
     * overlap. No effect when there is no outline.
     */
    outlineLayered: boolean;

    // Drop shadow — plain fields, so they can be assigned or tweened directly.
    // `setShadow` is a chainable convenience wrapper.
    /** Horizontal offset of the shadow, in pixels. */
    shadowX: number;
    /** Vertical offset of the shadow, in pixels. */
    shadowY: number;
    /** Shadow color, packed `0xRRGGBB`. */
    shadowColor: number;
    /**
     * Colour at the shadow's inner edge, packed `0xRRGGBB`, or `-1` (the default)
     * to inherit `shadowColor` and draw a single-colour shadow.
     *
     * A real colour makes the blur ramp from `shadowColor` at its outer edge to
     * this where it meets the glyph — a white-hot core inside a coloured halo.
     * Needs no layering (a shadow quad never has a fill), but it needs
     * `shadowSoftness` above `0` to have a band to ramp across.
     * {@link setShadowInnerColor} is the colour-parsing wrapper.
     */
    shadowInnerColor: number;
    /** Shadow alpha, 0-1. */
    shadowAlpha: number;
    /**
     * Shadow blur in distance-field units — scales with the text, like
     * `outlineWidth` (MTSDF atlas only). `0` is a hard edge.
     */
    shadowSoftness: number;
    /**
     * Dilate the shadow's silhouette *before* blurring it, in distance-field
     * units — Photoshop's *spread* next to its *size*. `0` (the default) traces
     * the glyph exactly.
     *
     * This is the knob that fattens a shadow without mushing it (softness alone
     * can only buy size at the cost of focus), and the only route to a fat *hard*
     * shadow — spread + `shadowRounded` + no softness is the chunky "sticker"
     * shadow behind cartoon lettering. It dilates the same field a thick outline
     * does, so unlike softness it works on plain MSDF atlases.
     *
     * Bounded like `outlineWidth`, at half the atlas `distanceRange` — and, like
     * a thick outline, a *hard* spread past roughly `0.3 × distanceRange` starts
     * to fade at its outer band, where the shader's background-haze guard reads
     * the raw field. Any nonzero `shadowSoftness` lifts that guard entirely.
     */
    shadowSpread: number;
    /**
     * How far to round the shadow's silhouette off the true SDF, from `0` (sharp
     * — the corner-preserving `median(rgb)` the fill uses) to `1` (fully
     * rounded). MTSDF atlas only; continuous and tweenable, like
     * {@link outlineRounded}, and a boolean is accepted for its two ends.
     *
     * Defaults to `1`, fully on — unlike {@link outlineRounded} — because it is a
     * **no-op until the shadow's edge leaves the glyph contour**, which needs a
     * {@link shadowSpread} or a {@link shadowSoftness}; and where it does bite, a
     * sharp dilation of `median(rgb)` grows a mitre spike at every corner of every
     * letter. Drop it towards `0` to file those spikes back in.
     */
    get shadowRounded(): number;
    set shadowRounded(value: number | boolean);

    /**
     * Slide every dashed rule on this text along its own length, in **dash
     * periods**: `1` advances the pattern by exactly one dash and a gap, so it is
     * seamlessly periodic and a plain `dashPhase += delta` marches for ever
     * without accumulating error. Positive moves the dashes forward (to the
     * right). Default `0`.
     *
     * This is the marching-ants knob. It is resolved at *submit* time — it slides
     * the rects' UV origin and nothing else — so tweening it costs no rebuild, no
     * re-seed and no re-layout, and it is a plain field, so `scene.tweens.add({
     * targets: text, dashPhase: 1, duration: 600, repeat: -1 })` is the whole
     * effect. Dashes cut by a rect's ends simply travel through them.
     *
     * No effect unless a rule carries a {@link DashSpec}.
     */
    dashPhase: number;

    /**
     * Render per-glyph shadows even when the object has no shadow of its own.
     *
     * The shadow pass is normally skipped unless {@link hasShadow} is true. In
     * per-glyph modes (a `displayCallback` or `editGlyphs`) you can set a shadow
     * on individual {@link GlyphState}s; set this `true` so those shadows draw.
     * Rich-text styles that set a shadow (via `setRichText`/`addStyle`) enable
     * the pass automatically, so this flag is only needed for callback/
     * manual-driven shadows. Default `false`.
     */
    perGlyphShadow: boolean;

    /**
     * Optional per-frame display callback. Receives the per-glyph state array
     * and the text object; mutate glyphs in place. Set via {@link setDisplayCallback}.
     */
    displayCallback?: DisplayCallback;

    /**
     * The per-glyph state array, or `null` in static mode (no callback and
     * `editGlyphs` never called). In callback mode it holds last frame's seeded
     * values; in manual mode it is the array you own. Read-only — use
     * {@link editGlyphs} to take manual control.
     */
    readonly glyphs: GlyphState[] | null;

    /**
     * Optional per-frame decoration callback. Receives every underline,
     * strikethrough and highlight pill the text laid out, as {@link DecorationState}
     * objects. Set via {@link setDecorationCallback}.
     */
    decorationCallback?: DecorationCallback;

    /**
     * The per-rect state array, or `null` when no decoration callback is set. Holds
     * last frame's seeded values. Read-only.
     */
    readonly decorations: DecorationState[] | null;

    /**
     * Optional per-character spacing callback. Unlike the other two it runs at
     * rebuild time, not per frame. Set via {@link setSpacingCallback}.
     */
    spacingCallback?: SpacingCallback;

    // Dimensions (derived from text bounds)
    readonly width: number;
    readonly height: number;
    displayWidth: number;
    displayHeight: number;

    // Property accessors (with side effects — trigger rebuild on change)
    text: string | string[];
    fontSize: number;
    /** Line alignment: `'left'` (default), `'center'` or `'right'`. */
    align: MSDFAlign;
    lineSpacing: number;
    letterSpacing: number;
    maxWidth: number;
    /**
     * Text color as a packed `0xRRGGBB` number. The getter recovers it from the
     * stored color; the setter routes through `setColor`, preserving the current
     * color alpha. To change the alpha too, use `setColor(color, alpha)`.
     */
    color: number;

    // Chainable setters
    setText(text: string | string[]): this;
    setFont(font: string, size?: number, align?: MSDFAlign): this;
    setFontSize(size: number): this;
    /** Set the faux-bold {@link weight} in distance-field units (chainable). */
    setWeight(weight: number): this;
    setColor(color: ColorValue, alpha?: number): this;
    setLeftAlign(): this;
    setCenterAlign(): this;
    setRightAlign(): this;
    setLineSpacing(spacing: number): this;
    setLetterSpacing(spacing: number): this;
    setMaxWidth(width: number): this;
    setDisplaySize(width: number, height: number): this;
    /**
     * Resize the text to fit inside a box, **reflowing** rather than scaling:
     * binary-search the largest `fontSize` whose *word-wrapped* layout fits
     * `rect.width`×`rect.height`. Shrink-only by default (`maxFontSize` defaults
     * to the current `fontSize`; raise it to allow growth).
     *
     * Permanently sets `fontSize` **and** `maxWidth` (to `rect.width`) — the
     * wrap width is what keeps the text fitted. One-shot: if the text later
     * changes it re-wraps at that width but does not re-fit the size; call
     * `fitInside` again. The chosen size is fractional by design (MSDF is crisp
     * at any scale); `Math.floor` it yourself if you need an integer.
     *
     * With `rect.x`/`rect.y` (both required) the block is also positioned inside
     * the box via `hAlign`/`vAlign`; with neither it is only resized. Ignores
     * outline width, shadow offset and rotation (all fall outside `width`/
     * `height`); `lineSpacing`/`letterSpacing`/shadow offsets are constant px and
     * do not scale with the fitted size.
     */
    fitInside(rect: RectLike, options?: FitOptions): this;
    /**
     * Set styled text from structured segments (**content** styling). Segment
     * text is concatenated into the plain `text` (so `this.text` still returns
     * the joined string and wrap/layout are unchanged); each styled segment's
     * appearance overrides are recorded as a run. The styles travel *with the
     * content* — they are replaced together on the next `setText`/`setRichText`.
     *
     * The update path is simply calling `setRichText` again: if the concatenated
     * text is unchanged, relayout is skipped and only the styles re-seed. Note
     * that either way it replaces the content, so **every position-anchored
     * overlay drops**. To update one piece repeatedly without that, give the
     * segment an {@link SegmentSpec.id} and drive it through
     * `addStyle({ segment: id }, …)` instead. Chainable.
     */
    setRichText(segments: Segment[]): this;
    /**
     * Add a style **overlay** on top of the current content: `target` says which
     * spans it covers, `style` says how they look. Returns a {@link StyleHandle}
     * to update or remove it. Overlays paint over `setRichText` segments, in the
     * order they were added — the style added last wins where two overlap.
     *
     * ```ts
     * text.addStyle('DMG', { color: 0xff3333 });                     // every "DMG"
     * text.addStyle(/\d+/, { weight: 2, fontScale: 1.2 });           // every number
     * text.addStyle({ match: 'the', nth: 0, wholeWord: true }, { color: 0x88ccff });
     * text.addStyle({ segment: 'dmg' }, { color: 0xffaa00 });        // a named segment
     * text.addStyle({ start: 5, length: 3 }, { color: 0xffff00 });   // fixed indices
     * ```
     *
     * The {@link StyleTarget} kind decides the lifetime: content anchors (string,
     * `RegExp`, {@link SegmentTarget}, matcher function) are re-derived on every
     * text change and survive it; a `{ start, length }` anchor dies with the text
     * it indexed.
     *
     * `style` is a full {@link StyleSpec} — appearance, decoration *and* the
     * structural `fontScale`/`font` ("every `H1` is 1.5× in the display face").
     * A structural key costs a relayout rather than a re-seed, here and on
     * `handle.update`.
     */
    addStyle(target: StyleTarget, style: StyleSpec): StyleHandle;
    /**
     * Remove every overlay added with {@link addStyle} (their handles die).
     * Content segments are not overlays, so they are left intact — replace them
     * with `setText`/`setRichText`. Chainable.
     */
    clearStyles(): this;
    setDisplayCallback(callback: DisplayCallback | undefined): this;
    clearDisplayCallback(): this;
    /**
     * Set the per-frame decoration callback — the lane that can see and animate
     * underlines, strikethroughs and highlight pills, which `displayCallback`
     * cannot (they are rects, not glyphs, and live outside the glyph array).
     *
     * A separate callback rather than an extra argument to `displayCallback`, on
     * purpose: decorations exist in every glyph mode, so folding the two together
     * would force a full per-frame re-seed of every glyph state on a text that only
     * wanted to animate three rects.
     *
     * The array is transient — re-seeded from the built rects every frame, so your
     * edits do not persist and there is no manual mode to take. That is not a
     * limitation so much as the shape of the thing: a rect is a *merge* of adjacent
     * characters, so it has no identity that survives a re-wrap for edits to be
     * re-applied to. Drive the effect from a clock or a tween instead.
     *
     * Passing `undefined` clears it (same as {@link clearDecorationCallback}).
     */
    setDecorationCallback(callback: DecorationCallback | undefined): this;
    /** Clear the decoration callback; rects return to their built appearance. */
    clearDecorationCallback(): this;
    /**
     * Set the per-character spacing callback — the lane that writes
     * {@link StyleSpec.space} pads per source character instead of per run.
     *
     * A one-off nudge does not need this: a span anchor of length 1 *is* a
     * character (`addStyle({ start: 12, length: 1 }, { space: { before: 0.1 } })`).
     * What this buys is the bulk case — many characters, many *different* values —
     * which through the spec layers would mean one overlay per value.
     *
     * It is the last layer of the pad maps, so it sees (and may overwrite) what the
     * segments and overlays painted. It runs at **rebuild** time, not per frame:
     * setting it costs a relayout, and so does {@link refreshSpacing}. Passing
     * `undefined` clears it (same as {@link clearSpacingCallback}).
     */
    setSpacingCallback(callback: SpacingCallback | undefined): this;
    /** Clear the spacing callback; the pads fall back to the `space` keys alone. */
    clearSpacingCallback(): this;
    /**
     * Re-run the spacing callback (a relayout). It re-runs on every rebuild
     * anyway, so this is only for when the callback's *own* inputs changed —
     * a tracking slider, a difficulty setting — and the text did not.
     */
    refreshSpacing(): this;
    /**
     * Take manual control of per-glyph state. Returns the (persistent) glyph
     * array, seeded to the text's current colour/alpha/layout, and switches the
     * text into manual mode: edits persist across frames and are *not* re-seeded
     * automatically. Clears any display callback. The array is rebuilt and
     * re-seeded whenever the glyph set changes (`setText`, `setFont`, re-wrap),
     * which emits a `'glyphsreset'` event so you can re-apply your edits.
     */
    editGlyphs(): GlyphState[];
    /** Re-seed the manual glyph array to the text's current defaults. No-op unless in manual mode. */
    resetGlyphs(): this;
    setOutline(width: number, color?: ColorValue, alpha?: number, rounded?: number | boolean, layered?: boolean, softness?: number): this;
    /** Ramp the outline to a second colour at its inner edge. See {@link outlineInnerColor}. */
    setOutlineInnerColor(color: ColorValue | null): this;
    clearOutline(): this;
    hasOutline(): boolean;
    setShadow(x?: number, y?: number, color?: ColorValue, alpha?: number, softness?: number, spread?: number): this;
    /** Ramp the shadow to a second colour at its inner edge. See {@link shadowInnerColor}. */
    setShadowInnerColor(color: ColorValue | null): this;
    clearShadow(): this;
    hasShadow(): boolean;
    /**
     * Underline the whole text (chainable). `true` inherits the fill colour and
     * the font's own underline metrics; pass a {@link DecorationSpec} to override
     * colour, alpha, thickness or position; `false` removes it.
     *
     * Style layers override this per run, so `setUnderline(true)` followed by a
     * rule carrying `underline: false` leaves that keyword un-underlined. The
     * rects batch with the glyphs — a decorated text is still one draw call.
     */
    setUnderline(enable: boolean | DecorationSpec): this;
    /**
     * Strike the whole text through (chainable). Same contract as
     * {@link setUnderline}, drawn *over* the glyphs rather than under them.
     *
     * msdf-atlas-gen emits no strike metric, so the default sits at `-0.25 em`
     * above the baseline (about mid-x-height for typical fonts) with the
     * underline's thickness. Use `offset` where that lands wrong.
     */
    setStrikethrough(enable: boolean | DecorationSpec): this;
    /**
     * Paint a highlight pill behind the whole text (chainable). `true` draws the
     * plain marker default; pass a {@link HighlightSpec} for colour, corner
     * radius, softness, border and padding; `false` removes it.
     *
     * Style layers override this per run, so `addStyle('CRIT', { highlight:
     * {...} })` pills one keyword. Pills batch with the glyphs and draw behind
     * everything else — a highlighted, shadowed, underlined text is still one
     * draw call.
     */
    setHighlight(enable: boolean | HighlightSpec): this;
    getTextBounds(): {
        width: number;
        height: number;
        lines: {
            count: number;
            lengths: number[];
            shortest: number;
            longest: number;
        };
    };
    /**
     * Per-line layout metrics, in the same text space as {@link GlyphState.x} /
     * {@link GlyphState.y} — cached by the last rebuild, not recomputed on read.
     *
     * This is the domain a per-glyph effect written as a *field over text space*
     * needs: normalize a glyph's `x` against its line's `x`/`width`, or its `y`
     * against the block's height, and neighbouring glyphs land on the same curve.
     * Reading it from a display callback is free; {@link getTextBounds} allocates
     * and is a snapshot, so prefer this in a per-frame loop.
     */
    readonly lines: ReadonlyArray<LineInfo>;
}

/**
 * Static `MSDFText` constructor surface (alignment constants).
 */
export interface MSDFTextStatic {
    new (
        scene: Phaser.Scene,
        x: number,
        y: number,
        font: string,
        text?: string | string[],
        fontSize?: number,
        align?: MSDFAlign
    ): MSDFTextInstance;
}
