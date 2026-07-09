/**
 * MSDF Font Parser
 *
 * Parses JSON font data from msdf-atlas-gen into a runtime-optimized format
 * for use with MSDF text rendering in Phaser 4.
 */

// ============================================================================
// JSON Format Types (from msdf-atlas-gen)
// ============================================================================

/**
 * Atlas metadata from msdf-atlas-gen
 */
export interface MSDFAtlasData {
    type: 'msdf' | 'mtsdf' | 'sdf';
    distanceRange: number;
    distanceRangeMiddle?: number;
    size: number;              // Base font size used during generation
    width: number;             // Atlas texture width
    height: number;            // Atlas texture height
    yOrigin: 'top' | 'bottom'; // Coordinate system origin
}

/**
 * Font metrics (normalized to em size)
 */
export interface MSDFMetrics {
    emSize: number;                  // Typically 1
    lineHeight: number;              // Line height (normalized)
    ascender: number;                // Distance from baseline to top
    descender: number;               // Distance from baseline to bottom
    underlineY: number;              // Underline position
    underlineThickness: number;      // Underline thickness
}

/**
 * Glyph bounds in plane coordinates (normalized)
 */
export interface MSDFPlaneBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * Glyph bounds in atlas texture (pixels)
 */
export interface MSDFAtlasBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * Single glyph definition from JSON
 */
export interface MSDFGlyphData {
    unicode: number;                     // Unicode code point
    advance: number;                     // Horizontal advance (normalized)
    planeBounds?: MSDFPlaneBounds;      // Glyph geometry bounds (optional for space)
    atlasBounds?: MSDFAtlasBounds;      // Texture atlas bounds (optional for space)
}

/**
 * Kerning pair definition
 */
export interface MSDFKerningData {
    unicode1: number;  // First character code
    unicode2: number;  // Second character code
    advance: number;   // Kerning adjustment (normalized)
}

/**
 * One font's data within a merged (`-and`) atlas. `name` comes from that
 * font's `-fontname` at generation time; msdf-atlas-gen omits it if unset.
 */
export interface MSDFFontVariantJSON {
    name?: string;
    metrics: MSDFMetrics;
    glyphs: MSDFGlyphData[];
    kerning?: MSDFKerningData[];
}

/**
 * Root JSON structure from msdf-atlas-gen.
 *
 * A single-font atlas carries `metrics`/`glyphs`/`kerning` at the top level.
 * An atlas generated from several `-font ... -and -font ...` inputs shares one
 * `atlas` block but carries a `variants` array instead — one entry per input
 * font, packed into the same texture.
 */
export interface MSDFFontJSON {
    atlas: MSDFAtlasData;
    metrics?: MSDFMetrics;
    glyphs?: MSDFGlyphData[];
    kerning?: MSDFKerningData[];
    variants?: MSDFFontVariantJSON[];
}

// ============================================================================
// Runtime Font Data Types (optimized for rendering)
// ============================================================================

/**
 * Distance field configuration for MSDF rendering
 */
export interface MSDFDistanceFieldConfig {
    fieldType: 'msdf' | 'mtsdf' | 'sdf';
    distanceRange: number;        // Must match shader uniform
    distanceRangeMiddle?: number;
}

/**
 * Runtime character data with pre-calculated texture coordinates
 */
export interface MSDFCharacter {
    // Character identity
    id: number;                   // Unicode code point

    // Texture atlas position (pixels)
    x: number;
    y: number;
    width: number;                // Atlas width in pixels
    height: number;               // Atlas height in pixels

    // Normalized glyph dimensions (multiply by fontSize for actual size)
    normalizedWidth: number;      // Width in em units
    normalizedHeight: number;     // Height in em units

    // Layout metrics (normalized to font size)
    xOffset: number;              // Horizontal offset from cursor
    yOffset: number;              // Vertical offset from baseline
    xAdvance: number;             // Cursor advance after character

    // Pre-calculated UV coordinates (0-1 range)
    u0: number;
    v0: number;
    u1: number;
    v1: number;

    // Kerning lookup for this character
    kerning: Map<number, number>; // Map<secondCharCode, amount>
}

/**
 * Complete runtime font data
 */
export interface MSDFFontData {
    // Font metadata
    face: string;                           // Font name
    pointSize: number;                      // Base font size in points
    lineHeight: number;                     // Line height (pixels at base size)

    // Extended metrics
    emSize: number;
    ascender: number;
    descender: number;
    underlineY: number;
    underlineThickness: number;

