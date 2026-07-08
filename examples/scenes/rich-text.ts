import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, GlyphState, Segment, StyleHandle } from "../../src";

// Gold → ember gradient for the item name (a per-corner fill).
const NAME_GRADIENT = {
  topLeft: 0xffe8a3,
  topRight: 0xffd23f,
  bottomLeft: 0xff8c42,
  bottomRight: 0xff5a2c,
};

// The rich-text content. Bare strings are unstyled; objects carry per-run
// appearance overrides. Concatenated, the text reads:
//   "You found the Blade of Embers!\nIt deals 50 fire damage and inflicts Burn
//    for 3 turns. Forged in dragonflame long ago."
const CONTENT: Segment[] = [
  "You found the ",
  { text: "Blade of Embers", color: NAME_GRADIENT },
  "!\nIt deals ",
  { text: "50", color: 0xffd23f, scale: 1.15 },
  " fire damage and inflicts ",
  { text: "Burn", color: 0xff5252 },
  " for 3 turns. Forged in ",
  { text: "dragonflame", color: NAME_GRADIENT, skew: 0.2 },
  " long ago.",
];

// An alternate body used by "Change text" to prove rule persistence (the 'fire'
// rule re-matches) and range transience (highlights are dropped).
const ALT_TEXT =
  "The blade grows cold.\nIts fire fades, and the dragonflame dies to embers.";

const MODE_OPTIONS = {
  "Content segments": "content",
  "Keyword rule (setTextStyle)": "rule",
  "Range highlight (addStyleRange)": "range",
  "Skew - faux italic": "skew",
  "Composition (rule + callback)": "composition",
};

/**
 * Rich text — per-run styling without markup, via three entry points:
 *   • setRichText  — content styling that travels with the text
 *   • setTextStyle — a persistent keyword rule, re-matched on every text change
 *   • addStyleRange— a transient index range, dropped on any text change
 * plus baseline **skew** (faux italic) and composition with a displayCallback.
 * Switch modes to see each layer; the paint order is segments → rules → ranges
 * → callback, applied key-by-key.
 */
export class RichTextScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = { mode: "content", skew: 0.22, altText: false };

  // Live handles for the persistent rule / transient range of the current mode.
  private ruleHandle: StyleHandle | null = null;
  private rangeHandle: StyleHandle | null = null;

  constructor() {
    super({ key: "richtext" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x161320);
    this.heading(
      "Rich Text",
      "Per-run colour, gradient, shadow and skew - no markup in the string.",
    );

    this.text = this.add
      .msdfText(this.designWidth / 2, 250, "Inter", "", 44)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(900);

    this.applyMode("content");

    this.caption(
      "text getter still returns the plain string; wrapping is unaffected. " +
        "Rules survive a text change and re-match; ranges are dropped.",
    );

    this.commonTargets.push(this.text);
  }

  /** Rebuild the styling for the selected mode from a clean slate. */
  private applyMode(mode: string): void {
    this.params.altText = false; // a mode switch is a fresh start on the base text

    // Drop the previous mode's rule/range, then re-lay the content. clearStyles
    // removes rules + ranges; setRichText replaces the content (and its styles).
    this.text.clearStyles();
    this.text.clearDisplayCallback();
    this.ruleHandle = null;
    this.rangeHandle = null;

    this.text.setRichText(CONTENT);

    const plain = this.text.text as string;

    if (mode === "rule") {
      // Every "fire" turns orange — a persistent policy, not tied to indices.
      this.ruleHandle = this.text.setTextStyle("fire", { color: 0xff8c42 });
      // A second rule shows nth targeting: only the first "the".
      this.text.setTextStyle("the", { color: 0x7fd4ff }, { nth: 0, wholeWord: true });
    } else if (mode === "range") {
      // A search-hit style highlight, anchored to indices in the current text
      // (only "Blade of Embers" exists in the base content). Recolour + a slight
      // enlarge — the classic transient use of addStyleRange.
      const name = "Blade of Embers";
      const at = plain.indexOf(name);
      if (at >= 0) {
        this.rangeHandle = this.text.addStyleRange(at, name.length, {
          color: 0xffe066,
          scale: 1.06,
        });
      }
    } else if (mode === "skew") {
      // A rule so the slider can drive handle.update (a coalesced re-seed, no
      // relayout). "damage" carries a 'g' descender — it leans with the rest.
      this.ruleHandle = this.text.setTextStyle("fire damage", {
        color: 0xffb37a,
        skew: this.params.skew,
      });
    } else if (mode === "composition") {
      // A static keyword rule *and* a per-frame callback: the callback sees the
      // already-styled glyphs and layers alpha on top, so the colour holds while
      // the word pulses.
      this.ruleHandle = this.text.setTextStyle("Burn", { color: 0xff5252 });
      const burnAt = plain.indexOf("Burn");
      const burnEnd = burnAt + "Burn".length;
      this.text.setDisplayCallback((glyphs: GlyphState[]) => {
        const t = this.time.now / 1000;
        for (let i = 0; i < glyphs.length; i++) {
          const g = glyphs[i];
          if (g.srcIndex >= burnAt && g.srcIndex < burnEnd) {
            g.setFillAlpha(0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 5 + i)));
          }
        }
      });
    }
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Rich text" });

    f.addBinding(this.params, "mode", { options: MODE_OPTIONS }).on("change", (e) =>
      this.applyMode(e.value as string),
    );

    // Skew slider — only meaningful in skew mode; drives handle.update live.
    f.addBinding(this.params, "skew", { min: -0.5, max: 0.5, step: 0.01 }).on(
      "change",
      (e) => {
        if (this.params.mode === "skew" && this.ruleHandle) {
          this.ruleHandle.update({ color: 0xffb37a, skew: e.value as number });
        }
      },
    );

    // Prove rule persistence + range transience with a *real* text change.
    // setText keeps rules (they re-match 'fire'/'the' in the new text) and
    // clears segments; any active range is dropped and its handle dies. Toggle
    // back to restore the styled content for the current mode.
    f.addBinding(this.params, "altText", { label: "change text (setText)" }).on(
      "change",
      (e) => {
        if (e.value) this.text.setText(ALT_TEXT);
        else this.applyMode(this.params.mode);
      },
    );
  }
}
