/**
 * Word Wrap Test (Phase 5.1)
 *
 * This example demonstrates the new word wrapping feature for MSDF text.
 *
 * Features demonstrated:
 * - Basic word wrapping with maxWidth
 * - Dynamic maxWidth changes
 * - Word wrapping with different alignments
 * - Detailed text bounds with line information
 */

import Phaser from 'phaser';
import '../src';
import { MSDFPlugin } from "../src";
import type { MSDFTextInstance } from "../src";

class WordWrapTestScene extends Phaser.Scene {
  private text1?: MSDFTextInstance;
  private text2?: MSDFTextInstance;
  private text3?: MSDFTextInstance;
  private boundsText?: MSDFTextInstance;
  private maxWidthValue: number = 400;

  constructor() {
    super({ key: "WordWrapTestScene" });
  }

  preload() {
    this.load.msdfFont(
      "arial",
      "assets/fonts/Arial.png",
      "assets/fonts/Arial.json",
    );
  }

  create() {
    const longText =
      "This is a very long line of text that will automatically wrap when it exceeds the maximum width. Word wrapping makes text much more readable in constrained spaces!";

    this.text1 = this.add.msdfText(50, 50, "arial", longText, 24);
    this.text1.setColor("#00ff00");
    this.text1.setAlign("left");
    this.text1.setMaxWidth(this.maxWidthValue);

    const mediumText =
      "Centered text with word wrapping. This demonstrates how alignment works with wrapped text.";

    this.text2 = this.add.msdfText(400, 200, "arial", mediumText, 28);
    this.text2.setColor("#ffff00");
    this.text2.setAlign("center");
    this.text2.setMaxWidth(350);

    const mixedText =
      "First paragraph with manual line break.\nSecond paragraph that will wrap because it contains a very long line that exceeds the maximum width constraint.";

    this.text3 = this.add.msdfText(50, 350, "arial", mixedText, 22);
    this.text3.setColor("#ff00ff");
    this.text3.setAlign("left");
    this.text3.setMaxWidth(500);
    this.text3.setLineSpacing(3);

    this.boundsText = this.add.msdfText(550, 50, "arial", "", 16);
    this.boundsText.setColor("#ffffff");
    this.boundsText.setAlign("left");
    this.updateBoundsInfo();

    // Instructions
    this.add.text(
      10,
      10,
      "Word Wrap Test - Use UP/DOWN arrows to adjust maxWidth",
      {
        fontSize: "14px",
        color: "#aaaaaa",
        fontFamily: "Arial",
      },
    );

    // Keyboard controls
    const cursors = this.input.keyboard!.createCursorKeys();

    cursors.up!.on("down", () => {
      this.maxWidthValue += 50;
      this.text1!.setMaxWidth(this.maxWidthValue);
      this.updateBoundsInfo();
      console.log(`MaxWidth: ${this.maxWidthValue}`);
    });

    cursors.down!.on("down", () => {
      this.maxWidthValue = Math.max(100, this.maxWidthValue - 50);
      this.text1!.setMaxWidth(this.maxWidthValue);
      this.updateBoundsInfo();
      console.log(`MaxWidth: ${this.maxWidthValue}`);
    });

    // Print debug info
    console.log("=== Text 1 Bounds ===");
    console.log(this.text1.getTextBounds());

    console.log("\n=== Text 2 Bounds ===");
    console.log(this.text2.getTextBounds());

    console.log("\n=== Text 3 Bounds ===");
    console.log(this.text3.getTextBounds());
  }

  updateBoundsInfo() {
    if (!this.text1 || !this.boundsText) return;

    const bounds = this.text1.getTextBounds();
    const info = [
      `MaxWidth: ${this.maxWidthValue}px`,
      ``,
      `Text Bounds:`,
      `Width: ${bounds.width.toFixed(1)}px`,
      `Height: ${bounds.height.toFixed(1)}px`,
      ``,
      `Lines:`,
      `Count: ${bounds.lines.count}`,
      `Shortest: ${bounds.lines.shortest.toFixed(1)}px`,
      `Longest: ${bounds.lines.longest.toFixed(1)}px`,
    ].join("\n");

    this.boundsText.setText(info);
  }

  update(time: number) {
    // Animate text2 by pulsing scale
    if (this.text2) {
      const scale = 1 + Math.sin(time / 500) * 0.1;
      this.text2.scaleX = scale;
      this.text2.scaleY = scale;
    }
  }
}

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: 800,
  height: 600,
  backgroundColor: "#2d2d2d",
  scene: WordWrapTestScene,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  plugins: {
    global: [{ key: "MSDFPlugin", plugin: MSDFPlugin, start: true }],
  },
};

new Phaser.Game(config);
