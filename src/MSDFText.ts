/**
 * MSDFText GameObject
 *
 * Renders text using MSDF (Multi-channel Signed Distance Field) fonts.
 * Characters are submitted to a custom BatchHandler so a full text object
 * typically renders in 1-2 draw calls.
 *
 * Uses Phaser's idiomatic Class system with component mixins for proper
 * integration with Phaser's GameObject ecosystem. The public surface is
 * BitmapText-flavoured but not a drop-in replacement — colour is a single base
 * `color` (no per-object Tint component), alignment is a string, and per-glyph
 * effects go through the `GlyphState` array rather than character callbacks.
 *
 * Usage:
 *   const text = scene.add.msdfText(x, y, 'arial', 'Hello World', fontSize);
 *   // or
 *   const text = scene.make.msdfText({ font: 'arial', text: 'Hello', fontSize: 42, x: 100, y: 100 });
 */

import * as Phaser from "phaser";
import { MSDFFont } from './MSDFFont';
import MSDFTextWebGLRenderer from './MSDFTextWebGLRenderer';
import { createGlyphState, type GlyphState } from './MSDFGlyphState';
import { wrapLines } from './MSDFTextWrap';
import {
    toColorInt,
    resolveStyle,
    matchRuns,
    hasStyleKeys,
    styleHasShadowKeys,
    applyStyleToGlyph,
    type ResolvedStyle,
    type StyleRun,
    type StyleRule
} from './MSDFTextStyle';
import type {
    ColorValue,
    MSDFAlign,
    RectLike,
    FitOptions,
    Segment,
    StyleSpec,
    TextStyleOpts,
    StyleHandle,
    DisplayCallback,
    MSDFTextStatic
} from './MSDFTextTypes';

// Re-export the public types so `'./MSDFText'` stays the canonical import path
// for consumers (index.ts, the factory/creator, the Phaser augmentations).
export type {
    ColorValue,
    MSDFAlign,
    PerCorner,
    StyleSpec,
    SegmentSpec,
    Segment,
    TextStyleOpts,
    StyleHandle,
    RectLike,
    FitOptions,
    DisplayCallback,
    MSDFTextInstance,
    MSDFTextStatic
} from './MSDFTextTypes';
export type { GlyphState } from './MSDFGlyphState';

// Per-glyph state mode. Static = no per-glyph array (object colour used as-is);
// callback = array re-seeded + handed to `displayCallback` each frame; manual =
// user owns the array via `editGlyphs()` and it persists until the text rebuilds.
const GLYPH_MODE_STATIC = 0;
const GLYPH_MODE_CALLBACK = 1;
const GLYPH_MODE_MANUAL = 2;

// Phaser's published types describe these as interfaces/values that don't
// match the runtime shape we need, so reach through `any`.
const Class: any = (Phaser as any).Class;
const Components: any = (Phaser as any).GameObjects.Components;
const GameObject: any = (Phaser as any).GameObjects.GameObject;
const PhaserMap: any = (Phaser as any).Structs.Map;

/**
 * Warn (once per effect, per text object) when an MTSDF-only effect is used on
 * a non-MTSDF atlas. Returns whether the loaded font actually supports it.
 */
function warnNeedsMtsdf(text: any, effectName: string): boolean {
    const fieldType = text.fontData ? text.fontData.distanceField.fieldType : undefined;
    if (fieldType === 'mtsdf') {
        return true;
    }
    if (!text._mtsdfWarnings) {
        text._mtsdfWarnings = {};
    }
    if (!text._mtsdfWarnings[effectName]) {
        text._mtsdfWarnings[effectName] = true;
        console.warn(
            `[MSDFText] "${effectName}" needs an MTSDF font atlas. The font ` +
            `"${text.font}" is "${fieldType}", so the effect falls back to the ` +
            `standard look. Regenerate the atlas with msdf-atlas-gen "-type mtsdf".`
        );
    }
    return false;
}

/**
 * Default render nodes map for MSDF text
 * Must be a Phaser.Structs.Map, not a plain object
 */
const DefaultMSDFNodes = new PhaserMap([
    ['Submitter', 'SubmitterQuad'],
    ['BatchHandler', 'BatchHandlerMSDF']
]);

/**
 * Render function for MSDF text (mixin)
 */
const MSDFTextRender = {
    renderWebGL: function (renderer: any, src: any, drawingContext: any, parentMatrix: any): void {
        // Rebuild if needed — rebuildText clears _dirty (and _stylesDirty, since
        // it re-seeds). Otherwise apply any pending style change lazily: one
        // coalesced re-seed regardless of how many handles changed this tick.
        if (src._dirty) {
            src.rebuildText();
        } else if (src._stylesDirty) {
            src.applyStylesDirty();
        }

        // Delegate to MSDFTextWebGLRenderer
        MSDFTextWebGLRenderer(renderer, src, drawingContext, parentMatrix);
    }
};

/**
 * MSDFText GameObject with batched rendering using Phaser's Class system
 */
