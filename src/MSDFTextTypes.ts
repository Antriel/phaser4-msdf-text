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
 * A per-run appearance override for the rich-text API. Every field is optional;
 * only the keys present override the glyph's seeded base (which inherits the
 * text object's colour/alpha/outline/shadow). `color`/`alpha` accept a scalar
 * (all four corners the same) or a {@link PerCorner} (a gradient across the
 * glyph quad). This is an *appearance* spec: it seeds `GlyphState`, never
 * changes layout, composes with `displayCallback`, and is animatable. Structural
 * keys (per-run size) live on {@link RuleStyleSpec}, which segments and rules
 * use; a per-run `font` is still unimplemented.
 */
export interface StyleSpec {
    /** Fill colour — a scalar or a per-corner gradient. */
    color?: ColorValue | PerCorner<ColorValue>;
    /** Fill alpha (0-1) — a scalar or a per-corner gradient. */
    alpha?: number | PerCorner<number>;
    /** Outline colour/alpha override (outline width/rounded stay object-level). */
    outline?: { color?: ColorValue; alpha?: number };
    /** Shadow colour/alpha/offset override (softness stays object-level). */
    shadow?: { color?: ColorValue; alpha?: number; x?: number; y?: number };
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

    // Outline — plain fields (no layout side effects), so they can be assigned
    // or tweened directly. `setOutline` is a chainable convenience wrapper.
    /** Outline width in distance-field units. `0` disables the outline. */
    outlineWidth: number;
    /** Outline color, packed `0xRRGGBB`. */
    outlineColor: number;
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
     * for callback/manual-driven shadows. Note that per-glyph shadows are always
     * hard-edged — `shadowSoftness` is an object-level uniform. Default `false`.
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
     * `fontScale` ("every `H1` is 1.5×") — its matches are re-cached before the
     * layout pass. The cost is that such a rule makes `setText` (and
     * `handle.update`) a relayout rather than a re-seed.
     */
    setTextStyle(match: string, style: RuleStyleSpec, opts?: TextStyleOpts): StyleHandle<RuleStyleSpec>;
    /**
     * Style a **transient range** of the current text by index (override
     * styling). Anchored to `this.text`, which the caller owns; **any** text
     * change drops all ranges and kills their handles (no clamping). Returns a
     * {@link StyleHandle}. Use for highlights over text known to be stable.
     *
     * Appearance-only: this layer is applied *after* layout, so it takes a
     * {@link StyleSpec} and never the structural `fontScale`.
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
    clearOutline(): this;
    hasOutline(): boolean;
    setShadow(x?: number, y?: number, color?: ColorValue, alpha?: number, softness?: number): this;
    clearShadow(): this;
    hasShadow(): boolean;
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
