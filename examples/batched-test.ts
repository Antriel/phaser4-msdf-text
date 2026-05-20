import * as Phaser from "phaser";
import type { MSDFTextInstance } from "../src";

export class BatchedTestScene extends Phaser.Scene {
  private text1?: MSDFTextInstance;
  private text2?: MSDFTextInstance;
  private text3?: MSDFTextInstance;
  private fpsText?: MSDFTextInstance;

  constructor() {
    super({ key: "BatchedTestScene" });
  }

  preload() {
    this.load.msdfFont(
      "Roboto_Regular",
      "assets/fonts/Roboto_Regular.png",
      "assets/fonts/Roboto_Regular.json",
    );
  }

  create() {
    this.text1 = this.add.msdfText(
      400,
      100,
      "Roboto_Regular",
      "Batched MSDF Text!",
      48,
    );
    this.text1.setColor("#00ff00");
    this.text1.setAlign("center");
    this.tweens.add({
      targets: this.text1,
      rotation: Math.PI * 2,
      duration: 3000,
      repeat: -1,
      ease: "Linear",
    });

    this.text2 = this.add.msdfText(
      400,
      200,
      "Roboto_Regular",
      "This is batched rendering!\nMultiple lines work too.\nMuch faster than Phase 3!",
      32,
    );
    this.text2.setColor("#ffffff");
    this.text2.setAlign("center");
    this.text2.setLineSpacing(5);

    this.text3 = this.add.msdfText(
      50,
      350,
      "Roboto_Regular",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n" +
        "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n" +
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.\n" +
        "Duis aute irure dolor in reprehenderit in voluptate velit esse.",
      24,
    );
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

    this.fpsText = this.add.msdfText(10, 10, "Roboto_Regular", "FPS: --", 20);
    this.fpsText.setColor("#ff0000");
  }

  update() {
    this.fpsText?.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
    if (this.text2) {
      const hue = (this.time.now / 10) % 360;
      this.text2.setColor(Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1));
    }
  }
}
