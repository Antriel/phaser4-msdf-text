/**
 * MSDFText GameObject
 *
 * Renders text using MSDF (Multi-channel Signed Distance Field) fonts.
 * Characters are submitted to a custom BatchHandler so a full text object
 * typically renders in 1-2 draw calls.
 *
 * Uses Phaser's idiomatic Class system with component mixins for proper
 * integration with Phaser's GameObject ecosystem.
 *
 * Usage:
 *   const text = scene.add.msdfText(x, y, 'arial', 'Hello World', fontSize);
 *   // or
 *   const text = scene.make.msdfText({ font: 'arial', text: 'Hello', fontSize: 42, x: 100, y: 100 });
 */

import * as Phaser from "phaser";
import { MSDFFont } from './MSDFFont';
import MSDFTextWebGLRenderer from './MSDFTextWebGLRenderer';

// Phaser's published types describe these as interfaces/values that don't
// match the runtime shape we need, so reach through `any`.
const Class: any = (Phaser as any).Class;
const Components: any = (Phaser as any).GameObjects.Components;
const GameObject: any = (Phaser as any).GameObjects.GameObject;
const PhaserMap: any = (Phaser as any).Structs.Map;

export type TextAlign = 'left' | 'center' | 'right';

/**
 * Any value accepted by Phaser.Display.Color.ValueToColor:
 * - number: packed 0xRRGGBB
 * - string: '#rrggbb', '#rgb', or 'rgb(r,g,b)'
 * - object: { r, g, b, a? } with channels in 0-255 (also accepts Phaser.Display.Color)
 */
export type ColorValue = number | string | Phaser.Types.Display.InputColorObject | Phaser.Display.Color;

/**
 * Options for {@link MSDFText.setOutline}.
 */
export interface MSDFOutlineOptions {
    /**
     * Round the outline's outer corners using the atlas's true signed distance
     * field. Requires an MTSDF font atlas (`-type mtsdf`); on a plain MSDF font
     * it is ignored with a one-time console warning. Default `false` (sharp,
     * mitred corners).
     */
    rounded?: boolean;
}

/**
 * Options for {@link MSDFText.setShadow}.
 */
export interface MSDFShadowOptions {
    /**
     * Shadow blur, in screen pixels. `0` is a hard-edged shadow (the default).
     * Any value above `0` produces a soft shadow and requires an MTSDF font
     * atlas (`-type mtsdf`); on a plain MSDF font it is ignored with a one-time
     * console warning. The maximum usable blur is bounded by the atlas
     * `distanceRange` — for very soft shadows regenerate with a larger
     * `-pxrange`. A soft shadow with zero offset reads as a glow.
     */
    softness?: number;
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
 * Per-corner tint data for display callbacks
 */
export interface DisplayCallbackTint {
    topLeft: number;
    topRight: number;
    bottomLeft: number;
    bottomRight: number;
}

/**
 * Data passed to display callback for each character
 */
export interface DisplayCallbackData {
    parent: any;           // Reference to the text object
    index: number;         // Character index in the text string
    charCode: number;      // Character code
    x: number;             // Character X position (can be modified)
    y: number;             // Character Y position (can be modified)
    scale: number;         // Character scale (can be modified)
    rotation: number;      // Character rotation in radians (can be modified)
    tint: DisplayCallbackTint;  // Per-corner tint values (can be modified)
    data: any;             // Custom user data
}

/**
 * Display callback function signature
 */
export type DisplayCallback = (data: DisplayCallbackData) => DisplayCallbackData;

/**
 * Character layout data
 */
export interface CharacterData {
    x: number;       // X position in text space
    y: number;       // Y position in text space
    w: number;       // Width
    h: number;       // Height
    u0: number;      // UV left
    v0: number;      // UV top
    u1: number;      // UV right
    v1: number;      // UV bottom

