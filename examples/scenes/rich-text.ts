import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, GlyphState, Segment, StyleHandle, RuleStyleSpec } from "../../src";

// Gold → ember gradient (a per-corner fill).
const NAME_GRADIENT = {
  topLeft: 0xffe8a3,
  topRight: 0xffd23f,
  bottomLeft: 0xff8c42,
  bottomRight: 0xff5a2c,
};

// The content layer. Bare strings are unstyled; objects carry per-run
// appearance overrides. Note "dragonflame" is a *bare* string here — its
// gradient and skew come from a persistent rule, so the skew slider can own it
// and it survives a text change.
const CONTENT: Segment[] = [
  "You found the ",
  // Per-run drop shadow — renders even though the object itself has no shadow
  // (the run sets a shadow, so the shadow pass runs and only these glyphs draw).
  {
    text: "Blade of Embers",
    color: NAME_GRADIENT,
    shadow: { color: 0x000000, alpha: 0.7, x: 3, y: 3 },
  },
  "!\nIt deals ",
  // Per-run weight (faux bold) + per-run scale, both appearance-lane.
  { text: "50", color: 0xffd23f, scale: 1.15, weight: 2 },
  " fire damage and inflicts ",
  { text: "Burn", color: 0xff5252 },
  " for 3 turns. Forged in dragonflame long ago.",
];

// An alternate body used by "change text" to prove rule persistence (the
// 'fire' and 'dragonflame' rules re-match) and range transience (any find
// highlights are dropped).
const ALT_TEXT =
  "The blade grows cold.\nIts fire fades, and the dragonflame dies to embers.";

/**
 * Rich text — all four style layers live at once, painted in order:
 *   • setRichText  — content styling that travels with the text
 *   • setTextStyle — persistent keyword rules, re-matched on every text change
 *   • addStyleRange— transient index ranges, dropped by any text change
 *   • displayCallback — per-frame composition on top of the resolved styles
 *
 * The interactions prove the lifetimes: type in `find` and ranges light up
 * every match; flip `change text` and the rules re-match while the ranges
 * vanish; the skew slider drives a rule's handle.update in either text state.
 */
export class RichTextScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = { find: "", skew: 0.22, altText: false };

  // The persistent 'dragonflame' rule, so the skew slider can re-style it
  // without touching any other layer (an appearance-only coalesced re-seed).
  private skewRule: StyleHandle<RuleStyleSpec> | null = null;

  // Source-index span of "Burn" in the current plain text (-1 when absent).
  // The pulse callback filters on GlyphState.srcIndex — the glyph's index into
  // the *source* string — which is all that survives of the old provenance
  // example, and the piece that makes text-anchored per-glyph animation work.
  private burnAt = -1;
  private burnEnd = -1;

  constructor() {
    super({ key: "richtext" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x161320);
    this.heading(
      "Rich Text",
      "Segments, rules, ranges and a display callback - four layers, one text.",
    );

    this.text = this.add
      .msdfText(this.designWidth / 2, 250, "Inter", "", 44)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(900);

    this.applyAll();

    this.caption(
      "Paint order: segments → rules → ranges → callback. The text getter still returns the " +
        "plain string. Rules survive a text change and re-match; ranges are dropped by one. " +
        "The callback layers alpha over the rule's colour, keyed on each glyph's srcIndex.",
    );

    this.commonTargets.push(this.text);
  }

  /**
   * Deterministic reset: content + rules from scratch for the current text
   * state, then the find ranges on top. Ranges have no individual teardown —
   * clearStyles drops rules *and* ranges, so everything re-applies in paint
   * order.
   */
  private applyAll(): void {
    this.text.clearStyles();
    this.skewRule = null;

    if (this.params.altText) {
      this.text.setText(ALT_TEXT);
    } else {
      this.text.setRichText(CONTENT);
    }

    // Rules (persistent): every "dragonflame" gets the gradient + the
    // slider's skew; every "fire" turns orange.
    this.skewRule = this.text.setTextStyle("dragonflame", {
      color: NAME_GRADIENT,
      skew: this.params.skew,
    });
    this.text.setTextStyle("fire", { color: 0xff8c42 });
    // nth + wholeWord targeting: only the first standalone "the" turns blue
    // (in either text state — rules re-match, options included).
    this.text.setTextStyle("the", { color: 0x7fd4ff }, { nth: 0, wholeWord: true });

    this.seedBurn();
    this.applyFind();
  }

  /** Anchor the pulse to "Burn" in the current plain text (absent from ALT_TEXT). */
  private seedBurn(): void {
    const plain = this.text.text;
    this.burnAt = plain.indexOf("Burn");
    this.burnEnd = this.burnAt + "Burn".length;
    this.text.setDisplayCallback(this.burnPulse);
  }

  /** Transient ranges: a yellow recolour over every match of the find string. */
  private applyFind(): void {
    const needle = this.params.find;
    if (!needle) return;
    const plain = this.text.text;
    for (let at = plain.indexOf(needle); at >= 0; at = plain.indexOf(needle, at + needle.length)) {
      this.text.addStyleRange(at, needle.length, { color: 0xffe066, scale: 1.06 });
    }
  }

  /**
   * Composition: the callback sees the already-styled glyphs and layers alpha
   * on top, so the rule's red holds while the word pulses.
   */
  private burnPulse = (glyphs: GlyphState[]): void => {
    if (this.burnAt < 0) return;
    const t = this.time.now / 1000;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      if (g.srcIndex >= this.burnAt && g.srcIndex < this.burnEnd) {
        g.setFillAlpha(0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 5 + i)));
      }
    }
  };

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Rich text" });

    // Re-applies content + rules from scratch, then ranges over every match —
    // try "fire" or "Embers".
    f.addBinding(this.params, "find").on("change", () => this.applyAll());

    // Drives the 'dragonflame' rule's handle.update — an appearance-only
    // change, so it re-seeds without reflowing, in either text state.
    f.addBinding(this.params, "skew", { min: -0.5, max: 0.5, step: 0.01 }).on("change", (e) => {
      this.skewRule?.update({ color: NAME_GRADIENT, skew: e.value });
    });

    // The three lifetimes in one click: setText keeps the rules (they re-match
    // 'fire' and 'dragonflame' in the new string), drops the segments, and
    // kills any find ranges. Restoring re-applies everything.
    f.addBinding(this.params, "altText", { label: "change text (setText)" }).on("change", (e) => {
      if (e.value) {
        this.text.setText(ALT_TEXT);
        this.seedBurn();
      } else {
        this.applyAll();
      }
    });
  }
}
