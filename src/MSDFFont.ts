/**
 * MSDFFont
 *
 * Container for MSDF font data and texture atlas.
 * Provides utilities for character lookup, kerning, and text measurement.
 */

import { MSDFFontData, MSDFCharacter } from './MSDFFontParser';
import {
    lineMetrics,
    measureLines as measureLinesRuns,
    measureSpan,
    uniformRuns,
    type LayoutRuns,
    type LineMeasurement
} from './MSDFMeasure';

/**
 * Per-character font-size multipliers, parallel to the string being measured
 * (`null` = a uniform size everywhere, the common case). Rich-text `fontScale`
 * runs produce one of these; see `MSDFText.buildSizeScales`.
 */
export type SizeScales = ArrayLike<number> | null;

export class MSDFFont {
    /** Font data from parser */
    public readonly data: MSDFFontData;

    /** Texture key in Phaser's texture manager */
    public readonly textureKey: string;

    /** Base font size (from generation) */
    public readonly baseSize: number;

    /**
     * This font as a run source, for the single-font measurement helpers below.
     * Cached so they allocate nothing.
     */
    private readonly _runs: LayoutRuns;

    constructor(fontData: MSDFFontData, textureKey: string) {
        this.data = fontData;
        this.textureKey = textureKey;
        this.baseSize = fontData.pointSize;
        this._runs = uniformRuns(this);
    }

    /**
     * Wrap optional per-character size multipliers into a run source over this
     * one font. Returns the cached uniform runs when there are none.
     */
    private runs(scales: SizeScales): LayoutRuns {
        if (!scales) return this._runs;
        return { base: this, scales, fonts: null, fontList: null, padBefore: null, padAfter: null };
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
     * Measure the width of a text string at a given font size.
     *
     * Single-font convenience wrapper over `MSDFMeasure`. `MSDFText` calls the
     * run-aware primitives directly, since a rich-text object's characters can
     * each carry their own font.
     *
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

        const runs = this.runs(scales);
        return {
            width: measureSpan(text, 0, n, fontSize, letterSpacing, runs),
            height: lineMetrics(0, n, fontSize, runs).height
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
     * Single-font convenience wrapper over `MSDFMeasure.measureLines`. With
     * `scales`, line metrics become **variable**: a line's box height and ascent
     * both take the largest size on that line, and every glyph on it sits on the
     * resulting shared `baselines[i]`. Mixed-size runs therefore align by
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
    ): LineMeasurement {
        return measureLinesRuns(text, fontSize, lineSpacing, letterSpacing, this.runs(scales));
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
