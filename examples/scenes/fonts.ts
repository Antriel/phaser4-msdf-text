import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFFont, MSDFTextInstance, Segment, StyleHandle, StyleSpec } from "../../src";

// Gold → ember gradient for the block B title (a per-corner fill).
const TITLE_GRADIENT = {
  topLeft: 0xffe8a3,
  topRight: 0xffd23f,
  bottomLeft: 0xff8c42,
  bottomRight: 0xff5a2c,
};

// Block A — one line, one size, five faces. The baseline is shared and the
// line box grows to the tallest ascender among them; the guide line drawn
// under the glyphs makes the shared baseline visible rather than stated.
//
// `space` is the manual fix for the one thing a mixed-font line cannot do for
// itself: no kern pair exists across a font boundary, so where one face's right
// side bearing meets another's left, the gap is whatever the two happen to add up
// to. Bangers runs tight into Mono, and Mono's wide space glyph leaves Condensed
// stranded — so one boundary is opened and the next is pulled shut (`space` is
// em-relative to the run's own size, and negative tightens). The `optical` toggle
// in the pane turns the corrections off.
const BASELINE: Segment[] = [
  { text: "Inter " },
  { text: "Anton ", font: "Anton", color: 0xffd23f },
  { text: "Bangers ", font: "Bangers", color: 0xff8c42, space: { after: 0.14 } },
  { text: "Mono ", font: "JetBrainsMono", color: 0x7fd4ff, space: { after: -0.18 } },
  { text: "Condensed", font: "RobotoCondensed", color: 0x9ae6b4 },
];

/** The same five runs with every `space` key stripped — the uncorrected line. */
const BASELINE_RAW: Segment[] = BASELINE.map((s) => {
  const { space, ...rest } = s as Exclude<Segment, string>;
  return rest;
});

const BASELINE_FONTS = ["Inter", "Anton", "Bangers", "JetBrainsMono", "RobotoCondensed"];

// Block B — loot-card content. The `readySec()` run is the hidden gem: a
// monospace face, scaled down, underlined — its underline thickness and
// position come from *its* font's metrics, not Inter's, so the rect splits at
// the font boundary.
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

// Block C — per-run size (`fontScale`, a structural key): a line's box grows
// to its tallest run while every run on it keeps one shared baseline.
const SIZED: Segment[] = [
  { text: "Blade of Embers\n", fontScale: 1.5, color: TITLE_GRADIENT },
  "Deals ",
  { text: "50", fontScale: 1.5, color: 0xffd23f },
  " fire damage and inflicts ",
  { text: "Burn", color: 0xff5252 },
  " for 3 turns.\n",
  {
    text: "Forged in dragonflame long ago, when the mountain still burned.",
    fontScale: 0.65,
    color: 0x9a93b3,
  },
];

// Proves a *font* rule survives a text change: 'fire' re-matches in the new
// string and is still rendered in the accent face.
const ALT_TEXT = "The blade grows cold. Its fire fades to embers, and the dragonflame dies.";

const ACCENT_OPTIONS = {
  Bangers: "Bangers",
  Anton: "Anton",
  "JetBrains Mono": "JetBrainsMono",
  "Roboto Condensed": "RobotoCondensed",
};

/**
 * Mixed fonts & sizes — everything visible at once, no modes.
 *
 * A run's advances, kerning, ascender, line height and underline metrics all
 * come from its own font. Lines align by **baseline**, never by top; kerning
 * never crosses a font boundary; a character absent from its run's font is
 * skipped, never borrowed. All five faces here share one merged atlas
 * (msdf-atlas-gen `-and`), so the whole scene is one draw call.
 */
export class FontsScene extends ExampleScene {
  private blockA!: MSDFTextInstance;
  private blockB!: MSDFTextInstance;
  private guide!: Phaser.GameObjects.Graphics;
  private guideLabel!: MSDFTextInstance;
  private baselineY = 0;
  private params = {
    accent: "Bangers",
    fontScale: 1.35,
    altText: false,
    optical: true,
    boundaryKern: 0.08,
  };

  // The persistent 'fire' overlay on block B. `font`/`fontScale` are structural,
  // so handle.update() reflows the text — which is exactly the demo.
  private rule: StyleHandle | null = null;

  constructor() {
    super({ key: "fonts" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x161320);
    this.heading(
      "Mixed Fonts & Sizes",
      "Five typefaces, one text object, one draw call - aligned by baseline.",
    );

    // ── Block A: the shared baseline, drawn ──
    this.blockA = this.add
      .msdfText(640, 150, "Inter", "", 44)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0);

    // The line's baseline sits at the largest ascender among the faces on it.
    // Independent of the spacing, which only moves the pen horizontally.
    const fontCache = this.game.cache.custom.msdfFont;
    const ascent = Math.max(
      ...BASELINE_FONTS.map((key) => (fontCache.get(key) as MSDFFont).getAscender(44)),
    );
    this.baselineY = 150 + ascent;
    this.guide = this.add.graphics().setDepth(-3);
    this.guideLabel = this.add
      .msdfText(0, this.baselineY, "Inter", "baseline", 13)
      .setColor("#4ade80")
      .setAlpha(0.8)
      .setOrigin(0, 0.5)
      .setDepth(-1);
    this.applyBaseline();

    // ── Block B: mixed-font content + the persistent 'fire' rule ──
    this.blockB = this.add
      .msdfText(640, 262, "Inter", "", 40)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(940)
      .setRichText(CONTENT);
    this.applyRule();
    this.applyBoundaryKern();

    // ── Block C: per-run size, shared baseline ──
    this.add
      .msdfText(640, 490, "Inter", "", 28)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(900)
      .setRichText(SIZED);

    this.caption(
      "All five faces live in one merged atlas, so the whole scene is one draw call — verify " +
        "with GL Capture. The mono run's underline takes thickness and position from its own " +
        "font's metrics. No kerning and no glyph fallback across a font boundary; `space` is " +
        "how you reconcile two faces by hand where no kern pair can.",
    );
  }

