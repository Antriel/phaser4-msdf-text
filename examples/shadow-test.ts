import * as Phaser from "phaser";
import { Pane } from "tweakpane";
import type { MSDFTextInstance, DisplayCallbackData } from "../src";

const COLOR_PRESETS = [
  { label: "Black", color: 0x000000 },
  { label: "Dark Blue", color: 0x000066 },
  { label: "Dark Red", color: 0x660000 },
  { label: "Dark Green", color: 0x006600 },
  { label: "Gray", color: 0x666666 },
];

export class ShadowTestScene extends Phaser.Scene {
  private dynamicTexts: MSDFTextInstance[] = [];
  private currentTime = 0;

  private params = {
    offsetX: 3,
    offsetY: 3,
    alpha: 0.7,
    color: "Black",
    softness: 0,
  };

  constructor() {
    super({ key: "ShadowTestScene" });
  }

  preload() {
    this.load.msdfFont(
      "Roboto_Regular",
      "assets/fonts/Roboto_Regular.png",
      "assets/fonts/Roboto_Regular.json",
    );
  }

  create() {
    const t1 = this.add.msdfText(
      400,
      80,
      "Roboto_Regular",
      "SHADOWED TEXT",
      56,
    );
    const t2 = this.add.msdfText(
      400,
      160,
      "Roboto_Regular",
      "Colorful Shadow",
      42,
    );
    const t3 = this.add.msdfText(400, 230, "Roboto_Regular", "GAME OVER", 64);
    const t4 = this.add.msdfText(
      400,
      310,
      "Roboto_Regular",
      "Small text with shadow",
      24,
    );
    const t5 = this.add.msdfText(
      400,
      370,
      "Roboto_Regular",
      "WAVE WITH SHADOW",
      48,
    );

    t1.setColor("#ffffff");
    t1.setAlign("center");
    t2.setColor("#00ff00");
    t2.setAlign("center");
    t3.setColor("#ffffff");
    t3.setAlign("center");
    t3.setShadow(4, 4, 0x000000, 0.9);
    t4.setColor("#ffff00");
    t4.setAlign("center");
    t4.setShadow(2, 2, 0x000000, 0.4);
    t5.setColor("#00ffff");
    t5.setAlign("center");
    t5.setDisplayCallback((data: DisplayCallbackData) => {
      data.y += Math.sin(data.index * 0.5 + this.currentTime * 0.003) * 20;
      return data;
    });

    // t1 and t2 are driven by the pane; t3/t4 keep fixed shadows for variety
    this.dynamicTexts = [t1, t2, t5];
    this.applyParams();
  }

  setupPane(pane: Pane) {
    pane
      .addBinding(this.params, "offsetX", {
        label: "Offset X",
        min: -20,
        max: 20,
        step: 1,
      })
      .on("change", () => this.applyParams());
    pane
      .addBinding(this.params, "offsetY", {
        label: "Offset Y",
        min: -20,
        max: 20,
        step: 1,
      })
      .on("change", () => this.applyParams());
    pane
      .addBinding(this.params, "alpha", {
        label: "Alpha",
        min: 0,
        max: 1,
        step: 0.05,
      })
      .on("change", () => this.applyParams());
    pane
      .addBinding(this.params, "color", {
        label: "Color",
        options: Object.fromEntries(
          COLOR_PRESETS.map((p) => [p.label, p.label]),
        ),
      })
      .on("change", () => this.applyParams());
    pane
      .addBinding(this.params, "softness", {
        label: "Softness (MTSDF)",
        min: 0,
        max: 16,
        step: 0.5,
      })
      .on("change", () => this.applyParams());

    pane.addButton({ title: "Remove shadow" }).on("click", () => {
      this.params.offsetX = 0;
      this.params.offsetY = 0;
      pane.refresh();
      this.applyParams();
    });
  }

  private applyParams() {
    const preset =
      COLOR_PRESETS.find((p) => p.label === this.params.color) ??
      COLOR_PRESETS[0];
    for (const t of this.dynamicTexts) {
      t.setShadow(
        this.params.offsetX,
        this.params.offsetY,
        preset.color,
        this.params.alpha,
        { softness: this.params.softness },
      );
    }
  }

  update(time: number) {
    this.currentTime = time;
  }
}
