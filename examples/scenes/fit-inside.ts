import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import { FONT_OPTIONS } from "../harness/fonts";
import type { MSDFTextInstance, RectLike, FitOptions } from "../../src";

const PARAGRAPH =
  "MSDF stays crisp at any scale, so `fitInside` doesn't just scale the text - " +
  "it reflows it. A bigger font wraps to fewer words per line, changing the " +
  "shape of the block, and the binary search finds the largest size that still " +
  "fits the box on both axes.";

// The fit box, in design space. Width/height are driven by the controls; x/y
// stay fixed so the box is anchored while the text reflows and re-places inside.
// BOX_X is chosen so the widest box (max width) is centred in the design area,
// and BOX_Y leaves the tallest box clear of the footer caption.
const BOX_X = 190;
const BOX_Y = 140;

/**
 * fitInside: reflowing fit-to-box. The paragraph is binary-searched to the
 * largest font size whose *wrapped* layout fits the box on both axes, then
 * placed inside it via hAlign/vAlign. Drag the box width/height and watch the
 * font size (and the number of lines) change - shrinking the box height picks a
 * smaller font; widening it (fixed height) picks a larger one, because fewer
 * lines are needed. Swap the font to see the fit follow the new metrics.
 */
export class FitInsideScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private guide!: Phaser.GameObjects.Graphics;
  private readout!: MSDFTextInstance;

  private params = {
    font: "Inter",
    width: 620,
    height: 300,
    maxFontSize: 50,
    align: "center" as "left" | "center" | "right",
    hAlign: "center" as NonNullable<FitOptions["hAlign"]>,
    vAlign: "middle" as NonNullable<FitOptions["vAlign"]>,
    letterSpacing: 0,
    lineSpacing: 0,
  };

  constructor() {
    super({ key: "fitinside" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x161a22);
    this.heading("Fit Inside", "Reflow to a box - not just scale - via binary search on font size.");

    this.guide = this.add.graphics().setDepth(-1);

    this.text = this.add.msdfText(0, 0, "Inter", PARAGRAPH, 40).setColor("#eef1f7").setCenterAlign();

    this.readout = this.add
      .msdfText(BOX_X, BOX_Y - 16, "Inter", "", 16)
      .setColor("#8ea2c6")
      .setOrigin(0, 1);

    this.fit();
    this.caption(
      "Shrink-only by default; raise maxFontSize to let it grow. The chosen size " +
        "is fractional by design.",
    );
  }

  /** Re-run the fit for the current box + options and refresh the guide/readout. */
  private fit(): void {
    const rect: RectLike = {
      x: BOX_X,
      y: BOX_Y,
      width: this.params.width,
      height: this.params.height,
    };
    this.text.fitInside(rect, {
      maxFontSize: this.params.maxFontSize,
      hAlign: this.params.hAlign,
      vAlign: this.params.vAlign,
    });

    this.guide
      .clear()
      .fillStyle(0x0d1017, 1)
      .fillRect(rect.x!, rect.y!, rect.width, rect.height)
      .lineStyle(2, 0x3f6bd4, 1)
      .strokeRect(rect.x!, rect.y!, rect.width, rect.height);

    this.readout.setText(
      `font size ${this.text.fontSize.toFixed(1)}px  ` +
        `•  block ${Math.round(this.text.width)}x${Math.round(this.text.height)}`,
    );
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Fit box" });
    const refit = () => this.fit();
    f.addBinding(this.params, "font", { options: FONT_OPTIONS }).on("change", (e) => {
      this.text.setFont(e.value as string);
      this.fit();
    });
    f.addBinding(this.params, "width", { min: 160, max: 900, step: 10 }).on("change", refit);
    f.addBinding(this.params, "height", { min: 80, max: 500, step: 10 }).on("change", refit);
    f.addBinding(this.params, "maxFontSize", { label: "max font size", min: 10, max: 200, step: 1 }).on(
      "change",
      refit,
    );

    // Line alignment within the block (the object's own `align`) composes with
    // the block-placement hAlign/vAlign below — e.g. right-aligned lines pinned
    // to the top-right corner of the box.
    f.addBinding(this.params, "align", {
      options: { left: "left", center: "center", right: "right" },
    }).on("change", (e) => {
      this.text.align = e.value as "left" | "center" | "right";
      this.fit();
    });
    f.addBinding(this.params, "hAlign", {
      options: { left: "left", center: "center", right: "right" },
    }).on("change", refit);
    f.addBinding(this.params, "vAlign", {
      options: { top: "top", middle: "middle", bottom: "bottom" },
    }).on("change", refit);

    // Spacing is constant px (doesn't scale with the fitted size) but does feed
    // measurement, so a change re-runs the fit.
    f.addBinding(this.params, "letterSpacing", { label: "letter spacing", min: -5, max: 20, step: 0.5 }).on(
      "change",
      (e) => {
        this.text.setLetterSpacing(e.value as number);
        this.fit();
      },
    );
    f.addBinding(this.params, "lineSpacing", { label: "line spacing", min: -10, max: 40, step: 1 }).on(
      "change",
      (e) => {
        this.text.setLineSpacing(e.value as number);
        this.fit();
      },
    );
  }
}
