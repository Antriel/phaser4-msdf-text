import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, Segment } from "../../src";

// A highlight pill is a `solid` quad — the same rect kind that draws underlines,
// which carries real 0..1 UVs across its own box. The shader reads the screen-space
// derivative of those UVs as the rect's pixel size and evaluates a rounded-box SDF
// against it, so radius, border width and edge blur all ride the three `params`
// bytes a solid quad has no other use for. No new attribute, no new draw call:
// every pill below batches with the glyphs in front of it.

const MARKER: Segment[] = [
  "Style layers reach the ",
  { text: "highlight", highlight: { color: 0xffe066, radius: 0.35, padding: { x: 0.2, y: 0.06 } }, color: 0x1a1030 },
  " lane, so a rule or a range pills exactly the run it matches — and a pill spans\nmixed ",
  { text: "sizes", fontScale: 1.6, highlight: { color: 0x7fd4ff, alpha: 0.35, radius: 1, padding: 0.1 } },
  { text: " and fonts", highlight: { color: 0x7fd4ff, alpha: 0.35, radius: 1, padding: 0.1 } },
  " as one shape.",
];

const MODE_OPTIONS = {
  "Damage pill": "pill",
  "Marker highlight": "marker",
  "Two-tone glow blob": "glow",
  "Per-corner radius": "corners",
  "Rich-text runs": "runs",
};

/**
 * Highlight pills — a rounded, optionally soft, optionally bordered box behind a
 * run of text.
 *
 * Two things worth watching. `radius`, `borderWidth` and `softness` are fractions
 * of the pill's own **half-thickness**, not pixels, so `radius: 1` is a stadium at
 * any font size and the whole pill scales with the camera exactly as the text
 * does. And because those three channels are continuous, they are per-corner for
 * free — the same reason a glyph's outline width can ramp across its quad.
 */
export class HighlightScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = { mode: "pill", radius: 1, softness: 0, border: 0.18, padX: 0.3, padY: 0.12 };

  constructor() {
    super({ key: "highlight" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x161320);
    this.heading(
      "Highlight Pills",
      "A rounded-box SDF over a solid quad's own UVs - batched with the glyphs.",
    );

    this.text = this.add
      .msdfText(this.designWidth / 2, 250, "Inter", "", 54)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(940);

    this.applyMode("pill");

    this.caption(
      "radius, borderWidth and softness are fractions of the pill's half-thickness, " +
        "so a pill keeps its shape at any size. They are per-corner, like every other " +
        "params channel. Pills draw behind everything, the text's own shadow included.",
    );

    this.commonTargets.push(this.text);
  }

  /** Rebuild the styling for the selected mode from a clean slate. */
  private applyMode(mode: string): void {
    const p = this.params;

    this.text.clearStyles();
    this.text.clearShadow();
    this.text.setHighlight(false);
    this.text.setColor("#f0ecff");
    this.text.setFontSize(54);

    if (mode === "pill") {
      // The damage-number look: a stadium with a crisp border. The drop shadow
      // lands *on* the pill, because highlights submit behind every other pass.
      this.text.setText("CRITICAL  2 4 8");
      this.text.setColor("#fff6d5");
      this.text.setShadow(0, 5, 0x000000, 0.45, 4);
      // Padding is em-relative and may go negative — the pill's box is the glyph
      // run's bounds (ascender to descender) plus this, so a negative y crops the
      // slab down towards the x-height.
      this.text.setHighlight({
        color: 0xd6304a,
        radius: p.radius,
        softness: p.softness,
        borderWidth: p.border,
        borderColor: 0xffd23f,
        padding: { x: p.padX, y: p.padY },
      });
    } else if (mode === "marker") {
      // Softening the face alone reads as a marker pen: no border, a low alpha,
      // and enough blur that the edge stops being a rule.
      this.text.setText("drawn on with a marker");
      this.text.setColor("#1a1030");
      this.text.setHighlight({
        color: 0xffe066,
        alpha: 0.85,
        radius: 0.45,
        softness: 0.3,
        padding: { x: 0.12, y: 0.04 },
      });
    } else if (mode === "glow") {
      // A face alpha of 0 frees the colour slot for the ramp's inner end, and a
      // borderWidth of 1 is a ring that fills the pill — so the whole blob ramps
      // from `borderColor` at its blurred rim to `innerColor` at the core. The
      // same two-tone gate a glowing glyph shadow uses.
      this.text.setText("W A R P   C O R E");
      this.text.setColor("#0b0d12");
      this.text.setHighlight({
        alpha: 0,
        radius: 1,
        softness: 0.75,
        borderWidth: 1,
        borderColor: 0x2b0a4a,
        innerColor: 0x9ad8ff,
        padding: { x: 0.35, y: 0.25 },
      });
    } else if (mode === "corners") {
      // Radius is a continuous byte, so it interpolates across the quad like a
      // colour corner does. Near any one corner the interpolant is dominated by
      // that corner's value, which is all a rounded-box SDF needs.
      this.text.setText("a tab, not a pill");
      this.text.setColor("#1a1030");
      this.text.setHighlight({
        color: 0x7fd4ff,
        radius: { topLeft: 1, topRight: 1, bottomLeft: 0, bottomRight: 0 },
        softness: { topLeft: 0, topRight: 0.5, bottomLeft: 0, bottomRight: 0.5 },
        padding: { x: 0.3, y: 0.12 },
      });
    } else if (mode === "runs") {
      this.text.setFontSize(40);
      this.text.setRichText(MARKER);
    }
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "pill" });

    f.addBinding(this.params, "mode", { options: MODE_OPTIONS }).on("change", (e) =>
      this.applyMode(e.value as string),
    );

    // All three are fractions of the pill's half-thickness: 1 is a stadium, a
    // ring that fills the pill, or a blur as deep as the pill is thick.
    const live = () => {
      if (this.params.mode === "pill") this.applyMode("pill");
    };
    f.addBinding(this.params, "radius", { min: 0, max: 1, step: 0.01 }).on("change", live);
    f.addBinding(this.params, "softness", { min: 0, max: 1, step: 0.01 }).on("change", live);
    f.addBinding(this.params, "border", { label: "borderWidth", min: 0, max: 1, step: 0.01 }).on(
      "change",
      live,
    );

    // Em-relative, and negative is legal: the pill's box starts at the run's
    // ascender/descender, so a negative padY crops it in towards the letterforms.
    f.addBinding(this.params, "padX", { label: "padding x (em)", min: -0.2, max: 1, step: 0.01 }).on(
      "change",
      live,
    );
    f.addBinding(this.params, "padY", { label: "padding y (em)", min: -0.2, max: 1, step: 0.01 }).on(
      "change",
      live,
    );
  }
}
