/**
 * Shadow Effect Test (Phase 5.4)
 *
 * This example demonstrates two-pass shadow rendering for MSDF text.
 *
 * Features demonstrated:
 * - Hard-edged shadows
 * - Dynamic shadow offset control
 * - Shadow color and alpha
 * - Callback-aware shadows (wave effect with shadow)
 *
 * Controls:
 * - Arrow Keys: Adjust shadow offset
 * - 1-5: Change shadow color preset
 * - 0: Remove shadow
 * - +/-: Adjust shadow alpha
 */

import Phaser from 'phaser';
import '../src';
import { installMSDFPlugin } from '../src/MSDFPlugin';
import type { MSDFTextInstance, DisplayCallbackData } from '../src/MSDFText';
import { registerMSDFBatchHandler } from '../src/registerMSDFBatchHandler';
import * as SPECTOR from "phaser3spectorjs";

class ShadowTestScene extends Phaser.Scene {
  private text1?: MSDFTextInstance;
  private text2?: MSDFTextInstance;
  private text3?: MSDFTextInstance;
  private text4?: MSDFTextInstance;
  private text5?: MSDFTextInstance;  // Wave + shadow
  private currentShadowX: number = 3;
  private currentShadowY: number = 3;
  private currentShadowAlpha: number = 0.7;
  private currentColorIndex: number = 0;
  private controlsText?: Phaser.GameObjects.Text;
  private currentTime: number = 0;

  // Shadow color presets
  private shadowPresets = [
    { name: "Black", color: 0x000000 },
    { name: "Dark Blue", color: 0x000066 },
    { name: "Dark Red", color: 0x660000 },
    { name: "Dark Green", color: 0x006600 },
    { name: "Gray", color: 0x666666 },
  ];

  constructor() {
    super({ key: "ShadowTestScene" });
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

    this.text1 = this.add.msdfText(400, 80, font, "SHADOWED TEXT", 56);
    this.text1.setColor("#ffffff");
    this.text1.setAlign("center");
    this.text1.setShadow(this.currentShadowX, this.currentShadowY, this.shadowPresets[0].color, this.currentShadowAlpha);

    this.text2 = this.add.msdfText(400, 160, font, "Colorful Shadow", 42);
    this.text2.setColor("#00ff00");
    this.text2.setAlign("center");
    this.text2.setShadow(this.currentShadowX, this.currentShadowY, this.shadowPresets[0].color, this.currentShadowAlpha);

    this.text3 = this.add.msdfText(400, 230, font, "GAME OVER", 64);
    this.text3.setColor("#ffffff");
    this.text3.setAlign("center");
    this.text3.setShadow(4, 4, 0x000000, 0.9);

    this.text4 = this.add.msdfText(400, 310, font, "Small text with subtle shadow", 24);
    this.text4.setColor("#ffff00");
    this.text4.setAlign("center");
    this.text4.setShadow(2, 2, 0x000000, 0.4);

    this.text5 = this.add.msdfText(400, 370, font, "WAVE WITH SHADOW", 48);
    this.text5.setColor("#00ffff");
    this.text5.setAlign("center");
    this.text5.setShadow(3, 3, 0x000000, 0.6);
    this.text5.setDisplayCallback((data: DisplayCallbackData) => {
      data.y += Math.sin((data.index * 0.5) + (this.currentTime * 0.003)) * 20;
      return data;
    });

    // Instructions
    this.add.text(
      10,
      10,
      "Shadow Effect Test - Phase 5.4\nTwo-pass rendering (shadow + text)",
      {
        fontSize: "14px",
        color: "#aaaaaa",
        fontFamily: "Arial",
      }
    );

    // Controls info
    this.controlsText = this.add.text(
      10,
      460,
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

  update(time: number) {
    this.currentTime = time;
  }

  private handleKeyPress(key: string) {
    let changed = false;

    if (key === 'ArrowUp') {
      this.currentShadowY = Math.max(this.currentShadowY - 1, -20);
      changed = true;
    } else if (key === 'ArrowDown') {
      this.currentShadowY = Math.min(this.currentShadowY + 1, 20);
      changed = true;
    } else if (key === 'ArrowLeft') {
      this.currentShadowX = Math.max(this.currentShadowX - 1, -20);
      changed = true;
    } else if (key === 'ArrowRight') {
      this.currentShadowX = Math.min(this.currentShadowX + 1, 20);
      changed = true;
    } else if (key >= '1' && key <= '5') {
      this.currentColorIndex = parseInt(key) - 1;
      changed = true;
    } else if (key === '0') {
      this.currentShadowX = 0;
      this.currentShadowY = 0;
      changed = true;
    } else if (key === '=' || key === '+') {
      this.currentShadowAlpha = Math.min(this.currentShadowAlpha + 0.1, 1.0);
      changed = true;
    } else if (key === '-' || key === '_') {
      this.currentShadowAlpha = Math.max(this.currentShadowAlpha - 0.1, 0);
      changed = true;
    }

    if (changed) {
      this.updateShadows();
      this.controlsText?.setText(this.getControlsText());
    }
  }

  private updateShadows() {
    const preset = this.shadowPresets[this.currentColorIndex];

    // Update all texts with current shadow settings
    if (this.text1) {
      this.text1.setShadow(this.currentShadowX, this.currentShadowY, preset.color, this.currentShadowAlpha);
    }

    if (this.text2) {
      this.text2.setShadow(this.currentShadowX, this.currentShadowY, preset.color, this.currentShadowAlpha);
    }

    // Text3, 4, 5 keep their original settings (demonstrate variety)
  }

  private getControlsText(): string {
    const preset = this.shadowPresets[this.currentColorIndex];
    return `Controls: Arrows = Offset (${this.currentShadowX}, ${this.currentShadowY}) | 1-5 = Color (${preset.name}) | +/- = Alpha (${this.currentShadowAlpha.toFixed(1)}) | 0 = Remove`;
  }
}

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: 800,
  height: 600,
  backgroundColor: "#1a1a2e",
  scene: ShadowTestScene,
  callbacks: {
    postBoot: (game) => {
      installMSDFPlugin(game);
      const spector = new SPECTOR.Spector();
      spector.displayUI();
    },
  },
};

const game = new Phaser.Game(config);
registerMSDFBatchHandler(game);
