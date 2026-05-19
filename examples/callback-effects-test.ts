/**
 * Display Callback Effects Test (Phase 5.2)
 *
 * This example demonstrates per-character display callbacks for dynamic text effects.
 *
 * Features demonstrated:
 * - Wave effect (vertical sine wave)
 * - Rainbow effect (gradient colors)
 * - Breathing effect (pulsing scale)
 * - Jiggle effect (random position offsets)
 * - Rotation effect (spinning characters)
 * - Combined effects
 */

import Phaser from 'phaser';
import '../src';
import { installMSDFPlugin } from '../src/MSDFPlugin';
import type { MSDFTextInstance, DisplayCallbackData } from '../src/MSDFTextBatched';
import { registerMSDFBatchHandler } from '../src/registerMSDFBatchHandler';
import * as SPECTOR from "phaser3spectorjs";

class CallbackEffectsTestScene extends Phaser.Scene {
  private waveText?: MSDFTextInstance;
  private rainbowText?: MSDFTextInstance;
  private breathingText?: MSDFTextInstance;
  private jiggleText?: MSDFTextInstance;
  private rotationText?: MSDFTextInstance;
  private combinedText?: MSDFTextInstance;
  private currentTime: number = 0;

  constructor() {
    super({ key: "CallbackEffectsTestScene" });
  }

  preload() {
    this.load.msdfFont("arial", "assets/fonts/Arial.png", "assets/fonts/Arial.json");
  }

  create() {
    const font = this.cache.custom.msdfFont?.get("arial");
    if (!font) {
      console.error("Failed to load font!");
      return;
    }

    // Effect 1: Wave (vertical sine wave)
    this.waveText = this.add.msdfTextBatched(400, 60, font, "WAVE EFFECT", 36);
    this.waveText.setColorHex("#00ff00");
    this.waveText.setAlign("center");
    this.waveText.setDisplayCallback((data: DisplayCallbackData) => {
      data.y += Math.sin((data.index * 0.5) + (this.currentTime * 0.003)) * 15;
      return data;
    });

    // Effect 2: Rainbow (gradient colors)
    this.rainbowText = this.add.msdfTextBatched(400, 130, font, "RAINBOW COLORS", 36);
    this.rainbowText.setAlign("center");
    this.rainbowText.setDisplayCallback((data: DisplayCallbackData) => {
      const hue = (data.index * 30 + this.currentTime * 0.1) % 360;
      const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1);
      const tintValue = (255 << 24) | (color.b << 16) | (color.g << 8) | color.r;
      data.tint.topLeft = tintValue;
      data.tint.topRight = tintValue;
      data.tint.bottomLeft = tintValue;
      data.tint.bottomRight = tintValue;
      return data;
    });

    // Effect 3: Breathing (pulsing scale)
    this.breathingText = this.add.msdfTextBatched(400, 200, font, "BREATHING", 36);
    this.breathingText.setColorHex("#ffff00");
    this.breathingText.setAlign("center");
    this.breathingText.setDisplayCallback((data: DisplayCallbackData) => {
      const pulsePhase = (data.index * 0.2) + (this.currentTime * 0.002);
      data.scale = 1 + Math.sin(pulsePhase) * 0.3;
      return data;
    });

    // Effect 4: Jiggle (random position offsets)
    this.jiggleText = this.add.msdfTextBatched(400, 270, font, "JIGGLE!", 36);
    this.jiggleText.setColorHex("#ff00ff");
    this.jiggleText.setAlign("center");
    this.jiggleText.setDisplayCallback((data: DisplayCallbackData) => {
      // Use time + index for pseudo-random but smooth jiggle
      const jiggleX = Math.sin(this.currentTime * 0.01 + data.index * 1.5) * 3;
      const jiggleY = Math.cos(this.currentTime * 0.012 + data.index * 1.7) * 3;
      data.x += jiggleX;
      data.y += jiggleY;
      return data;
    });

    // Effect 5: Rotation (spinning characters)
    this.rotationText = this.add.msdfTextBatched(400, 340, font, "SPINNING", 36);
    this.rotationText.setColorHex("#00ffff");
    this.rotationText.setAlign("center");
    this.rotationText.setDisplayCallback((data: DisplayCallbackData) => {
      data.rotation = (this.currentTime * 0.002 + data.index * 0.2);
      return data;
    });

    // Effect 6: Combined (wave + rainbow + scale)
    this.combinedText = this.add.msdfTextBatched(400, 450, font, "COMBINED EFFECTS!", 48);
    this.combinedText.setAlign("center");
    this.combinedText.setDisplayCallback((data: DisplayCallbackData) => {
      // Wave
      data.y += Math.sin((data.index * 0.4) + (this.currentTime * 0.004)) * 20;

      // Rainbow
      const hue = (data.index * 25 + this.currentTime * 0.15) % 360;
      const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1);
      const tintValue = (255 << 24) | (color.b << 16) | (color.g << 8) | color.r;
      data.tint.topLeft = tintValue;
      data.tint.topRight = tintValue;
      data.tint.bottomLeft = tintValue;
      data.tint.bottomRight = tintValue;

      // Breathing
      const pulsePhase = (data.index * 0.15) + (this.currentTime * 0.003);
      data.scale = 1 + Math.sin(pulsePhase) * 0.2;

      return data;
    });

    // Instructions
    this.add.text(
      10,
      10,
      "Display Callback Effects - Phase 5.2\nEach text uses a different callback for dynamic per-character effects!",
      {
        fontSize: "14px",
        color: "#aaaaaa",
        fontFamily: "Arial",
      }
    );

    // FPS counter
    const fpsText = this.add.text(10, 550, "FPS: --", {
      fontSize: "14px",
      color: "#ff0000",
      fontFamily: "Arial",
    });

    this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        const fps = Math.round(this.game.loop.actualFps);
        fpsText.setText(`FPS: ${fps}`);
      }
    });

    console.log("All effects created! Watch the magic happen!");
  }

  update(time: number, delta: number) {
    this.currentTime = time;
  }
}

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: 800,
  height: 600,
  backgroundColor: "#1a1a2e",
  scene: CallbackEffectsTestScene,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  callbacks: {
    postBoot: (game) => {
      installMSDFPlugin(game);
      const spector = new SPECTOR.Spector();
      spector.displayUI();
    },
  },
};

// Create game
const game = new Phaser.Game(config);

// Register MSDF batch handler
registerMSDFBatchHandler(game);
console.log('Callback effects test initialized! Enjoy the show!');
