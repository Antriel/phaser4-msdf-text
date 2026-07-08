import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, GlyphState } from "../../src";

// A source string with two hard paragraphs (an explicit '\n') that *also* word-
// wraps, so soft and hard breaks both occur. The highlighted phrase "signed
// distance" straddles a soft break, proving srcIndex targeting is wrap-proof.
const SOURCE =
  "MSDF keeps text crisp at any scale using a signed distance field.\n" +
  "Provenance maps each glyph back to the text you set.";

// Source index range of the phrase "signed distance" in SOURCE.
const PHRASE_START = SOURCE.indexOf("signed distance");
const PHRASE_END = PHRASE_START + "signed distance".length;

const LINE_COLORS = [0xffffff, 0x88ccff];
const SRCLINE_COLORS = [0xffd200, 0x9ae66e];

const MODE_OPTIONS = {
  "srcIndex phrase (wrap-proof)": "srcIndex",
  "visual line (alternate)": "line",
  "source paragraph": "srcLine",
};

/**
 * Glyph provenance — `srcIndex` / `line` / `srcLine`. Each glyph carries where
 * it came from in the original (pre-wrap) string, which visual line it landed
 * on, and which source paragraph it belongs to. A display callback colours the
 * text three ways to show each field. Drag the wrap width and watch the
 * `srcIndex` phrase stay locked onto "signed distance" even as the wrap point —
 * and the glyph count before it — changes.
 */
export class ProvenanceScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = { mode: "srcIndex", maxWidth: 620 };

  constructor() {
    super({ key: "provenance" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x14161d);
    this.heading(
      "Glyph Provenance",
      "srcIndex / line / srcLine — map every glyph back to its source.",
    );

    this.text = this.add
      .msdfText(this.designWidth / 2, 360, "Inter", SOURCE, 40)
      .setColor("#ffffff")
      .setOrigin(0.5)
      .setCenterAlign()
      .setMaxWidth(this.params.maxWidth)
      .setDisplayCallback(this.recolour);

    this.caption(
      "srcIndex indexes the original string (before wrap); line is the visual " +
        "line after wrap; srcLine counts only original newlines.",
    );

    this.commonTargets.push(this.text);
  }

  /** Display callback — colours each glyph from the selected provenance field. */
  private recolour = (glyphs: GlyphState[]): void => {
    const mode = this.params.mode;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      if (mode === "srcIndex") {
        const hit = g.srcIndex >= PHRASE_START && g.srcIndex < PHRASE_END;
        g.setFillColor(hit ? 0xffd200 : 0x6f7680);
      } else if (mode === "line") {
        g.setFillColor(LINE_COLORS[g.line % LINE_COLORS.length]);
      } else {
        g.setFillColor(SRCLINE_COLORS[g.srcLine % SRCLINE_COLORS.length]);
      }
    }
  };

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Provenance" });
    f.addBinding(this.params, "mode", { options: MODE_OPTIONS });
    f.addBinding(this.params, "maxWidth", { min: 260, max: 1100, step: 10 }).on(
      "change",
      (e) => this.text.setMaxWidth(e.value as number),
    );
  }
}
