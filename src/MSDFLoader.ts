/**
 * MSDFLoader
 *
 * Utility for loading MSDF font assets in Phaser 4.
 * Provides a cleaner API for loading both the texture and metadata files.
 *
 * Usage:
 *   preload() {
 *     loadMSDFFont(this, 'arial', 'assets/fonts/Arial');
 *   }
 *
 *   create() {
 *     const font = getMSDFFont(this, 'arial');
 *     const text = new MSDFText(this, 100, 100, font, 'Hello!', 48);
 *   }
 */

import type Phaser from 'phaser';
import { loadMSDFShaders } from './MSDFShader';
import { parseMSDFFont, MSDFFontJSON } from './MSDFFontParser';
import { MSDFFont } from './MSDFFont';

// ============================================================================
// Internal Cache for MSDFFont instances
// ============================================================================

/**
 * Internal cache key for storing MSDFFont instances
 */
const MSDF_FONT_CACHE_KEY = '__msdf_fonts__';

/**
 * Get the internal font cache from the scene's data manager
 */
function getFontCache(scene: Phaser.Scene): Map<string, MSDFFont> {
    if (!scene.data.has(MSDF_FONT_CACHE_KEY)) {
        scene.data.set(MSDF_FONT_CACHE_KEY, new Map<string, MSDFFont>());
    }
    return scene.data.get(MSDF_FONT_CACHE_KEY) as Map<string, MSDFFont>;
}

// ============================================================================
// Loader Configuration
// ============================================================================

export interface MSDFLoadConfig {
    /** Base path to the font files (without extension) */
    basePath: string;

    /** Optional: Custom texture key (defaults to `${key}-texture`) */
    textureKey?: string;

    /** Optional: Custom JSON data key (defaults to `${key}-data`) */
    dataKey?: string;

    /** Optional: Font face name (defaults to key) */
    fontName?: string;

    /** Optional: Load MSDF shaders automatically (defaults to true) */
    loadShaders?: boolean;
}

// ============================================================================
// Primary Loader Function
// ============================================================================

/**
 * Load MSDF font assets in the preload phase
 *
 * This function queues both the texture and JSON metadata for loading,
 * and optionally loads the MSDF shaders if not already loaded.
 *
 * @param scene - The Phaser scene (typically `this` in preload())
 * @param key - Unique identifier for this font
 * @param config - Configuration object or string basePath
 *
 * @example
 * ```typescript
 * preload() {
 *   // Simple usage - loads Arial.png and Arial.json
 *   loadMSDFFont(this, 'arial', 'assets/fonts/Arial');
 *
 *   // Advanced usage with options
 *   loadMSDFFont(this, 'arial', {
 *     basePath: 'assets/fonts/Arial',
 *     fontName: 'Arial Bold',
 *     loadShaders: false  // Skip shader loading if already loaded
 *   });
 * }
 * ```
 */
export function loadMSDFFont(
    scene: Phaser.Scene,
    key: string,
    config: string | MSDFLoadConfig
): void {
    // Normalize config
    const cfg: MSDFLoadConfig = typeof config === 'string'
        ? { basePath: config }
        : config;

    const textureKey = cfg.textureKey || `${key}-texture`;
    const dataKey = cfg.dataKey || `${key}-data`;
    const loadShaders = cfg.loadShaders !== false; // Default to true

    // Load shaders if requested
    if (loadShaders) {
        loadMSDFShaders(scene);
    }

    // Load texture (PNG)
    scene.load.image(textureKey, `${cfg.basePath}.png`);

    // Load metadata (JSON)
    scene.load.json(dataKey, `${cfg.basePath}.json`);

    // Store metadata for font creation in create()
    const cache = getFontCache(scene);
    cache.set(key, {
        textureKey,
        dataKey,
        fontName: cfg.fontName || key
    } as any); // Temporary placeholder
}

// ============================================================================
// Font Retrieval
// ============================================================================

