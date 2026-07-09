/**
 * MSDFFontFile - Phaser Loader MultiFile for MSDF Fonts
 *
 * This file type loads both the JSON font data and PNG texture atlas
 * as a single unit, following Phaser's MultiFile pattern (similar to BitmapFontFile).
 */

import * as Phaser from "phaser";
import { parseMSDFFontSet } from './MSDFFontParser';
import { MSDFFont } from './MSDFFont';

// @ts-ignore - Phaser internals not fully typed
const Class = Phaser.Class;
// @ts-ignore - Phaser internals not fully typed
const FileTypesManager = Phaser.Loader.FileTypesManager;
// @ts-ignore - Phaser internals not fully typed
const GetFastValue = Phaser.Utils.Objects.GetFastValue;
// @ts-ignore - Phaser internals not fully typed
const IsPlainObject = Phaser.Utils.Objects.IsPlainObject;
// @ts-ignore - Phaser internals not fully typed
const ImageFile = Phaser.Loader.FileTypes.ImageFile;
// @ts-ignore - Phaser internals not fully typed
const JSONFile = Phaser.Loader.FileTypes.JSONFile;
// @ts-ignore - Phaser internals not fully typed
const MultiFile = Phaser.Loader.MultiFile;

/**
 * Configuration for loading an MSDF font
 */
export interface MSDFFontFileConfig {
    /** The key to use for this font */
    key: string;

    /** URL to the PNG texture atlas */
    textureURL?: string;

    /** URL to the JSON font data */
    fontDataURL?: string;

    /** Extension for texture (default: 'png') */
    textureExtension?: string;

    /** Extension for font data (default: 'json') */
    fontDataExtension?: string;

    /** XHR settings for texture */
    textureXhrSettings?: Phaser.Types.Loader.XHRSettingsObject;

    /** XHR settings for font data */
    fontDataXhrSettings?: Phaser.Types.Loader.XHRSettingsObject;
}

/**
 * A single MSDF Font file suitable for loading by the Loader.
 *
 * These are created when you use the Phaser.Loader.LoaderPlugin#msdfFont method
 * and are not typically created directly.
 *
 * The file consists of two parts:
 * - JSON font data (from msdf-atlas-gen)
 * - PNG texture atlas
 */
