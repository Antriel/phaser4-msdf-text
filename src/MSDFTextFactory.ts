/**
 * Factory method for creating MSDFText GameObjects
 *
 * This registers the `msdfText` method on the GameObjectFactory,
 * making it available as `scene.add.msdfText(x, y, fontKey, text, fontSize)`
 */

import * as Phaser from "phaser";
import { MSDFText } from './MSDFText';

// @ts-ignore - Phaser internals not fully typed
const GameObjectFactory = Phaser.GameObjects.GameObjectFactory;

/**
 * Creates a new MSDFText Game Object and adds it to the Scene.
 *
 * @method Phaser.GameObjects.GameObjectFactory#msdfText
 *
 * @param {number} x - The horizontal position of this Game Object in the world.
 * @param {number} y - The vertical position of this Game Object in the world.
 * @param {string} font - The key of the MSDF font to use, from the `msdfFont` cache.
 * @param {string} [text=''] - The text content to display.
 * @param {number} [fontSize=42] - The font size in pixels.
 *
 * @return {MSDFText} The Game Object that was created.
 */
GameObjectFactory.register('msdfText', function (
    x: number,
    y: number,
    font: string,
    text: string | string[] = '',
    fontSize: number = 42
) {
    const normalized = Array.isArray(text) ? text.join('\n') : text;
    // @ts-ignore - 'this' context is GameObjectFactory
    return this.displayList.add(new MSDFText(this.scene, x, y, font, normalized, fontSize));
});

//  When registering a factory function 'this' refers to the GameObjectFactory context.
//
//  There are several properties available to use:
//
//  this.scene - a reference to the Scene that owns the GameObjectFactory
//  this.displayList - a reference to the Display List the Scene owns
//  this.updateList - a reference to the Update List the Scene owns