    // Optional callback data
    originalX?: number;     // Original X (before callback modifications)
    originalY?: number;     // Original Y (before callback modifications)
    scale?: number;         // Per-character scale
    rotation?: number;      // Per-character rotation
    tint?: number;          // Per-character tint override
    data?: any;             // Custom user data
    charCode?: number;      // Character code (for callbacks)
    line?: number;          // Line index (used by alignment)
}

/**
 * Type interface for MSDFText instances
 * Use this for type annotations instead of the Class constructor
 */
export interface MSDFTextInstance extends
    Phaser.GameObjects.GameObject,
    Phaser.GameObjects.Components.Alpha,
    Phaser.GameObjects.Components.BlendMode,
    Phaser.GameObjects.Components.Depth,
    Phaser.GameObjects.Components.GetBounds,
    Phaser.GameObjects.Components.Origin,
    Phaser.GameObjects.Components.ScrollFactor,
    Phaser.GameObjects.Components.Texture,
    Phaser.GameObjects.Components.Tint,
    Phaser.GameObjects.Components.Transform,
    Phaser.GameObjects.Components.Visible {

    // Custom properties
    font: string;
    fontData: MSDFFont;
    _text: string;
    _fontSize: number;
    _color: { r: number; g: number; b: number; a: number };
    _align: TextAlign;
    _lineSpacing: number;
    _letterSpacing: number;
    _maxWidth: number;
    wordWrapCharCode: number;
    _outlineWidth: number;
    _outlineColor: { r: number; g: number; b: number; a: number };
    _outlineRounded: boolean;
    _shadowOffset: { x: number; y: number };
    _shadowColor: { r: number; g: number; b: number };
    _shadowAlpha: number;
    _shadowSoftness: number;
    _characters: CharacterData[];
    _width: number;
    _height: number;
    _dirty: boolean;
    displayCallback?: DisplayCallback;
    callbackData: DisplayCallbackData;

    // Dimensions (derived from text bounds)
    readonly width: number;
    readonly height: number;
    displayWidth: number;
    displayHeight: number;

    // Property accessors (with side effects — trigger rebuild on change)
    text: string | string[];
    fontSize: number;
    align: TextAlign;
    lineSpacing: number;
    letterSpacing: number;
    maxWidth: number;

    // Chainable setters
    setText(text: string | string[]): this;
    setFont(font: string, size?: number, align?: TextAlign): this;
    setFontSize(size: number): this;
    setColor(color: ColorValue, alpha?: number): this;
    setAlign(align: TextAlign): this;
    setLineSpacing(spacing: number): this;
    setLetterSpacing(spacing: number): this;
    setMaxWidth(width: number): this;
    setDisplaySize(width: number, height: number): this;
    setDisplayCallback(callback: DisplayCallback | undefined): this;
    clearDisplayCallback(): this;
    setOutline(width: number, color?: ColorValue, alpha?: number, options?: MSDFOutlineOptions): this;
    clearOutline(): this;
    hasOutline(): boolean;
    setShadow(offsetX: number, offsetY: number, color?: ColorValue, alpha?: number, options?: MSDFShadowOptions): this;
    clearShadow(): this;
    hasShadow(): boolean;
    getTextWidth(): number;
    getTextHeight(): number;
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
export const MSDFText = new Class({

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
        Components.Tint,
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
        fontSize: number = 42
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
        this._text = text;
        this._fontSize = fontSize;
        this._color = { r: 1, g: 1, b: 1, a: 1 };
        this._align = 'left';
        this._lineSpacing = 0;
        this._letterSpacing = 0;
        this._maxWidth = 0; // 0 = no word wrapping
        this.wordWrapCharCode = 32; // space character

        // Outline properties (Phase 5.4)
        this._outlineWidth = 0;
        this._outlineColor = { r: 0, g: 0, b: 0, a: 0 };
        this._outlineRounded = false;

        // Shadow properties (Phase 5.4)
        this._shadowOffset = { x: 0, y: 0 };
        this._shadowColor = { r: 0, g: 0, b: 0 };
        this._shadowAlpha = 0.5;
        this._shadowSoftness = 0;

        // Character layout data (not GameObjects!)
        this._characters = [];
        this._width = 0;
        this._height = 0;
        this._dirty = true;

        // Display callback (Phase 5.2)
        this.displayCallback = undefined;
        this.callbackData = {
            parent: this,
            index: 0,
            charCode: 0,
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            tint: {
                topLeft: 0xffffffff,
                topRight: 0xffffffff,
                bottomLeft: 0xffffffff,
                bottomRight: 0xffffffff
            },
            data: undefined
        };

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
     * @param align Optional alignment. Defaults to the current alignment.
     */
    setFont: function (font: string, size?: number, align?: TextAlign) {
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
     * Text alignment. Setting this triggers a rebuild on next render.
     */
    align: {
        get: function (this: any): TextAlign { return this._align; },
        set: function (this: any, value: TextAlign) {
            if (this._align !== value) {
                this._align = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set text alignment (chainable)
     */
    setAlign: function (align: TextAlign) {
        this.align = align;
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
     * Set display callback for per-character effects
     * @param callback Function called for each character during rendering
     */
    setDisplayCallback: function (callback: DisplayCallback | undefined) {
        this.displayCallback = callback;
        return this;
    },

    /**
     * Clear display callback
     */
    clearDisplayCallback: function () {
        this.displayCallback = undefined;
        return this;
    },

    /**
     * Set outline for the text.
     *
     * The maximum representable outline is roughly half the font's
     * `distanceRange` (`pxRange`). Past that, the MSDF texture's distance
     * field is saturated and the outline stops growing, showing flat edges
     * around each glyph's atlas cell. For thicker outlines, regenerate the
     * font with a larger `-pxrange` (and matching glyph padding) rather than
     * raising `width` further.
     *
     * @param width Outline width in distance field units
     * @param color Outline color (number, hex/rgb string, or {r,g,b,a?} object). Defaults to black.
     * @param alpha Outline alpha (0-1). Overrides any alpha in `color`.
     * @param options Extra outline options. `rounded: true` rounds the outer
     *   corners using the true SDF and requires an MTSDF atlas.
     */
    setOutline: function (width: number, color: ColorValue = 0x000000, alpha: number = 1, options?: MSDFOutlineOptions) {
        this._outlineWidth = width;
        const c = (Phaser.Display.Color.ValueToColor as any)(color);
        this._outlineColor = { r: c.redGL, g: c.greenGL, b: c.blueGL, a: alpha };
        this._outlineRounded = !!(options && options.rounded);
        if (this._outlineRounded && width > 0) {
            warnNeedsMtsdf(this, 'rounded outline');
        }
        return this;
    },

    /**
     * Clear outline effect
     */
    clearOutline: function () {
        this._outlineWidth = 0;
        this._outlineRounded = false;
        return this;
    },

    /**
     * Check if outline is enabled
     */
    hasOutline: function (): boolean {
        return this._outlineWidth > 0;
    },

    /**
     * Set shadow for the text.
     * @param offsetX Shadow X offset in pixels
     * @param offsetY Shadow Y offset in pixels
     * @param color Shadow color (number, hex/rgb string, or {r,g,b,a?} object). Defaults to black.
     * @param alpha Shadow alpha (0-1)
     * @param options Extra shadow options. `softness` (screen pixels, default 0)
     *   produces a soft shadow and requires an MTSDF atlas. A soft shadow with
     *   zero offset reads as a glow.
     */
    setShadow: function (offsetX: number, offsetY: number, color: ColorValue = 0x000000, alpha: number = 0.5, options?: MSDFShadowOptions) {
        this._shadowOffset = { x: offsetX, y: offsetY };
        const c = (Phaser.Display.Color.ValueToColor as any)(color);
        this._shadowColor = { r: c.redGL, g: c.greenGL, b: c.blueGL };
        this._shadowAlpha = alpha;
        this._shadowSoftness = options && typeof options.softness === 'number'
            ? Math.max(0, options.softness)
            : 0;
        if (this._shadowSoftness > 0) {
            warnNeedsMtsdf(this, 'soft shadow');
        }
        return this;
    },

    /**
     * Clear shadow effect
     */
    clearShadow: function () {
        this._shadowOffset = { x: 0, y: 0 };
        this._shadowSoftness = 0;
        return this;
    },

    /**
     * Check if shadow is enabled
     */
    hasShadow: function (): boolean {
        return this._shadowOffset.x !== 0 || this._shadowOffset.y !== 0 || this._shadowSoftness > 0;
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
                this._dirty = false;
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
                this._dirty = false;
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
     * Get the width of the rendered text in local space (alias for `width`).
     */
    getTextWidth: function (): number {
        return this.width;
    },

    /**
     * Get the height of the rendered text in local space (alias for `height`).
     */
    getTextHeight: function (): number {
        return this.height;
    },

    /**
     * Get detailed text bounds including line information
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
            const charWidth = (char.normalizedWidth || (char.width / this.fontData.baseSize)) * this._fontSize;
            const charHeight = (char.normalizedHeight || (char.height / this.fontData.baseSize)) * this._fontSize;

            if (!char.normalizedWidth) {
                console.warn(`Character ${String.fromCharCode(charCode)} missing normalizedWidth! Font may need re-parsing.`);
            }

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
                charCode: charCode,  // Store for callback access
                line: lineIndex,     // Line index, used by applyAlignment
                originalX: charX,    // Store original position
                originalY: charY
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

            // Keep originalX in sync so display callbacks see the aligned position.
            char.x += offset;
            char.originalX = (char.originalX as number) + offset;
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
