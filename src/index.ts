/**
 * MSDF Font Rendering for Phaser 4
 *
 * Main entry point - exports public API and registers factory/creator methods
 */

// Type augmentations for Phaser (adds scene.add.msdfTextBatched and scene.make.msdfTextBatched)
/// <reference path="./phaser-augmentations.d.ts" />

// Register factory and creator methods (side-effect imports)
import './MSDFTextBatchedFactory';
import './MSDFTextBatchedCreator';

// Register MSDF font file type (side-effect import)
import './MSDFFontFile';

// Export public API
export { MSDFFont } from './MSDFFont';
export { MSDFText } from './MSDFTextBatched';
export { parseMSDFFont } from './MSDFFontParser';

// Export plugin functions
export { installMSDFPlugin, autoInstallMSDFPlugin, getMSDFCache, isMSDFPluginInstalled } from './MSDFPlugin';

// Export legacy loader functions (deprecated - use this.load.msdfFont() instead)
export { loadMSDFFont, getMSDFFont } from './MSDFLoader';

// Export types
export type { TextAlign, DisplayCallback, DisplayCallbackData, DisplayCallbackTint, MSDFTextInstance, CharacterData } from './MSDFTextBatched';
export type { MSDFFontFileConfig } from './MSDFFontFile';

/**
 * Usage:
 *
 * ```typescript
 * import 'phaser4-msdf-font'; // Registers loader, factory, and creator
 * import { installMSDFPlugin } from 'phaser4-msdf-font';
 *
 * // Install the plugin (in game config or first scene):
 * const config = {
 *     type: Phaser.WEBGL,
 *     scene: MyScene,
 *     callbacks: {
 *         postBoot: (game) => {
 *             installMSDFPlugin(game); // Adds cache.custom.msdfFont
 *         }
 *     }
 * };
 *
 * // In your scene's preload():
 * this.load.msdfFont('myFont', 'assets/fonts/MyFont'); // Loads MyFont.json and MyFont.png
 *
 * // In your scene's create():
 * const font = this.cache.custom.msdfFont.get('myFont');
 *
 * // Using factory pattern (creates and adds to scene):
 * const text = this.add.msdfTextBatched(100, 100, font, 'Hello World', 42);
 *
 * // Using creator pattern (creates from config):
 * const text = this.make.msdfTextBatched({
 *     font: font,
 *     text: 'Hello World',
 *     fontSize: 42,
 *     x: 100,
 *     y: 100,
 *     alpha: 0.8,
 *     color: { r: 255, g: 0, b: 0 }
 * });
 * ```
 *
 * **Legacy API (deprecated but still supported):**
 * ```typescript
 * import { loadMSDFFont, getMSDFFont } from 'phaser4-msdf-font';
 *
 * // In preload():
 * loadMSDFFont(this, 'myFont', 'assets/fonts/MyFont');
 *
 * // In create():
 * const font = getMSDFFont(this, 'myFont');
 * ```
 */
