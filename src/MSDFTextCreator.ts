/**
 * Creator method for creating MSDFText GameObjects from config
 *
 * This registers the `msdfText` method on the GameObjectCreator,
 * making it available as `scene.make.msdfText(config)`
 */

import Phaser from 'phaser';
import { MSDFText, ColorValue } from './MSDFText';

// @ts-ignore - Phaser internals not fully typed
const GameObjectCreator = Phaser.GameObjects.GameObjectCreator;
// @ts-ignore - Phaser internals not fully typed
const BuildGameObject = Phaser.GameObjects.BuildGameObject;
// @ts-ignore - Phaser internals not fully typed
const GetAdvancedValue = Phaser.Utils.Objects.GetAdvancedValue;

/**
 * Outline configuration for {@link MSDFTextConfig}. Mirrors `setOutline`.
 */
export interface MSDFTextOutlineConfig {
    /** Outline width in distance-field units. Values <= 0 disable the outline. */
    width: number;
    /** Outline color. Defaults to black. */
    color?: ColorValue;
    /** Outline alpha (0-1). Defaults to 1. */
    alpha?: number;
    /** Round the outer corners using the true SDF (requires an MTSDF atlas). Defaults to false. */
    rounded?: boolean;
}

/**
 * Shadow configuration for {@link MSDFTextConfig}. Mirrors `setShadow`.
 */
export interface MSDFTextShadowConfig {
    /** Shadow X offset in pixels. Defaults to 0. */
    offsetX?: number;
    /** Shadow Y offset in pixels. Defaults to 0. */
    offsetY?: number;
    /** Shadow color. Defaults to black. */
    color?: ColorValue;
    /** Shadow alpha (0-1). Defaults to 0.5. */
    alpha?: number;
    /** Shadow blur in screen pixels (requires an MTSDF atlas). Defaults to 0. */
    softness?: number;
}

/**
 * Configuration object for MSDFText
 */
export interface MSDFTextConfig extends Phaser.Types.GameObjects.GameObjectConfig {
    /** Key of the MSDF font in the `msdfFont` cache. */
    font: string;
    text?: string | string[];
    fontSize?: number;
    color?: ColorValue;
    colorAlpha?: number;
    align?: 'left' | 'center' | 'right';
    lineSpacing?: number;
    letterSpacing?: number;
    maxWidth?: number;
    /** Outline effect. See {@link MSDFTextOutlineConfig}. */
    outline?: MSDFTextOutlineConfig;
    /** Shadow effect. See {@link MSDFTextShadowConfig}. */
    shadow?: MSDFTextShadowConfig;
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
    const font = GetAdvancedValue(config, 'font', '');
    const rawText = GetAdvancedValue(config, 'text', '');
    const text = Array.isArray(rawText) ? rawText.join('\n') : rawText;
    const fontSize = GetAdvancedValue(config, 'fontSize', 42);

    // Create the text object (MSDFText will warn if the font key is invalid)
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
        const colorAlpha = GetAdvancedValue(config, 'colorAlpha', null);
        msdfText.setColor(color, colorAlpha !== null ? colorAlpha : undefined);
    }

    const align = GetAdvancedValue(config, 'align', null);
    if (align !== null) {
        msdfText.setAlign(align);
    }

    const lineSpacing = GetAdvancedValue(config, 'lineSpacing', null);
    if (lineSpacing !== null) {
        msdfText.setLineSpacing(lineSpacing);
    }

    const letterSpacing = GetAdvancedValue(config, 'letterSpacing', null);
    if (letterSpacing !== null) {
        msdfText.setLetterSpacing(letterSpacing);
    }

    const maxWidth = GetAdvancedValue(config, 'maxWidth', null);
    if (maxWidth !== null) {
        msdfText.setMaxWidth(maxWidth);
    }

    // Effect configs are nested objects, read directly rather than via
    // GetAdvancedValue (which is geared toward primitive/random values).
    const outline = config.outline;
    if (outline && outline.width > 0) {
        msdfText.setOutline(outline.width, outline.color, outline.alpha, { rounded: !!outline.rounded });
    }

    const shadow = config.shadow;
    if (shadow) {
        msdfText.setShadow(
            shadow.offsetX || 0,
            shadow.offsetY || 0,
            shadow.color,
            shadow.alpha,
            { softness: shadow.softness || 0 }
        );
    }

    return msdfText;
});
