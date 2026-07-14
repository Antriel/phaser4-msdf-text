import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, GlyphState, Segment, StyleHandle, StyleSpec } from "../../src";

// Gold → ember gradient (a per-corner fill).
const NAME_GRADIENT = {
  topLeft: 0xffe8a3,
  topRight: 0xffd23f,
  bottomLeft: 0xff8c42,
  bottomRight: 0xff5a2c,
};

// The content layer. Bare strings are unstyled; objects carry per-run
// appearance overrides. Note "dragonflame" is a *bare* string here — its
// gradient and skew come from a content-anchored overlay, so the skew slider
// can own it and it survives a text change.
const CONTENT = (weapon: string): Segment[] => [
  "You found the ",
  // Per-run drop shadow — renders even though the object itself has no shadow
  // (the run sets a shadow, so the shadow pass runs and only these glyphs draw).
  // `id` names the run so an overlay can address it by name — see `rarityRule`.
  {
    text: weapon,
    id: "weapon",
    shadow: { color: 0x000000, alpha: 0.7, x: 3, y: 3 },
  },
  "!\nIt deals ",
  // Per-run weight (faux bold) + per-run scale, both appearance-lane.
  { text: "50", color: 0xffd23f, scale: 1.15, weight: 2 },
  " fire damage and inflicts ",
  { text: "Burn", color: 0xff5252 },
  " for 3 turns. Forged in dragonflame long ago.",
];

// The weapon names `reforge` cycles through. Each `setRichText` replaces the
// content, but the segment keeps its `id`, so the rarity overlay follows it to
// the new span without being re-declared.
const WEAPONS = ["Blade of Embers", "Cinderfang", "Ashmourne, the Last Kindling"];

// What the `{ segment: 'weapon' }` overlay paints. The segment itself carries no
// colour — its look is entirely the overlay's, which is the point: one named
// piece, restyled through a handle, with no `setRichText` call in sight.
const RARITY: Record<string, StyleSpec> = {
  legendary: { color: NAME_GRADIENT },
  cursed: { color: 0xb388ff, weight: 1.5 },
  common: { color: 0xd8d4e8 },
};

// An alternate body used by "change text" to prove that content anchors
// survive (the 'fire', 'dragonflame' and /\d+/ overlays re-derive) while
// position anchors die (any find highlights are dropped).
const ALT_TEXT =
  "The blade grows cold.\nIts fire fades, and 3 dragonflame embers die out.";

/**
 * Rich text — every style layer live at once, painted in order:
 *   • setRichText — content styling that travels with the text
 *   • addStyle    — overlays, in the order added; the last one wins on overlap
 *   • displayCallback — per-frame composition on top of the resolved styles
 *
 * One method, and the *anchor* decides the lifetime. A string, a RegExp or a
 * matcher function anchors to content, so the overlay re-derives its spans on
 * every text change and survives it. A `{ start, length }` anchors to positions
 * in the text the caller indexed, so any text change drops it and kills its
 * handle.
 *
 * A third anchor addresses a *named segment*: `{ segment: 'weapon' }` finds the
 * run by its `id`, wherever the last `setRichText` put it. Content-anchored, so
 * `reforge` can swap the weapon's name and the rarity overlay follows it; while
 * `change text` has replaced the segments entirely it holds no spans, drawing
 * nothing, and revives when they come back.
 *
 * The interactions prove that: type in `find` and position-anchored overlays
 * light up every match (and bump its size — a structural key, legal on any
 * layer now, so the text reflows); flip `change text` and the content anchors
 * re-derive while the find highlights vanish; the skew slider drives one
 * overlay's handle.update in either text state.
 */
