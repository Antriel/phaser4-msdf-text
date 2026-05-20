import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import { FONT_OPTIONS, fontByKey } from "../harness/fonts";
import type { MSDFTextInstance } from "../../src";

/** Vertical centre of each comparison row, in design space. */
const ROW_Y = [190, 400, 610];
const SAMPLE_X = 640;

/**
 * The hero demo: one word rendered three ways — MSDF (this plugin), Phaser
 * BitmapText, and Phaser canvas Text — under a single zoom slider. MSDF stays
 * razor-sharp at any scale; the other two pixelate or blur.
 */
export class CrispScene extends ExampleScene {
  private msdf!: MSDFTextInstance;
  private bitmap!: Phaser.GameObjects.BitmapText;
  private canvasText!: Phaser.GameObjects.Text;

  private readonly baseSize = 48;
  private params = { word: "Sharp", font: "Anton", zoom: 3, autoZoom: false };

  constructor() {
    super({ key: "crisp" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x12141c);

    this.heading(
      "Crisp at Any Scale",
      "Same word, three renderers. Crank the zoom - only MSDF keeps clean edges.",
    );

    this.msdf = this.add
      .msdfText(SAMPLE_X, ROW_Y[0], this.params.font, this.params.word, this.baseSize)
      .setOrigin(0.5);
    this.rowLabel(ROW_Y[0], "MSDF", "phaser4-msdf-font", "#4ade80");

    this.bitmap = this.add
      .bitmapText(SAMPLE_X, ROW_Y[1], fontByKey(this.params.font).bitmapKey, this.params.word, this.baseSize)
      .setOrigin(0.5);
    this.rowLabel(ROW_Y[1], "BitmapText", "Phaser - pixelates", "#f87171");

    this.canvasText = this.add
      .text(SAMPLE_X, ROW_Y[2], this.params.word, {
        fontFamily: this.params.font,
        fontSize: `${this.baseSize}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5);
    this.rowLabel(ROW_Y[2], "Text", "Phaser canvas - blurs", "#f87171");

    this.applyZoom();
  }

  private heading(title: string, sub: string): void {
    this.add.msdfText(SAMPLE_X, 50, "Inter", title, 30).setColor("#ffffff").setOrigin(0.5).setDepth(-1);
    this.add.msdfText(SAMPLE_X, 88, "Inter", sub, 16).setColor("#9aa0aa").setOrigin(0.5).setDepth(-1);
  }

  private rowLabel(y: number, name: string, sub: string, color: string): void {
    this.add.msdfText(44, y - 14, "Inter", name, 24).setColor(color).setOrigin(0, 0.5).setDepth(-1);
    this.add.msdfText(44, y + 16, "Inter", sub, 14).setColor("#9aa0aa").setOrigin(0, 0.5).setDepth(-1);
  }

  private applyZoom(): void {
    this.msdf.setScale(this.params.zoom);
    this.bitmap.setScale(this.params.zoom);
    this.canvasText.setScale(this.params.zoom);
  }

  protected addControls(pane: Pane): void {
    pane.addBinding(this.params, "word").on("change", (e) => {
      this.msdf.setText(e.value);
      this.bitmap.setText(e.value);
      this.canvasText.setText(e.value);
    });
    pane.addBinding(this.params, "font", { options: FONT_OPTIONS }).on("change", (e) => {
      this.msdf.setFont(e.value);
      this.bitmap.setFont(fontByKey(e.value).bitmapKey);
      this.canvasText.setFontFamily(e.value);
    });
    pane
      .addBinding(this.params, "zoom", { min: 0.5, max: 8, step: 0.1 })
      .on("change", () => this.applyZoom());
    pane.addBinding(this.params, "autoZoom", { label: "auto zoom" });
  }

  update(): void {
    if (this.params.autoZoom) {
      this.params.zoom = 4.25 + 3.5 * Math.sin(this.time.now * 0.0006);
      this.applyZoom();
    }
  }
}
