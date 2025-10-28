/**
 * MSDFFont
 *
 * Container for MSDF font data and texture atlas.
 * Provides utilities for character lookup, kerning, and text measurement.
 */

import { MSDFFontData, MSDFCharacter } from './MSDFFontParser';

export class MSDFFont {
    /** Font data from parser */
    public readonly data: MSDFFontData;

    /** Texture key in Phaser's texture manager */
    public readonly textureKey: string;

    /** Base font size (from generation) */
    public readonly baseSize: number;

    constructor(fontData: MSDFFontData, textureKey: string) {
        this.data = fontData;
        this.textureKey = textureKey;
        this.baseSize = fontData.pointSize;
    }

    // ========================================================================
    // Character Access
    // ========================================================================

    /**
     * Get character data by Unicode code point
     */
    getChar(charCode: number): MSDFCharacter | undefined {
        return this.data.chars.get(charCode);
    }

    /**
     * Get character data by string character
     */
    getCharFromString(char: string): MSDFCharacter | undefined {
        if (char.length === 0) return undefined;
        return this.getChar(char.charCodeAt(0));
    }

    /**
     * Check if font has a character
     */
    hasChar(charCode: number): boolean {
        return this.data.chars.has(charCode);
    }

    // ========================================================================
    // Kerning
    // ========================================================================

    /**
     * Get kerning adjustment between two characters
     * @returns Normalized kerning amount (multiply by font size)
     */
    getKerning(firstCharCode: number, secondCharCode: number): number {
        const char = this.data.chars.get(firstCharCode);
        if (!char) return 0;
        return char.kerning.get(secondCharCode) || 0;
    }

    /**
     * Get kerning between two string characters
     */
    getKerningFromString(first: string, second: string): number {
        if (first.length === 0 || second.length === 0) return 0;
        return this.getKerning(first.charCodeAt(0), second.charCodeAt(0));
    }

    // ========================================================================
    // Text Measurement
    // ========================================================================

    /**
     * Measure the width of a text string at a given font size
     */
    measureText(text: string, fontSize: number): { width: number; height: number } {
        if (!text || text.length === 0) {
            return { width: 0, height: fontSize * this.data.lineHeight };
        }

        let width = 0;
        let prevCharCode = 0;

        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            const char = this.getChar(charCode);

            if (!char) {
                // Character not in font, skip
                prevCharCode = 0;
                continue;
            }

            // Add advance
            width += char.xAdvance * fontSize;

            // Add kerning with previous character
            if (prevCharCode !== 0) {
                width += this.getKerning(prevCharCode, charCode) * fontSize;
            }

            prevCharCode = charCode;
        }

        return {
            width: width,
            height: fontSize * this.data.lineHeight
        };
    }

    /**
     * Measure multiple lines of text
     */
    measureMultilineText(
        lines: string[],
        fontSize: number,
        lineSpacing: number = 0
    ): { width: number; height: number } {
        if (lines.length === 0) {
            return { width: 0, height: 0 };
        }

        let maxWidth = 0;

        for (const line of lines) {
            const { width } = this.measureText(line, fontSize);
            maxWidth = Math.max(maxWidth, width);
        }

        const lineHeight = fontSize * this.data.lineHeight;
        const totalHeight = lineHeight * lines.length + lineSpacing * (lines.length - 1);

        return { width: maxWidth, height: totalHeight };
    }

    // ========================================================================
    // Layout Utilities
    // ========================================================================

    /**
     * Get the line height at a specific font size
     */
    getLineHeight(fontSize: number): number {
        return fontSize * this.data.lineHeight;
    }

    /**
     * Get the ascender height at a specific font size
     */
    getAscender(fontSize: number): number {
        return Math.abs(fontSize * this.data.ascender);
    }

    /**
     * Get the descender height at a specific font size
     */
    getDescender(fontSize: number): number {
        return fontSize * this.data.descender;
    }

    /**
     * Get baseline offset from top at a specific font size
     */
    getBaselineOffset(fontSize: number): number {
        return this.getAscender(fontSize);
    }

    // ========================================================================
    // Font Info
    // ========================================================================

    /**
     * Get font face name
     */
    get face(): string {
        return this.data.face;
    }

    /**
     * Get distance field configuration
     */
    get distanceField() {
        return this.data.distanceField;
    }

    /**
     * Get atlas dimensions
     */
    get atlasSize(): { width: number; height: number } {
        return {
            width: this.data.atlasWidth,
            height: this.data.atlasHeight
        };
    }

    /**
     * Get character count
     */
    get charCount(): number {
        return this.data.chars.size;
    }

    // ========================================================================
    // Debug
    // ========================================================================

    /**
     * Get debug information about the font
     */
    getDebugInfo(): string {
        return [
            `Font: ${this.face}`,
            `Base Size: ${this.baseSize}px`,
            `Line Height: ${this.data.lineHeight.toFixed(3)}`,
            `Characters: ${this.charCount}`,
            `Atlas: ${this.data.atlasWidth}x${this.data.atlasHeight}`,
            `Distance Field: ${this.data.distanceField.fieldType}`,
            `Distance Range: ${this.data.distanceField.distanceRange}`
        ].join('\n');
    }

    /**
     * Print debug info to console
     */
    printDebugInfo(): void {
        // Debug method intentionally left empty - use getDebugInfo() instead
    }
}