    // Atlas info
    atlasWidth: number;
    atlasHeight: number;
    yOrigin: 'top' | 'bottom';

    // Character data
    chars: Map<number, MSDFCharacter>;     // Map by Unicode code point

    // MSDF configuration
    distanceField: MSDFDistanceFieldConfig;
}

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Convert atlas pixel bounds to OpenGL UV coordinates.
 *
 * Output is always semantically (v0 = bottom of glyph in texture, v1 = top of glyph),
 * with v0 < v1, regardless of the source yOrigin.
 *
 * - yOrigin "top": atlas pixel Y grows downward, so we flip with `1 - y/H`.
 * - yOrigin "bottom": atlas pixel Y already matches OpenGL UV (Y up); no flip.
 *
 * UVs use atlasBounds directly. Neighbour-pixel bleed under LINEAR filtering is
 * controlled by giving each glyph enough gutter at atlas-generation time
 * (msdf-atlas-gen `-pxpadding` / `-outerpxpadding`); see FONTS.md.
 */
function atlasBoundsToUV(
    atlasBounds: MSDFAtlasBounds,
    atlasWidth: number,
    atlasHeight: number,
    yOrigin: 'top' | 'bottom'
): { u0: number; v0: number; u1: number; v1: number } {
    const u0 = atlasBounds.left / atlasWidth;
    const u1 = atlasBounds.right / atlasWidth;

    let v0: number;
    let v1: number;
    if (yOrigin === 'top') {
        v0 = 1 - (atlasBounds.bottom / atlasHeight);
        v1 = 1 - (atlasBounds.top / atlasHeight);
    } else {
        v0 = atlasBounds.bottom / atlasHeight;
        v1 = atlasBounds.top / atlasHeight;
    }

    return { u0, v0, u1, v1 };
}

/**
 * Parse one variant's glyph/metrics data (already resolved against the shared
 * `atlas` block) into runtime format. Shared by `parseMSDFFont` (single-font
 * JSON) and `parseMSDFFontSet` (one call per variant of a merged atlas).
 */
function parseVariant(atlas: MSDFAtlasData, variant: MSDFFontVariantJSON, fontName: string): MSDFFontData {
    const { metrics, glyphs, kerning = [] } = variant;
    const isYUp = atlas.yOrigin === 'bottom';

    // Initialize character map
    const chars = new Map<number, MSDFCharacter>();

    // Parse glyphs
    for (const glyph of glyphs) {
        const { unicode, advance, planeBounds, atlasBounds } = glyph;

        // Handle space character (no visual bounds)
        if (!planeBounds || !atlasBounds) {
            chars.set(unicode, {
                id: unicode,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                normalizedWidth: 0,
                normalizedHeight: 0,
                xOffset: 0,
                yOffset: 0,
                xAdvance: advance,
                u0: 0,
                v0: 0,
                u1: 0,
                v1: 0,
                kerning: new Map()
            });
            continue;
        }

        // Calculate texture coordinates
        const uvs = atlasBoundsToUV(
            atlasBounds,
            atlas.width,
            atlas.height,
            atlas.yOrigin
        );

        // Calculate pixel dimensions (atlas).
        // With yOrigin=bottom, atlasBounds.top > atlasBounds.bottom, so swap order to stay positive.
        const width = Math.abs(atlasBounds.right - atlasBounds.left);
        const height = Math.abs(atlasBounds.bottom - atlasBounds.top);

        // Calculate normalized dimensions and yOffset, normalized to Y-down convention.
        // Y-down (yOrigin=top): planeBounds.top is negative for above-baseline glyphs,
        //   normalizedHeight = bottom - top.
        // Y-up (yOrigin=bottom): planeBounds.top is positive for above-baseline glyphs,
        //   normalizedHeight = top - bottom; negate top to convert to Y-down.
        const normalizedWidth = planeBounds.right - planeBounds.left;
        const normalizedHeight = isYUp
            ? planeBounds.top - planeBounds.bottom
            : planeBounds.bottom - planeBounds.top;
        const yOffset = isYUp ? -planeBounds.top : planeBounds.top;

        chars.set(unicode, {
            id: unicode,
            x: Math.min(atlasBounds.left, atlasBounds.right),
            y: Math.min(atlasBounds.top, atlasBounds.bottom),
            width: width,
            height: height,
            normalizedWidth: normalizedWidth,
            normalizedHeight: normalizedHeight,
            xOffset: planeBounds.left,
            yOffset: yOffset,
            xAdvance: advance,
            u0: uvs.u0,
            v0: uvs.v0,
            u1: uvs.u1,
            v1: uvs.v1,
            kerning: new Map()
        });
    }

    // Parse kerning pairs
    for (const kern of kerning) {
        const char = chars.get(kern.unicode1);
        if (char) {
            char.kerning.set(kern.unicode2, kern.advance);
        }
    }

    // Normalize vertical metrics to Y-down convention so consumers can treat all fonts uniformly.
    // In Y-down: ascender is negative (above baseline), descender/underlineY are positive (below baseline).
    const verticalSign = isYUp ? -1 : 1;

    // Build font data
    const fontData: MSDFFontData = {
        face: fontName,
        pointSize: atlas.size,
        lineHeight: metrics.lineHeight,
        emSize: metrics.emSize,
        ascender: verticalSign * metrics.ascender,
        descender: verticalSign * metrics.descender,
        underlineY: verticalSign * metrics.underlineY,
        underlineThickness: metrics.underlineThickness,
        atlasWidth: atlas.width,
        atlasHeight: atlas.height,
        yOrigin: atlas.yOrigin,
        chars: chars,
        distanceField: {
            fieldType: atlas.type,
            distanceRange: atlas.distanceRange,
            distanceRangeMiddle: atlas.distanceRangeMiddle
        }
    };

    return fontData;
}

