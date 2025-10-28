/**
 * Register MSDF Batch Handler
 *
 * Registers the MSDFBatchHandler with Phaser's RenderNodeManager.
 * This must be called once during game initialization, before creating any MSDFText objects.
 *
 * Usage:
 *   import { registerMSDFBatchHandler } from './src/registerMSDFBatchHandler';
 *
 *   const game = new Phaser.Game(config);
 *   registerMSDFBatchHandler(game);
 */

import MSDFBatchHandler from './MSDFBatchHandler.js';

/**
 * Register the MSDF batch handler with Phaser's renderer
 *
 * @param {Phaser.Game} game - The Phaser game instance
 * @returns {boolean|Promise<boolean>} True if registration succeeded, false otherwise, or Promise if waiting for game ready
 */
export function registerMSDFBatchHandler(game) {
    if (!game) {
        console.error('registerMSDFBatchHandler: Invalid game instance');
        return false;
    }

    // If renderer isn't ready yet, wait for the 'ready' event
    // Note: In Phaser 4, it's called 'renderNodes' not 'renderNodeManager'
    if (!game.renderer || !game.renderer.renderNodes) {
        console.warn('registerMSDFBatchHandler: Renderer not ready yet. Waiting for game \'ready\' event...');
        return new Promise((resolve) => {
            game.events.once('ready', () => {
                resolve(registerMSDFBatchHandler(game));
            });
        });
    }

    const renderer = game.renderer;

    // Check if renderer has renderNodes (WebGL only)
    if (!renderer.renderNodes) {
        console.error('registerMSDFBatchHandler: RenderNodes not found. Is WebGL enabled?');
        return false;
    }

    const renderNodeManager = renderer.renderNodes;

    // Check if already registered (check both instances and constructors)
    if (renderNodeManager._nodeConstructors && renderNodeManager._nodeConstructors['BatchHandlerMSDF']) {
        console.warn('registerMSDFBatchHandler: MSDFBatchHandler already registered');
        return true;
    }

    try {
        // Register the batch handler CONSTRUCTOR (not instance)
        // The RenderNodeManager will auto-instantiate it when getNode() is called
        renderNodeManager.addNodeConstructor('BatchHandlerMSDF', MSDFBatchHandler);
        return true;
    } catch (error) {
        console.error('registerMSDFBatchHandler: Failed to register', error);
        return false;
    }
}
