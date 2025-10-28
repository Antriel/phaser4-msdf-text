/**
 * MSDFText GameObject
 *
 * Renders text using MSDF (Multi-channel Signed Distance Field) fonts.
 * Each character is rendered as a shader quad with the MSDF fragment shader.
 *
 * Usage:
 *   const text = new MSDFText(scene, x, y, font, 'Hello World', fontSize);
 *   scene.add.existing(text);
 */

import Phaser from 'phaser';
import { MSDFFont } from './MSDFFont';
import { createMSDFShaderConfig, MSDF_SHADER_KEYS } from './MSDFShader';

export type TextAlign = 'left' | 'center' | 'right';

interface CharacterQuad {
    shader: Phaser.GameObjects.Shader;
    charCode: number;
}

export class MSDFText extends Phaser.GameObjects.Container {
    private font: MSDFFont;
    private _text: string = '';
    private _fontSize: number = 42;
    private _color: { r: number; g: number; b: number; a: number } = { r: 1, g: 1, b: 1, a: 1 };
    private _align: TextAlign = 'left';
    private _lineSpacing: number = 0;

    private characterQuads: CharacterQuad[] = [];
    private needsRebuild: boolean = true;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        font: MSDFFont,
        text: string = '',
        fontSize: number = 42
    ) {
        super(scene, x, y);

        this.font = font;
        this._text = text;
        this._fontSize = fontSize;

        // Add to scene
        scene.add.existing(this);

        // Initial build
        this.rebuildText();
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
        this.updateCharacterColors();
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
        this.updateCharacterColors();
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
     * Update loop - rebuild if needed
     */
    preUpdate(): void {
        if (this.needsRebuild) {
            this.rebuildText();
            this.needsRebuild = false;
        }
    }

    /**
     * Rebuild all character quads
     */
    private rebuildText(): void {
        // Clear existing quads
        this.clearCharacters();

        if (!this._text || this._text.length === 0) {
            return;
        }

        // Calculate scale factor (fontSize / baseSize)
        const scale = this._fontSize / this.font.baseSize;

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
            // Fallback to pixel dimensions if normalized not available (shouldn't happen)
            const charWidth = (char.normalizedWidth || (char.width / this.font.baseSize)) * this._fontSize;
            const charHeight = (char.normalizedHeight || (char.height / this.font.baseSize)) * this._fontSize;

            if (!char.normalizedWidth) {
                console.warn(`Character ${String.fromCharCode(charCode)} missing normalizedWidth! Font may need re-parsing.`);
            }

            // Create shader config with character-specific UVs
            // IMPORTANT: Each character needs its own config so setupUniforms
            // sets the correct uCharUV for this specific character
            const charShaderConfig = createMSDFShaderConfig({
                name: `MSDFChar_${charCode}_${i}`,
                textureWidth: this.font.data.atlasWidth,
                textureHeight: this.font.data.atlasHeight,
                distanceRange: this.font.distanceField.distanceRange,
                fragmentKey: MSDF_SHADER_KEYS.FRAGMENT,
                textColor: [this._color.r, this._color.g, this._color.b, this._color.a],
                charUV: [char.u0, char.v0, char.u1, char.v1] // Character-specific UVs!
            });
            delete charShaderConfig.vertexKey; // Use default vertex shader

            // Create shader for this character
            const shader = this.scene.add.shader(
                charShaderConfig,
                charX + charWidth / 2,  // Center X
                charY + charHeight / 2, // Center Y
                charWidth,
                charHeight,
                [this.font.textureKey]
            );

            // Add as child
            this.add(shader);

            // Store reference
            this.characterQuads.push({
                shader: shader,
                charCode: charCode
            });

            // Advance cursor
            cursorX += char.xAdvance * this._fontSize;
            prevCharCode = charCode;
        }

        // Apply alignment
        this.applyAlignment();
    }

    /**
     * Apply text alignment to character quads
     */
    private applyAlignment(): void {
        if (this._align === 'left' || this.characterQuads.length === 0) {
            return;
        }

        const textWidth = this.getTextWidth();
        let offset = 0;

        if (this._align === 'center') {
            offset = -textWidth / 2;
        } else if (this._align === 'right') {
            offset = -textWidth;
        }

        // Offset all characters
        for (const quad of this.characterQuads) {
            quad.shader.x += offset;
        }
    }

    /**
     * Update color uniforms on all character shaders
     */
    private updateCharacterColors(): void {
        const color = [this._color.r, this._color.g, this._color.b, this._color.a];

        for (const quad of this.characterQuads) {
            if (quad.shader.shader) {
                quad.shader.setUniform('uTextColor.value', color);
            }
        }
    }

    /**
     * Clear all character quads
     */
    private clearCharacters(): void {
        // Destroy all shader objects
        for (const quad of this.characterQuads) {
            quad.shader.destroy();
        }

        // Clear array
        this.characterQuads = [];

        // Remove all children
        this.removeAll();
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
            `Characters: ${this.characterQuads.length}`,
            `Bounds: ${this.getTextWidth().toFixed(1)}x${this.getTextHeight().toFixed(1)}`,
            `Align: ${this._align}`,
            `Color: rgba(${(this._color.r * 255).toFixed(0)}, ${(this._color.g * 255).toFixed(0)}, ${(this._color.b * 255).toFixed(0)}, ${this._color.a.toFixed(2)})`
        ].join('\n');
    }

    /**
     * Print debug info to console
     */
    printDebugInfo(): void {
        // Debug method intentionally left empty - use getDebugInfo() instead
    }
}
