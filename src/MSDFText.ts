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
 *   const text = scene.add.msdfText(x, y, font, 'Hello World', fontSize);
 *   // or
 *   const text = scene.make.msdfText({ font, text: 'Hello', fontSize: 42, x: 100, y: 100 });
 */

import Phaser from 'phaser';
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
}

/**
 * Type interface for MSDFText instances
 * Use this for type annotations instead of the Class constructor
 */
export interface MSDFTextInstance extends Phaser.GameObjects.GameObject {
    // Properties from components
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    originX: number;
    originY: number;
    alpha: number;
    visible: boolean;
    blendMode: number;
    depth: number;
    scrollFactorX: number;
    scrollFactorY: number;

    // Custom properties
    font: MSDFFont;
    _text: string;
    _fontSize: number;
    _color: { r: number; g: number; b: number; a: number };
    _align: TextAlign;
    _lineSpacing: number;
    _maxWidth: number;
    wordWrapCharCode: number;
    _outlineWidth: number;
    _outlineColor: { r: number; g: number; b: number; a: number };
    _shadowOffset: { x: number; y: number };
    _shadowColor: { r: number; g: number; b: number };
    _shadowAlpha: number;
    _characters: CharacterData[];
    _dirty: boolean;
    displayCallback?: DisplayCallback;
    callbackData: DisplayCallbackData;
    _texture: any;

    // Property accessors (with side effects — trigger rebuild on change)
    text: string;
    fontSize: number;
    align: TextAlign;
    lineSpacing: number;
    maxWidth: number;

    // Chainable setters
    setText(text: string): this;
    setFontSize(size: number): this;
    setColor(color: ColorValue, alpha?: number): this;
    setAlign(align: TextAlign): this;
    setLineSpacing(spacing: number): this;
    setMaxWidth(width: number): this;
    setDisplayCallback(callback: DisplayCallback | undefined): this;
    clearDisplayCallback(): this;
    setOutline(width: number, color?: ColorValue, alpha?: number): this;
    clearOutline(): this;
    hasOutline(): boolean;
    setShadow(offsetX: number, offsetY: number, color?: ColorValue, alpha?: number): this;
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
        // Rebuild if needed
        if (src._dirty) {
            src.rebuildText();
            src._dirty = false;
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
        Components.Origin,
        Components.RenderNodes,
        Components.ScrollFactor,
        Components.Transform,
        Components.Visible,
        MSDFTextRender
    ],

    initialize:

