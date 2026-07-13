/**
 * Creator method for creating MSDFText GameObjects from config
 *
 * This registers the `msdfText` method on the GameObjectCreator,
 * making it available as `scene.make.msdfText(config)`
 */

import * as Phaser from "phaser";
import { MSDFText, type ColorValue, type MSDFAlign, type DecorationSpec, type HighlightSpec } from './MSDFText';

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
    /**
     * Outline width in distance-field units. Values <= 0 disable the outline,
     * unless {@link softness} gives it a body of its own.
     */
    width: number;
    /** Outline color. Defaults to black. */
    color?: ColorValue;
    /** Outline alpha (0-1). Defaults to 1. */
    alpha?: number;
    /**
     * How far to round the outer corners off the true SDF, `0` (sharp) to `1`
     * (round), or a boolean for those ends. Requires an MTSDF atlas. Defaults to 0.
     */
    rounded?: number | boolean;
    /** Draw outline silhouettes under the fills, so thick outlines never cover neighbouring glyphs. Defaults to false. */
    layered?: boolean;
    /**
     * Blur the outline's outer edge, in distance-field units (requires an MTSDF
     * atlas). Defaults to 0. With `width: 0` this alone is a glow hugging the
     * letterform, drawn in the fill's own quad.
     */
    softness?: number;
    /**
     * Inner end of the outline's two-tone colour ramp. `null`/omitted inherits
     * the outline's own colour (no ramp).
     */
    innerColor?: ColorValue | null;
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
    /** Shadow blur in distance-field units (requires an MTSDF atlas). Defaults to 0. */
    softness?: number;
    /**
     * Dilate the shadow's silhouette before blurring it, in distance-field units.
     * Defaults to 0. Fattens a shadow without mushing it; needs no MTSDF atlas.
     */
    spread?: number;
    /**
     * How far to round the dilated / blurred silhouette off the true SDF, `0`
     * (sharp) to `1` (round), or a boolean. Requires an MTSDF atlas. Defaults to
     * `1` — see `MSDFTextInstance.shadowRounded`.
     */
    rounded?: number | boolean;
    /**
     * Inner end of the shadow's two-tone colour ramp. `null`/omitted inherits
     * the shadow's own colour (no ramp).
     */
    innerColor?: ColorValue | null;
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
    /** Faux-bold weight, in distance-field units. Defaults to 0. */
    weight?: number;
    /** Line alignment: `'left'` (default), `'center'` or `'right'`. */
    align?: MSDFAlign;
    lineSpacing?: number;
    letterSpacing?: number;
    maxWidth?: number;
    /** Outline effect. See {@link MSDFTextOutlineConfig}. */
    outline?: MSDFTextOutlineConfig;
    /** Shadow effect. See {@link MSDFTextShadowConfig}. */
    shadow?: MSDFTextShadowConfig;
    /** Underline decoration. `true` for defaults, or a {@link DecorationSpec}. */
    underline?: boolean | DecorationSpec;
    /** Strikethrough decoration. `true` for defaults, or a {@link DecorationSpec}. */
    strikethrough?: boolean | DecorationSpec;
    /** Highlight pill. `true` for defaults, or a {@link HighlightSpec}. */
    highlight?: boolean | HighlightSpec;
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
        msdfText.align = align;
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

    const weight = GetAdvancedValue(config, 'weight', null);
    if (weight !== null) {
        msdfText.setWeight(weight);
    }

    // Effect configs are nested objects, read directly rather than via
    // GetAdvancedValue (which is geared toward primitive/random values).
    //
    // A softness with no width is a legitimate outline (a glow on the
    // letterform), so the gate is "has a body", not "has a width".
    const outline = config.outline;
    if (outline && ((outline.width || 0) > 0 || (outline.softness || 0) > 0)) {
        msdfText.setOutline(
            outline.width || 0, outline.color, outline.alpha,
            outline.rounded || 0, !!outline.layered, outline.softness || 0
        );
    }
    if (outline && outline.innerColor !== undefined) {
        msdfText.setOutlineInnerColor(outline.innerColor);
    }

    const shadow = config.shadow;
    if (shadow) {
        msdfText.setShadow(
            shadow.offsetX || 0,
            shadow.offsetY || 0,
            shadow.color,
            shadow.alpha,
            shadow.softness || 0,
            shadow.spread || 0
        );
        // Fully on by default on the object, so only an explicit key overrides it.
        if (shadow.rounded !== undefined) {
            msdfText.shadowRounded = shadow.rounded;
        }
        if (shadow.innerColor !== undefined) {
            msdfText.setShadowInnerColor(shadow.innerColor);
        }
    }

    if (config.underline !== undefined) {
        msdfText.setUnderline(config.underline);
    }
    if (config.strikethrough !== undefined) {
        msdfText.setStrikethrough(config.strikethrough);
    }
    if (config.highlight !== undefined) {
        msdfText.setHighlight(config.highlight);
    }

    return msdfText;
});
