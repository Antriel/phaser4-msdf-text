import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import { FONT_OPTIONS } from "../harness/fonts";
import { applyPreset } from "../harness/modes";
import type { MSDFTextInstance } from "../../src";

/**
 * Style Lab — every object-level appearance knob, live simultaneously: fill,
 * faux-bold weight, outline (width / colour / alpha / rounded / softness /
 * layered / two-tone) and shadow-or-glow (offset / colour / alpha / softness /
 * spread / rounded / two-tone / pulse). Which is itself the demo: all of it
 * batches into **one draw call** (`layered` adds a second submission pass
 * inside the same call).
 *
 * Two knobs are worth hunting for, because nothing else can reach what they do:
 *
 *   - **shadow spread** dilates the silhouette *before* the blur, so a shadow
 *     can be fattened without being mushed — and a fat *hard* shadow (the
 *     chunky cartoon "sticker", see that preset) exists at all.
 *   - **outline softness** blurs the outline's outer edge. At width `0` the
 *     outline *is* a glow hugging the letterform (the "Halo" preset) — and it
 *     rides the fill's own quad, so unlike the shadow-based glow of "Neon" it
 *     costs no extra pass at all.
 *
 * Three rows share one `apply()` push. The middle row shows the effects
 * holding up at small sizes; the bottom row uses tight letter spacing so a
 * thick outline overlaps the next glyph — the artifact `layered` removes.
 */

interface LabParams {
  word: string;
  font: string;
  fill: string;
  weight: number;
  outlineWidth: number;
  outlineColor: string;
  outlineAlpha: number;
  outlineRounded: boolean;
  outlineSoftness: number;
  outlineLayered: boolean;
  outlineTwoTone: boolean;
  outlineInner: string;
  shadowX: number;
  shadowY: number;
  shadowColor: string;
  shadowAlpha: number;
  shadowSoftness: number;
  shadowSpread: number;
  shadowRounded: boolean;
  shadowTwoTone: boolean;
  shadowInner: string;
  pulse: boolean;
}

// Everything a preset doesn't name keeps its current value, so every preset
// names the full appearance state (word/font excepted — those are yours).
const PRESETS: Record<string, Partial<LabParams>> = {
  Plain: {
    fill: "#ffffff", weight: 0,
    outlineWidth: 0, outlineSoftness: 0, outlineTwoTone: false,
    shadowAlpha: 0, shadowSpread: 0, shadowRounded: true,
    shadowTwoTone: false, pulse: false,
  },
  // The payoff of spread: a *hard* shadow, dilated well past the letterform and
  // rounded off the true SDF, is the chunky offset slab behind cartoon
  // lettering. Softness cannot reach it — blurring is the one thing this look
  // must not do — so before spread it was simply unreachable.
  Sticker: {
    fill: "#ffd23f", weight: 1.2,
    outlineWidth: 3.5, outlineColor: "#ffffff", outlineAlpha: 1,
    outlineRounded: true, outlineSoftness: 0, outlineLayered: true, outlineTwoTone: false,
    shadowX: 5, shadowY: 8, shadowColor: "#1c1633", shadowAlpha: 1,
    shadowSoftness: 0, shadowSpread: 3.5, shadowRounded: true,
    shadowTwoTone: false, pulse: false,
  },
  // Glow via the shadow pass — a second set of quads, but it can be offset and
  // it ramps two-tone. Compare with "Halo", which glows for free.
  Neon: {
    fill: "#ffffff", weight: 0,
    outlineWidth: 0, outlineSoftness: 0, outlineTwoTone: false,
    shadowX: 0, shadowY: 0, shadowColor: "#ff2d95", shadowAlpha: 1,
    shadowSoftness: 12, shadowSpread: 2, shadowRounded: true,
    shadowTwoTone: true, shadowInner: "#ffd6ef", pulse: true,
  },
  // Glow via the *outline*, at width 0: the blur is centred on the glyph edge,
  // its inner half hides under the fill, and the whole thing rides the fill's
  // own quad. No shadow pass, no second quad — the cheapest glow in the plugin.
  Halo: {
    fill: "#ffffff", weight: 0,
    outlineWidth: 0, outlineColor: "#00e5ff", outlineAlpha: 1,
    outlineRounded: false, outlineSoftness: 7, outlineLayered: false, outlineTwoTone: false,
    shadowAlpha: 0, shadowSpread: 0, shadowRounded: true,
    shadowTwoTone: false, pulse: false,
  },
  Ember: {
    fill: "#ffd23f", weight: 0.6,
    outlineWidth: 2, outlineColor: "#3a0d00", outlineAlpha: 1,
    outlineRounded: false, outlineSoftness: 0, outlineLayered: false, outlineTwoTone: false,
    shadowX: 0, shadowY: 0, shadowColor: "#ff5a1e", shadowAlpha: 0.9,
    shadowSoftness: 8, shadowSpread: 1.5, shadowRounded: true,
    shadowTwoTone: true, shadowInner: "#ffe69c", pulse: false,
  },
  Ice: {
    fill: "#eaf6ff", weight: 0,
    outlineWidth: 3, outlineColor: "#0b2a4a", outlineAlpha: 1,
    outlineRounded: true, outlineSoftness: 0, outlineLayered: true,
    outlineTwoTone: true, outlineInner: "#7fd4ff",
    shadowX: 0, shadowY: 4, shadowColor: "#7fd4ff", shadowAlpha: 0.5,
    shadowSoftness: 6, shadowSpread: 0, shadowRounded: true,
    shadowTwoTone: false, pulse: false,
  },
  Comic: {
    fill: "#ffd23f", weight: 1.5,
    outlineWidth: 4, outlineColor: "#1a1030", outlineAlpha: 1,
    outlineRounded: true, outlineSoftness: 0, outlineLayered: true, outlineTwoTone: false,
    shadowX: 5, shadowY: 5, shadowColor: "#1a1030", shadowAlpha: 1,
    shadowSoftness: 0, shadowSpread: 0, shadowRounded: true,
    shadowTwoTone: false, pulse: false,
  },
};

