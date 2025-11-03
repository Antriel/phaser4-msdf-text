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

// Export public API
export { MSDFFont } from './MSDFFont';
export { MSDFText } from './MSDFTextBatched';
export { loadMSDFFont, getMSDFFont } from './MSDFLoader';
export { parseMSDFFont } from './MSDFFontParser';

// Export types
export type { TextAlign, DisplayCallback, DisplayCallbackData, DisplayCallbackTint, MSDFTextInstance, CharacterData } from './MSDFTextBatched';

/**
 * Usage:
 *
 * ```typescript
 * import 'phaser4-msdf-font'; // Registers scene.add.msdfTextBatched() and scene.make.msdfTextBatched()
 *
 * // In your scene's preload():
 * loadMSDFFont(this, 'myFont', 'assets/font.fnt');
 *
 * // In your scene's create():
 * const font = getMSDFFont(this, 'myFont');
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
 */