export const MSDFText: MSDFTextStatic = new Class({

    Extends: GameObject,

    Mixins: [
        Components.Alpha,
        Components.BlendMode,
        Components.Depth,
        Components.GetBounds,
        Components.Origin,
        Components.RenderNodes,
        Components.ScrollFactor,
        Components.Texture,
        Components.Transform,
        Components.Visible,
        MSDFTextRender
    ],

    initialize:

    function MSDFText(
        scene: Phaser.Scene,
        x: number,
        y: number,
        font: string,
        text: string = '',
        fontSize: number = 42,
        align: MSDFAlign = 'left'
    ) {
        GameObject.call(this, scene, 'MSDFText');

        // Font and text properties
        this.font = font;

        const msdfCache = scene.sys.cache.custom.msdfFont;
        const fontData: MSDFFont | undefined = msdfCache ? msdfCache.get(font) : undefined;

        if (!fontData) {
            console.warn('Invalid MSDFText font key: ' + font);
        }

        this.fontData = fontData as MSDFFont;

        // ── Backing fields ──────────────────────────────────────────────
        // These have setters that flip `_dirty` (or normalize the value), so
        // a private backing field is required. They are not part of the
        // public `MSDFTextInstance` type.
        this._text = text;
        this._fontSize = fontSize;
        this._color = { r: 1, g: 1, b: 1, a: 1 };
        this._align = align;
        this._lineSpacing = 0;
        this._letterSpacing = 0;
        this._maxWidth = 0; // 0 = no word wrapping

        // ── Plain public fields ─────────────────────────────────────────
        this.wordWrapCharCode = 32; // space character

        // Outline — no layout side effects, so assign/tween directly.
        this.outlineWidth = 0;
        this.outlineColor = 0x000000;
        this.outlineAlpha = 1;
        this.outlineRounded = false;
        this.outlineLayered = false;

        // Drop shadow — plain fields, assign/tween directly.
        this.shadowX = 0;
        this.shadowY = 0;
        this.shadowColor = 0x000000;
        this.shadowAlpha = 0.5;
        this.shadowSoftness = 0;

        // Force the shadow pass in per-glyph modes (callback / manual) even when
        // the object has no shadow, so shadows set on individual glyphs render.
        // Rich-text styles that set a shadow turn this on automatically.
        this.perGlyphShadow = false;

        // ── Internal state ──────────────────────────────────────────────
        this._characters = [];
        this._width = 0;
        this._height = 0;
        this._dirty = true;
        this._mtsdfWarnings = {};

        // Per-glyph display state. Static by default — no array is built until a
        // display callback is set or `editGlyphs()` is called.
        this.displayCallback = undefined;
        this._glyphMode = GLYPH_MODE_STATIC;
        this._glyphStates = [];

        // ── Rich-text styling ───────────────────────────────────────────────
        // Three layers, painted segments → rules → ranges (then displayCallback).
        this._segmentRuns = [];   // content — rebuilt with the text (setRichText)
        this._styleRules = [];    // policy — runs re-cached on each text change
        this._rangeRuns = [];     // override — dropped on any text change
        this._hasStyles = false;  // any layer non-empty ⇒ force the per-glyph array
        this._stylesHaveShadow = false; // any run sets a shadow ⇒ run the shadow pass
        this._stylesDirty = false;// a handle/segment changed ⇒ coalesced re-seed
        this._rangeGen = 0;       // bumped on text change to invalidate range handles
        this._deadHandleWarned = false;

        // Bind atlas texture via the standard Texture component (no width/height
        // or origin updates — those derive from text bounds, not the atlas frame).
        if (fontData) {
            this.setTexture(fontData.textureKey, undefined, false, false);
        }

        // Set initial position using Transform component
        this.setPosition(x, y);

        // Match BitmapText: position from top-left of the rendered text.
        // Assign directly (not via setOrigin) to avoid an early width-getter
        // call that would trigger a rebuild before we're done setting up.
        this.originX = 0;
        this.originY = 0;

        // Initialize render nodes using RenderNodes component
        this.initRenderNodes(this._defaultRenderNodesMap);

        // Initial build — also computes bounds, clears _dirty, and calls updateDisplayOrigin.
        this.rebuildText();
    },

    /**
     * The default render nodes for this Game Object.
     */
    _defaultRenderNodesMap: {
        get: function () {
            return DefaultMSDFNodes;
        }
    },

    // ========================================================================
    // Text Properties
    // ========================================================================

    /**
     * The text content. Assigning routes through `setText`, so arrays are
     * joined with newlines and falsy values become empty strings.
     */
    text: {
        get: function (this: any): string { return this._text; },
        set: function (this: any, value: string | string[]) {
            this.setText(value);
        }
    },

    /**
     * Set the text content (chainable).
     *
     * Arrays are joined with `'\n'`. Falsy values (other than 0) become the
     * empty string. Width/height/displayOrigin are refreshed immediately so
     * code that reads them right after `setText` sees current values.
     */
    setText: function (value: string | string[]) {
        // Permissive falsy handling matches BitmapText: 0 stays as "0", but
        // null/undefined/'' become ''.
        if (!value && (value as unknown) !== 0) {
            value = '';
        }

        if (Array.isArray(value)) {
            value = value.join('\n');
        }

        const str = String(value);
        if (str !== this._text) {
            this._text = str;
            this._dirty = true;
            // Plain setText replaces the content: segment styles go with it,
            // ranges drop, rules re-match against the new text.
            if (this._hasStyles) {
                this._segmentRuns.length = 0;
                this.onTextChanged(str);
            }
            // Force a rebuild now so width/height/displayOrigin are correct
            // for any code that reads them between setText and the next render.
            this.updateDisplayOrigin();
        }
        return this;
    },

    /**
     * Shared text-change bookkeeping for the style layers: drop transient ranges
     * (killing their handles via `_rangeGen`), re-cache every rule's matches
     * against the new text, then recompute `_hasStyles` and flag a re-seed.
     * Segments are handled by the caller (they are content, not policy).
     */
    onTextChanged: function (text: string): void {
        if (this._rangeRuns.length > 0) {
            this._rangeRuns.length = 0;
            this._rangeGen++;
        }
        for (let i = 0; i < this._styleRules.length; i++) {
            const rule = this._styleRules[i];
            rule.runs = matchRuns(text, rule.match, rule.opts);
        }
        this.recomputeHasStyles();
        this._stylesDirty = true;
    },

    /** `_hasStyles` = any of the three style layers is non-empty. */
    recomputeHasStyles: function (): void {
        this._hasStyles = this._segmentRuns.length > 0 ||
            this._styleRules.length > 0 ||
            this._rangeRuns.length > 0;
        // `_stylesHaveShadow` is recomputed in `applyStyleRuns` (which only runs
        // while styled); clear it here so it can't linger true after all styles go.
        if (!this._hasStyles) this._stylesHaveShadow = false;
    },

    /**
     * The font size. Setting this triggers a rebuild on next render.
     */
    fontSize: {
        get: function (this: any): number { return this._fontSize; },
        set: function (this: any, value: number) {
            if (this._fontSize !== value) {
                this._fontSize = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set font size (chainable)
     */
    setFontSize: function (size: number) {
        this.fontSize = size;
        return this;
    },

    /**
     * Swap the font used by this text. Existing text, size, and alignment are
     * preserved unless overridden via the arguments.
     *
     * @param font  Key of the font in the `msdfFont` cache.
     * @param size  Optional font size in pixels. Defaults to the current size.
     * @param align Optional alignment (0/1/2). Defaults to the current alignment.
     */
    setFont: function (font: string, size?: number, align?: number) {
        const msdfCache = this.scene.sys.cache.custom.msdfFont;
        const fontData: MSDFFont | undefined = msdfCache ? msdfCache.get(font) : undefined;

        if (!fontData) {
            console.warn('Invalid MSDFText font key: ' + font);
            return this;
        }

        this.font = font;
        this.fontData = fontData;
        if (size !== undefined) this._fontSize = size;
        if (align !== undefined) this._align = align;

        this.setTexture(fontData.textureKey, undefined, false, false);
        this._dirty = true;
        this.updateDisplayOrigin();
        return this;
    },

    /**
     * Set the display size of this text (in pixels) by adjusting its scale.
     */
    setDisplaySize: function (width: number, height: number) {
        this.displayWidth = width;
        this.displayHeight = height;
        return this;
    },

    /**
     * Resize (and optionally place) the text to fit inside a box by reflowing.
     * See {@link MSDFTextInstance.fitInside} for the full contract.
     */
    fitInside: function (rect: RectLike, options: FitOptions = {}) {
        const boxW = rect.width;
        const boxH = rect.height;
        // Both dimensions must be positive; otherwise there is nothing to fit.
        if (!(boxW > 0) || !(boxH > 0)) {
            return this;
        }

        const maxFontSize = options.maxFontSize ?? this._fontSize;
        const minFontSize = options.minFontSize ?? 1;
        const precision = options.precision ?? 0.25;

        // The predicate is monotone in size: bigger font ⇒ taller lines and never
        // fewer of them (words only wrap more), so height is non-decreasing.
        const fits = (size: number): boolean => {
            const wrapped = this.computeWrap(this._text, boxW, size).text;
            const m = this.fontData.measureLines(
                wrapped, size, this._lineSpacing, this._letterSpacing
            );
            return m.totalWidth <= boxW && m.totalHeight <= boxH;
        };

        // Free hard upper bound: any layout is at least one line tall, so
        // size * lineHeight <= boxH ⇒ size <= boxH / lineHeight.
        let hi = Math.min(maxFontSize, boxH / this.fontData.data.lineHeight);
        let lo = minFontSize;

        let chosen: number;
        if (hi <= lo) {
            // Box shorter than one line even at the floor — give up at the floor
            // (same clamp as the can't-fit case).
            chosen = lo;
        } else if (fits(hi)) {
            // Current (or max) size already fits — no shrink.
            chosen = hi;
        } else {
            while (hi - lo > precision) {
                const mid = (lo + hi) / 2;
                if (fits(mid)) lo = mid;
                else hi = mid;
            }
            chosen = lo; // largest tested size that still fits
        }

        // Both mutations are intended and permanent: the wrap width keeps the
        // text fitted across later content changes.
        this.fontSize = chosen;
        this.maxWidth = boxW;
        if (this._dirty) this.rebuildText(); // so width/height/displayOrigin are current
        this.placeInBox(rect, options);
        return this;
    },

    /**
     * Position the fitted block inside `rect` using `hAlign`/`vAlign`. Only runs
     * when both `rect.x` and `rect.y` are given (a partial anchor is size-only,
     * with a dev-warn). Origin-robust: uses the scaled display size and current
     * origin, so any pre-existing user scale and arbitrary origin are respected.
     * Ignores rotation. Not part of the public `MSDFTextInstance` type.
     */
    placeInBox: function (rect: RectLike, options: FitOptions) {
        const hasX = rect.x !== undefined;
        const hasY = rect.y !== undefined;
        if (!hasX && !hasY) return; // size-only
        if (hasX !== hasY) {
            console.warn(
                '[MSDFText] fitInside: `x` and `y` must be provided together to ' +
                'place the block; ignoring the partial anchor (resize only).'
            );
            return;
        }

        const dw = this.displayWidth;  // width  * scaleX (respects user scale)
        const dh = this.displayHeight; // height * scaleY
        const hf = { left: 0, center: 0.5, right: 1 }[options.hAlign ?? 'left'];
        const vf = { top: 0, middle: 0.5, bottom: 1 }[options.vAlign ?? 'top'];
        this.x = (rect.x as number) + (rect.width - dw) * hf + this.displayOriginX;
        this.y = (rect.y as number) + (rect.height - dh) * vf + this.displayOriginY;
    },

    /**
     * Set text color. Accepts a 0xRRGGBB number, a hex/rgb string, or an
     * `{r, g, b, a?}` object (channels in 0-255). When provided, `alpha`
     * (0-1) overrides any alpha embedded in the color value.
     */
    setColor: function (color: ColorValue, alpha?: number) {
        const c = (Phaser.Display.Color.ValueToColor as any)(color);
        this._color = {
            r: c.redGL,
            g: c.greenGL,
            b: c.blueGL,
            a: alpha !== undefined ? alpha : c.alphaGL
        };
        // In plain static mode the renderer reads this colour fresh each frame.
        // But with rich-text styles the per-glyph array is snapshotted (seeded
        // once, like manual mode), so flag a coalesced re-seed to propagate the
        // new base colour under the styled runs.
        if (this._hasStyles) {
            this._stylesDirty = true;
        }
        return this;
    },

    /**
     * Text color as a packed `0xRRGGBB` number.
     *
     * The getter recovers it from the stored color. The setter routes through
     * `setColor`, preserving the current color alpha — pass `setColor(color,
     * alpha)` to change the alpha too. Color is consumed directly at render
     * time, so changing it does not trigger a layout rebuild.
     */
    color: {
        get: function (this: any): number {
            const c = this._color;
            return (
                (Math.round(c.r * 255) << 16) |
                (Math.round(c.g * 255) << 8) |
                Math.round(c.b * 255)
            );
        },
        set: function (this: any, value: ColorValue) {
            this.setColor(value, this._color.a);
        }
    },

    /**
     * Line alignment for multi-line text: `'left'` (default), `'center'` or
     * `'right'`. See the `setLeftAlign` / `setCenterAlign` / `setRightAlign`
     * chainable helpers. Setting this triggers a rebuild on next render.
     */
    align: {
        get: function (this: any): MSDFAlign { return this._align; },
        set: function (this: any, value: MSDFAlign) {
            if (this._align !== value) {
                this._align = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Left-align each line of text (chainable). Only affects multi-line text.
     */
    setLeftAlign: function () {
        this.align = 'left';
        return this;
    },

    /**
     * Center-align each line of text (chainable). Only affects multi-line text.
     */
    setCenterAlign: function () {
        this.align = 'center';
        return this;
    },

    /**
     * Right-align each line of text (chainable). Only affects multi-line text.
     */
    setRightAlign: function () {
        this.align = 'right';
        return this;
    },

    /**
     * Extra horizontal space (in pixels) added between every character.
     * Can be negative to tighten spacing. Setting this triggers a rebuild
     * on next render.
     */
    letterSpacing: {
        get: function (this: any): number { return this._letterSpacing; },
        set: function (this: any, value: number) {
            if (this._letterSpacing !== value) {
                this._letterSpacing = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set letter spacing in pixels (chainable). Positive widens, negative tightens.
     */
    setLetterSpacing: function (spacing: number) {
        this.letterSpacing = spacing;
        return this;
    },

    /**
     * Line spacing. Setting this triggers a rebuild on next render.
     */
    lineSpacing: {
        get: function (this: any): number { return this._lineSpacing; },
        set: function (this: any, value: number) {
            if (this._lineSpacing !== value) {
                this._lineSpacing = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set line spacing (chainable)
     */
    setLineSpacing: function (spacing: number) {
        this.lineSpacing = spacing;
        return this;
    },

    /**
     * Maximum text width for word wrapping (0 = no wrapping).
     * Setting this triggers a rebuild on next render.
     */
    maxWidth: {
        get: function (this: any): number { return this._maxWidth; },
        set: function (this: any, value: number) {
            if (this._maxWidth !== value) {
                this._maxWidth = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set maximum text width for word wrapping (chainable)
     * @param width Maximum width in pixels (0 = no wrapping)
     */
    setMaxWidth: function (width: number) {
        this.maxWidth = width;
        return this;
    },

    /**
     * Set the per-frame display callback. It receives the per-glyph state array
     * (re-seeded to the text's defaults every frame) and the text object; mutate
     * glyphs in place. Passing `undefined` clears it (same as
     * {@link clearDisplayCallback}). Switches the text into callback mode,
     * overriding any prior manual control.
     */
    setDisplayCallback: function (callback: DisplayCallback | undefined) {
        this.displayCallback = callback;
        if (callback) {
            this._glyphMode = GLYPH_MODE_CALLBACK;
        } else if (this._glyphMode === GLYPH_MODE_CALLBACK) {
            this._glyphMode = GLYPH_MODE_STATIC;
        }
        return this;
    },

    /**
     * Clear the display callback. Returns to static mode if it was in callback
     * mode; leaves manual mode untouched.
     */
    clearDisplayCallback: function () {
        this.displayCallback = undefined;
        if (this._glyphMode === GLYPH_MODE_CALLBACK) {
            this._glyphMode = GLYPH_MODE_STATIC;
        }
        return this;
    },

    /**
     * The per-glyph state array (`null` in static mode). See
     * {@link MSDFTextInstance.glyphs}.
     */
    glyphs: {
        get: function (this: any): GlyphState[] | null {
            return this._glyphMode === GLYPH_MODE_STATIC ? null : this._glyphStates;
        }
    },

    /**
     * Take manual control of per-glyph state (chainable-returning the array).
     * See {@link MSDFTextInstance.editGlyphs}.
     */
    editGlyphs: function (): GlyphState[] {
        if (this._dirty) {
            this.rebuildText();
        }
        this.displayCallback = undefined;
        this._glyphMode = GLYPH_MODE_MANUAL;
        return this.prepareGlyphStates();
    },

    /**
     * Re-seed the manual glyph array to the text's current defaults.
     */
    resetGlyphs: function () {
        if (this._glyphMode === GLYPH_MODE_MANUAL) {
            if (this._dirty) {
                this.rebuildText();
            }
            this.prepareGlyphStates();
        }
        return this;
    },

    /**
     * Ensure the glyph-state array matches the renderable glyph count and seed
     * every entry to the text's current defaults. Used by the renderer each
     * frame in callback mode, and on rebuild/edit/reset in manual mode.
     */
    prepareGlyphStates: function (): GlyphState[] {
        const chars = this._characters;
        const states: GlyphState[] = this._glyphStates;
        const n = chars.length;

        while (states.length < n) {
            states.push(createGlyphState());
        }
        if (states.length > n) {
            states.length = n;
        }
        for (let i = 0; i < n; i++) {
            this.seedGlyph(states[i], chars[i], i);
        }
        // Rich-text styling overrides the seeded base, before any callback runs.
        if (this._hasStyles) {
            this.applyStyleRuns(states);
        }
        return states;
    },

    /**
     * Layer the three style stores onto already-seeded glyph states, in paint
     * order — **segments → rules → ranges** — and creation order within each
     * layer. Applied key-by-key, so a later layer that sets only `outline`
     * leaves an earlier layer's `color` intact. Glyphs are matched to runs by
     * `srcIndex` (source position, wrap-independent).
     */
    applyStyleRuns: function (states: GlyphState[]): void {
        let shadow = false;
        const seg = this._segmentRuns;
        for (let r = 0; r < seg.length; r++) {
            shadow = shadow || styleHasShadowKeys(seg[r].style);
            this.applyRun(states, seg[r].start, seg[r].length, seg[r].style);
        }
        const rules = this._styleRules;
        for (let k = 0; k < rules.length; k++) {
            const rule = rules[k];
            const runs = rule.runs;
            if (runs.length > 0) shadow = shadow || styleHasShadowKeys(rule.style);
            for (let r = 0; r < runs.length; r++) {
                this.applyRun(states, runs[r].start, runs[r].length, rule.style);
            }
        }
        const range = this._rangeRuns;
        for (let r = 0; r < range.length; r++) {
            shadow = shadow || styleHasShadowKeys(range[r].style);
            this.applyRun(states, range[r].start, range[r].length, range[r].style);
        }
        // Cached for the renderer's shadow-pass gate: in per-glyph mode the pass
        // runs if any run sets a shadow, even without an object-level shadow.
        this._stylesHaveShadow = shadow;
    },

    /** Apply one resolved style to every glyph whose `srcIndex` is in the span. */
    applyRun: function (states: GlyphState[], start: number, length: number, style: ResolvedStyle): void {
        const end = start + length;
        for (let i = 0; i < states.length; i++) {
            const g = states[i];
            const si = (g as any).srcIndex;
            if (si >= start && si < end) {
                applyStyleToGlyph(g, style);
            }
        }
    },

    /**
     * Lazily apply a pending style change (set `_stylesDirty` by a handle, a
     * segment update or `clearStyles`). Coalesced to one re-seed per tick by the
     * flag. In callback mode the array is re-seeded every frame anyway, so this
     * only clears the flag; in manual/static+styles it re-seeds the persistent
     * array (and, in manual mode, emits `'glyphsreset'` so edits can re-apply).
     */
    applyStylesDirty: function (): void {
        this._stylesDirty = false;
        if (this._glyphMode === GLYPH_MODE_CALLBACK) {
            return;
        }
        if (this._glyphMode === GLYPH_MODE_MANUAL || this._hasStyles) {
            this.prepareGlyphStates();
            if (this._glyphMode === GLYPH_MODE_MANUAL) {
                this.emit('glyphsreset', this);
            }
        }
    },

    /**
     * Seed one glyph state with the text object's effective colour, alpha,
     * outline, shadow and layout position. Mirrors the static-mode resolution in
     * the renderer so callback/manual glyphs start from the same defaults.
     */
    seedGlyph: function (g: GlyphState, char: any, index: number): void {
        (g as any).index = index;
        (g as any).charCode = char.charCode || 0;
        (g as any).srcIndex = char.srcIndex;
        (g as any).line = char.line;
        (g as any).srcLine = char.srcLine;
        g.x = char.x;
        g.y = char.y;
        g.scaleX = 1;
        g.scaleY = 1;
        g.rotation = 0;
        g.skew = 0;

        const c = this._color;
        const cA = c.a;
        const aTL = cA * this._alphaTL, aTR = cA * this._alphaTR;
        const aBL = cA * this._alphaBL, aBR = cA * this._alphaBR;

        // Single base colour, applied to all four corners. Per-corner gradients
        // are the caller's to set after seeding (e.g. in a display callback).
        const rgb = this.color;
        const ft = g.fill.color, fa = g.fill.alpha;
        ft.topLeft = ft.topRight = ft.bottomLeft = ft.bottomRight = rgb;
        fa.topLeft = aTL; fa.topRight = aTR; fa.bottomLeft = aBL; fa.bottomRight = aBR;

        const st = g.shadow.color, sa = g.shadow.alpha;
        const sc = this.shadowColor;
        // Seed a base shadow only when the object itself has one. Without it,
        // glyphs get zero shadow alpha, so when the shadow pass runs for the sake
        // of a per-run / per-glyph shadow the untouched glyphs draw nothing.
        const sAlpha = this.hasShadow() ? this.shadowAlpha : 0;
        st.topLeft = st.topRight = st.bottomLeft = st.bottomRight = sc;
        sa.topLeft = sAlpha * this._alphaTL; sa.topRight = sAlpha * this._alphaTR;
        sa.bottomLeft = sAlpha * this._alphaBL; sa.bottomRight = sAlpha * this._alphaBR;
        g.shadow.x = this.shadowX;
        g.shadow.y = this.shadowY;

        const ot = g.outline.color, oa = g.outline.alpha;
        const oc = this.outlineColor, oAlpha = this.outlineAlpha;
        ot.topLeft = ot.topRight = ot.bottomLeft = ot.bottomRight = oc;
        oa.topLeft = oAlpha * this._alphaTL; oa.topRight = oAlpha * this._alphaTR;
        oa.bottomLeft = oAlpha * this._alphaBL; oa.bottomRight = oAlpha * this._alphaBR;
    },

    /**
     * Set the outline for the text (chainable convenience wrapper).
     *
     * The outline edge has no layout side effects, so the underlying
     * `outlineWidth`, `outlineColor`, `outlineAlpha` and `outlineRounded`
     * fields can also be assigned or tweened directly.
     *
     * The maximum representable outline is roughly half the font's
     * `distanceRange` (`pxRange`). Past that, the MSDF texture's distance
     * field is saturated and the outline stops growing, showing flat edges
     * around each glyph's atlas cell. For thicker outlines, regenerate the
     * font with a larger `-pxrange` (and matching glyph padding) rather than
     * raising `width` further.
     *
     * @param width   Outline width in distance field units.
     * @param color   Outline color (number, hex/rgb string, or {r,g,b,a?} object). Defaults to black.
     * @param alpha   Outline alpha (0-1). Defaults to 1.
     * @param rounded Round the outer corners using the true SDF. Requires an
     *   MTSDF atlas; ignored with a one-time warning on a plain MSDF font.
     * @param layered Draw the outline as a separate silhouette pass under the
     *   fill so a thick outline does not overlap the neighbouring glyph. See
     *   {@link MSDFTextInstance.outlineLayered} for the cost and the
     *   transparent-text caveat. Defaults to `false`.
     */
    setOutline: function (width: number, color: ColorValue = 0x000000, alpha: number = 1, rounded: boolean = false, layered: boolean = false) {
        this.outlineWidth = width;
        this.outlineColor = toColorInt(color);
        this.outlineAlpha = alpha;
        this.outlineRounded = !!rounded;
        this.outlineLayered = !!layered;
        if (this.outlineRounded && width > 0) {
            warnNeedsMtsdf(this, 'rounded outline');
        }
        return this;
    },

    /**
     * Clear the outline effect (chainable).
     */
    clearOutline: function () {
        this.outlineWidth = 0;
        this.outlineRounded = false;
        return this;
    },

    /**
     * Whether an outline is currently enabled.
     */
    hasOutline: function (): boolean {
        return this.outlineWidth > 0;
    },

    /**
     * Set the drop shadow for the text (chainable convenience wrapper).
     *
     * The shadow has no layout side effects, so the underlying `shadowX`,
     * `shadowY`, `shadowColor`, `shadowAlpha` and `shadowSoftness` fields can
     * also be assigned or tweened directly.
     *
     * Called with no arguments, this resets the shadow to its defaults
     * (effectively clearing it).
     *
     * @param x        Shadow X offset in pixels. Defaults to 0.
     * @param y        Shadow Y offset in pixels. Defaults to 0.
     * @param color    Shadow color (number, hex/rgb string, or {r,g,b,a?} object). Defaults to black.
     * @param alpha    Shadow alpha (0-1). Defaults to 0.5.
     * @param softness Shadow blur in distance-field units — so it scales with
     *   the text, like outline width. Defaults to 0 (hard edge). Any value
     *   above 0 requires an MTSDF atlas; ignored with a one-time warning on a
     *   plain MSDF font. A soft shadow with zero offset reads as a glow. The
     *   maximum usable blur is the atlas `distanceRange`.
     */
    setShadow: function (x: number = 0, y: number = 0, color: ColorValue = 0x000000, alpha: number = 0.5, softness: number = 0) {
        this.shadowX = x;
        this.shadowY = y;
        this.shadowColor = toColorInt(color);
        this.shadowAlpha = alpha;
        this.shadowSoftness = Math.max(0, softness);
        if (this.shadowSoftness > 0) {
            warnNeedsMtsdf(this, 'soft shadow');
        }
        return this;
    },

    /**
     * Clear the drop shadow effect (chainable). Resets the offset and softness;
     * leaves color and alpha so a later `setShadow` reuses them.
     */
    clearShadow: function () {
        this.shadowX = 0;
        this.shadowY = 0;
        this.shadowSoftness = 0;
        return this;
    },

    /**
     * Whether a drop shadow is currently visible (has an offset or softness).
     */
    hasShadow: function (): boolean {
        return this.shadowX !== 0 || this.shadowY !== 0 || this.shadowSoftness > 0;
    },

    // ========================================================================
    // Rich-text styling
    // ========================================================================

    /**
     * Set styled text from structured segments. See
     * {@link MSDFTextInstance.setRichText}.
     */
    setRichText: function (segments: Segment[]) {
        let text = '';
        const runs: StyleRun[] = [];

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (typeof seg === 'string') {
                text += seg;
                continue;
            }
            const start = text.length;
            const t = seg.text != null ? String(seg.text) : '';
            text += t;
            if (t.length > 0 && hasStyleKeys(seg)) {
                runs.push({ start, length: t.length, style: resolveStyle(seg) });
            }
        }

        // Segments replace the content layer wholesale; ranges drop (content
        // replacement). Rules re-match only when the text actually changed.
        const changed = text !== this._text;
        this._segmentRuns = runs;
        if (changed) {
            this._text = text;
            this._dirty = true;
            this.onTextChanged(text);      // drop ranges, re-match rules, dirty flags
            this.updateDisplayOrigin();
        } else {
            // Same concatenated text ⇒ skip relayout; still drop ranges and
            // refresh the styled seed (that is the update path — no _dirty).
            if (this._rangeRuns.length > 0) {
                this._rangeRuns.length = 0;
                this._rangeGen++;
            }
            this.recomputeHasStyles();
            this._stylesDirty = true;
        }
        return this;
    },

    /**
     * Add a persistent keyword rule. See {@link MSDFTextInstance.setTextStyle}.
     */
    setTextStyle: function (match: string, style: StyleSpec, opts: TextStyleOpts = {}) {
        const resolvedOpts: Required<TextStyleOpts> = {
            all: opts.all !== undefined ? opts.all : true,
            nth: opts.nth !== undefined ? opts.nth : -1, // -1 = not targeting a single occurrence
            wholeWord: !!opts.wholeWord,
            caseSensitive: opts.caseSensitive !== undefined ? opts.caseSensitive : true
        };
        const rule: StyleRule = {
            match: String(match),
            opts: resolvedOpts,
            style: resolveStyle(style),
            runs: matchRuns(this._text, String(match), resolvedOpts)
        };
        this._styleRules.push(rule);
        this.recomputeHasStyles();
        this._stylesDirty = true;
        return this.makeRuleHandle(rule);
    },

    /**
     * Style a transient index range. See {@link MSDFTextInstance.addStyleRange}.
     */
    addStyleRange: function (start: number, length: number, style: StyleSpec) {
        const run: StyleRun = { start, length, style: resolveStyle(style) };
        this._rangeRuns.push(run);
        this.recomputeHasStyles();
        this._stylesDirty = true;
        return this.makeRangeHandle(run, this._rangeGen);
    },

    /**
     * Remove all rules and ranges. See {@link MSDFTextInstance.clearStyles}.
     */
    clearStyles: function () {
        this._styleRules.length = 0;
        if (this._rangeRuns.length > 0) {
            this._rangeRuns.length = 0;
            this._rangeGen++;
        }
        // Segments are content, not policy — left intact.
        this.recomputeHasStyles();
        this._stylesDirty = true;
        return this;
    },

    /** Build the {@link StyleHandle} for a persistent rule (survives text changes). */
    makeRuleHandle: function (rule: StyleRule): StyleHandle {
        const self = this;
        let removed = false;
        return {
            update(style: StyleSpec): void {
                if (removed) { self.warnDeadHandle(); return; }
                rule.style = resolveStyle(style);
                self._stylesDirty = true;
            },
            remove(): void {
                if (removed) return;
                removed = true;
                const i = self._styleRules.indexOf(rule);
                if (i >= 0) self._styleRules.splice(i, 1);
                self.recomputeHasStyles();
                self._stylesDirty = true;
            }
        };
    },

    /**
     * Build the {@link StyleHandle} for a transient range. `gen` snapshots
     * `_rangeGen` at creation; a mismatch means a text change dropped the range,
     * so the handle is dead (methods no-op with a one-time warning).
     */
    makeRangeHandle: function (run: StyleRun, gen: number): StyleHandle {
        const self = this;
        return {
            update(style: StyleSpec): void {
                if (gen !== self._rangeGen) { self.warnDeadHandle(); return; }
                run.style = resolveStyle(style);
                self._stylesDirty = true;
            },
            remove(): void {
                if (gen !== self._rangeGen) return;
                const i = self._rangeRuns.indexOf(run);
                if (i >= 0) self._rangeRuns.splice(i, 1);
                self.recomputeHasStyles();
                self._stylesDirty = true;
            }
        };
    },

    /** One-time dev warning when a dead style handle is used. */
    warnDeadHandle: function (): void {
        if (!this._deadHandleWarned) {
            this._deadHandleWarned = true;
            console.warn(
                '[MSDFText] A style handle was used after it was removed or after ' +
                'a text change dropped its range; the call is ignored. Re-create ' +
                'the range/rule against the current text.'
            );
        }
    },

    // ========================================================================
    // Measurement
    // ========================================================================

    /**
     * The width of the rendered text in local space (excludes scale).
     */
    width: {
        get: function (this: any): number {
            if (this._dirty) {
                this.rebuildText();
            }
            return this._width;
        }
    },

    /**
     * The height of the rendered text in local space (excludes scale).
     */
    height: {
        get: function (this: any): number {
            if (this._dirty) {
                this.rebuildText();
            }
            return this._height;
        }
    },

    /**
     * The displayed width of this text, taking the scale factor into account.
     * Setting this adjusts `scaleX` so the rendered width matches the value.
     */
    displayWidth: {
        get: function (this: any): number {
            return this.width * this.scaleX;
        },
        set: function (this: any, value: number) {
            this.scaleX = this.width === 0 ? 1 : value / this.width;
        }
    },

    /**
     * The displayed height of this text, taking the scale factor into account.
     * Setting this adjusts `scaleY` so the rendered height matches the value.
     */
    displayHeight: {
        get: function (this: any): number {
            return this.height * this.scaleY;
        },
        set: function (this: any, value: number) {
            this.scaleY = this.height === 0 ? 1 : value / this.height;
        }
    },

    /**
     * Get detailed text bounds including per-line information
     */
    getTextBounds: function () {
        // Get text to measure (with word wrapping if enabled).
        const textToMeasure = this.computeWrap(this._text, this._maxWidth, this._fontSize).text;

        const lineData = this.fontData.measureLines(
            textToMeasure, this._fontSize, this._lineSpacing, this._letterSpacing
        );

        return {
            width: lineData.totalWidth,
            height: lineData.totalHeight,
            lines: {
                count: lineData.lines.length,
                lengths: lineData.widths,
                shortest: lineData.shortest,
                longest: lineData.longest
            }
        };
    },

    // ========================================================================
    // Rendering
    // ========================================================================

    /**
     * Word wrap text to fit within `maxWidth`, returning the wrapped string plus
     * a parallel source-index map (see {@link wrapLines} for the map contract).
     * Thin adapter that feeds the pure wrapper the object's current wrap char,
     * letter spacing and font. Not part of the public `MSDFTextInstance` type.
     */
    computeWrap: function (text: string, maxWidth: number, fontSize: number): { text: string; srcIndex: number[] } {
        return wrapLines(text, maxWidth, fontSize, this.wordWrapCharCode, this._letterSpacing, this.fontData);
    },

    /**
     * Back-compat thin wrapper over {@link computeWrap} returning just the
     * wrapped string, measured at the current font size. Not part of the public
     * `MSDFTextInstance` type.
     */
    wrapText: function (text: string, maxWidth: number): string {
        return this.computeWrap(text, maxWidth, this._fontSize).text;
    },

    /**
     * Rebuild character layout data
     * This calculates positions and UVs for all characters but doesn't create GameObjects
     */
    rebuildText: function () {
        // Clear existing character data
        this.clearCharacters();

        if (!this._text || this._text.length === 0) {
            this.refreshGlyphs();
            return;
        }

        // Apply word wrapping (a no-op identity map when maxWidth <= 0). `srcMap`
        // is parallel to `textToRender`: srcMap[i] is character i's index in the
        // original text, or -1 for a wrap-inserted (soft) newline.
        const wrap = this.computeWrap(this._text, this._maxWidth, this._fontSize);
        const textToRender = wrap.text;
        const srcMap = wrap.srcIndex;

        // Layout characters.
        // y = 0 is the top of the text block (matching BitmapText), so each
        // line's baseline sits `baselineOffset` below its own top edge.
        const baselineOffset = this.fontData.getBaselineOffset(this._fontSize);
        let cursorX = 0;
        let cursorY = 0;
        let lineIndex = 0;    // visual line (soft + hard breaks)
        let srcLineIndex = 0; // source paragraph (hard breaks only)
        let prevCharCode = 0;

        for (let i = 0; i < textToRender.length; i++) {
            const charCode = textToRender.charCodeAt(i);

            // Handle newlines
            if (charCode === 10) { // '\n'
                cursorX = 0;
                cursorY += this.fontData.getLineHeight(this._fontSize) + this._lineSpacing;
                lineIndex++;
                // Soft (inserted) breaks carry -1; only original newlines advance srcLine.
                if (srcMap[i] !== -1) srcLineIndex++;
                prevCharCode = 0;
                continue;
            }

            const char = this.fontData.getChar(charCode);
            if (!char) {
                // Character not in font
                prevCharCode = 0;
                continue;
            }

            // Apply kerning
            if (prevCharCode !== 0) {
                const kerning = this.fontData.getKerning(prevCharCode, charCode);
                cursorX += kerning * this._fontSize;
            }

            // Skip rendering for space (but still advance)
            if (charCode === 32) {
                cursorX += char.xAdvance * this._fontSize + this._letterSpacing;
                prevCharCode = charCode;
                continue;
            }

            // Calculate character position (using normalized offsets scaled by
            // fontSize). charY is measured from the top of the line:
            // line top + baseline offset + the glyph's baseline-relative offset.
            const charX = cursorX + char.xOffset * this._fontSize;
            const charY = cursorY + baselineOffset + char.yOffset * this._fontSize;

            // Calculate character size (using normalized dimensions scaled by fontSize)
            const charWidth = char.normalizedWidth * this._fontSize;
            const charHeight = char.normalizedHeight * this._fontSize;

            // Store character layout data (no GameObject creation!)
            // NOTE: UV coordinates in MSDFFont are pre-flipped for Phaser's Shader GameObject.
            // For batched rendering we need to swap v0 and v1 to correct the orientation.
            this._characters.push({
                x: charX,
                y: charY,
                w: charWidth,
                h: charHeight,
                u0: char.u0,
                v0: char.v1,  // Swap v0 and v1 to flip orientation
                u1: char.u1,
                v1: char.v0,   // Swap v0 and v1 to flip orientation
                charCode: charCode,           // Store for seeding GlyphState
                line: lineIndex,              // Visual line index, used by applyAlignment + provenance
                srcIndex: srcMap[i],          // Index into the original text (provenance)
                srcLine: srcLineIndex,        // Source paragraph index (provenance)
                baselineY: cursorY + baselineOffset  // Layout baseline (used by the skew feature)
            });

            // Advance cursor (letter spacing applies after every character)
            cursorX += char.xAdvance * this._fontSize + this._letterSpacing;
            prevCharCode = charCode;
        }

        // Cache local bounds. measureLines also drives per-line alignment below.
        // Clear dirty BEFORE updateDisplayOrigin so the width/height getters
        // it reads don't re-enter rebuildText.
        const lineData = this.fontData.measureLines(
            textToRender, this._fontSize, this._lineSpacing, this._letterSpacing
        );
        this._width = lineData.totalWidth;
        this._height = lineData.totalHeight;

        // Apply alignment now that line widths are known.
        this.applyAlignment(lineData);

        this._dirty = false;
        this.updateDisplayOrigin();
        this.refreshGlyphs();
    },

    /**
     * After a rebuild, re-seed the persistent glyph array for the fresh glyph
     * set. Fires in **manual** mode (and emits `'glyphsreset'` so listeners can
     * re-apply the edits the rebuild discarded) and whenever rich-text styles
     * are present (so a no-callback styled text has its styled array ready).
     * Callback mode re-seeds every frame instead, so it is skipped here. Clears
     * `_stylesDirty` since the array is now freshly seeded + styled.
     */
    refreshGlyphs: function (): void {
        this._stylesDirty = false;
        if (this._glyphMode === GLYPH_MODE_CALLBACK) {
            return;
        }
        if (this._glyphMode === GLYPH_MODE_MANUAL || this._hasStyles) {
            this.prepareGlyphStates();
            if (this._glyphMode === GLYPH_MODE_MANUAL) {
                this.emit('glyphsreset', this);
            }
        }
    },

    /**
     * Apply text alignment to character positions.
     *
     * Matches BitmapText: the text block's left edge always stays at x = 0,
     * and alignment only shifts each line *within* the block relative to the
     * longest line. Use `originX` to position the block as a whole.
     *
     * @param lineData Per-line measurement from `MSDFFont.measureLines`.
     */
    applyAlignment: function (lineData: { widths: number[]; totalWidth: number }) {
        if (this._align === 'left' || this._characters.length === 0) {
            return;
        }

        const longest = lineData.totalWidth;

        for (const char of this._characters) {
            const lineWidth = lineData.widths[char.line as number] || 0;
            let offset = 0;

            if (this._align === 'center') {
                offset = (longest - lineWidth) / 2;
            } else if (this._align === 'right') {
                offset = longest - lineWidth;
            }

            char.x += offset;
        }
    },

    /**
     * Clear all character data
     */
    clearCharacters: function () {
        this._characters = [];
    },

    // ========================================================================
    // Cleanup
    // ========================================================================

    /**
     * Destroy the text object
     */
    preDestroy: function () {
        this.clearCharacters();
    }

});
