import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, Segment, StyleHandle, RuleStyleSpec } from "../../src";

// Gold → ember gradient for the display line.
const TITLE_GRADIENT = {
  topLeft: 0xffe8a3,
  topRight: 0xffd23f,
  bottomLeft: 0xff8c42,
  bottomRight: 0xff5a2c,
};

/**
 * Mixed fonts in one text object. Every styled run names an `msdfFont` cache key
 * that {@link preloadFonts} already loaded. The bare strings stay in the object's
 * own font ("Inter").
 *
 * The `readySec()` run is the interesting one: a monospace face, scaled down,
 * underlined. Its underline thickness and position come from *its* font's
 * metrics, not Inter's, so the rect splits at the run boundary.
 */
const CONTENT: Segment[] = [
  { text: "DRAGONFLAME\n", font: "Anton", fontScale: 1.7, color: TITLE_GRADIENT },
  "Deals ",
  { text: "50", font: "Bangers", fontScale: 1.35, color: 0xffd23f },
  " fire damage over ",
  { text: "3", font: "Bangers", fontScale: 1.35, color: 0xffd23f },
  " turns.\n",
  "Cooldown ",
  { text: "readySec()", font: "JetBrainsMono", fontScale: 0.8, color: 0x7fd4ff, underline: true },
  " seconds.",
];

// One line, one size, five faces — the baseline is shared, the line box grows to
// the tallest ascender among them. Nothing here sets `fontScale`.
const BASELINE: Segment[] = [
  { text: "Inter " },
  { text: "Anton ", font: "Anton", color: 0xffd23f },
  { text: "Bangers ", font: "Bangers", color: 0xff8c42 },
  { text: "Mono ", font: "JetBrainsMono", color: 0x7fd4ff },
  { text: "Condensed", font: "RobotoCondensed", color: 0x9ae6b4 },
];

// Proves a *font* rule survives a text change: 'fire' re-matches in the new
// string and is still rendered in the accent face.
const ALT_TEXT = "The blade grows cold. Its fire fades to embers, and the dragonflame dies.";

const MODE_OPTIONS = {
  "Mixed segments": "content",
  "Font rule (setTextStyle)": "rule",
  "Baseline across faces": "baseline",
};

const ACCENT_OPTIONS = {
  Bangers: "Bangers",
  Anton: "Anton",
  "JetBrains Mono": "JetBrainsMono",
  "Roboto Condensed": "RobotoCondensed",
};

/**
 * Per-run **font** — the structural sibling of `fontScale`.
 *
 * A run's advances, kerning, ascender, line height and underline metrics all come
 * from its own font. Three consequences the modes below show:
 *
 *   • A line's height and baseline take the largest metric among the runs on it,
 *     so mixed faces align by **baseline**, not by top.
 *   • Kerning never crosses a font boundary, and there is **no glyph fallback** —
 *     a character absent from its run's font is skipped, not borrowed.
 *   • A run whose font uses a different atlas texture ends the draw call. Generate
 *     one merged atlas (`msdf-atlas-gen -and`) if you mix fonts heavily.
 *
 * Like `fontScale`, `font` is legal only on the layers that resolve *before*
 * layout — `setRichText` segments and `setTextStyle` rules. It reflows rather
 * than re-seeding, and `addStyleRange` rejects it.
 */
export class PerRunFontScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = { mode: "content", accent: "Bangers", fontScale: 1.35, altText: false };

  // The live 'fire' rule in rule mode, so the accent dropdown can re-point it at
  // a different face. `font` is structural, so this update reflows.
  private ruleHandle: StyleHandle<RuleStyleSpec> | null = null;

  constructor() {
    super({ key: "perrunfont" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x161320);
    this.heading(
      "Per-Run Font",
      "Mixed typefaces in one text object - one layout, shared baselines.",
    );

    this.text = this.add
      .msdfText(this.designWidth / 2, 220, "Inter", "", 44)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(940);

    this.applyMode("content");

    this.caption(
      "Each run measures, wraps and kerns in its own font. Lines align by " +
        "baseline, never by top. No kerning and no glyph fallback across a font " +
        "boundary. Rules carrying a font survive a text change.",
    );

    this.commonTargets.push(this.text);
  }

  /** Rebuild the styling for the selected mode from a clean slate. */
  private applyMode(mode: string): void {
    this.params.altText = false;

    this.text.clearStyles();
    this.ruleHandle = null;

    if (mode === "baseline") {
      this.text.setRichText(BASELINE);
      return;
    }

    this.text.setRichText(CONTENT);

    if (mode === "rule") {
      // A structural rule: every "fire" switches face *and* size. Rules re-match
      // before the layout pass, which is exactly why they may carry `font`.
      this.ruleHandle = this.text.setTextStyle("fire", {
        font: this.params.accent,
        fontScale: this.params.fontScale,
        color: 0xff8c42,
      });
    }
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Per-run font" });

    f.addBinding(this.params, "mode", { options: MODE_OPTIONS }).on("change", (e) =>
      this.applyMode(e.value as string),
    );

    // Re-point the 'fire' rule at another face. A font change is structural, so
    // handle.update() routes to a rebuild — the text reflows as advances change.
    f.addBinding(this.params, "accent", { label: "accent font", options: ACCENT_OPTIONS }).on(
      "change",
      (e) => {
        if (this.params.mode === "rule" && this.ruleHandle) {
          this.ruleHandle.update({
            font: e.value as string,
            fontScale: this.params.fontScale,
            color: 0xff8c42,
          });
        }
      },
    );

    f.addBinding(this.params, "fontScale", {
      label: "fontScale (fire)",
      min: 0.5,
      max: 2.5,
      step: 0.05,
    }).on("change", (e) => {
      if (this.params.mode === "rule" && this.ruleHandle) {
        this.ruleHandle.update({
          font: this.params.accent,
          fontScale: e.value as number,
          color: 0xff8c42,
        });
      }
    });

    // setText drops the segments but keeps the rules, which re-match against the
    // new string — so 'fire' is still in the accent face afterwards.
    f.addBinding(this.params, "altText", { label: "change text (setText)" }).on(
      "change",
      (e) => {
        if (e.value) this.text.setText(ALT_TEXT);
        else this.applyMode(this.params.mode);
      },
    );
  }
}