/**
 * Get a loaded MSDFFont instance from the cache
 *
 * This should be called in create() after the assets have loaded.
 * The font will be automatically parsed and cached on first access.
 *
 * @param scene - The Phaser scene
 * @param key - The font key used in loadMSDFFont()
 * @returns The MSDFFont instance, or undefined if not found
 *
 * @example
 * ```typescript
 * create() {
 *   const font = getMSDFFont(this, 'arial');
 *   if (font) {
 *     const text = new MSDFText(this, 100, 100, font, 'Hello!', 48);
 *   }
 * }
 * ```
 */
export function getMSDFFont(scene: Phaser.Scene, key: string): MSDFFont | undefined {
    const cache = getFontCache(scene);
    const cached = cache.get(key);

    if (!cached) {
        console.warn(`[MSDFLoader] Font '${key}' not found. Did you call loadMSDFFont()?`);
        return undefined;
    }

    // If already a MSDFFont instance, return it
    if (cached instanceof MSDFFont) {
        return cached;
    }

    // Otherwise, parse and cache the font
    const { textureKey, dataKey, fontName } = cached as any;

    try {
        // Get the JSON data from Phaser's cache
        const fontJson = scene.cache.json.get(dataKey) as MSDFFontJSON;

        if (!fontJson) {
            console.error(`[MSDFLoader] Failed to load JSON data for font '${key}' (key: ${dataKey})`);
            return undefined;
        }

        // Verify texture is loaded
        if (!scene.textures.exists(textureKey)) {
            console.error(`[MSDFLoader] Failed to load texture for font '${key}' (key: ${textureKey})`);
            return undefined;
        }

        // Parse font data
        const fontData = parseMSDFFont(fontJson, fontName);

        // Create MSDFFont instance
        const font = new MSDFFont(fontData, textureKey);

        // Cache the parsed font
        cache.set(key, font);

        return font;
    } catch (error) {
        console.error(`[MSDFLoader] Error parsing font '${key}':`, error);
        return undefined;
    }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Check if a font has been loaded and is ready to use
 *
 * @param scene - The Phaser scene
 * @param key - The font key
 * @returns True if the font is loaded and parsed
 */
export function hasMSDFFont(scene: Phaser.Scene, key: string): boolean {
    const cache = getFontCache(scene);
    const cached = cache.get(key);
    return cached instanceof MSDFFont;
}

/**
 * Preload a font and ensure it's parsed and ready
 *
 * Useful for ensuring a font is fully parsed in create() before use.
 *
 * @param scene - The Phaser scene
 * @param key - The font key
 * @returns The MSDFFont instance or undefined
 */
export function ensureMSDFFont(scene: Phaser.Scene, key: string): MSDFFont | undefined {
    return getMSDFFont(scene, key);
}

/**
 * Remove a font from the cache
 *
 * This does not unload the texture or JSON data from Phaser's caches.
 *
 * @param scene - The Phaser scene
 * @param key - The font key
 */
export function removeMSDFFont(scene: Phaser.Scene, key: string): void {
    const cache = getFontCache(scene);
    cache.delete(key);
}

/**
 * Get all loaded font keys
 *
 * @param scene - The Phaser scene
 * @returns Array of font keys
 */
export function listMSDFFonts(scene: Phaser.Scene): string[] {
    const cache = getFontCache(scene);
    return Array.from(cache.keys());
}

// ============================================================================
// Debug Utilities
// ============================================================================

/**
 * Print debug information about loaded fonts
 *
 * @param scene - The Phaser scene
 */
export function debugMSDFFonts(scene: Phaser.Scene): void {
    const cache = getFontCache(scene);
    console.log('=== MSDF Fonts ===');
    console.log(`Total fonts: ${cache.size}`);

    cache.forEach((font, key) => {
        if (font instanceof MSDFFont) {
            console.log(`  ${key}:`, font.getDebugInfo());
        } else {
            console.log(`  ${key}: [not yet parsed]`);
        }
    });
}