    function MSDFText(
        scene: Phaser.Scene,
        x: number,
        y: number,
        font: MSDFFont,
        text: string = '',
        fontSize: number = 42
    ) {
        GameObject.call(this, scene, 'MSDFText');

        // Font and text properties
        this.font = font;
        this._text = text;
        this._fontSize = fontSize;
        this._color = { r: 1, g: 1, b: 1, a: 1 };
        this._align = 'left';
        this._lineSpacing = 0;
        this._maxWidth = 0; // 0 = no word wrapping
        this.wordWrapCharCode = 32; // space character

        // Outline properties (Phase 5.4)
        this._outlineWidth = 0;
        this._outlineColor = { r: 0, g: 0, b: 0, a: 0 };

        // Shadow properties (Phase 5.4)
        this._shadowOffset = { x: 0, y: 0 };
        this._shadowColor = { r: 0, g: 0, b: 0 };
        this._shadowAlpha = 0.5;

        // Character layout data (not GameObjects!)
        this._characters = [];
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

        // Texture and rendering
        this._texture = null; // WebGLTextureWrapper

        // Get texture wrapper from Phaser's texture cache
        const frame = scene.sys.textures.getFrame(font.textureKey);
        if (frame && frame.glTexture) {
            this._texture = frame.glTexture;
        } else {
            console.warn(`MSDFText: Could not get texture wrapper for '${font.textureKey}'`);
        }

        // Set initial position using Transform component
        this.setPosition(x, y);

        // Initialize render nodes using RenderNodes component
        this.initRenderNodes(this._defaultRenderNodesMap);

        // Initial build
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
     * The text content. Setting this triggers a rebuild on next render.
     */
    text: {
        get: function (this: any): string { return this._text; },
        set: function (this: any, value: string) {
            if (this._text !== value) {
                this._text = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set the text content (chainable)
     */
    setText: function (text: string) {
        this.text = text;
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
     * @param width Outline width in distance field units
     * @param color Outline color (number, hex/rgb string, or {r,g,b,a?} object). Defaults to black.
     * @param alpha Outline alpha (0-1). Overrides any alpha in `color`.
     */
    setOutline: function (width: number, color: ColorValue = 0x000000, alpha: number = 1) {
        this._outlineWidth = width;
        const c = (Phaser.Display.Color.ValueToColor as any)(color);
        this._outlineColor = { r: c.redGL, g: c.greenGL, b: c.blueGL, a: alpha };
        return this;
    },

    /**
     * Clear outline effect
     */
    clearOutline: function () {
        this._outlineWidth = 0;
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
     */
    setShadow: function (offsetX: number, offsetY: number, color: ColorValue = 0x000000, alpha: number = 0.5) {
        this._shadowOffset = { x: offsetX, y: offsetY };
        const c = (Phaser.Display.Color.ValueToColor as any)(color);
        this._shadowColor = { r: c.redGL, g: c.greenGL, b: c.blueGL };
        this._shadowAlpha = alpha;
        return this;
    },

    /**
     * Clear shadow effect
     */
    clearShadow: function () {
        this._shadowOffset = { x: 0, y: 0 };
        return this;
    },

    /**
     * Check if shadow is enabled
     */
    hasShadow: function (): boolean {
        return this._shadowOffset.x !== 0 || this._shadowOffset.y !== 0;
    },

    // ========================================================================
    // Measurement
    // ========================================================================

    /**
     * Get the width of the rendered text
     */
    getTextWidth: function (): number {
        const { width } = this.font.measureText(this._text, this._fontSize);
        return width;
    },

    /**
     * Get the height of the rendered text
     */
    getTextHeight: function (): number {
        const { height } = this.font.measureText(this._text, this._fontSize);
        return height;
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

        const lineData = this.font.measureLines(textToMeasure, this._fontSize, this._lineSpacing);

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
                    const { width } = this.font.measureText(testLine, this._fontSize);

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
                const { width } = this.font.measureText(testLine, this._fontSize);

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

        // Layout characters
        let cursorX = 0;
        let cursorY = 0;
        let prevCharCode = 0;

        for (let i = 0; i < textToRender.length; i++) {
            const charCode = textToRender.charCodeAt(i);

            // Handle newlines
            if (charCode === 10) { // '\n'
                cursorX = 0;
                cursorY += this.font.getLineHeight(this._fontSize) + this._lineSpacing;
                prevCharCode = 0;
                continue;
            }

            const char = this.font.getChar(charCode);
            if (!char) {
                // Character not in font
                prevCharCode = 0;
                continue;
            }

            // Apply kerning
            if (prevCharCode !== 0) {
                const kerning = this.font.getKerning(prevCharCode, charCode);
                cursorX += kerning * this._fontSize;
            }

            // Skip rendering for space (but still advance)
            if (charCode === 32) {
                cursorX += char.xAdvance * this._fontSize;
                prevCharCode = charCode;
                continue;
            }

            // Calculate character position (using normalized offsets scaled by fontSize)
            const charX = cursorX + char.xOffset * this._fontSize;
            const charY = cursorY + char.yOffset * this._fontSize;

            // Calculate character size (using normalized dimensions scaled by fontSize)
            const charWidth = (char.normalizedWidth || (char.width / this.font.baseSize)) * this._fontSize;
            const charHeight = (char.normalizedHeight || (char.height / this.font.baseSize)) * this._fontSize;

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
                originalX: charX,    // Store original position
                originalY: charY
            });

            // Advance cursor
            cursorX += char.xAdvance * this._fontSize;
            prevCharCode = charCode;
        }

        // Apply alignment
        this.applyAlignment();
    },

    /**
     * Apply text alignment to character positions
     */
    applyAlignment: function () {
        if (this._align === 'left' || this._characters.length === 0) {
            return;
        }

        const textWidth = this.getTextWidth();
        let offset = 0;

        if (this._align === 'center') {
            offset = -textWidth / 2;
        } else if (this._align === 'right') {
            offset = -textWidth;
        }

        // Offset all character positions
        for (const char of this._characters) {
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
