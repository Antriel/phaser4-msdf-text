/**
 * MSDFFont
 *
 * Container for MSDF font data and texture atlas.
 * Provides utilities for character lookup, kerning, and text measurement.
 */

import { MSDFFontData, MSDFCharacter } from './MSDFFontParser';

/**
 * Per-character font-size multipliers, parallel to the string being measured
 * (`null` = a uniform size everywhere, the common case). Rich-text `fontScale`
 * runs produce one of these; see `MSDFText.buildSizeScales`.
 */
export type SizeScales = ArrayLike<number> | null;

/**
 * The largest multiplier over `[from, to)`. An empty span (a blank line) has no
 * runs on it, so it takes the object's own size.
 */
function maxScaleIn(scales: SizeScales, from: number, to: number): number {
    if (!scales) return 1;
    let max = 0;
    for (let i = from; i < to; i++) {
        if (scales[i] > max) max = scales[i];
    }
    return max > 0 ? max : 1;
}

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
     * Width of `text[from, to)` laid out at `fontSize`, honouring per-character
     * size multipliers. This is the single primitive both `measureText` and
     * `measureLines` walk, and it mirrors the advance/kerning arithmetic of
     * `MSDFText.rebuildText` exactly — the two must agree or wrapped lines will
     * not match their measured widths.
     *
     * Kerning is applied only *within* a run of equal size: a kern pair spanning
     * a size change is ambiguous (whose size scales it?), so it is skipped.
     *
     * @param scales Multipliers indexed by absolute position in `text`, or `null`.
     */
    private measureSpan(
        text: string,
        from: number,
        to: number,
        fontSize: number,
        letterSpacing: number,
        scales: SizeScales
    ): number {
        let width = 0;
        let prevCharCode = 0;
        let prevScale = 1;
        let count = 0;

        for (let i = from; i < to; i++) {
            const charCode = text.charCodeAt(i);
            const char = this.getChar(charCode);

            if (!char) {
                // Character not in font, skip
                prevCharCode = 0;
                continue;
            }

            const scale = scales ? scales[i] : 1;
            const size = fontSize * scale;

            // Add kerning with previous character (same-size runs only)
            if (prevCharCode !== 0 && scale === prevScale) {
                width += this.getKerning(prevCharCode, charCode) * size;
            }

            // Add advance
            width += char.xAdvance * size;

            prevCharCode = charCode;
            prevScale = scale;
            count++;
        }

        // Letter spacing is added after every character's advance (matching
        // BitmapText), so a measured width includes a trailing slot. It is a
        // constant pixel amount and does not scale with a run's size.
        if (letterSpacing !== 0 && count > 0) {
            width += letterSpacing * count;
        }

        return width;
    }

    /**
     * Measure the width of a text string at a given font size.
     * @param letterSpacing Extra pixels added after every character (in pixel units, not scaled).
     * @param scales Optional per-character size multipliers, parallel to `text`.
     */
    measureText(
        text: string,
        fontSize: number,
        letterSpacing: number = 0,
        scales: SizeScales = null
    ): { width: number; height: number } {
        const n = text ? text.length : 0;
        if (n === 0) {
            return { width: 0, height: fontSize * this.data.lineHeight };
        }

        return {
            width: this.measureSpan(text, 0, n, fontSize, letterSpacing, scales),
            height: fontSize * this.data.lineHeight * maxScaleIn(scales, 0, n)
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

    /**
     * Measure lines with detailed information.
     *
     * With `scales`, line metrics become **variable**: a line's box height and
     * ascent both take the largest size on that line, and every glyph on it sits
     * on the resulting shared `baselines[i]`. Mixed-size runs therefore align by
     * baseline, not by top — the reason this returns baselines at all, rather
     * than leaving the caller to derive them from a uniform line height.
     *
     * @param scales Optional per-character size multipliers, parallel to `text`.
     * @returns Detailed line measurement data, including each line's baseline Y
     *   measured from the top of the text block.
     */
    measureLines(
        text: string,
        fontSize: number,
        lineSpacing: number = 0,
        letterSpacing: number = 0,
        scales: SizeScales = null
    ): {
        lines: string[];
        widths: number[];
        baselines: number[];
        totalWidth: number;
        totalHeight: number;
        shortest: number;
        longest: number;
    } {
        const lines = text.split('\n');
        const widths: number[] = [];
        const baselines: number[] = [];
        let maxWidth = 0;
        let minWidth = Infinity;

        // Absolute Y of the current line's top edge, walking down the block.
        let top = 0;
        // Absolute index of the current line's first character in `text`.
        let start = 0;

        for (const line of lines) {
            const end = start + line.length;

            const width = this.measureSpan(text, start, end, fontSize, letterSpacing, scales);
            widths.push(width);
            maxWidth = Math.max(maxWidth, width);
            if (line.length > 0) {
                minWidth = Math.min(minWidth, width);
            }

            const scale = maxScaleIn(scales, start, end);
            baselines.push(top + this.getAscender(fontSize) * scale);
            top += this.getLineHeight(fontSize) * scale + lineSpacing;

            start = end + 1; // skip the '\n' that split() consumed
        }

        if (minWidth === Infinity) {
            minWidth = 0;
        }

        // `top` overshot by one trailing lineSpacing; there are always >= 1 lines.
        const totalHeight = top - lineSpacing;

        return {
            lines,
            widths,
            baselines,
            totalWidth: maxWidth,
            totalHeight,
            shortest: minWidth,
            longest: maxWidth
        };
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

}