/**
 * Parse a single-font MSDF JSON (from msdf-atlas-gen) into runtime format.
 *
 * @param json - The parsed JSON data from msdf-atlas-gen
 * @param fontName - Optional font name (defaults to 'MSDF Font')
 * @returns Parsed font data ready for rendering
 */
export function parseMSDFFont(json: MSDFFontJSON, fontName: string = 'MSDF Font'): MSDFFontData {
    if (json.variants) {
        throw new Error(
            `parseMSDFFont: "${fontName}" is a merged atlas (multiple -and inputs) — use parseMSDFFontSet to get one MSDFFontData per variant.`
        );
    }
    return parseVariant(json.atlas, { metrics: json.metrics!, glyphs: json.glyphs!, kerning: json.kerning }, fontName);
}

/** One font extracted from a `parseMSDFFontSet` call, named for cache registration. */
export interface MSDFFontSetEntry {
    name: string;
    data: MSDFFontData;
}

/**
 * Parse an MSDF JSON that may contain several fonts merged into one atlas
 * (msdf-atlas-gen `-font a.ttf -and -font b.ttf ...`). Returns one entry per
 * font, all sharing the same atlas texture. A plain single-font JSON yields a
 * single entry, so callers can use this unconditionally.
 *
 * @param json - The parsed JSON data from msdf-atlas-gen
 * @param baseFontName - Name for a single-font JSON, or the fallback prefix
 *   for merged variants that were generated without `-fontname`
 */
export function parseMSDFFontSet(json: MSDFFontJSON, baseFontName: string = 'MSDF Font'): MSDFFontSetEntry[] {
    if (!json.variants) {
        return [{ name: baseFontName, data: parseMSDFFont(json, baseFontName) }];
    }
    return json.variants.map((variant, i) => {
        const name = variant.name || `${baseFontName}#${i}`;
        return { name, data: parseVariant(json.atlas, variant, name) };
    });
}

/**
 * Get kerning amount between two characters
 *
 * @param fontData - The parsed font data
 * @param firstCharCode - Unicode of first character
 * @param secondCharCode - Unicode of second character
 * @returns Kerning adjustment amount (normalized)
 */
export function getKerning(
    fontData: MSDFFontData,
    firstCharCode: number,
    secondCharCode: number
): number {
    const char = fontData.chars.get(firstCharCode);
    if (!char) return 0;

    return char.kerning.get(secondCharCode) || 0;
}

/**
 * Get character data by code point
 *
 * @param fontData - The parsed font data
 * @param charCode - Unicode code point
 * @returns Character data or undefined if not found
 */
export function getChar(fontData: MSDFFontData, charCode: number): MSDFCharacter | undefined {
    return fontData.chars.get(charCode);
}

/**
 * Check if a font has a specific character
 *
 * @param fontData - The parsed font data
 * @param charCode - Unicode code point
 * @returns True if character exists in font
 */
export function hasChar(fontData: MSDFFontData, charCode: number): boolean {
    return fontData.chars.has(charCode);
}