  /**
   * (Re)set block A and redraw the baseline guide under it. `space` is structural,
   * so the line's width changes with it — and the guide, which brackets the line,
   * has to be redrawn rather than placed once.
   */
  private applyBaseline(): void {
    this.blockA.setRichText(this.params.optical ? BASELINE : BASELINE_RAW);

    const left = 640 - this.blockA.width / 2;
    const right = left + this.blockA.width;
    this.guide
      .clear()
      .lineStyle(1, 0x4ade80, 0.7)
      .lineBetween(left - 20, this.baselineY, right + 20, this.baselineY);
    this.guideLabel.setPosition(right + 30, this.baselineY);
  }

  /**
   * Open every **font boundary** in block B by one amount — the spacing callback's
   * own lane, and the case the per-run `space` key cannot reach: the boundaries are
   * wherever the runs happen to fall (the 'fire' overlay moves them at runtime), so
   * a spec key would mean one overlay per boundary, hand-placed and re-placed. A
   * uniform pad would be no use either — that is just `letterSpacing`. What makes
   * this a *rule* is that only the handful of characters that start a new face pay
   * it, and the callback finds them by reading the resolved layout (`fontAt`).
   *
   * It runs at *rebuild* time, because spacing is layout and not appearance. So the
   * slider calls `refreshSpacing()`: its own input moved while the text did not,
   * which is the one case a rebuild would not catch by itself. At `0` the callback
   * is dropped entirely, putting the pad maps back on their null fast path.
   */
  private applyBoundaryKern(): void {
    if (this.params.boundaryKern === 0) {
      this.blockB.clearSpacingCallback();
      return;
    }
    if (!this.blockB.spacingCallback) {
      this.blockB.setSpacingCallback((pad, src, text) => {
        for (let i = 1; i < src.length; i++) {
          // A pad is real advance, so one at a line start is an indent and one at a
          // line end is width that drags a centred line off centre. Neither is what
          // a boundary wants, and a break is a boundary the eye never sees anyway.
          if (src[i] === "\n" || src[i - 1] === "\n") continue;
          if (text.fontAt(i) !== text.fontAt(i - 1)) {
            pad.before[i] = this.params.boundaryKern;
          }
        }
      });
    } else {
      this.blockB.refreshSpacing();
    }
  }

  /** (Re)apply the 'fire' overlay — a structural update, so block B reflows. */
  private applyRule(): void {
    const spec: StyleSpec = {
      font: this.params.accent,
      fontScale: this.params.fontScale,
      color: 0xff8c42,
    };
    if (this.rule) {
      this.rule.update(spec);
    } else {
      this.rule = this.blockB.addStyle("fire", spec);
    }
  }

  protected addControls(pane: Pane): void {
    const s = pane.addFolder({ title: "spacing" });

    // Per-run `space` (block A): the two hand-tuned boundaries. Off, Bangers runs
    // into Mono and Condensed drifts away from it.
    s.addBinding(this.params, "optical", { label: "space fixes (A)" }).on("change", () =>
      this.applyBaseline(),
    );

    // Per-character pads (block B), via the spacing callback: one rule, every font
    // boundary. Structural, so every step reflows — spacing is layout, not
    // appearance. Switch the accent font below and the boundaries move with it; the
    // rule re-runs on the rebuild and finds them again.
    s.addBinding(this.params, "boundaryKern", {
      label: "boundary kern (B)",
      min: -0.1,
      max: 0.3,
      step: 0.005,
    }).on("change", () => this.applyBoundaryKern());

    const f = pane.addFolder({ title: "'fire' rule (block B)" });

    f.addBinding(this.params, "accent", { label: "accent font", options: ACCENT_OPTIONS }).on(
      "change",
      () => this.applyRule(),
    );
    f.addBinding(this.params, "fontScale", { min: 0.5, max: 2.5, step: 0.05 }).on("change", () =>
      this.applyRule(),
    );

    // setText drops the segments but keeps the overlay: 'fire' is anchored to
    // content, so it re-derives against the new string and is still in the
    // accent face afterwards. Restoring re-applies the content; the overlay
    // never went away.
    f.addBinding(this.params, "altText", { label: "change text (setText)" }).on("change", (e) => {
      if (e.value) this.blockB.setText(ALT_TEXT);
      else this.blockB.setRichText(CONTENT);
    });
  }
}
