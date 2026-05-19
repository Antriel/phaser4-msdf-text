/**
 * Outline Effect Test (Phase 5.4)
 *
 * This example demonstrates shader-based outline rendering for MSDF text.
 *
 * Features demonstrated:
 * - Shader-based outline (no extra draw calls)
 * - Different outline widths
 * - Different outline colors
 * - Interactive controls
 *
 * Controls:
 * - UP/DOWN: Adjust outline width
 * - 1-5: Change outline color preset
 * - 0: Remove outline
 */

import Phaser from 'phaser';
import '../src';
import { installMSDFPlugin } from '../src/MSDFPlugin';
import type { MSDFTextInstance } from '../src/MSDFTextBatched';
import { registerMSDFBatchHandler } from '../src/registerMSDFBatchHandler';
import * as SPECTOR from "phaser3spectorjs";

class OutlineTestScene extends Phaser.Scene {
  private text1?: MSDFTextInstance;
  private text2?: MSDFTextInstance;
  private text3?: MSDFTextInstance;
  private text4?: MSDFTextInstance;
  private text5?: MSDFTextInstance;
  private currentOutlineWidth: number = 1.5;
  private currentColorIndex: number = 0;
  private controlsText?: Phaser.GameObjects.Text;

  // Outline color presets (name, hex, alpha)
  private outlinePresets = [
    { name: "Black", color: 0x000000, alpha: 1.0 },
    { name: "White", color: 0xFFFFFF, alpha: 1.0 },
    { name: "Red", color: 0xFF0000, alpha: 1.0 },
    { name: "Blue", color: 0x0000FF, alpha: 1.0 },
    { name: "Yellow", color: 0xFFFF00, alpha: 1.0 },
  ];

  constructor() {
    super({ key: "OutlineTestScene" });
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

    this.text1 = this.add.msdfTextBatched(400, 100, font, "OUTLINED TEXT", 64);
    this.text1.setColorHex("#ffffff");
    this.text1.setAlign("center");
    this.text1.setOutline(this.currentOutlineWidth, this.outlinePresets[0].color, this.outlinePresets[0].alpha);

    this.text2 = this.add.msdfTextBatched(400, 190, font, "Colorful Outline", 48);
    this.text2.setColorHex("#00ff00");
    this.text2.setAlign("center");
    this.text2.setOutline(this.currentOutlineWidth, 0x000000, 1.0);

    this.text3 = this.add.msdfTextBatched(400, 270, font, "Press START", 56);
    this.text3.setColorHex("#ffffff");
    this.text3.setAlign("center");
    this.text3.setOutline(2.0, 0x000000, 0.8);

    this.text4 = this.add.msdfTextBatched(400, 350, font, "Small text with thin outline", 24);
    this.text4.setColorHex("#ffff00");
    this.text4.setAlign("center");
    this.text4.setOutline(0.8, 0x000000, 1.0);

    this.text5 = this.add.msdfTextBatched(400, 400, font, "BOLD STYLE", 52);
    this.text5.setColorHex("#ff6600");
    this.text5.setAlign("center");
    this.text5.setOutline(2.5, 0x000000, 1.0);

    // Instructions
    this.add.text(
      10,
      10,
      "Outline Effect Test - Phase 5.4\nShader-based outline (no extra draw calls!)",
      {
        fontSize: "14px",
        color: "#aaaaaa",
        fontFamily: "Arial",
      }
    );

    // Controls info
    this.controlsText = this.add.text(
      10,
      480,
      this.getControlsText(),
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
      },
    });

    // Keyboard controls
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      this.handleKeyPress(event.key);
    });
  }

  private handleKeyPress(key: string) {
    let changed = false;

    if (key === 'ArrowUp') {
      this.currentOutlineWidth = Math.min(this.currentOutlineWidth + 0.25, 5.0);
      changed = true;
    } else if (key === 'ArrowDown') {
      this.currentOutlineWidth = Math.max(this.currentOutlineWidth - 0.25, 0);
      changed = true;
    } else if (key >= '1' && key <= '5') {
      this.currentColorIndex = parseInt(key) - 1;
      changed = true;
    } else if (key === '0') {
      this.currentOutlineWidth = 0;
      changed = true;
    }

    if (changed) {
      this.updateOutlines();
      this.controlsText?.setText(this.getControlsText());
    }
  }

  private updateOutlines() {
    const preset = this.outlinePresets[this.currentColorIndex];

    // All texts use the current preset for interactive testing
    if (this.text1) {
      this.text1.setOutline(this.currentOutlineWidth, preset.color, preset.alpha);
    }

    if (this.text2 && this.currentOutlineWidth > 0) {
      this.text2.setOutline(this.currentOutlineWidth, preset.color, preset.alpha);
    } else if (this.text2) {
      this.text2.clearOutline();
    }

    if (this.text3 && this.currentOutlineWidth > 0) {
      this.text3.setOutline(this.currentOutlineWidth, preset.color, preset.alpha);
    } else if (this.text3) {
      this.text3.clearOutline();
    }

    if (this.text4 && this.currentOutlineWidth > 0) {
      this.text4.setOutline(this.currentOutlineWidth, preset.color, preset.alpha);
    } else if (this.text4) {
      this.text4.clearOutline();
    }

    if (this.text5 && this.currentOutlineWidth > 0) {
      this.text5.setOutline(this.currentOutlineWidth, preset.color, preset.alpha);
    } else if (this.text5) {
      this.text5.clearOutline();
    }
  }

  private getControlsText(): string {
    const preset = this.outlinePresets[this.currentColorIndex];
    return `Controls: UP/DOWN = Width (${this.currentOutlineWidth.toFixed(2)}) | 1-5 = Color (${preset.name}) | 0 = Remove`;
  }
}

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: 800,
  height: 600,
  backgroundColor: "#1a1a2e",
  smoothPixelArt: true,
  scene: OutlineTestScene,
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

const game = new Phaser.Game(config);

// Register MSDF batch handler
registerMSDFBatchHandler(game);
