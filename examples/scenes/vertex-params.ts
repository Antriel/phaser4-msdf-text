import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, GlyphState, Segment } from "../../src";

// Every effect below used to be a per-batch uniform, which meant a shadowed,
// outlined text cost three draw calls and two texts with different outline
// widths could never share one. They now ride the per-vertex `params` attribute,
// so all of this is a single draw call — including the underline rects, which
// batch with the glyphs via a `solid` flag rather than a mode switch.

const BODY: Segment[] = [
  "A ",
  { text: "params", weight: 2.4, color: 0xffd23f },
  " byte per vertex carries ",
  { text: "weight", weight: 3.2 },
  ", ",
  { text: "outline", outline: { width: 2.2, color: 0x1a1030 } },
  ", ",
  { text: "softness", shadow: { color: 0x7fd4ff, alpha: 0.9, x: 0, y: 0, softness: 6 } },
  " and ",
  { text: "rounding", outline: { width: 2.4, color: 0xff5252, rounded: true } },
  " — all in one draw call.",
];

// Inherited colour splits an underline per coloured word; an explicit colour on
// the spec suppresses that split and paints the whole span one colour.
const DECOR: Segment[] = [
  "Underlines ",
  { text: "inherit", color: 0xffd23f },
  " the ",
  { text: "fill", color: 0x7fd4ff },
  " colour of each word, unless you name one. ",
  { text: "This was wrong.", strikethrough: true, color: 0x9a93b3 },
  " Rules never ",
  { text: "reflow", underline: false },
  " the text.",
];

const MODE_OPTIONS = {
  "Faux bold (weight)": "weight",
  "Per-glyph outline width": "outline",
  "Per-corner ramps": "corners",
  "Per-glyph glow softness": "glow",
  "Underline & strikethrough": "decorations",
};

/**
 * The `params` vertex attribute — per-glyph outline width, rounding, shadow
 * softness, faux weight, and underline/strikethrough rects.
 *
 * Two things worth watching. First, **weight** shifts the distance threshold, so
 * it fattens the letterform *without changing its advance* — crank it and the
 * letters touch. Second, the effects are normalised as fractions of the atlas
 * `distanceRange` at pack time, so they mean the same thing on any font and both
 * atlas uniforms collapse into one per-texture ratio.
 */
export class VertexParamsScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = { mode: "weight", weight: 2.5, softness: 5, thickness: 1, offset: 0 };

  constructor() {
    super({ key: "params" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x161320);
    this.heading(
      "Weight, Outline & Decorations",
      "Per-glyph effects from one vertex attribute - one shader branch, one draw call.",
    );

    this.text = this.add
      .msdfText(this.designWidth / 2, 230, "Inter", "", 46)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(940);

    this.applyMode("weight");

    this.caption(
      "weight widens a glyph without changing its advance, so letters touch at " +
        "high values. Decorations follow the layout, not the glyph transform, " +
        "and displayCallback cannot see them.",
    );

    this.commonTargets.push(this.text);
  }

  /** Rebuild the styling for the selected mode from a clean slate. */
  private applyMode(mode: string): void {
    this.text.clearStyles();
    this.text.clearDisplayCallback();
    this.text.clearOutline();
    this.text.clearShadow();
    this.text.setUnderline(false);
    this.text.setStrikethrough(false);
    this.text.weight = 0;

    if (mode === "weight") {
      // One rule, one object-level weight: a styled run overrides the object's
      // just like colour does. Neither reflows — weight is appearance lane.
      this.text.setRichText(BODY);
      this.text.weight = this.params.weight;
    } else if (mode === "outline") {
      // Three outline widths in one text. Before `params` these were a per-batch
      // uniform, so each width forced its own draw call.
      this.text.setRichText([
        "Thin, ",
        { text: "medium", outline: { width: 1.6, color: 0x1a1030 } },
        ", ",
        { text: "thick", outline: { width: 3.4, color: 0x1a1030 } },
        ", and ",
        { text: "rounded", outline: { width: 3.4, color: 0xff5252, rounded: true } },
        " outlines, batched together.",
      ]);
      this.text.setOutline(0.9, 0x1a1030);
    } else if (mode === "corners") {
      // weight, outline.width and shadow.softness are continuous, so they
      // interpolate across the quad exactly like the colour corners do. The ramp
      // is linear across the quad's bounding box, not along the letter contour.
      this.text.setText("Gradient weight and directional outlines");
      this.text.setOutline(1, 0xffd23f);
      this.text.setDisplayCallback((glyphs: GlyphState[]) => {
        const t = this.time.now / 1000;
        for (let i = 0; i < glyphs.length; i++) {
          const g = glyphs[i];
          const phase = Math.sin(t * 1.5 + i * 0.25) * 0.5 + 0.5;
          const w = g.weight;
          w.topLeft = w.topRight = 3.6 * phase;
          w.bottomLeft = w.bottomRight = 0;
          const o = g.outline.width;
          o.topLeft = o.bottomLeft = 0.2;
          o.topRight = o.bottomRight = 3.0;
        }
      });
    } else if (mode === "glow") {
      // A soft shadow is an outline-only quad reading the true SDF, so softness
      // is per-glyph like everything else. The zero offset reads as a glow.
      this.text.setText("Each glyph glows on its own beat");
      this.text.perGlyphShadow = true;
      this.text.setDisplayCallback((glyphs: GlyphState[]) => {
        const t = this.time.now / 1000;
        for (let i = 0; i < glyphs.length; i++) {
          const g = glyphs[i];
          const pulse = 0.5 + 0.5 * Math.sin(t * 2.5 - i * 0.3);
          g.setShadowColor(0x7fd4ff);
          g.setShadowAlpha(0.35 + 0.65 * pulse);
          g.setShadowSoftness(this.params.softness * pulse);
        }
      });
    } else if (mode === "decorations") {
      this.text.setRichText(DECOR);
      this.text.setUnderline({
        thickness: this.params.thickness,
        offset: this.params.offset,
      });
    }
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "params" });

    f.addBinding(this.params, "mode", { options: MODE_OPTIONS }).on("change", (e) =>
      this.applyMode(e.value as string),
    );

    // Distance-field units, like outlineWidth. The useful span is half the
    // atlas distanceRange (16 for these fonts), past which the field saturates.
    f.addBinding(this.params, "weight", { min: -2, max: 8, step: 0.1 }).on("change", (e) => {
      if (this.params.mode === "weight") this.text.weight = e.value as number;
    });

    f.addBinding(this.params, "softness", { min: 0, max: 16, step: 0.5 }).on("change", () => {
      /* read live by the glow callback */
    });

    f.addBinding(this.params, "thickness", { min: 0.25, max: 4, step: 0.05 }).on("change", () => {
      if (this.params.mode === "decorations") this.applyMode("decorations");
    });

    f.addBinding(this.params, "offset", {
      label: "offset (em)",
      min: -0.3,
      max: 0.3,
      step: 0.01,
    }).on("change", () => {
      if (this.params.mode === "decorations") this.applyMode("decorations");
    });
  }
}