export class StyleLabScene extends ExampleScene {
  private hero!: MSDFTextInstance;
  private texts: MSDFTextInstance[] = [];

  private params: LabParams = {
    word: "BLAZE",
    font: "Anton",
    fill: "#ffffff",
    weight: 0,
    outlineWidth: 0,
    outlineColor: "#101018",
    outlineAlpha: 1,
    outlineRounded: false,
    outlineSoftness: 0,
    outlineLayered: false,
    outlineTwoTone: false,
    outlineInner: "#ff5ea8",
    shadowX: 0,
    shadowY: 0,
    shadowColor: "#000000",
    shadowAlpha: 0,
    shadowSoftness: 0,
    shadowSpread: 0,
    shadowRounded: true,
    shadowTwoTone: false,
    shadowInner: "#ffffff",
    pulse: false,
  };

  constructor() {
    super({ key: "stylelab" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x0f1118);
    this.heading(
      "Style Lab",
      "Fill, weight, outline and glow - every knob live at once, one draw call.",
    );

    this.hero = this.add
      .msdfText(640, 280, this.params.font, this.params.word, 150)
      .setOrigin(0.5)
      .setLetterSpacing(6);

    const small = this.add
      .msdfText(640, 450, this.params.font, "crisp down to small sizes", 36)
      .setOrigin(0.5)
      .setLetterSpacing(3);

    // Deliberately tight spacing so a thick outline overlaps the next glyph —
    // the artifact `layered` removes.
    const tight = this.add
      .msdfText(640, 560, this.params.font, "SPILLOVER", 90)
      .setOrigin(0.5)
      .setLetterSpacing(-2);

    this.texts = [this.hero, small, tight];

    // Start on a preset so the lab opens looking like a lab, not a form.
    Object.assign(this.params, PRESETS.Sticker);
    this.apply();

    this.caption(
      "Widths, spreads and softnesses are all distance-field units, bounded by the atlas distanceRange. " +
        "Shadow 'spread' fattens a shadow without blurring it (see the Sticker preset); outline 'softness' " +
        "at width 0 is a glow in the fill's own quad (Halo), where Neon's costs a shadow pass. " +
        "A two-tone outline implies 'layered'. Toggle 'layered' to fix the bottom row's overlap. " +
        "All three rows and every effect batch into a single draw call.",
    );

    // commonTargets stays empty on purpose: the shared Text folder's font and
    // colour bindings would fight the lab's own controls.
  }

  /** Push the current params onto every row. */
  private apply(): void {
    const p = this.params;
    for (const t of this.texts) {
      t.setColor(p.fill);
      t.weight = p.weight;
      t.setOutline(
        p.outlineWidth, p.outlineColor, p.outlineAlpha,
        p.outlineRounded, p.outlineLayered, p.outlineSoftness,
      );
      t.setOutlineInnerColor(p.outlineTwoTone ? p.outlineInner : null);
      t.shadowRounded = p.shadowRounded;
      if (p.shadowAlpha > 0) {
        t.setShadow(
          p.shadowX, p.shadowY, p.shadowColor, p.shadowAlpha,
          p.shadowSoftness, p.shadowSpread,
        );
        t.setShadowInnerColor(p.shadowTwoTone ? p.shadowInner : null);
      } else {
        t.clearShadow();
      }
    }
  }

  protected addControls(pane: Pane): void {
    const apply = () => this.apply();

    const presets = pane.addFolder({ title: "Presets" });
    for (const name of Object.keys(PRESETS)) {
      presets.addButton({ title: name }).on("click", () => {
        applyPreset(this.params, PRESETS[name], pane);
        this.apply();
      });
    }

    pane.addBinding(this.params, "word").on("change", (e) => this.hero.setText(e.value));
    pane.addBinding(this.params, "font", { options: FONT_OPTIONS }).on("change", (e) => {
      for (const t of this.texts) t.setFont(e.value);
    });
    pane.addBinding(this.params, "fill", { view: "color" }).on("change", apply);
    // Distance-field units, like outline width; the fill edge saturates near
    // the top of the range.
    pane.addBinding(this.params, "weight", { min: -2, max: 8, step: 0.1 }).on("change", apply);

    // Width and softness are both distance-field units. Width tops out at half
    // the atlas distanceRange (8 here); softness is useful over the whole range.
    const o = pane.addFolder({ title: "Outline" });
    o.addBinding(this.params, "outlineWidth", { label: "width", min: 0, max: 8, step: 0.1 }).on("change", apply);
    o.addBinding(this.params, "outlineColor", { label: "color", view: "color" }).on("change", apply);
    o.addBinding(this.params, "outlineAlpha", { label: "alpha", min: 0, max: 1, step: 0.05 }).on("change", apply);
    o.addBinding(this.params, "outlineRounded", { label: "rounded corners" }).on("change", apply);
    // Drop width to 0 and raise this: the outline becomes a glow on the
    // letterform, still inside the fill's own quad.
    o.addBinding(this.params, "outlineSoftness", { label: "softness (glow)", min: 0, max: 16, step: 0.5 }).on("change", apply);
    o.addBinding(this.params, "outlineLayered", { label: "layered (no overlap)" }).on("change", apply);
    o.addBinding(this.params, "outlineTwoTone", { label: "two-tone" }).on("change", apply);
    o.addBinding(this.params, "outlineInner", { label: "inner color", view: "color" }).on("change", apply);

    const s = pane.addFolder({ title: "Glow / Shadow" });
    s.addBinding(this.params, "shadowX", { label: "offset X", min: -30, max: 30, step: 1 }).on("change", apply);
    s.addBinding(this.params, "shadowY", { label: "offset Y", min: -30, max: 30, step: 1 }).on("change", apply);
    s.addBinding(this.params, "shadowColor", { label: "color", view: "color" }).on("change", apply);
    s.addBinding(this.params, "shadowAlpha", { label: "alpha", min: 0, max: 1, step: 0.05 }).on("change", apply);
    s.addBinding(this.params, "shadowSoftness", { label: "softness", min: 0, max: 16, step: 0.5 }).on("change", apply);
    // Dilates the silhouette before the blur. Same units and ceiling as outline
    // width — it is literally the same channel, read off a shadow quad. Past
    // ~5 with *zero* softness the outer band starts to fade: the shader's
    // background-haze guard reads the raw field, and any softness lifts it.
    s.addBinding(this.params, "shadowSpread", { label: "spread (fatten)", min: 0, max: 8, step: 0.1 }).on("change", apply);
    // A no-op until spread or softness lifts the shadow's edge off the glyph
    // contour; turn it off there to see the mitre spikes a sharp dilation grows.
    s.addBinding(this.params, "shadowRounded", { label: "rounded" }).on("change", apply);
    s.addBinding(this.params, "shadowTwoTone", { label: "two-tone" }).on("change", apply);
    s.addBinding(this.params, "shadowInner", { label: "inner color", view: "color" }).on("change", apply);
    // Re-apply on toggle so the slider values are restored when pulse stops.
    s.addBinding(this.params, "pulse", { label: "pulse (neon)" }).on("change", apply);
  }

  update(): void {
    // Pulse modulates *around* the slider values for a breathing neon look —
    // the alpha/softness sliders still set the upper bound and stay live.
    if (this.params.pulse && this.params.shadowAlpha > 0) {
      const s = (Math.sin(this.time.now * 0.004) + 1) / 2; // 0..1
      for (const t of this.texts) {
        t.shadowSoftness = this.params.shadowSoftness * (0.6 + 0.4 * s);
        t.shadowAlpha = this.params.shadowAlpha * (0.7 + 0.3 * s);
      }
    }
  }
}
