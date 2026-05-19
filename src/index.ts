/**
 * Phaser 4 MSDF Font Rendering
 *
 * Public entry point. Importing this module also registers the `msdfFont`
 * loader and `msdfTextBatched` factory/creator on Phaser via side-effect
 * imports.
 *
 * Usage (recommended, via game config):
 *
 *   import { MSDFPlugin, MSDFBatchHandler } from 'phaser4-msdf-font';
 *
 *   new Phaser.Game({
 *       type: Phaser.WEBGL,
 *       render: { renderNodes: { BatchHandlerMSDF: MSDFBatchHandler } },
 *       plugins: { global: [{ key: 'MSDFPlugin', plugin: MSDFPlugin, start: true }] },
 *       scene: MyScene
 *   });
 *
 *   // In a scene:
 *   this.load.msdfFont('arial', 'assets/fonts/Arial.png', 'assets/fonts/Arial.json');
 *   const font = this.cache.custom.msdfFont.get('arial');
 *   const text = this.add.msdfTextBatched(100, 100, font, 'Hello World', 42);
 */

// Side-effect imports: register factory, creator, and loader, and apply
// Phaser type augmentations.
import './phaser-augmentations';
import './MSDFTextBatchedFactory';
import './MSDFTextBatchedCreator';
import './MSDFFontFile';

// Public API
export { MSDFFont } from './MSDFFont';
export { MSDFText } from './MSDFTextBatched';
export { parseMSDFFont } from './MSDFFontParser';
export {
    MSDFPlugin,
    installMSDFPlugin,
    autoInstallMSDFPlugin,
    getMSDFCache,
    isMSDFPluginInstalled
} from './MSDFPlugin';
export { default as MSDFBatchHandler } from './MSDFBatchHandler';

// Types
export type {
    TextAlign,
    DisplayCallback,
    DisplayCallbackData,
    DisplayCallbackTint,
    MSDFTextInstance,
    CharacterData
} from './MSDFTextBatched';
export type { MSDFFontFileConfig } from './MSDFFontFile';
export type { MSDFTextConfig } from './MSDFTextBatchedCreator';
