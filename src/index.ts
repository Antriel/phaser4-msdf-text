/**
 * MSDF Font Rendering for Phaser 4
 *
 * Main entry point - exports public API and registers factory/creator methods
 */

/// <reference path="./phaser-augmentations.d.ts" />

// Side-effect imports: register factory/creator methods and the msdfFont loader
import './MSDFTextBatchedFactory';
import './MSDFTextBatchedCreator';
import './MSDFFontFile';

// Public API
export { MSDFFont } from './MSDFFont';
export { MSDFText } from './MSDFTextBatched';
export { parseMSDFFont } from './MSDFFontParser';
export { installMSDFPlugin, autoInstallMSDFPlugin, getMSDFCache, isMSDFPluginInstalled } from './MSDFPlugin';

// Types
export type { TextAlign, DisplayCallback, DisplayCallbackData, DisplayCallbackTint, MSDFTextInstance, CharacterData } from './MSDFTextBatched';
export type { MSDFFontFileConfig } from './MSDFFontFile';

/**
 * Usage:
 *
 * ```typescript
 * import 'phaser4-msdf-font';
 * import { installMSDFPlugin } from 'phaser4-msdf-font';
 *
 * const config = {
 *     type: Phaser.WEBGL,
 *     scene: MyScene,
 *     smoothPixelArt: true, // enables OES_standard_derivatives (required for AA)
 *     callbacks: {
 *         postBoot: (game) => installMSDFPlugin(game)
 *     }
 * };
 *
 * // In preload():
 * this.load.msdfFont('myFont', 'assets/fonts/MyFont.png', 'assets/fonts/MyFont.json');
 *
 * // In create():
 * const font = this.cache.custom.msdfFont.get('myFont');
 * const text = this.add.msdfTextBatched(100, 100, font, 'Hello World', 42);
 * // or
 * const text = this.make.msdfTextBatched({
 *     font, text: 'Hello World', fontSize: 42, x: 100, y: 100,
 *     color: { r: 255, g: 0, b: 0 }
 * });
 * ```
 */
