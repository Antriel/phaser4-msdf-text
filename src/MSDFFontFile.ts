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

        if (IsPlainObject(key)) {
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
            image = new ImageFile(loader, key, textureURL, textureXhrSettings);
            data = new JSONFile(loader, key, fontDataURL, fontDataXhrSettings);
        }

        MultiFile.call(this, loader, 'msdffont', key, [image, data]);
    },

    /**
     * Adds this file to its target cache upon successful loading and processing.
     * Called automatically by the Loader.
     */
    addToCache: function () {
        if (this.isReadyToProcess()) {
            const image = this.files[0];
            const json = this.files[1];

            // Add texture to Phaser's texture manager
            image.addToCache();

            // Get the texture
            const textureKey = image.key;
            const texture = image.cache.get(textureKey);

            if (!texture) {
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
 * Once the font has finished loading you can access it from the cache:
 *
 * ```javascript
 * const font = this.cache.custom.msdfFont.get('arial');
 * const text = this.add.msdfTextBatched(100, 100, font, 'Hello World', 42);
 * ```
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
