import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import { FONT_OPTIONS } from "../harness/fonts";
import { applyPreset } from "../harness/modes";
import type { MSDFTextInstance } from "../../src";

/**
 * Style Lab — every object-level appearance knob, live simultaneously: fill,
 * faux-bold weight, outline (width / colour / alpha / rounded / layered /
 * two-tone) and shadow-or-glow (offset / colour / alpha / softness / two-tone
 * / pulse). Which is itself the demo: all of it batches into **one draw call**
 * (`layered` adds a second submission pass inside the same call).
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
  outlineLayered: boolean;
  outlineTwoTone: boolean;
  outlineInner: string;
  shadowX: number;
  shadowY: number;
  shadowColor: string;
  shadowAlpha: number;
  shadowSoftness: number;
  shadowTwoTone: boolean;
  shadowInner: string;
  pulse: boolean;
}

// Everything a preset doesn't name keeps its current value, so every preset
// names the full appearance state (word/font excepted — those are yours).
const PRESETS: Record<string, Partial<LabParams>> = {
  Plain: {
    fill: "#ffffff", weight: 0,
    outlineWidth: 0, outlineTwoTone: false,
    shadowAlpha: 0, shadowTwoTone: false, pulse: false,
  },
  Sticker: {
    fill: "#ffd23f", weight: 1.2,
    outlineWidth: 3.5, outlineColor: "#ffffff", outlineAlpha: 1,
    outlineRounded: true, outlineLayered: true, outlineTwoTone: false,
    shadowX: 0, shadowY: 6, shadowColor: "#000000", shadowAlpha: 0.4,
    shadowSoftness: 2, shadowTwoTone: false, pulse: false,
  },
  Neon: {
    fill: "#ffffff", weight: 0,
    outlineWidth: 0, outlineTwoTone: false,
    shadowX: 0, shadowY: 0, shadowColor: "#ff2d95", shadowAlpha: 1,
    shadowSoftness: 12, shadowTwoTone: true, shadowInner: "#ffd6ef", pulse: true,
  },
  Ember: {
    fill: "#ffd23f", weight: 0.6,
    outlineWidth: 2, outlineColor: "#3a0d00", outlineAlpha: 1,
    outlineRounded: false, outlineLayered: false, outlineTwoTone: false,
    shadowX: 0, shadowY: 0, shadowColor: "#ff5a1e", shadowAlpha: 0.9,
    shadowSoftness: 8, shadowTwoTone: true, shadowInner: "#ffe69c", pulse: false,
  },
  Ice: {
    fill: "#eaf6ff", weight: 0,
    outlineWidth: 3, outlineColor: "#0b2a4a", outlineAlpha: 1,
    outlineRounded: true, outlineLayered: true, outlineTwoTone: true, outlineInner: "#7fd4ff",
    shadowX: 0, shadowY: 4, shadowColor: "#7fd4ff", shadowAlpha: 0.5,
    shadowSoftness: 6, shadowTwoTone: false, pulse: false,
  },
  Comic: {
    fill: "#ffd23f", weight: 1.5,
    outlineWidth: 4, outlineColor: "#1a1030", outlineAlpha: 1,
    outlineRounded: true, outlineLayered: true, outlineTwoTone: false,
    shadowX: 5, shadowY: 5, shadowColor: "#1a1030", shadowAlpha: 1,
    shadowSoftness: 0, shadowTwoTone: false, pulse: false,
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
    outlineLayered: false,
    outlineTwoTone: false,
    outlineInner: "#ff5ea8",
    shadowX: 0,
    shadowY: 0,
    shadowColor: "#000000",
    shadowAlpha: 0,
    shadowSoftness: 0,
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
    Object.assign(this.params, PRESETS.Ember);
    this.apply();

    this.caption(
      "Outline width and glow softness are distance-field units, bounded by the atlas distanceRange. " +
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
      t.setOutline(p.outlineWidth, p.outlineColor, p.outlineAlpha, p.outlineRounded, p.outlineLayered);
      t.setOutlineInnerColor(p.outlineTwoTone ? p.outlineInner : null);
      if (p.shadowAlpha > 0) {
        t.setShadow(p.shadowX, p.shadowY, p.shadowColor, p.shadowAlpha, p.shadowSoftness);
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

    const o = pane.addFolder({ title: "Outline" });
    o.addBinding(this.params, "outlineWidth", { label: "width", min: 0, max: 8, step: 0.1 }).on("change", apply);
    o.addBinding(this.params, "outlineColor", { label: "color", view: "color" }).on("change", apply);
    o.addBinding(this.params, "outlineAlpha", { label: "alpha", min: 0, max: 1, step: 0.05 }).on("change", apply);
    o.addBinding(this.params, "outlineRounded", { label: "rounded corners" }).on("change", apply);
    o.addBinding(this.params, "outlineLayered", { label: "layered (no overlap)" }).on("change", apply);
    o.addBinding(this.params, "outlineTwoTone", { label: "two-tone" }).on("change", apply);
    o.addBinding(this.params, "outlineInner", { label: "inner color", view: "color" }).on("change", apply);

    const s = pane.addFolder({ title: "Glow / Shadow" });
    s.addBinding(this.params, "shadowX", { label: "offset X", min: -30, max: 30, step: 1 }).on("change", apply);
    s.addBinding(this.params, "shadowY", { label: "offset Y", min: -30, max: 30, step: 1 }).on("change", apply);
    s.addBinding(this.params, "shadowColor", { label: "color", view: "color" }).on("change", apply);
    s.addBinding(this.params, "shadowAlpha", { label: "alpha", min: 0, max: 1, step: 0.05 }).on("change", apply);
    s.addBinding(this.params, "shadowSoftness", { label: "softness", min: 0, max: 16, step: 0.5 }).on("change", apply);
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
