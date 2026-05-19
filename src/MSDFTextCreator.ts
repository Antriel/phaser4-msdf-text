/**
 * Creator method for creating MSDFText GameObjects from config
 *
 * This registers the `msdfText` method on the GameObjectCreator,
 * making it available as `scene.make.msdfText(config)`
 */

import Phaser from 'phaser';
import { MSDFText } from './MSDFText';
import { MSDFFont } from './MSDFFont';

// @ts-ignore - Phaser internals not fully typed
const GameObjectCreator = Phaser.GameObjects.GameObjectCreator;
// @ts-ignore - Phaser internals not fully typed
const BuildGameObject = Phaser.GameObjects.BuildGameObject;
// @ts-ignore - Phaser internals not fully typed
const GetAdvancedValue = Phaser.Utils.Objects.GetAdvancedValue;

/**
 * Configuration object for MSDFText
 */
export interface MSDFTextConfig extends Phaser.Types.GameObjects.GameObjectConfig {
    font: MSDFFont;
    text?: string;
    fontSize?: number;
    color?: { r: number; g: number; b: number; a?: number };
    align?: 'left' | 'center' | 'right';
    lineSpacing?: number;
    maxWidth?: number;
}

/**
 * Creates a new MSDFText Game Object and returns it.
 *
 * @method Phaser.GameObjects.GameObjectCreator#msdfText
 *
 * @param {MSDFTextConfig} config - The configuration object this Game Object will use to create itself.
 * @param {boolean} [addToScene=true] - Add this Game Object to the Scene after creating it? If set this argument overrides the `add` property in the config object.
 *
 * @return {MSDFText} The Game Object that was created.
 */
GameObjectCreator.register('msdfText', function (
    config: MSDFTextConfig,
    addToScene?: boolean
) {
    if (config === undefined) {
        config = {} as MSDFTextConfig;
    }

    // Get MSDF-specific config values
    const font = GetAdvancedValue(config, 'font', null);
    const text = GetAdvancedValue(config, 'text', '');
    const fontSize = GetAdvancedValue(config, 'fontSize', 42);

    if (!font) {
        console.error('MSDFTextCreator: font is required in config');
        // @ts-ignore - 'this' context is GameObjectCreator
        return new MSDFText(this.scene, 0, 0, null as any, text, fontSize);
    }

    // Create the text object
    // @ts-ignore - 'this' context is GameObjectCreator
    const msdfText = new MSDFText(this.scene, 0, 0, font, text, fontSize);

    // Handle addToScene parameter
    if (addToScene !== undefined) {
        config.add = addToScene;
    }

    // Apply standard GameObject config (position, alpha, visible, etc.)
    // @ts-ignore - 'this' context is GameObjectCreator
    BuildGameObject(this.scene, msdfText, config);

    // Apply MSDF-specific config options
    const color = GetAdvancedValue(config, 'color', null);
    if (color !== null) {
        const r = GetAdvancedValue(color, 'r', 255);
        const g = GetAdvancedValue(color, 'g', 255);
        const b = GetAdvancedValue(color, 'b', 255);
        const a = GetAdvancedValue(color, 'a', 255);
        msdfText.setColor(r, g, b, a);
    }

    const align = GetAdvancedValue(config, 'align', null);
    if (align !== null) {
        msdfText.setAlign(align);
    }

    const lineSpacing = GetAdvancedValue(config, 'lineSpacing', null);
    if (lineSpacing !== null) {
        msdfText.setLineSpacing(lineSpacing);
    }

    const maxWidth = GetAdvancedValue(config, 'maxWidth', null);
    if (maxWidth !== null) {
        msdfText.setMaxWidth(maxWidth);
    }

    return msdfText;
});
