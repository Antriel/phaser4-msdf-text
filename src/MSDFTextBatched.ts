/**
 * MSDFText GameObject (Batched Rendering)
 *
 * Renders text using MSDF (Multi-channel Signed Distance Field) fonts with
 * efficient batched rendering. All characters are rendered in 1-2 draw calls
 * instead of one draw call per character.
 *
 * This replaces the Container-based approach with a standalone GameObject
 * that uses custom WebGL batching via MSDFBatchHandler.
 *
 * Usage:
 *   const text = new MSDFText(scene, x, y, font, 'Hello World', fontSize);
 *   scene.add.existing(text);
 */

import Phaser from 'phaser';
import { MSDFFont } from './MSDFFont';
import MSDFTextWebGLRenderer from './MSDFTextWebGLRenderer.js';

export type TextAlign = 'left' | 'center' | 'right';

/**
 * Character layout data
 */
interface CharacterData {
    x: number;       // X position in text space
    y: number;       // Y position in text space
    w: number;       // Width
    h: number;       // Height
    u0: number;      // UV left
    v0: number;      // UV top
    u1: number;      // UV right
    v1: number;      // UV bottom
}

/**
 * MSDFText GameObject with batched rendering
 */
export class MSDFText extends Phaser.GameObjects.GameObject {
    // Position properties (GameObject doesn't include Transform by default)
    public x: number = 0;
    public y: number = 0;

    // Font and text properties
    private font: MSDFFont;
    public _text: string = '';
    public _fontSize: number = 42;
    public _color: { r: number; g: number; b: number; a: number } = { r: 1, g: 1, b: 1, a: 1 };
    private _align: TextAlign = 'left';
    private _lineSpacing: number = 0;

    // Character layout data (not GameObjects!)
    public _characters: CharacterData[] = [];
    private needsRebuild: boolean = true;

    // Texture and rendering
    public _texture: any = null; // WebGLTextureWrapper
    public _pxRange: number = 4;

    // Rendering properties (required by Phaser's renderer)
    public blendMode: number = 0; // NORMAL blend mode
    public alpha: number = 1.0;
    public tint: number = 0xffffff;
    public visible: boolean = true;

