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
 * Root JSON structure from msdf-atlas-gen
 */
export interface MSDFFontJSON {
    atlas: MSDFAtlasData;
    metrics: MSDFMetrics;
    glyphs: MSDFGlyphData[];
    kerning?: MSDFKerningData[];
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
 * Convert normalized coordinates to UV coordinates
 */
function planeBoundsToUV(
    planeBounds: MSDFPlaneBounds,
    atlasBounds: MSDFAtlasBounds,
    atlasWidth: number,
    atlasHeight: number,
    yOrigin: 'top' | 'bottom'
): { u0: number; v0: number; u1: number; v1: number } {
    const u0 = atlasBounds.left / atlasWidth;
    const u1 = atlasBounds.right / atlasWidth;

    // IMPORTANT: Phaser's texture coordinates are always bottom-up (OpenGL convention)
    // regardless of what yOrigin says in the JSON. We need to flip V coordinates.
    const v0 = 1 - (atlasBounds.bottom / atlasHeight);
    const v1 = 1 - (atlasBounds.top / atlasHeight);

    return { u0, v0, u1, v1 };
}

/**
 * Parse MSDF JSON font data into runtime format
 *
 * @param json - The parsed JSON data from msdf-atlas-gen
 * @param fontName - Optional font name (defaults to 'MSDF Font')
 * @returns Parsed font data ready for rendering
 */
export function parseMSDFFont(json: MSDFFontJSON, fontName: string = 'MSDF Font'): MSDFFontData {
    const { atlas, metrics, glyphs, kerning = [] } = json;

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
        const uvs = planeBoundsToUV(
            planeBounds,
            atlasBounds,
            atlas.width,
            atlas.height,
            atlas.yOrigin
        );

        // Calculate pixel dimensions (atlas)
        const width = atlasBounds.right - atlasBounds.left;
        const height = atlasBounds.bottom - atlasBounds.top;

        // Calculate normalized dimensions (from planeBounds)
        const normalizedWidth = planeBounds.right - planeBounds.left;
        const normalizedHeight = planeBounds.bottom - planeBounds.top;

        chars.set(unicode, {
            id: unicode,
            x: atlasBounds.left,
            y: atlasBounds.top,
            width: width,
            height: height,
            normalizedWidth: normalizedWidth,
            normalizedHeight: normalizedHeight,
            xOffset: planeBounds.left,
            yOffset: planeBounds.top,
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

    // Build font data
    const fontData: MSDFFontData = {
        face: fontName,
        pointSize: atlas.size,
        lineHeight: metrics.lineHeight,
        emSize: metrics.emSize,
        ascender: metrics.ascender,
        descender: metrics.descender,
        underlineY: metrics.underlineY,
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
