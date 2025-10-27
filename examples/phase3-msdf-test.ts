/**
 * Phase 3: MSDF Algorithm Test
 *
 * Tests the MSDF median/smoothstep algorithm with batched rendering.
 * This applies the MSDF distance field algorithm to render crisp text.
 *
 * Expected result: Clean, crisp character rendering with MSDF
 *
 * If this fails, the issue is in the MSDF shader algorithm.
 * If this succeeds, we've identified where the original MSDFBatchHandler differs!
 */

import Phaser from 'phaser';
import { SimpleQuad } from '../src/debug/SimpleQuad';
import SimpleBatchHandler from '../src/debug/SimpleBatchHandler';

class Phase3TestScene extends Phaser.Scene {
    private quad1?: SimpleQuad;
    private quad2?: SimpleQuad;
    private quad3?: SimpleQuad;
    private batchHandler?: any;

    constructor() {
        super({ key: 'Phase3TestScene' });
    }

    init() {
        console.log('[Phase 3] Init - Registering SimpleBatchHandler...');

        // Register the batch handler now that renderer is ready
        const renderer = this.sys.renderer;
        if (renderer && renderer.renderNodes) {
            const renderNodeManager = renderer.renderNodes;

            // Check if already registered
            if (!renderNodeManager._nodeConstructors || !renderNodeManager._nodeConstructors['SimpleBatchHandler']) {
                renderNodeManager.addNodeConstructor('SimpleBatchHandler', SimpleBatchHandler);
                console.log('[Phase 3] SimpleBatchHandler registered successfully');
            } else {
                console.log('[Phase 3] SimpleBatchHandler already registered');
            }

            // Get the batch handler so we can set MSDF parameters
            this.batchHandler = renderNodeManager.getNode('SimpleBatchHandler');
            if (this.batchHandler) {
                this.batchHandler.setPxRange(4);
                this.batchHandler.setTextColor(1, 1, 1, 1);
                console.log('[Phase 3] MSDF parameters set: pxRange=4, color=white');
            }
        } else {
            console.error('[Phase 3] Renderer or renderNodes not available!');
        }
    }

    preload() {
        console.log('[Phase 3] Preload - Loading MSDF font texture...');

        // Load the MSDF texture atlas
        this.load.image('arial-msdf', 'assets/fonts/Arial.png');
    }

    create() {
        console.log('[Phase 3] Creating MSDF character quads...');

        // Create large quads showing individual characters from the MSDF atlas
        // We'll use simple UV coordinates to show specific characters

        // Quad 1: Show character 'A' (uppercase A, ASCII 65)
        // Assuming a grid layout, let's try a specific UV region
        this.quad1 = new SimpleQuad(this, 50, 50, 200, 200, 'arial-msdf');
        // These UVs are approximate - we'd need to parse the .fnt file for exact coordinates
        // For now, let's show a region that should contain characters
        this.quad1.setUV(0.0, 0.0, 0.15, 0.15);
        console.log('[Phase 3] Quad 1 created - testing MSDF character rendering');

        // Quad 2: Different region
        this.quad2 = new SimpleQuad(this, 300, 50, 200, 200, 'arial-msdf');
        this.quad2.setUV(0.2, 0.2, 0.35, 0.35);
        console.log('[Phase 3] Quad 2 created - different UV region');

        // Quad 3: Another region
        this.quad3 = new SimpleQuad(this, 550, 50, 200, 200, 'arial-msdf');
        this.quad3.setUV(0.5, 0.5, 0.65, 0.65);
        console.log('[Phase 3] Quad 3 created - another UV region');

        // Add instruction text
        this.add.text(50, 280,
            'Phase 3: MSDF Algorithm Test\n\n' +
            'Expected: Clean, crisp character edges\n' +
            '(not blurry like Phase 2)\n\n' +
            'If you see sharp MSDF-rendered characters,\n' +
            'the MSDF algorithm works!\n\n' +
            'This means the issue in MSDFBatchHandler\n' +
            'is something ELSE (vertex layout, tint, etc.)\n\n' +
            'Check console for logs.',
            {
                fontSize: '16px',
                color: '#00ff00',
                fontFamily: 'Arial',
                backgroundColor: '#000000',
                padding: { x: 10, y: 10 }
            }
        );

        // Add comparison: Show raw texture for reference
        const rawQuad = new SimpleQuad(this, 50, 500, 150, 75, 'arial-msdf');
        rawQuad.setUV(0.0, 0.0, 0.15, 0.15);

        this.add.text(210, 520,
            'Reference: Same region\nwithout MSDF would look\nblurry (see Phase 2)',
            {
                fontSize: '14px',
                color: '#888888',
                fontFamily: 'Arial'
            }
        );

        console.log('[Phase 3] Scene created.');
        console.log('[Phase 3] If characters look CRISP (not blurry), Phase 3 succeeded!');
        console.log('[Phase 3] This means MSDF algorithm works in batching!');
    }

    update(time: number, delta: number) {
        // Animate text color to test dynamic color changes
        if (this.batchHandler && this.quad1) {
            const hue = (time / 20) % 360;
            const color = Phaser.Display.Color.HSVToRGB(hue / 360, 0.8, 1);
            this.batchHandler.setTextColor(color.r / 255, color.g / 255, color.b / 255, 1);
        }
    }
}

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.WEBGL,  // IMPORTANT: WebGL required
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#2d2d2d',
    scene: Phase3TestScene,
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

// Create game
const game = new Phaser.Game(config);

console.log('[Phase 3] Test initialized!');
console.log('[Phase 3] If you see crisp MSDF-rendered text, the algorithm works!');
console.log('[Phase 3] If not, check console for errors.');
