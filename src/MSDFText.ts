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
 * Any value accepted by Phaser.Display.Color.ValueToColor:
 * - number: packed 0xRRGGBB
 * - string: '#rrggbb', '#rgb', or 'rgb(r,g,b)'
 * - object: { r, g, b, a? } with channels in 0-255 (also accepts Phaser.Display.Color)
 */
export type ColorValue = number | string | Phaser.Types.Display.InputColorObject | Phaser.Display.Color;

/** Line alignment for multi-line text. */
export type MSDFAlign = 'left' | 'center' | 'right';

/** Convert any {@link ColorValue} to a packed `0xRRGGBB` number. */
function toColorInt(value: ColorValue): number {
    return (Phaser.Display.Color.ValueToColor as any)(value).color;
}

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
        // Rebuild if needed — rebuildText clears _dirty internally.
        if (src._dirty) {
            src.rebuildText();
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
            // Force a rebuild now so width/height/displayOrigin are correct
            // for any code that reads them between setText and the next render.
            this.updateDisplayOrigin();
        }
        return this;
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
        return states;
    },

    /**
     * Seed one glyph state with the text object's effective colour, alpha,
     * outline, shadow and layout position. Mirrors the static-mode resolution in
     * the renderer so callback/manual glyphs start from the same defaults.
     */
    seedGlyph: function (g: GlyphState, char: any, index: number): void {
        (g as any).index = index;
        (g as any).charCode = char.charCode || 0;
        g.x = char.x;
        g.y = char.y;
        g.scaleX = 1;
        g.scaleY = 1;
        g.rotation = 0;

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
        const sc = this.shadowColor, sAlpha = this.shadowAlpha;
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
        // Get text to measure (with word wrapping if enabled)
        let textToMeasure = this._text;
        if (this._maxWidth > 0) {
            textToMeasure = this.wrapText(this._text, this._maxWidth);
        }

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
     * Word wrap text to fit within maxWidth
     * @param text The text to wrap
     * @param maxWidth Maximum width in pixels
     * @returns Wrapped text with newlines inserted
     */
    wrapText: function (text: string, maxWidth: number): string {
        if (maxWidth <= 0 || !text || text.length === 0) {
            return text;
        }

        // Split by existing newlines first
        const existingLines = text.split('\n');
        const wrappedLines: string[] = [];

        for (const line of existingLines) {
            if (line.length === 0) {
                wrappedLines.push('');
                continue;
            }

            // Build words and measure
            let currentLine = '';
            let currentWord = '';

            for (let i = 0; i < line.length; i++) {
                const charCode = line.charCodeAt(i);
                const char = String.fromCharCode(charCode);

                // Check if this is a wrap character
                if (charCode === this.wordWrapCharCode) {
                    // Try adding the current word (including the wrap character)
                    const testLine = currentLine + currentWord + char;
                    const { width } = this.fontData.measureText(testLine, this._fontSize, this._letterSpacing);

                    if (width > maxWidth && currentLine.length > 0) {
                        // Word doesn't fit, wrap to new line
                        wrappedLines.push(currentLine.trim());
                        currentLine = currentWord + char;
                    } else {
                        // Word fits, add it
                        currentLine += currentWord + char;
                    }

                    currentWord = '';
                } else {
                    // Add character to current word
                    currentWord += char;
                }
            }

            // Handle remaining word
            if (currentWord.length > 0) {
                const testLine = currentLine + currentWord;
                const { width } = this.fontData.measureText(testLine, this._fontSize);

                if (width > maxWidth && currentLine.length > 0) {
                    // Last word doesn't fit, wrap it
                    wrappedLines.push(currentLine.trim());
                    wrappedLines.push(currentWord);
                } else {
                    // Last word fits
                    currentLine += currentWord;
                    wrappedLines.push(currentLine);
                }
            } else if (currentLine.length > 0) {
                wrappedLines.push(currentLine);
            }
        }

        return wrappedLines.join('\n');
    },

    /**
     * Rebuild character layout data
     * This calculates positions and UVs for all characters but doesn't create GameObjects
     */
    rebuildText: function () {
        // Clear existing character data
        this.clearCharacters();

        if (!this._text || this._text.length === 0) {
            this.refreshManualGlyphs();
            return;
        }

        // Apply word wrapping if maxWidth is set
        let textToRender = this._text;
        if (this._maxWidth > 0) {
            textToRender = this.wrapText(this._text, this._maxWidth);
        }

        // Layout characters.
        // y = 0 is the top of the text block (matching BitmapText), so each
        // line's baseline sits `baselineOffset` below its own top edge.
        const baselineOffset = this.fontData.getBaselineOffset(this._fontSize);
        let cursorX = 0;
        let cursorY = 0;
        let lineIndex = 0;
        let prevCharCode = 0;

        for (let i = 0; i < textToRender.length; i++) {
            const charCode = textToRender.charCodeAt(i);

            // Handle newlines
            if (charCode === 10) { // '\n'
                cursorX = 0;
                cursorY += this.fontData.getLineHeight(this._fontSize) + this._lineSpacing;
                lineIndex++;
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
                charCode: charCode,  // Store for seeding GlyphState
                line: lineIndex      // Line index, used by applyAlignment
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
        this.refreshManualGlyphs();
    },

    /**
     * In manual mode, re-seed the glyph array for the freshly rebuilt glyph set
     * and emit `'glyphsreset'` so listeners can re-apply their per-glyph edits
     * (which the rebuild discarded). No-op in static or callback mode.
     */
    refreshManualGlyphs: function (): void {
        if (this._glyphMode === GLYPH_MODE_MANUAL) {
            this.prepareGlyphStates();
            this.emit('glyphsreset', this);
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
