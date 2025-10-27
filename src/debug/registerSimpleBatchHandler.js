/**
 * Register Simple Batch Handler
 *
 * Registers the SimpleBatchHandler with Phaser's RenderNodeManager.
 * This is Phase 1 of the incremental MSDF debugging plan.
 */

import SimpleBatchHandler from './SimpleBatchHandler.js';

/**
 * Register the Simple batch handler with Phaser's renderer
 *
 * @param {Phaser.Game} game - The Phaser game instance
 * @returns {boolean|Promise<boolean>} True if registration succeeded, false otherwise
 */
export function registerSimpleBatchHandler(game) {
    if (!game) {
        console.error('registerSimpleBatchHandler: Invalid game instance');
        return false;
    }

    // If renderer isn't ready yet, wait for the 'ready' event
    if (!game.renderer || !game.renderer.renderNodes) {
        console.warn('registerSimpleBatchHandler: Renderer not ready yet. Waiting for game \'ready\' event...');
        return new Promise((resolve) => {
            game.events.once('ready', () => {
                resolve(registerSimpleBatchHandler(game));
            });
        });
    }

    const renderer = game.renderer;

    // Check if renderer has renderNodes (WebGL only)
    if (!renderer.renderNodes) {
        console.error('registerSimpleBatchHandler: RenderNodes not found. Is WebGL enabled?');
        return false;
    }

    const renderNodeManager = renderer.renderNodes;

    // Check if already registered
    if (renderNodeManager._nodeConstructors && renderNodeManager._nodeConstructors['SimpleBatchHandler']) {
        console.warn('registerSimpleBatchHandler: SimpleBatchHandler already registered');
        return true;
    }

    try {
        // Register the batch handler CONSTRUCTOR (not instance)
        renderNodeManager.addNodeConstructor('SimpleBatchHandler', SimpleBatchHandler);
        console.log('[Phase 1] SimpleBatchHandler registered successfully');
        return true;
    } catch (error) {
        console.error('registerSimpleBatchHandler: Failed to register', error);
        return false;
    }
}
