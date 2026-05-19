/**
 * TypeScript module augmentations for Phaser.
 *
 * Adds the MSDF factory/creator, loader method, and custom cache slot to
 * Phaser's type surface so consumers get autocomplete and type checking.
 */

import type { MSDFTextInstance } from './MSDFText';
import type { MSDFTextConfig } from './MSDFTextCreator';
import type { MSDFFontFileConfig } from './MSDFFontFile';

// This file exists purely for its `declare module 'phaser'` side effect.
// Re-export an empty marker so it's an ES module and is preserved through
// tsc's declaration emit.
export {};

declare module 'phaser' {
    namespace GameObjects {
        interface GameObjectFactory {
            /**
             * Creates a new MSDFText Game Object and adds it to the Scene.
             */
            msdfText(
                x: number,
                y: number,
                font: string,
                text?: string | string[],
                fontSize?: number
            ): MSDFTextInstance;
        }

        interface GameObjectCreator {
            /**
             * Creates a new MSDFText Game Object from a config object.
             */
            msdfText(
                config: MSDFTextConfig,
                addToScene?: boolean
            ): MSDFTextInstance;
        }
    }

    namespace Loader {
        interface LoaderPlugin {
            /**
             * Load an MSDF font from JSON data and a PNG atlas. Defaults to
             * `<key>.png` and `<key>.json` when URLs are omitted.
             */
            msdfFont(
                key: string | MSDFFontFileConfig | MSDFFontFileConfig[],
                textureURL?: string,
                fontDataURL?: string,
                textureXhrSettings?: Phaser.Types.Loader.XHRSettingsObject,
                fontDataXhrSettings?: Phaser.Types.Loader.XHRSettingsObject
            ): this;
        }
    }

}

// NOTE: Phaser declares `CacheManager.custom` as `{[key: string]: BaseCache}`,
// so `cache.custom.msdfFont` already type-checks as `BaseCache` without any
// augmentation — we just can't narrow that signature without conflicting with
// Phaser's own declaration.
