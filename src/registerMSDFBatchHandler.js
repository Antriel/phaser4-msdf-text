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

const MSDFBatchHandler = require('./MSDFBatchHandler');

/**
 * Register the MSDF batch handler with Phaser's renderer
 *
 * @param {Phaser.Game} game - The Phaser game instance
 * @returns {boolean} True if registration succeeded, false otherwise
 */
export function registerMSDFBatchHandler(game) {
    if (!game || !game.renderer) {
        console.error('registerMSDFBatchHandler: Invalid game instance or renderer not available');
        return false;
    }

    const renderer = game.renderer;

    // Check if renderer has renderNodeManager (WebGL only)
    if (!renderer.renderNodeManager) {
        console.error('registerMSDFBatchHandler: RenderNodeManager not found. Is WebGL enabled?');
        return false;
    }

    const renderNodeManager = renderer.renderNodeManager;

    // Check if already registered
    if (renderNodeManager.has('BatchHandlerMSDF')) {
        console.warn('registerMSDFBatchHandler: MSDFBatchHandler already registered');
        return true;
    }

    try {
        // Register the batch handler
        renderNodeManager.add('BatchHandlerMSDF', MSDFBatchHandler);
        console.log('MSDFBatchHandler registered successfully');
        return true;
    } catch (error) {
        console.error('registerMSDFBatchHandler: Failed to register', error);
        return false;
    }
}

module.exports = { registerMSDFBatchHandler };
