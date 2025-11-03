/**
 * MSDFText GameObject (Batched Rendering)
 *
 * Renders text using MSDF (Multi-channel Signed Distance Field) fonts with
 * efficient batched rendering. All characters are rendered in 1-2 draw calls
 * instead of one draw call per character.
 *
 * This uses Phaser's idiomatic Class system with component mixins for
 * proper integration with Phaser's GameObject ecosystem.
 *
 * Usage:
 *   const text = scene.add.msdfTextBatched(x, y, font, 'Hello World', fontSize);
 *   // or
 *   const text = scene.make.msdfTextBatched({ font, text: 'Hello', fontSize: 42, x: 100, y: 100 });
 */

import Phaser from 'phaser';
import { MSDFFont } from './MSDFFont';
import MSDFTextWebGLRenderer from './MSDFTextWebGLRenderer.js';

// @ts-ignore - Phaser internals not fully typed
const Class = Phaser.Class;
// @ts-ignore - Phaser internals not fully typed
const Components = Phaser.GameObjects.Components;
// @ts-ignore - Phaser internals not fully typed
const GameObject = Phaser.GameObjects.GameObject;
// @ts-ignore - Phaser internals not fully typed
const PhaserMap = Phaser.Structs.Map;

export type TextAlign = 'left' | 'center' | 'right';

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
    _wordWrapCharCode: number;
    _outlineWidth: number;
    _outlineColor: { r: number; g: number; b: number; a: number };
    _shadowOffset: { x: number; y: number };
    _shadowColor: { r: number; g: number; b: number };
    _shadowAlpha: number;
    _characters: CharacterData[];
    needsRebuild: boolean;
    displayCallback?: DisplayCallback;
    callbackData: DisplayCallbackData;
    _texture: any;
    _pxRange: number;

    // Methods
    setText(text: string): this;
    getText(): string;
    setFontSize(size: number): this;
    getFontSize(): number;
    setColor(r: number, g: number, b: number, a?: number): this;
    setColorHex(hex: string, alpha?: number): this;
    setAlign(align: TextAlign): this;
    setLineSpacing(spacing: number): this;
    setMaxWidth(width: number): this;
    getMaxWidth(): number;
    setWordWrapCharCode(charCode: number): this;
    getWordWrapCharCode(): number;
    setDisplayCallback(callback: DisplayCallback | undefined): this;
    clearDisplayCallback(): this;
    setOutline(width: number, color: number, alpha?: number): this;
    clearOutline(): this;
    hasOutline(): boolean;
    setShadow(offsetX: number, offsetY: number, color?: number, alpha?: number): this;
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
    getDebugInfo(): string;
    printDebugInfo(): void;
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
        if (src.needsRebuild) {
            src.rebuildText();
            src.needsRebuild = false;
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
        this._wordWrapCharCode = 32; // space character

        // Outline properties (Phase 5.4)
        this._outlineWidth = 0;
        this._outlineColor = { r: 0, g: 0, b: 0, a: 0 };

        // Shadow properties (Phase 5.4)
        this._shadowOffset = { x: 0, y: 0 };
        this._shadowColor = { r: 0, g: 0, b: 0 };
        this._shadowAlpha = 0.5;

        // Character layout data (not GameObjects!)
        this._characters = [];
        this.needsRebuild = true;

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
        this._pxRange = 4;

        // Get texture wrapper from Phaser's texture cache
        const frame = scene.sys.textures.getFrame(font.textureKey);
        if (frame && frame.glTexture) {
            this._texture = frame.glTexture;
        } else {
            console.warn(`MSDFText: Could not get texture wrapper for '${font.textureKey}'`);
        }

        // Get MSDF distance range parameter
        this._pxRange = font.distanceField.distanceRange;

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
     * Set the text content
     */
    setText: function (text: string) {
        if (this._text !== text) {
            this._text = text;
            this.needsRebuild = true;
        }
        return this;
    },

    /**
     * Get the text content
     */
    getText: function (): string {
        return this._text;
    },

    /**
     * Set font size
     */
    setFontSize: function (size: number) {
        if (this._fontSize !== size) {
            this._fontSize = size;
            this.needsRebuild = true;
        }
        return this;
    },

    /**
     * Get font size
     */
    getFontSize: function (): number {
        return this._fontSize;
    },

    /**
     * Set text color (0-255 range)
     */
    setColor: function (r: number, g: number, b: number, a: number = 255) {
        this._color = {
            r: r / 255,
            g: g / 255,
            b: b / 255,
            a: a / 255
        };
        return this;
    },

    /**
     * Set text color from hex string
     */
    setColorHex: function (hex: string, alpha: number = 1) {
        const rgb = Phaser.Display.Color.HexStringToColor(hex);
        this._color = {
            r: rgb.r / 255,
            g: rgb.g / 255,
            b: rgb.b / 255,
            a: alpha
        };
        return this;
    },

    /**
     * Set text alignment
     */
    setAlign: function (align: TextAlign) {
        if (this._align !== align) {
            this._align = align;
            this.needsRebuild = true;
        }
        return this;
    },

    /**
     * Set line spacing
     */
    setLineSpacing: function (spacing: number) {
        if (this._lineSpacing !== spacing) {
            this._lineSpacing = spacing;
            this.needsRebuild = true;
        }
        return this;
    },

    /**
     * Set maximum text width for word wrapping
     * @param width Maximum width in pixels (0 = no wrapping)
     */
    setMaxWidth: function (width: number) {
        if (this._maxWidth !== width) {
            this._maxWidth = width;
            this.needsRebuild = true;
        }
        return this;
    },

    /**
     * Get maximum text width for word wrapping
     */
    getMaxWidth: function (): number {
        return this._maxWidth;
    },

    /**
     * Set word wrap character code
     * @param charCode Character code to wrap on (default: 32 for space)
     */
    setWordWrapCharCode: function (charCode: number) {
        if (this._wordWrapCharCode !== charCode) {
            this._wordWrapCharCode = charCode;
            this.needsRebuild = true;
        }
        return this;
    },

    /**
     * Get word wrap character code
     */
    getWordWrapCharCode: function (): number {
        return this._wordWrapCharCode;
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
     * Set outline for the text
     * @param width Outline width in distance field units
     * @param color Outline color as 0xRRGGBB
     * @param alpha Outline alpha (0-1)
     */
    setOutline: function (width: number, color: number, alpha: number = 1) {
        this._outlineWidth = width;
        const r = ((color >> 16) & 0xFF) / 255;
        const g = ((color >> 8) & 0xFF) / 255;
        const b = (color & 0xFF) / 255;
        this._outlineColor = { r, g, b, a: alpha };
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
     * Set shadow for the text
     * @param offsetX Shadow X offset in pixels
     * @param offsetY Shadow Y offset in pixels
     * @param color Shadow color as 0xRRGGBB
     * @param alpha Shadow alpha (0-1)
     */
    setShadow: function (offsetX: number, offsetY: number, color: number = 0x000000, alpha: number = 0.5) {
        this._shadowOffset = { x: offsetX, y: offsetY };
        const r = ((color >> 16) & 0xFF) / 255;
        const g = ((color >> 8) & 0xFF) / 255;
        const b = (color & 0xFF) / 255;
        this._shadowColor = { r, g, b };
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
                if (charCode === this._wordWrapCharCode) {
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
    },

    // ========================================================================
    // Debug
    // ========================================================================

    /**
     * Get debug information
     */
    getDebugInfo: function (): string {
        return [
            `Text: "${this._text}"`,
            `Font: ${this.font.face}`,
            `Size: ${this._fontSize}px`,
            `Characters: ${this._characters.length}`,
            `Bounds: ${this.getTextWidth().toFixed(1)}x${this.getTextHeight().toFixed(1)}`,
            `Align: ${this._align}`,
            `Color: rgba(${(this._color.r * 255).toFixed(0)}, ${(this._color.g * 255).toFixed(0)}, ${(this._color.b * 255).toFixed(0)}, ${this._color.a.toFixed(2)})`
        ].join('\n');
    },

    /**
     * Print debug info to console
     */
    printDebugInfo: function () {
        // Debug method intentionally left empty - use getDebugInfo() instead
    }

});