    // Render nodes for batched rendering (following Phaser's RenderNodes pattern)
    public customRenderNodes: any;
    public defaultRenderNodes: any;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        font: MSDFFont,
        text: string = '',
        fontSize: number = 42
    ) {
        super(scene, 'MSDFText');

        this.font = font;
        this._text = text;
        this._fontSize = fontSize;

        // Set position
        this.x = x;
        this.y = y;

        // Get texture wrapper from Phaser's texture cache
        const frame = scene.sys.textures.getFrame(font.textureKey);
        if (frame && frame.glTexture) {
            this._texture = frame.glTexture;
            console.log(`[MSDFText] Texture loaded:`, font.textureKey, this._texture);
        } else {
            console.warn(`MSDFText: Could not get texture wrapper for '${font.textureKey}'`);
            console.log('[MSDFText] Frame:', frame);
        }

        // Get MSDF distance range parameter
        this._pxRange = font.distanceField.distanceRange;

        // Configure render nodes for batching
        // Note: MSDFBatchHandler must be registered with RenderNodeManager first
        this.customRenderNodes = {};
        this.defaultRenderNodes = {};

        // Initialize render nodes (similar to Components.RenderNodes.initRenderNodes)
        const renderer = scene.sys.renderer;
        console.log('[MSDFText] Renderer:', renderer);
        if (renderer && renderer.renderNodes) {
            const manager = renderer.renderNodes;
            console.log('[MSDFText] RenderNodes manager:', manager);
            // Get the actual BatchHandler instance from the manager
            this.defaultRenderNodes['BatchHandler'] = manager.getNode('BatchHandlerMSDF');
            console.log('[MSDFText] BatchHandler:', this.defaultRenderNodes['BatchHandler']);
            // Also set up a Submitter (we can reuse SubmitterQuad)
            this.defaultRenderNodes['Submitter'] = manager.getNode('SubmitterQuad');
            console.log('[MSDFText] Submitter:', this.defaultRenderNodes['Submitter']);
        } else {
            console.warn('[MSDFText] Renderer or renderNodes not available!');
        }

        // Add to scene
        scene.add.existing(this);

        // Initial build
        this.rebuildText();
    }

    // ========================================================================
    // Position
    // ========================================================================

    /**
     * Set position
     */
    setPosition(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }

    // ========================================================================
    // Rendering Properties
    // ========================================================================

    /**
     * Set alpha/opacity (0-1)
     */
    setAlpha(value: number): this {
        this.alpha = value;
        return this;
    }

    /**
     * Set tint color (0xRRGGBB format)
     */
    setTint(value: number): this {
        this.tint = value;
        return this;
    }

    /**
     * Set blend mode
     */
    setBlendMode(value: number): this {
        this.blendMode = value;
        return this;
    }

    /**
     * Set visibility
     */
    setVisible(value: boolean): this {
        this.visible = value;
        return this;
    }

    // ========================================================================
    // Text Properties
    // ========================================================================

    /**
     * Set the text content
     */
    setText(text: string): this {
        if (this._text !== text) {
            this._text = text;
            this.needsRebuild = true;
        }
        return this;
    }

    /**
     * Get the text content
     */
    getText(): string {
        return this._text;
    }

    /**
     * Set font size
     */
    setFontSize(size: number): this {
        if (this._fontSize !== size) {
            this._fontSize = size;
            this.needsRebuild = true;
        }
        return this;
    }

    /**
     * Get font size
     */
    getFontSize(): number {
        return this._fontSize;
    }

    /**
     * Set text color (0-255 range)
     */
    setColor(r: number, g: number, b: number, a: number = 255): this {
        this._color = {
            r: r / 255,
            g: g / 255,
            b: b / 255,
            a: a / 255
        };
        // Color will be applied during rendering (no need to update individual shaders)
        return this;
    }

    /**
     * Set text color from hex string
     */
    setColorHex(hex: string, alpha: number = 1): this {
        const rgb = Phaser.Display.Color.HexStringToColor(hex);
        this._color = {
            r: rgb.r / 255,
            g: rgb.g / 255,
            b: rgb.b / 255,
            a: alpha
        };
        return this;
    }

    /**
     * Set text alignment
     */
    setAlign(align: TextAlign): this {
        if (this._align !== align) {
            this._align = align;
            this.needsRebuild = true;
        }
        return this;
    }

    /**
     * Set line spacing
     */
    setLineSpacing(spacing: number): this {
        if (this._lineSpacing !== spacing) {
            this._lineSpacing = spacing;
            this.needsRebuild = true;
        }
        return this;
    }

    // ========================================================================
    // Measurement
    // ========================================================================

    /**
     * Get the width of the rendered text
     */
    getTextWidth(): number {
        const { width } = this.font.measureText(this._text, this._fontSize);
        return width;
    }

    /**
     * Get the height of the rendered text
     */
    getTextHeight(): number {
        const { height } = this.font.measureText(this._text, this._fontSize);
        return height;
    }

    /**
     * Get text bounds
     */
    getTextBounds(): { width: number; height: number } {
        return this.font.measureText(this._text, this._fontSize);
    }

    // ========================================================================
    // Rendering
    // ========================================================================

    /**
     * WebGL rendering method
     * Called by Phaser's renderer when this GameObject needs to be drawn
     * Note: In Phaser's rendering pipeline, 'this' is NOT the GameObject - use 'src' instead
     */
    renderWebGL(renderer: any, src: this, drawingContext: any, parentMatrix: any): void {
        console.log('[MSDFText] renderWebGL called, characters:', src._characters.length, 'visible:', src.visible);

        // Rebuild if needed (use src, not this!)
        if (src.needsRebuild) {
            src.rebuildText();
            src.needsRebuild = false;
        }

        // Delegate to MSDFTextWebGLRenderer
        MSDFTextWebGLRenderer(renderer, src, drawingContext, parentMatrix);
    }

    /**
     * Rebuild character layout data
     * This calculates positions and UVs for all characters but doesn't create GameObjects
     */
    private rebuildText(): void {
        // Clear existing character data
        this.clearCharacters();

        if (!this._text || this._text.length === 0) {
            console.log('[MSDFText] rebuildText: No text to render');
            return;
        }

        console.log(`[MSDFText] rebuildText: Building "${this._text}" at size ${this._fontSize}`);

        // Layout characters
        let cursorX = 0;
        let cursorY = 0;
        let prevCharCode = 0;

        for (let i = 0; i < this._text.length; i++) {
            const charCode = this._text.charCodeAt(i);

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
            this._characters.push({
                x: charX,
                y: charY,
                w: charWidth,
                h: charHeight,
                u0: char.u0,
                v0: char.v0,
                u1: char.u1,
                v1: char.v1
            });

            // Advance cursor
            cursorX += char.xAdvance * this._fontSize;
            prevCharCode = charCode;
        }

        // Apply alignment
        this.applyAlignment();

        console.log(`[MSDFText] rebuildText: Created ${this._characters.length} character quads`);
    }

    /**
     * Apply text alignment to character positions
     */
    private applyAlignment(): void {
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
    }

    /**
     * Clear all character data
     */
    private clearCharacters(): void {
        this._characters = [];
    }

    // ========================================================================
    // Cleanup
    // ========================================================================

    /**
     * Destroy the text object
     */
    destroy(fromScene?: boolean): void {
        this.clearCharacters();
        super.destroy(fromScene);
    }

    // ========================================================================
    // Debug
    // ========================================================================

    /**
     * Get debug information
     */
    getDebugInfo(): string {
        return [
            `Text: "${this._text}"`,
            `Font: ${this.font.face}`,
            `Size: ${this._fontSize}px`,
            `Characters: ${this._characters.length}`,
            `Bounds: ${this.getTextWidth().toFixed(1)}x${this.getTextHeight().toFixed(1)}`,
            `Align: ${this._align}`,
            `Color: rgba(${(this._color.r * 255).toFixed(0)}, ${(this._color.g * 255).toFixed(0)}, ${(this._color.b * 255).toFixed(0)}, ${this._color.a.toFixed(2)})`
        ].join('\n');
    }

    /**
     * Print debug info to console
     */
    printDebugInfo(): void {
        console.log(this.getDebugInfo());
    }
}
