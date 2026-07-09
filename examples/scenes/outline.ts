import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance } from "../../src";

/**
 * Outlines: a signed-distance border derived from the same field as the glyph,
 * so it stays clean at any size. `rounded` rounds the outer corners using the
 * true SDF in the alpha channel (MTSDF atlases only — all five sample fonts
 * qualify).
 *
 * `layered` draws the outline as a silhouette pass under the fill, so a thick
 * outline never spills over the neighbouring glyph. The bottom line uses tight
 * letter spacing to make that overlap obvious — toggle `layered` to see it
 * appear and vanish.
 *
 * `innerColor` ramps the outline from `color` at its outer edge to a second
 * colour where it meets the glyph — a neon tube, a bevel. The inner colour rides
 * the silhouette quad's otherwise-idle fill attribute, so it only exists in the
 * layered pass; setting it turns `layered` on whether or not you asked.
 */
export class OutlineScene extends ExampleScene {
  private headline!: MSDFTextInstance;
  private small!: MSDFTextInstance;
  private tight!: MSDFTextInstance;
  private params = {
    width: 4,
    color: "#101018",
    alpha: 1,
    rounded: true,
    layered: true,
    twoTone: false,
    innerColor: "#ff5ea8",
  };

  constructor() {
    super({ key: "outline" });
  }

  protected build(): void {
    // Mid-tone background so a dark or light outline both read.
    this.cameras.main.setBackgroundColor(0x3a3a4a);
    this.heading(
      "Outline",
      "A distance-field border that holds up at any scale.",
    );

    this.headline = this.add
      .msdfText(640, 260, "Anton", "OUTLINE", 140)
      .setColor("#ffd24a")
      .setOrigin(0.5)
      .setLetterSpacing(13);

    this.small = this.add
      .msdfText(640, 400, "Anton", "crisp down to small sizes", 40)
      .setColor("#ffffff")
      .setOrigin(0.5)
      .setLetterSpacing(4);

    // Deliberately tight spacing so a thick outline overlaps the next glyph —
    // the artifact `layered` removes.
    this.tight = this.add
      .msdfText(640, 500, "Anton", "LAYERED", 90)
      .setColor("#ffd24a")
      .setOrigin(0.5)
      .setLetterSpacing(-2);

    this.applyOutline();
    this.caption(
      "Outline width is in distance-field units; the usable maximum is about half the atlas distanceRange. " +
        "Toggle 'layered' to stop a thick outline overlapping the neighbouring glyph (bottom line). " +
        "'two-tone' ramps the outline across its own band — widen it to see the gradient.",
    );

    // The shared Text folder drives the headline.
    this.commonTargets.push(this.headline);
  }

  /** Push the current outline params onto every text. */
  private applyOutline(): void {
    const { width, color, alpha, rounded, layered, twoTone, innerColor } = this.params;
    const inner = twoTone ? innerColor : null;
    for (const text of [this.headline, this.small, this.tight]) {
      text.setOutline(width, color, alpha, rounded, layered);
      text.setOutlineInnerColor(inner);
    }
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Outline" });
    f.addBinding(this.params, "width", { min: 0, max: 8, step: 0.1 }).on(
      "change",
      () => this.applyOutline(),
    );
    f.addBinding(this.params, "color", { view: "color" }).on("change", () =>
      this.applyOutline(),
    );
    f.addBinding(this.params, "alpha", { min: 0, max: 1, step: 0.05 }).on(
      "change",
      () => this.applyOutline(),
    );
    f.addBinding(this.params, "rounded", { label: "rounded corners" }).on(
      "change",
      () => this.applyOutline(),
    );
    f.addBinding(this.params, "layered", { label: "layered (no overlap)" }).on(
      "change",
      () => this.applyOutline(),
    );
    f.addBinding(this.params, "twoTone", { label: "two-tone" }).on("change", () =>
      this.applyOutline(),
    );
    f.addBinding(this.params, "innerColor", {
      label: "inner color",
      view: "color",
    }).on("change", () => this.applyOutline());
  }
}
