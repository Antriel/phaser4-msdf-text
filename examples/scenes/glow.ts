import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance } from "../../src";

/**
 * Drop shadow / glow. The shadow pass samples the true SDF (alpha channel) with
 * a widened transition, so `softness` blurs it. A soft shadow with no offset
 * reads as a glow; a hard shadow with an offset is a classic drop shadow.
 *
 * A shadow quad has no fill, so its fill-colour attribute is free — that is
 * where `shadowInnerColor` rides. The blur then ramps from `color` at its outer
 * edge to `innerColor` where it meets the glyph: a white-hot core inside a
 * coloured halo, for no extra quad and no extra draw call. The ramp is weighted
 * toward `color`, since the shadow's alpha fades across the same interval.
 */
export class GlowScene extends ExampleScene {
  private word!: MSDFTextInstance;
  private params = {
    offsetX: 0,
    offsetY: 0,
    color: "#1b47ff",
    alpha: 1,
    softness: 13,
    twoTone: true,
    innerColor: "#8ffbff",
    pulse: true,
  };

  constructor() {
    super({ key: "glow" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x0a0a14);
    this.heading("Glow & Drop Shadow", "One soft SDF pass - glow or shadow, your call.");

    this.word = this.add
      .msdfText(640, 360, "Bangers", "NEON", 160)
      .setColor("#ffffff")
      .setOrigin(0.5);

    this.applyShadow();
    this.caption(
      "Soft + zero offset reads as a glow. Add an offset and drop softness for a classic drop shadow. " +
        "'two-tone' ramps the halo to a second colour at the glyph edge — the blur has to be wide enough to see it.",
    );

    this.commonTargets.push(this.word);
  }

  /** Push the current shadow params onto the word. */
  private applyShadow(): void {
    const { offsetX, offsetY, color, alpha, softness, twoTone, innerColor } = this.params;
    this.word.setShadow(offsetX, offsetY, color, alpha, softness);
    // `null` collapses the ramp back to a single-colour shadow.
    this.word.setShadowInnerColor(twoTone ? innerColor : null);
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Shadow / Glow" });
    f.addBinding(this.params, "offsetX", { label: "offset X", min: -30, max: 30, step: 1 })
      .on("change", () => this.applyShadow());
    f.addBinding(this.params, "offsetY", { label: "offset Y", min: -30, max: 30, step: 1 })
      .on("change", () => this.applyShadow());
    f.addBinding(this.params, "color", { view: "color" })
      .on("change", () => this.applyShadow());
    f.addBinding(this.params, "alpha", { min: 0, max: 1, step: 0.05 })
      .on("change", () => this.applyShadow());
    f.addBinding(this.params, "softness", { min: 0, max: 16, step: 0.5 })
      .on("change", () => this.applyShadow());
    f.addBinding(this.params, "twoTone", { label: "two-tone" })
      .on("change", () => this.applyShadow());
    f.addBinding(this.params, "innerColor", { label: "inner color", view: "color" })
      .on("change", () => this.applyShadow());
    // Re-apply on toggle so the slider values are restored when pulse stops.
    f.addBinding(this.params, "pulse", { label: "pulse (neon)" })
      .on("change", () => this.applyShadow());
  }

  update(): void {
    // Pulse modulates *around* the slider values for a breathing neon look —
    // so the alpha/softness sliders still set the upper bound and stay live.
    if (this.params.pulse) {
      const s = (Math.sin(this.time.now * 0.004) + 1) / 2; // 0..1
      this.word.shadowSoftness = this.params.softness * (0.6 + 0.4 * s);
      this.word.shadowAlpha = this.params.alpha * (0.7 + 0.3 * s);
    }
  }
}
