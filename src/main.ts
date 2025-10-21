/**
 * Main entry point for Phaser 4 MSDF Font Test
 */

import Phaser from 'phaser';
import { BasicMSDFShaderTest } from '../examples/basic-msdf-shader-test';

// Update status in UI
function updateStatus(message: string) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = message;
    }
    console.log('Status:', message);
}

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.WEBGL,
    width: 1280,
    height: 720,
    parent: 'game-container',
    backgroundColor: '#1a1a2e',
    scene: [BasicMSDFShaderTest],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: {
        antialias: true,
        pixelArt: false
    },
    callbacks: {
        preBoot: (game) => {
            updateStatus('Phaser 4 booting...');
        },
        postBoot: (game) => {
            updateStatus('Phaser 4 ready!');
            console.log('Phaser 4 Game Instance:', game);
            console.log('Renderer:', game.renderer);
        }
    }
};

// Initialize Phaser
updateStatus('Initializing...');
const game = new Phaser.Game(config);

// Global access for debugging
(window as any).game = game;

console.log('Phaser 4 MSDF Font Test started');
console.log('Game config:', config);
