import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance } from "../../src";

const PARAGRAPH =
  "Multi-channel signed distance fields keep every edge sharp while a single " +
  "texture serves all sizes. Word wrap, alignment, line and letter spacing, " +
  "and kerning are all measured from the same font metrics.";

const GUIDE_TOP = 200;

/**
 * Layout: word wrapping inside a `maxWidth`, with the shared Text folder driving
 * alignment, line/letter spacing and font (switch fonts to see kerning differ).
 * A guide rectangle visualises the current wrap width.
 */
export class LayoutScene extends ExampleScene {
  private paragraph!: MSDFTextInstance;
  private guide!: Phaser.GameObjects.Graphics;
  private params = { maxWidth: 720 };

  constructor() {
    super({ key: "layout" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x1a1d27);
    this.heading("Text Layout", "Word wrap, alignment and spacing - measured, not guessed.");

    this.guide = this.add.graphics().setDepth(-1);

    this.paragraph = this.add
      .msdfText(640, GUIDE_TOP, "Inter", PARAGRAPH, 36)
      .setColor("#e8eaf0")
      .setOrigin(0.5, 0)
      .setMaxWidth(this.params.maxWidth)
      .setCenterAlign();

    this.drawGuide();
    this.caption(
      "Switch fonts in the Text folder to compare kerning - Bangers and Inter are rich, JetBrains Mono has none.",
    );

    this.commonTargets.push(this.paragraph);
  }

  /** Redraw the wrap-width guide rectangle around the current paragraph. */
  private drawGuide(): void {
    const w = this.params.maxWidth;
    this.guide
      .clear()
      .lineStyle(2, 0x4a5066, 1)
      .strokeRect(640 - w / 2, GUIDE_TOP, w, this.paragraph.height);
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Layout" });
    f.addBinding(this.params, "maxWidth", { label: "max width", min: 200, max: 1000, step: 10 })
      .on("change", (e) => this.paragraph.setMaxWidth(e.value));
  }

  update(): void {
    // The shared Text folder can change font/size/spacing, which changes the
    // wrapped height — redraw the guide every frame so it always fits.
    this.drawGuide();
  }
}