export const MSDFFontFile = new Class({
    Extends: MultiFile,

    initialize: function MSDFFontFile(
        loader: Phaser.Loader.LoaderPlugin,
        key: string | MSDFFontFileConfig,
        textureURL?: string,
        fontDataURL?: string,
        textureXhrSettings?: Phaser.Types.Loader.XHRSettingsObject,
        fontDataXhrSettings?: Phaser.Types.Loader.XHRSettingsObject
    ) {
        let image: any;
        let data: any;

        if (IsPlainObject(key as object)) {
            const config = key as MSDFFontFileConfig;
            const configKey = GetFastValue(config, 'key');

            image = new ImageFile(loader, {
                key: configKey,
                url: GetFastValue(config, 'textureURL'),
                extension: GetFastValue(config, 'textureExtension', 'png'),
                xhrSettings: GetFastValue(config, 'textureXhrSettings')
            });

            data = new JSONFile(loader, {
                key: configKey,
                url: GetFastValue(config, 'fontDataURL'),
                extension: GetFastValue(config, 'fontDataExtension', 'json'),
                xhrSettings: GetFastValue(config, 'fontDataXhrSettings')
            });
        } else {
            image = new ImageFile(loader, key as string, textureURL, textureXhrSettings);
            data = new JSONFile(loader, key as string, fontDataURL, fontDataXhrSettings);
        }

        MultiFile.call(this, loader, 'msdffont', key as string, [image, data]);
    },

    /**
     * Adds this file to its target cache upon successful loading and processing.
     * Called automatically by the Loader.
     */
    addToCache: function () {
        if (this.isReadyToProcess()) {
            const image = this.files[0];
            const json = this.files[1];

            const textureKey = image.key;

            // Upload the atlas ourselves with premultiplied alpha DISABLED.
            //
            // Phaser's default image path (ImageFile.addToCache -> TextureManager.addImage)
            // always uploads with UNPACK_PREMULTIPLY_ALPHA_WEBGL = true. For an MTSDF
            // atlas the alpha channel carries a true signed distance field, not opacity;
            // premultiplying would multiply the MSDF data in RGB by it and destroy the
            // glyph edges. So we build the WebGLTextureWrapper directly with pma = false
            // and register it via addGLTexture. pma = false is a no-op for plain RGB
            // MSDF atlases (alpha is 255 everywhere), so this single path is correct
            // for both field types.
            const textureManager: any = this.loader.textureManager;
            const renderer: any = this.loader.systems.renderer;
            const hasTexture = textureManager.exists(textureKey);

            if (renderer && renderer.gl && !hasTexture) {
                const gl = renderer.gl;
                const img = image.data;
                const wrap = gl.CLAMP_TO_EDGE;

                const glTexture = renderer.createTexture2D(
                    0,                    // mipLevel
                    gl.LINEAR,            // minFilter — MSDF requires linear filtering
                    gl.LINEAR,            // magFilter
                    wrap, wrap,           // wrapT, wrapS
                    gl.RGBA,              // format
                    img,                  // source image element
                    img.width, img.height,
                    false,                // pma — do NOT premultiply (preserves the SDF alpha)
                    false,                // forceSize
                    true                  // flipY — matches Phaser's default for loaded images
                );

                textureManager.addGLTexture(textureKey, glTexture);
            } else if (!hasTexture) {
                // No WebGL renderer — fall back to the default upload path. Plain
                // MSDF still renders; MTSDF effects would not.
                image.addToCache();
            }
            // else: the texture is already registered (the same font finished
            // loading in another scene). Reuse it — re-adding would trip
            // TextureManager.checkKey ("Texture key already in use").

            if (!textureManager.exists(textureKey)) {
                console.error(`[MSDFFontFile] Failed to load texture for key: ${textureKey}`);
                return;
            }

            // Register the parsed font(s) in the custom msdfFont cache (created
            // by MSDFPlugin on boot). A merged atlas (msdf-atlas-gen `-and`)
            // yields one entry per input font, all sharing `textureKey` — so
            // mixed-font rich text never flushes on texture change. Skip an
            // entry already present — two scenes can load the same font before
            // either finishes processing.
            const cache = this.loader.cacheManager.custom.msdfFont;
            if (!cache) {
                console.warn('[MSDFFontFile] MSDF font cache not initialized. Did you install the MSDFPlugin?');
            } else {
                for (const { name, data } of parseMSDFFontSet(json.data, this.key)) {
                    if (!cache.has(name)) {
                        cache.add(name, new MSDFFont(data, textureKey));
                    }
                }
            }

            this.complete = true;
        }
    }
});

/**
 * Queues a single MSDF font for loading, unless its texture has already been
 * uploaded.
 *
 * Phaser's loader dedups standard files via `File.hasCacheConflict()` against
 * each file's target cache, but an MSDF font's loader `key` is not itself a
 * `msdfFont` cache entry — a merged atlas (`-and`) registers its *variants*
 * under their own names, sharing one texture keyed by `key`. The texture
 * manager is therefore the authoritative "already loaded" check for both the
 * single-font and merged cases — applying it here makes re-`preload()`ing the
 * same font (e.g. from every scene that uses it) a no-op instead of a
 * redundant download.
 */
function addMSDFFont(
    loader: Phaser.Loader.LoaderPlugin,
    key: string | MSDFFontFileConfig,
    textureURL?: string,
    fontDataURL?: string,
    textureXhrSettings?: Phaser.Types.Loader.XHRSettingsObject,
    fontDataXhrSettings?: Phaser.Types.Loader.XHRSettingsObject
): void {
    const fontKey = typeof key === 'string' ? key : GetFastValue(key, 'key');
    const textureManager = (loader as any).textureManager;

    if (textureManager && fontKey && textureManager.exists(fontKey)) {
        return;
    }

    const multifile = new MSDFFontFile(
        loader, key, textureURL, fontDataURL, textureXhrSettings, fontDataXhrSettings
    );
    loader.addFile(multifile.files);
}

