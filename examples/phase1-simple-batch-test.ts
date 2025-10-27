/**
 * Phase 1: Simple Batch Test
 *
 * Tests the most basic batched rendering: solid color quads with no textures.
 * This is the first step in the incremental MSDF debugging plan.
 *
 * Expected result: Red quad visible at screen center
 *
 * If this fails, the issue is in basic batching setup (not MSDF-specific).
 * If this succeeds, proceed to Phase 2 (texture sampling).
 */

import Phaser from 'phaser';
import { SimpleQuad } from '../src/debug/SimpleQuad';
import SimpleBatchHandler from '../src/debug/SimpleBatchHandler';

class Phase1TestScene extends Phaser.Scene {
    private quad1?: SimpleQuad;
    private quad2?: SimpleQuad;
    private quad3?: SimpleQuad;

    constructor() {
        super({ key: 'Phase1TestScene' });
    }

    init() {
        console.log('[Phase 1] Init - Registering SimpleBatchHandler...');

        // Register the batch handler now that renderer is ready
        const renderer = this.sys.renderer;
        if (renderer && renderer.renderNodes) {
            const renderNodeManager = renderer.renderNodes;

            // Check if already registered
            if (!renderNodeManager._nodeConstructors || !renderNodeManager._nodeConstructors['SimpleBatchHandler']) {
                renderNodeManager.addNodeConstructor('SimpleBatchHandler', SimpleBatchHandler);
                console.log('[Phase 1] SimpleBatchHandler registered successfully');
            } else {
                console.log('[Phase 1] SimpleBatchHandler already registered');
            }
        } else {
            console.error('[Phase 1] Renderer or renderNodes not available!');
        }
    }

    preload() {
        console.log('[Phase 1] Preload complete');
    }

    create() {
        console.log('[Phase 1] Creating simple quads...');

        // Create a large quad at screen center
        this.quad1 = new SimpleQuad(this, 300, 200, 200, 200);
        console.log('[Phase 1] Quad 1 created at (300, 200), size 200x200');

        // Create a smaller quad at top-left
        this.quad2 = new SimpleQuad(this, 50, 50, 100, 100);
        console.log('[Phase 1] Quad 2 created at (50, 50), size 100x100');

        // Create another small quad at bottom-right
        this.quad3 = new SimpleQuad(this, 650, 450, 100, 100);
        console.log('[Phase 1] Quad 3 created at (650, 450), size 100x100');

        // Add instruction text
        this.add.text(10, 560, 'Phase 1: Simple Batch Test\nExpected: 3 red quads visible\nCheck console for debug info', {
            fontSize: '14px',
            color: '#aaaaaa',
            fontFamily: 'Arial',
            backgroundColor: '#000000',
            padding: { x: 5, y: 5 }
        });

        console.log('[Phase 1] Scene created. If you see red quads, Phase 1 succeeded!');
    }

    update(time: number, delta: number) {
        // Nothing to update
    }
}

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.WEBGL,  // IMPORTANT: WebGL required
    width: 800,
    height: 600,
    backgroundColor: '#2d2d2d',
    scene: Phase1TestScene,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

// Create game
const game = new Phaser.Game(config);

// Note: SimpleBatchHandler is registered in scene's init() method
console.log('[Phase 1] Test initialized!');
console.log('[Phase 1] If you see red quads, basic batching works!');
console.log('[Phase 1] If not, check console for errors.');
