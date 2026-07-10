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
 * An underline or strikethrough. Passing `true` instead of this object inherits
 * everything; passing `false` switches the decoration off for the run.
 *
 * Decorations follow the **layout**, not the glyphs: per-glyph `scale`,
 * `rotation` and `skew` move a glyph without moving the rule under it. They also
 * cast no shadow and take no outline, and `displayCallback` cannot see or
 * animate them — they are resolved from the style layers only.
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
 * A per-run appearance override for the rich-text API. Every field is optional;
 * only the keys present override the glyph's seeded base (which inherits the
 * text object's colour/alpha/weight/outline/shadow). Colours, alphas and the
 * continuous effect channels (`weight`, `outline.width`, `shadow.softness`)
 * accept a scalar (all four corners the same) or a {@link PerCorner} (a gradient
 * across the glyph quad).
 *
 * This is an *appearance* spec: it never changes layout, composes with
 * `displayCallback`, and is animatable. Structural keys (`fontScale`, `font`)
 * live on {@link RuleStyleSpec}, which segments and rules use, because only a
 * layer resolved before the layout pass may carry them. Everything here seeds
 * `GlyphState` except `underline`, `strikethrough` and `highlight`, which resolve
 * per source character into merged rects.
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
    /** Outline override. `width` of `0` disables this run's outline. */
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
        /** Round the outer corners using the true SDF (MTSDF atlas only). */
        rounded?: boolean;
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
    /** Underline this run. `true` inherits everything; see {@link DecorationSpec}. */
    underline?: boolean | DecorationSpec;
    /** Strike this run through. `true` inherits everything; see {@link DecorationSpec}. */
    strikethrough?: boolean | DecorationSpec;
    /** Paint a pill behind this run. `true` is plain marker yellow; see {@link HighlightSpec}. */
    highlight?: boolean | HighlightSpec;
}

/**
 * A style that may also carry **structural** keys — ones that change layout and
 * therefore take effect on a rebuild rather than a per-glyph re-seed.
 *
 * Structural keys are only legal on style layers resolved *before* the layout
 * pass: content segments ({@link SegmentSpec}) and persistent rules
 * ({@link MSDFTextInstance.setTextStyle}, whose matches are re-cached on every
 * text change). They must never appear on {@link StyleSpec}, which is the
 * override layer applied *after* layout — a transient range or a
 * `displayCallback` that reflowed the text would silently break the "cheap
 * re-seed, never relayout" contract those paths promise.
 */
export interface RuleStyleSpec extends StyleSpec {
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
}

/** A styled run of text for {@link MSDFTextInstance.setRichText}. */
export interface SegmentSpec extends RuleStyleSpec {
    /** The run's text. Concatenated (in order) into the object's plain text. */
    text: string;
}

/** One rich-text segment: a bare string (unstyled) or a styled {@link SegmentSpec}. */
export type Segment = string | SegmentSpec;

/** Options for {@link MSDFTextInstance.setTextStyle}. */
export interface TextStyleOpts {
    /** Style every occurrence. Default `true`. Ignored when `nth` is given. */
    all?: boolean;
    /** Style only the nth occurrence (0-based). Overrides `all`. */
    nth?: number;
    /** Require whole-word matches (word-char boundaries). Default `false`. */
    wholeWord?: boolean;
    /** Case-sensitive matching. Default `true`. */
    caseSensitive?: boolean;
}

/**
 * A live handle to a persistent rule ({@link MSDFTextInstance.setTextStyle}) or
 * a transient range ({@link MSDFTextInstance.addStyleRange}). Changes coalesce
 * into a single re-seed before the next render. A range handle dies on any text
 * change — its methods then no-op with a one-time dev warning.
 *
 * A rule handle is a `StyleHandle<RuleStyleSpec>`: it accepts structural keys,
 * and an update that changes one costs a relayout rather than a re-seed.
 */
export interface StyleHandle<S extends StyleSpec = StyleSpec> {
    /** Replace the style. */
    update(style: S): void;
    /** Drop the rule/range. */
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
 * Display callback signature.
 *
 * Called once per frame (not once per glyph) with the full array of per-glyph
 * {@link GlyphState} objects — already seeded with the text's effective colour,
 * alpha and layout — and the parent text object. Mutate the glyphs in place;
 * the return value is ignored. The same array instance is reused every frame.
 */
export type DisplayCallback = (glyphs: GlyphState[], parent: MSDFTextInstance) => void;

// Re-export so consumers can type their callbacks against the glyph state.
export type { GlyphState } from './MSDFGlyphState';

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
    /** Outline width in distance-field units. `0` disables the outline. */
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
    /** Round the outline's outer corners using the true SDF (MTSDF atlas only). */
    outlineRounded: boolean;
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
     * Render per-glyph shadows even when the object has no shadow of its own.
     *
     * The shadow pass is normally skipped unless {@link hasShadow} is true. In
     * per-glyph modes (a `displayCallback` or `editGlyphs`) you can set a shadow
     * on individual {@link GlyphState}s; set this `true` so those shadows draw.
     * Rich-text styles that set a shadow (via `setRichText`/`setTextStyle`/
     * `addStyleRange`) enable the pass automatically, so this flag is only needed
     * for callback/manual-driven shadows. Default `false`.
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
     * text is unchanged, relayout is skipped and only the styles re-seed.
     * Chainable.
     */
    setRichText(segments: Segment[]): this;
    /**
     * Add a persistent keyword **rule** (policy styling): every match of `match`
     * in the current text is styled. Survives `setText`/`setRichText` and is
     * re-matched against the new text each time. Returns a {@link StyleHandle}
     * to update/remove the rule. Substring match by default; see
     * {@link TextStyleOpts} for `wholeWord`/`nth`/`caseSensitive`/`all`.
     *
     * Rules take a {@link RuleStyleSpec}, so they may carry the structural
     * `fontScale` and `font` ("every `H1` is 1.5× in the display face") — their
     * matches are re-cached before the layout pass. The cost is that such a rule
     * makes `setText` (and `handle.update`) a relayout rather than a re-seed.
     */
    setTextStyle(match: string, style: RuleStyleSpec, opts?: TextStyleOpts): StyleHandle<RuleStyleSpec>;
    /**
     * Style a **transient range** of the current text by index (override
     * styling). Anchored to `this.text`, which the caller owns; **any** text
     * change drops all ranges and kills their handles (no clamping). Returns a
     * {@link StyleHandle}. Use for highlights over text known to be stable.
     *
     * Appearance-only: this layer is applied *after* layout, so it takes a
     * {@link StyleSpec} and never the structural `fontScale` / `font`.
     */
    addStyleRange(start: number, length: number, style: StyleSpec): StyleHandle;
    /**
     * Remove all rules **and** ranges (their handles die). Content segments are
     * not policy, so they are left intact — replace them with `setText`/
     * `setRichText`. Chainable.
     */
    clearStyles(): this;
    setDisplayCallback(callback: DisplayCallback | undefined): this;
    clearDisplayCallback(): this;
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
    setOutline(width: number, color?: ColorValue, alpha?: number, rounded?: boolean, layered?: boolean): this;
    /** Ramp the outline to a second colour at its inner edge. See {@link outlineInnerColor}. */
    setOutlineInnerColor(color: ColorValue | null): this;
    clearOutline(): this;
    hasOutline(): boolean;
    setShadow(x?: number, y?: number, color?: ColorValue, alpha?: number, softness?: number): this;
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
     * Style layers override this per run, so `setTextStyle('CRIT', { highlight:
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
