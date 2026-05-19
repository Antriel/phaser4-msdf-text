/**
 * Batched MSDF Text Test
 *
 * This example demonstrates the new batched rendering system (Phase 4).
 * Compare performance with the old loader-test.ts to see the improvement!
 *
 * Expected performance:
 * - Old (Phase 3): ~100 draw calls for 100 characters
 * - New (Phase 4): 1-2 draw calls for 100 characters
 */

import Phaser from 'phaser';
import { installMSDFPlugin } from '../src/MSDFPlugin';
import type { MSDFTextInstance } from '../src/MSDFText';
import { registerMSDFBatchHandler } from '../src/registerMSDFBatchHandler';
import * as SPECTOR from "phaser3spectorjs";

class BatchedTestScene extends Phaser.Scene {
  private text1?: MSDFTextInstance;
  private text2?: MSDFTextInstance;
  private text3?: MSDFTextInstance;
  private fpsText?: MSDFTextInstance;

  constructor() {
    super({ key: "BatchedTestScene" });
  }

  preload() {
    console.log("Loading MSDF font...");
    // Load MSDF font using Phaser's loader plugin
    this.load.msdfFont(
      "arial",
      // "assets/fonts/Arial.png",
      // "assets/fonts/Arial.json",
      "assets/fonts/Chubby_Thumbs.png",
      "assets/fonts/Chubby_Thumbs.json",
    );
  }

  create() {
    console.log("Creating batched MSDF text...");

    // Test 1: Simple text with rotation (using factory pattern)
    this.text1 = this.add.msdfText(400, 100, "arial", "Batched MSDF Text!", 48);
    this.text1.setColor("#00ff00");
    this.text1.setAlign("center");
    // Add rotation animation to test transform support
    this.tweens.add({
      targets: this.text1,
      rotation: Math.PI * 2,
      duration: 3000,
      repeat: -1,
      ease: "Linear",
    });

    // Test 2: Multi-line text (using factory pattern)
    this.text2 = this.add.msdfText(
      400,
      200,
      "arial",
      "This is batched rendering!\nMultiple lines work too.\nMuch faster than Phase 3!",
      32
    );
    this.text2.setColor("#ffffff");
    this.text2.setAlign("center");
    this.text2.setLineSpacing(5);

    // Test 3: Large text block (stress test)
    const loremIpsum =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n" +
      "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n" +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.\n" +
      "Duis aute irure dolor in reprehenderit in voluptate velit esse.";

    this.text3 = this.add.msdfText(50, 350, "arial", loremIpsum, 24);
    this.text3.setColor("#ffff00");
    this.text3.setAlign("left");
    this.text3.scaleX = 10;
    this.tweens.add({
      targets: this.text3,
      scaleX: 5,
      scaleY: 5,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // FPS counter (updates every frame to test dynamic text, using factory pattern)
    this.fpsText = this.add.msdfText(10, 10, "arial", "FPS: --", 20);
    this.fpsText.setColor("#ff0000");

    // Instructions
    this.add.text(
      10,
      550,
      "Open DevTools to check draw calls!\nPhase 4 batching should show 1-2 draw calls per text object.",
      {
        fontSize: "14px",
        color: "#aaaaaa",
        fontFamily: "Arial",
      }
    );
  }

  update(time: number, delta: number) {
    // Update FPS counter (tests dynamic text updates)
    if (this.fpsText) {
      const fps = Math.round(this.game.loop.actualFps);
      this.fpsText.setText(`FPS: ${fps}`);
    }

    // Animate text2 color
    if (this.text2) {
      const hue = (time / 10) % 360;
      const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1);
      this.text2.setColor(color);
    }
  }
}

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL, // IMPORTANT: WebGL required for batching
  width: 800,
  height: 600,
  backgroundColor: "#2d2d2d",
  scene: BatchedTestScene,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  callbacks: {
    postBoot: (game) => {
      // Install MSDF plugin (adds custom font cache)
      installMSDFPlugin(game);

      // Initialize Spector.js for WebGL debugging
      const spector = new SPECTOR.Spector();
      spector.displayUI();
    },
  },
};

// Create game
const game = new Phaser.Game(config);

// Register MSDF batch handler (will auto-wait for renderer to be ready)
registerMSDFBatchHandler(game);
console.log('Batched test initialized! Check console for debug info.');
