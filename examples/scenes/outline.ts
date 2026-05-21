import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance } from "../../src";

/**
 * Outlines: a signed-distance border derived from the same field as the glyph,
 * so it stays clean at any size. `rounded` rounds the outer corners using the
 * true SDF in the alpha channel (MTSDF atlases only — all five sample fonts
 * qualify).
 */
export class OutlineScene extends ExampleScene {
  private headline!: MSDFTextInstance;
  private small!: MSDFTextInstance;
  private params = { width: 4, color: "#101018", alpha: 1, rounded: true };

  constructor() {
    super({ key: "outline" });
  }

  protected build(): void {
    // Mid-tone background so a dark or light outline both read.
    this.cameras.main.setBackgroundColor(0x3a3a4a);
    this.heading("Outline", "A distance-field border that holds up at any scale.");

    this.headline = this.add
      .msdfText(640, 300, "Anton", "OUTLINE", 140)
      .setColor("#ffd24a")
      .setOrigin(0.5)
      .setLetterSpacing(13);

    this.small = this.add
      .msdfText(640, 450, "Anton", "crisp down to small sizes", 40)
      .setColor("#ffffff")
      .setOrigin(0.5)
      .setLetterSpacing(4);

    this.applyOutline();
    this.caption(
      "Outline width is in distance-field units; the usable maximum is about half the atlas distanceRange.",
    );

    // The shared Text folder drives the headline.
    this.commonTargets.push(this.headline);
  }

  /** Push the current outline params onto both texts. */
  private applyOutline(): void {
    const { width, color, alpha, rounded } = this.params;
    this.headline.setOutline(width, color, alpha, rounded);
    this.small.setOutline(width, color, alpha, rounded);
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Outline" });
    f.addBinding(this.params, "width", { min: 0, max: 8, step: 0.1 })
      .on("change", () => this.applyOutline());
    f.addBinding(this.params, "color", { view: "color" })
      .on("change", () => this.applyOutline());
    f.addBinding(this.params, "alpha", { min: 0, max: 1, step: 0.05 })
      .on("change", () => this.applyOutline());
    f.addBinding(this.params, "rounded", { label: "rounded corners" })
      .on("change", () => this.applyOutline());
  }
}