export class RichTextScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = { find: "", skew: 0.22, altText: false, rarity: "legendary" };

  // The content-anchored 'dragonflame' overlay, so the skew slider can re-style
  // it without touching any other layer (an appearance-only coalesced re-seed).
  private skewRule: StyleHandle | null = null;

  // The `{ segment: 'weapon' }` overlay. Survives `reforge`'s setRichText, so the
  // rarity dropdown never has to know what the weapon is currently called.
  private rarityRule: StyleHandle | null = null;

  // Which name `reforge` shows next.
  private weapon = 0;

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
      "Segments, overlays and a display callback - one spec, one text.",
    );

    this.text = this.add
      .msdfText(this.designWidth / 2, 250, "Inter", "", 44)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(900);

    this.applyAll();

    this.caption(
      "Paint order: segments -> overlays (in the order added) -> callback; the style added last " +
        "wins where two overlap. The text getter still returns the plain string. Content-anchored " +
        "overlays survive a text change and re-derive; position-anchored ones are dropped by it. " +
        "The callback layers alpha over the overlay's colour, keyed on each glyph's srcIndex.",
    );

    this.commonTargets.push(this.text);
  }

  /**
   * Deterministic reset: content + content-anchored overlays from scratch for
   * the current text state, then the find highlights on top. `clearStyles` drops
   * every overlay at once, so all of them re-apply in creation order.
   */
  private applyAll(): void {
    this.text.clearStyles();
    this.skewRule = null;
    this.rarityRule = null;

    if (this.params.altText) {
      this.text.setText(ALT_TEXT);
    } else {
      this.text.setRichText(CONTENT(WEAPONS[this.weapon]));
    }

    // Content anchors (persistent): every "dragonflame" gets the gradient + the
    // slider's skew; every "fire" turns orange.
    this.skewRule = this.text.addStyle("dragonflame", {
      color: NAME_GRADIENT,
      skew: this.params.skew,
    });
    this.text.addStyle("fire", { color: 0xff8c42 });
    // nth + wholeWord targeting: only the first standalone "the" turns blue
    // (in either text state — content anchors re-derive, options included).
    this.text.addStyle({ match: "the", nth: 0, wholeWord: true }, { color: 0x7fd4ff });
    // A RegExp anchor. "50" already carries a segment's gold; the overlay paints
    // after it and wins on `color`, while the segment's `scale`/`weight` survive
    // — later layers overwrite key by key, not wholesale.
    this.text.addStyle(/\d+/, { color: 0x9ae6b4, underline: true });

    // A segment anchor: the weapon run is addressed by its `id`, not by its
    // characters or its position. Under `change text` there are no segments at
    // all, so this overlay resolves to nothing — alive, painting nothing.
    this.rarityRule = this.text.addStyle({ segment: "weapon" }, RARITY[this.params.rarity]);

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

  /**
   * Position-anchored overlays: a yellow recolour over every match of the find
   * string, one `{ start, length }` overlay each. Written the long way on
   * purpose — `addStyle(needle, ...)` would do it in one call, but as a *content*
   * anchor that survives the text change this scene is here to demonstrate.
   *
   * `fontScale` rides along: a structural key is legal on any spec layer now, so
   * a fixed-index overlay reflows the text. Removing it (a text change, or
   * `clearStyles`) reflows back.
   */
  private applyFind(): void {
    const needle = this.params.find;
    if (!needle) return;
    const plain = this.text.text;
    for (let at = plain.indexOf(needle); at >= 0; at = plain.indexOf(needle, at + needle.length)) {
      this.text.addStyle({ start: at, length: needle.length }, { color: 0xffe066, fontScale: 1.12 });
    }
  }

  /**
   * Composition: the callback sees the already-styled glyphs and layers alpha
   * on top, so the segment's red holds while the word pulses.
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

    // Re-applies content + content anchors from scratch, then a position-anchored
    // overlay over every match — try "fire" or "Embers".
    f.addBinding(this.params, "find").on("change", () => this.applyAll());

    // Drives the 'dragonflame' overlay's handle.update — an appearance-only
    // change, so it re-seeds without reflowing, in either text state. (Note
    // `update` replaces the style, so the gradient has to be restated.)
    f.addBinding(this.params, "skew", { min: -0.5, max: 0.5, step: 0.01 }).on("change", (e) => {
      this.skewRule?.update({ color: NAME_GRADIENT, skew: e.value });
    });

    // Restyles the named segment through its handle — no setRichText, so nothing
    // else on the text is disturbed (the find overlays stay put). Under
    // `change text` the overlay has no spans and this is a visible no-op.
    f.addBinding(this.params, "rarity", {
      options: { legendary: "legendary", cursed: "cursed", common: "common" },
    }).on("change", (e) => this.rarityRule?.update(RARITY[e.value as string]));

    // Replaces the content, keeping the segment's `id`. The rarity overlay is
    // content-anchored, so it re-derives onto the new name and keeps its colour.
    // Position anchors don't survive that, which is why `find` is re-applied.
    f.addButton({ title: "reforge (setRichText)" }).on("click", () => {
      if (this.params.altText) return;
      this.weapon = (this.weapon + 1) % WEAPONS.length;
      this.text.setRichText(CONTENT(WEAPONS[this.weapon]));
      this.seedBurn();
      this.applyFind();
    });

    // Both lifetimes in one click: setText keeps the content anchors (they
    // re-derive 'fire', 'dragonflame' and /\d+/ in the new string), drops the
    // segments — so the segment anchor goes quiet — and kills any find overlays.
    // Restoring re-applies everything.
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
