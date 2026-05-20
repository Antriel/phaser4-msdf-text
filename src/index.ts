/**
 * Phaser 4 MSDF Font Rendering
 *
 * Public entry point. Importing this module also registers the `msdfFont`
 * loader and `msdfText` factory/creator on Phaser via side-effect imports.
 *
 * Usage (recommended, via game config):
 *
 *   import { MSDFPlugin } from 'phaser4-msdf-font';
 *
 *   new Phaser.Game({
 *       type: Phaser.WEBGL,
 *       plugins: { global: [{ key: 'MSDFPlugin', plugin: MSDFPlugin, start: true }] },
 *       scene: MyScene
 *   });
 *
 *   // In a scene:
 *   this.load.msdfFont('arial', 'assets/fonts/Arial.png', 'assets/fonts/Arial.json');
 *   const text = this.add.msdfText(100, 100, 'arial', 'Hello World', 42);
 */

// Side-effect imports: register factory, creator, and loader, and apply
// Phaser type augmentations.
import './phaser-augmentations';
import './MSDFTextFactory';
import './MSDFTextCreator';
import './MSDFFontFile';

// Public API
export { MSDFFont } from './MSDFFont';
export { MSDFText } from './MSDFText';
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
    ColorValue,
    DisplayCallback,
    DisplayCallbackData,
    DisplayCallbackTint,
    MSDFTextInstance,
    MSDFTextStatic,
    CharacterData
} from './MSDFText';
export type { MSDFFontFileConfig } from './MSDFFontFile';
export type {
    MSDFTextConfig,
    MSDFTextOutlineConfig,
    MSDFTextShadowConfig
} from './MSDFTextCreator';
