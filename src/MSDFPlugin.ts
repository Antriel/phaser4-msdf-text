/**
 * MSDFPlugin - Phaser Plugin for MSDF Font Support
 *
 * This plugin adds a custom cache for MSDF fonts to the CacheManager.
 * It should be initialized once when your game boots.
 */

import Phaser from 'phaser';

/**
 * Install MSDF font support into a Phaser game instance
 *
 * This adds a custom cache at `game.cache.custom.msdfFont` where
 * loaded MSDF fonts are stored.
 *
 * Call this function once during game initialization, typically in
 * the game config's `callbacks.postBoot` or at the start of your
 * first scene's `create()` method.
 *
 * @param game - The Phaser game instance
 *
 * @example
 * ```typescript
 * const config = {
 *     type: Phaser.WEBGL,
 *     width: 800,
 *     height: 600,
 *     scene: MyScene,
 *     callbacks: {
 *         postBoot: (game) => {
 *             installMSDFPlugin(game);
 *         }
 *     }
 * };
 * const game = new Phaser.Game(config);
 * ```
 */
export function installMSDFPlugin(game: Phaser.Game): void {
    // Add custom cache for MSDF fonts
    if (!game.cache.custom.msdfFont) {
        game.cache.addCustom('msdfFont');
        console.log('[MSDFPlugin] MSDF font cache installed');
    }
}

/**
 * Get the MSDF font cache from a game instance
 *
 * @param game - The Phaser game instance
 * @returns The MSDF font cache, or undefined if not installed
 */
export function getMSDFCache(game: Phaser.Game): Phaser.Cache.BaseCache | undefined {
    return game.cache.custom.msdfFont;
}

/**
 * Check if the MSDF plugin is installed
 *
 * @param game - The Phaser game instance
 * @returns True if the plugin is installed
 */
export function isMSDFPluginInstalled(game: Phaser.Game): boolean {
    return !!game.cache.custom.msdfFont;
}

/**
 * Auto-install the plugin when a scene is booted
 *
 * This is a convenience function that automatically installs the MSDF plugin
 * when a scene starts if it hasn't been installed yet.
 *
 * You can call this in your scene's `init()` or `preload()` method to ensure
 * the plugin is available without manually calling installMSDFPlugin.
 *
 * @param scene - The Phaser scene
 *
 * @example
 * ```typescript
 * class MyScene extends Phaser.Scene {
 *     preload() {
 *         autoInstallMSDFPlugin(this);
 *         this.load.msdfFont('arial', 'assets/fonts/Arial');
 *     }
 * }
 * ```
 */
export function autoInstallMSDFPlugin(scene: Phaser.Scene): void {
    if (!isMSDFPluginInstalled(scene.game)) {
        installMSDFPlugin(scene.game);
    }
}

/**
 * Augment Phaser's LoaderPlugin type to include msdfFont method
 */
declare module 'phaser' {
    namespace Loader {
        interface LoaderPlugin {
            /**
             * Load an MSDF font from JSON data and PNG texture.
             *
             * @param key - The key to use for this font.
             * @param textureURL - URL to the PNG texture atlas. If omitted, defaults to `<key>.png`.
             * @param fontDataURL - URL to the JSON font data. If omitted, defaults to `<key>.json`.
             * @param textureXhrSettings - Optional XHR settings for the texture.
             * @param fontDataXhrSettings - Optional XHR settings for the font data.
             */
            msdfFont(
                key: string,
                textureURL?: string,
                fontDataURL?: string,
                textureXhrSettings?: Phaser.Types.Loader.XHRSettingsObject,
                fontDataXhrSettings?: Phaser.Types.Loader.XHRSettingsObject
            ): this;
        }
    }

    namespace Cache {
        interface CacheManager {
            custom: {
                msdfFont?: BaseCache;
                [key: string]: BaseCache | undefined;
            };
        }
    }
}
