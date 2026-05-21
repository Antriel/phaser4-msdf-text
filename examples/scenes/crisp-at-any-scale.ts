import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import { FONT_OPTIONS, fontByKey } from "../harness/fonts";
import type { MSDFTextInstance } from "../../src";

/** Vertical centre of each comparison row, in design space. */
const ROW_Y = [190, 400, 610];
const SAMPLE_X = 640;

/**
 * The hero demo: one word rendered three ways under a font-size slider.
 * MSDF stays crisp at any size. BitmapText blurs when scaled away from its
 * atlas size. Canvas Text re-renders sharply but is slower.
 */
export class CrispScene extends ExampleScene {
  private msdf!: MSDFTextInstance;
  private bitmap!: Phaser.GameObjects.BitmapText;
  private canvasText!: Phaser.GameObjects.Text;

  private params = { word: "Sharp", font: "Anton", fontSize: 100, rotation: 0 };

  constructor() {
    super({ key: "crisp" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x12141c);

    this.heading(
      "Crisp at Any Scale",
      "Same word, three renderers. Change the size - MSDF stays crisp; BitmapText blurs; canvas Text re-renders.",
    );

    this.msdf = this.add
      .msdfText(SAMPLE_X, ROW_Y[0], this.params.font, this.params.word, this.params.fontSize)
      .setOrigin(0.5);
    this.rowLabel(ROW_Y[0], "MSDF", "phaser4-msdf-text · always crisp", "#4ade80");

    this.bitmap = this.add
      .bitmapText(SAMPLE_X, ROW_Y[1], fontByKey(this.params.font).bitmapKey, this.params.word, this.params.fontSize)
      .setOrigin(0.5);
    this.rowLabel(ROW_Y[1], "BitmapText", "fixed atlas · blurs off native size", "#f87171");

    this.canvasText = this.add
      .text(SAMPLE_X, ROW_Y[2], this.params.word, {
        fontFamily: this.params.font,
        fontSize: `${this.params.fontSize}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5);
    this.rowLabel(ROW_Y[2], "Text", "re-renders at each size · slower · more memory", "#fbbf24");
  }

  private rowLabel(y: number, name: string, sub: string, color: string): void {
    this.add.msdfText(44, y - 14, "Inter", name, 24).setColor(color).setOrigin(0, 0.5).setDepth(-1);
    this.add.msdfText(44, y + 16, "Inter", sub, 14).setColor("#9aa0aa").setOrigin(0, 0.5).setDepth(-1);
  }

  private applyFontSize(): void {
    this.msdf.setFontSize(this.params.fontSize);
    this.bitmap.setFontSize(this.params.fontSize);
    this.canvasText.setFontSize(`${this.params.fontSize}px`);
  }

  private applyRotation(): void {
    this.msdf.setAngle(this.params.rotation);
    this.bitmap.setAngle(this.params.rotation);
    this.canvasText.setAngle(this.params.rotation);
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
      .addBinding(this.params, "fontSize", { min: 12, max: 180, step: 1, label: "font size" })
      .on("change", () => this.applyFontSize());
    pane
      .addBinding(this.params, "rotation", { min: -10, max: 10, step: 0.1 })
      .on("change", () => this.applyRotation());
  }
}
