/**
 * MSDFFontFile - Phaser Loader MultiFile for MSDF Fonts
 *
 * This file type loads both the JSON font data and PNG texture atlas
 * as a single unit, following Phaser's MultiFile pattern (similar to BitmapFontFile).
 */

import Phaser from 'phaser';
import { parseMSDFFont } from './MSDFFontParser';
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

            if (renderer && renderer.gl && !textureManager.exists(textureKey)) {
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
            } else {
                // No WebGL renderer (or the key is already taken) — fall back to the
                // default path. Plain MSDF still renders; MTSDF effects would not.
                image.addToCache();
            }

            if (!textureManager.exists(textureKey)) {
                console.error(`[MSDFFontFile] Failed to load texture for key: ${textureKey}`);
                return;
            }

            // Parse the MSDF font data
            const fontData = parseMSDFFont(json.data, this.key);

            // Create MSDFFont instance
            const font = new MSDFFont(fontData, textureKey);

            // Add to custom msdfFont cache
            // The cache is created by MSDFPlugin on boot
            if (this.loader.cacheManager.custom.msdfFont) {
                this.loader.cacheManager.custom.msdfFont.add(this.key, font);
            } else {
                console.warn('[MSDFFontFile] MSDF font cache not initialized. Did you install the MSDFPlugin?');
            }

            this.complete = true;
        }
    }
});

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
    let multifile;

    // Supports an Object file definition in the key argument
    // Or an array of objects in the key argument
    // Or a single entry where all arguments have been defined

    if (Array.isArray(key)) {
        for (let i = 0; i < key.length; i++) {
            multifile = new MSDFFontFile(this, key[i]);
            this.addFile(multifile.files);
        }
    } else {
        multifile = new MSDFFontFile(this, key, textureURL, fontDataURL, textureXhrSettings, fontDataXhrSettings);
        this.addFile(multifile.files);
    }

    return this;
});