/**
 * Adds an MSDF Font, or array of fonts, to the current load queue.
 *
 * You can call this method from within your Scene's `preload`, along with any other files you wish to load:
 *
 * ```javascript
 * function preload() {
 *     this.load.msdfFont('arial', 'assets/fonts/Arial');
 * }
 * ```
 *
 * The file is **not** loaded right away. It is added to a queue ready to be loaded either when the loader starts,
 * or if it's already running, when the next free load slot becomes available.
 *
 * If you don't provide explicit URLs, the Loader will automatically append `.json` for the font data
 * and `.png` for the texture atlas based on the key you provide.
 *
 * Instead of passing arguments you can pass a configuration object:
 *
 * ```javascript
 * this.load.msdfFont({
 *     key: 'arial',
 *     textureURL: 'assets/fonts/Arial.png',
 *     fontDataURL: 'assets/fonts/Arial.json'
 * });
 * ```
 *
 * Once the font has finished loading you can create text with it by key:
 *
 * ```javascript
 * const text = this.add.msdfText(100, 100, 'arial', 'Hello World', 42);
 * ```
 *
 * The parsed font is also available via `this.cache.custom.msdfFont.get('arial')`
 * if you need direct access to its `MSDFFont` instance.
 *
 * If the JSON was generated with `msdf-atlas-gen -font a.ttf -and -font b.ttf ...`
 * (several fonts merged into one atlas texture, each given a `-fontname`), this
 * one call registers every font under its own name — `key` need only be a
 * unique load key for the shared texture, not one of the font names:
 *
 * ```javascript
 * this.load.msdfFont('gameFonts', 'assets/fonts/merged.png', 'assets/fonts/merged.json');
 * // later: this.add.msdfText(x, y, 'Anton', 'Hello'); this.add.msdfText(x, y, 'Inter', 'World');
 * ```
 *
 * Text mixing those fonts (via `font:` on a rich-text segment/rule) shares one
 * atlas texture, so `configureFont`'s per-font flush never fires.
 *
 * @method Phaser.Loader.LoaderPlugin#msdfFont
 * @fires Phaser.Loader.Events#ADD
 * @since 1.0.0
 *
 * @param {string|MSDFFontFileConfig|MSDFFontFileConfig[]} key - The key to use for this file, or a file configuration object, or array of them.
 * @param {string} [textureURL] - The absolute or relative URL to load the font texture from. If undefined or `null` it will be set to `<key>.png`.
 * @param {string} [fontDataURL] - The absolute or relative URL to load the font data from. If undefined or `null` it will be set to `<key>.json`.
 * @param {Phaser.Types.Loader.XHRSettingsObject} [textureXhrSettings] - XHR Settings for the texture file.
 * @param {Phaser.Types.Loader.XHRSettingsObject} [fontDataXhrSettings] - XHR Settings for the font data file.
 *
 * @return {this} The Loader instance.
 */
FileTypesManager.register('msdfFont', function (
    this: Phaser.Loader.LoaderPlugin,
    key: string | MSDFFontFileConfig | MSDFFontFileConfig[],
    textureURL?: string,
    fontDataURL?: string,
    textureXhrSettings?: Phaser.Types.Loader.XHRSettingsObject,
    fontDataXhrSettings?: Phaser.Types.Loader.XHRSettingsObject
) {
    // Supports a single key + URLs, a config object, or an array of configs.
    if (Array.isArray(key)) {
        for (let i = 0; i < key.length; i++) {
            addMSDFFont(this, key[i]);
        }
    } else {
        addMSDFFont(this, key, textureURL, fontDataURL, textureXhrSettings, fontDataXhrSettings);
    }

    return this;
});
