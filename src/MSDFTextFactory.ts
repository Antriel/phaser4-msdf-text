/**
 * Factory method for creating MSDFText GameObjects
 *
 * This registers the `msdfText` method on the GameObjectFactory,
 * making it available as `scene.add.msdfText(x, y, font, text, fontSize)`
 */

import Phaser from 'phaser';
import { MSDFText } from './MSDFText';
import { MSDFFont } from './MSDFFont';

// @ts-ignore - Phaser internals not fully typed
const GameObjectFactory = Phaser.GameObjects.GameObjectFactory;

/**
 * Creates a new MSDFText Game Object and adds it to the Scene.
 *
 * @method Phaser.GameObjects.GameObjectFactory#msdfText
 *
 * @param {number} x - The horizontal position of this Game Object in the world.
 * @param {number} y - The vertical position of this Game Object in the world.
 * @param {MSDFFont} font - The MSDF font to use for rendering.
 * @param {string} [text=''] - The text content to display.
 * @param {number} [fontSize=42] - The font size in pixels.
 *
 * @return {MSDFText} The Game Object that was created.
 */
GameObjectFactory.register('msdfText', function (
    x: number,
    y: number,
    font: MSDFFont,
    text: string = '',
    fontSize: number = 42
) {
    // @ts-ignore - 'this' context is GameObjectFactory
    return this.displayList.add(new MSDFText(this.scene, x, y, font, text, fontSize));
});

//  When registering a factory function 'this' refers to the GameObjectFactory context.
//
//  There are several properties available to use:
//
//  this.scene - a reference to the Scene that owns the GameObjectFactory
//  this.displayList - a reference to the Display List the Scene owns
//  this.updateList - a reference to the Update List the Scene owns
