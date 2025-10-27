/**
 * Phase 2: Texture Sampling Test
 *
 * Tests texture sampling with batched rendering (no MSDF algorithm yet).
 * This displays the raw MSDF texture atlas to verify texture binding works.
 *
 * Expected result: MSDF texture atlas visible (looks like a sprite sheet of blurry characters)
 *
 * If this fails, the issue is in texture binding/sampling.
 * If this succeeds, proceed to Phase 3 (MSDF algorithm).
 */

import Phaser from 'phaser';
import { SimpleQuad } from '../src/debug/SimpleQuad';
import SimpleBatchHandler from '../src/debug/SimpleBatchHandler';

class Phase2TestScene extends Phaser.Scene {
    private quad1?: SimpleQuad;
    private quad2?: SimpleQuad;

    constructor() {
        super({ key: 'Phase2TestScene' });
    }

    init() {
        console.log('[Phase 2] Init - Registering SimpleBatchHandler...');

        // Register the batch handler now that renderer is ready
        const renderer = this.sys.renderer;
        if (renderer && renderer.renderNodes) {
            const renderNodeManager = renderer.renderNodes;

            // Check if already registered
            if (!renderNodeManager._nodeConstructors || !renderNodeManager._nodeConstructors['SimpleBatchHandler']) {
                renderNodeManager.addNodeConstructor('SimpleBatchHandler', SimpleBatchHandler);
                console.log('[Phase 2] SimpleBatchHandler registered successfully');
            } else {
                console.log('[Phase 2] SimpleBatchHandler already registered');
            }
        } else {
            console.error('[Phase 2] Renderer or renderNodes not available!');
        }
    }

    preload() {
        console.log('[Phase 2] Preload - Loading MSDF font texture...');

        // Load the MSDF texture atlas
        this.load.image('arial-msdf', 'assets/fonts/Arial.png');
    }

    create() {
        console.log('[Phase 2] Creating texture quads...');

        // Create a quad showing the full MSDF texture atlas
        this.quad1 = new SimpleQuad(this, 50, 50, 512, 512, 'arial-msdf');
        console.log('[Phase 2] Quad 1 created - full texture atlas at (50, 50)');

        // Create a smaller quad showing part of the texture (zoom in on one character)
        // This tests custom UV coordinates
        this.quad2 = new SimpleQuad(this, 50, 570, 200, 200, 'arial-msdf');
        this.quad2.setUV(0.0, 0.0, 0.25, 0.25);  // Top-left quarter of texture
        console.log('[Phase 2] Quad 2 created - zoomed UV region at (50, 570)');

        // Add instruction text
        this.add.text(600, 50,
            'Phase 2: Texture Test\n\n' +
            'Expected:\n' +
            '• Top: Full MSDF atlas\n' +
            '  (blurry character grid)\n\n' +
            '• Bottom: Zoomed region\n' +
            '  (enlarged characters)\n\n' +
            'If you see textures,\n' +
            'texture binding works!\n\n' +
            'Check console for logs.',
            {
                fontSize: '16px',
                color: '#00ff00',
                fontFamily: 'Arial',
                backgroundColor: '#000000',
                padding: { x: 10, y: 10 }
            }
        );

        console.log('[Phase 2] Scene created.');
        console.log('[Phase 2] If you see the MSDF texture atlas, Phase 2 succeeded!');
    }

    update(time: number, delta: number) {
        // Nothing to update
    }
}

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.WEBGL,  // IMPORTANT: WebGL required
    width: 1024,
    height: 800,
    backgroundColor: '#2d2d2d',
    scene: Phase2TestScene,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

// Create game
const game = new Phaser.Game(config);

console.log('[Phase 2] Test initialized!');
console.log('[Phase 2] If you see the MSDF texture atlas, texture sampling works!');
console.log('[Phase 2] If not, check console for errors.');
