import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, Segment } from "../../src";

// A highlight pill is a `solid` quad — the same rect kind that draws underlines,
// carrying real 0..1 UVs across its own box. The shader reads the screen-space
// derivative of those UVs as the rect's pixel size and evaluates a rounded-box
// SDF against it, so radius, border width and edge blur all ride the three
// `params` bytes a solid quad has no other use for. No new attribute, no new
// draw call: every pill below batches with the glyphs in front of it.

// One pill spanning mixed sizes *and* mixed fonts. Runs merge into a single
// rect while they share a line and the *same* resolved highlight — identity, not
// equality, so two segments each naming the same literal would still pill twice.
// The size and the font stay on the segments (they are structural); the
// highlight comes from one overlay across both, and the pill's vertical extent
// is the union of the runs' metrics.
const MARKER: Segment[] = [
  "Style layers reach the ",
  { text: "highlight", highlight: { color: 0xffe066, radius: 0.35, padding: { x: 0.2, y: 0.06 } }, color: 0x1a1030 },
  " lane, so a rule or a range pills exactly the run it matches — and a pill spans\nmixed ",
  { text: "sizes", fontScale: 1.6 },
  { text: " and fonts", font: "Bangers" },
  " as one shape.",
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

/**
 * Highlights & decorations — a gallery of looks that never change, and one
 * playground row that every control drives. `radius`, `borderWidth` and
 * `softness` are fractions of the pill's own **half-thickness**, so `radius: 1`
 * is a stadium at any font size and the whole pill scales with the camera
 * exactly as the text does.
 *
 * A dashed rule is the same rect and the same rounded-box SDF, folded: its U
 * spans one unit *per dash* instead of `0..1`, so the shader cuts it into cells
 * with `fract` and the derivative it already reads as a pill's width comes out as
 * one dash period. However many dashes it draws, it is still one quad — and the
 * marching ants below are a plain `dashPhase` tween, which only slides that U
 * origin, so they rebuild nothing.
 */
export class DecorScene extends ExampleScene {
  private playground!: MSDFTextInstance;
  private ants!: MSDFTextInstance;

  private params = {
    radius: 1,
    softness: 0,
    border: 0.18,
    borderColor: 0xffd23f,
    borderAlpha: 1,
    alpha: 1,
    faceAlpha: 1,
    twoTone: false,
    innerColor: 0x9ad8ff,
    padX: 0.3,
    padY: 0.12,
    underline: true,
    thickness: 1,
    offset: 0,
    dash: false,
    dashLength: 0.14,
    dashGap: 0.09,
    dashRadius: 0,
    strike: false,
  };

  constructor() {
    super({ key: "decor" });
  }

  /**
   * The ants march. `dashPhase` counts in whole dash periods, so it is seamlessly
   * periodic — `+= dt` for ever accumulates no error and needs no wrapping here
   * (the renderer wraps it), and it resolves at submit time, so this costs no
   * rebuild, no re-seed and no relayout. A tween on the field would do just as
   * well; this is only so the speed reads honestly per second.
   */
  update(_time: number, delta: number): void {
    if (this.ants) this.ants.dashPhase += delta / 1000;
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x161320);
    this.heading(
      "Highlights & Decorations",
      "Pills, markers, glows, underlines - all solid quads, batched with the glyphs.",
    );

    this.buildGallery();
    this.buildPlayground();

    this.caption(
      "Pills draw behind everything, the text's own drop shadow included. Underlines split " +
        "where an inherited colour changes, and a dashed one is still a single quad — the dash " +
        "count rides its UVs, so tweening dashPhase marches the ants for free. All of it batches " +
        "with the glyphs.",
    );
  }

  /** Static rows — built once, never touched by the controls. */
  private buildGallery(): void {
    // The damage-number look: a stadium with a crisp border. The drop shadow
    // lands *on* the pill, because highlights submit behind every other pass.
    this.add
      .msdfText(330, 170, "Inter", "CRITICAL  2 4 8", 44)
      .setColor("#fff6d5")
      .setOrigin(0.5)
      .setShadow(0, 5, 0x000000, 0.45, 4)
      .setHighlight({
        color: 0xd6304a,
        radius: 1,
        borderWidth: 0.18,
        borderColor: 0xffd23f,
        padding: { x: 0.3, y: 0.12 },
      });

    // Radius is a continuous byte, so it interpolates across the quad like a
    // colour corner does — a tab shape, square along the bottom.
    this.add
      .msdfText(950, 170, "Inter", "a tab, not a pill", 34)
      .setColor("#1a1030")
      .setOrigin(0.5)
      .setHighlight({
        color: 0x7fd4ff,
        radius: { topLeft: 1, topRight: 1, bottomLeft: 0, bottomRight: 0 },
        softness: { topLeft: 0, topRight: 0.5, bottomLeft: 0, bottomRight: 0.5 },
        padding: { x: 0.3, y: 0.12 },
      });

    // Softening the face alone reads as a marker pen: no border, translucent,
    // and enough blur that the edge stops being a rule.
    this.add
      .msdfText(330, 258, "Inter", "drawn on with a marker", 36)
      .setColor("#1a1030")
      .setOrigin(0.5)
      .setHighlight({
        color: 0xffe066,
        alpha: 0.85,
        radius: 0.45,
        softness: 0.3,
        padding: { x: 0.12, y: 0.04 },
      });

    // A face alpha of 0 frees the colour slot for the two-tone ramp's inner
    // end, and a borderWidth of 1 is a ring that fills the pill — the whole
    // blob ramps from `borderColor` at its blurred rim to `innerColor` at the
    // core. The same two-tone gate a glowing glyph shadow uses. (The pill's own
    // `alpha` is untouched, and is what would fade the blob: it multiplies both
    // layers, so it dims the ring without closing the gate this face is holding
    // open.)
    this.add
      .msdfText(950, 258, "Inter", "W A R P   C O R E", 36)
      .setColor("#0b0d12")
      .setOrigin(0.5)
      .setHighlight({
        faceAlpha: 0,
        radius: 1,
        softness: 0.75,
        borderWidth: 1,
        borderColor: 0x2b0a4a,
        innerColor: 0x9ad8ff,
        padding: { x: 0.35, y: 0.25 },
      });

    // Rich-text runs reaching the highlight lane.
    const marker = this.add
      .msdfText(640, 330, "Inter", "", 30)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(1000)
      .setRichText(MARKER);
    // One overlay across both runs, so both resolve to the *same* highlight and
    // merge into one pill — two segments each naming this literal would not.
    marker.addStyle("sizes and fonts", {
      highlight: { color: 0x7fd4ff, alpha: 0.35, radius: 1, padding: 0.1 },
    });

    // Underline / strikethrough splits, driven purely by the segments.
    this.add
      .msdfText(640, 448, "Inter", "", 28)
      .setColor("#f0ecff")
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(1000)
      .setRichText(DECOR)
      .setUnderline({ thickness: 1, offset: 0 });

    // Dashes. `length` and `gap` are em-relative to the run's own size, and the
    // period is rounded to fit each rect a whole number of times — so a rule
    // always begins and ends the same way, whatever it happens to span.
    this.add
      .msdfText(280, 566, "Inter", "dashed", 30)
      .setColor("#f0ecff")
      .setOrigin(0.5)
      .setUnderline({ dash: true });

    // Dots are not a second feature: a cap radius of 1 rounds a dash into a
    // stadium, and a dash as long as the rule is thick makes that stadium a
    // circle. Inter's underline is 0.068 em, so a 1.6x rule is ~0.11 em thick —
    // which is where `length` has to land for a round dot rather than a lozenge.
    this.add
      .msdfText(530, 566, "Inter", "dotted", 30)
      .setColor("#f0ecff")
      .setOrigin(0.5)
      .setUnderline({ thickness: 1.6, dash: { length: 0.11, gap: 0.1, radius: 1 } });

    // Softness blurs a dash exactly as it blurs a pill — inward from its own box.
    this.add
      .msdfText(800, 566, "Inter", "soft", 30)
      .setColor("#f0ecff")
      .setOrigin(0.5)
      .setUnderline({ thickness: 2.5, color: 0x7fd4ff, dash: { length: 0.24, gap: 0.16, radius: 1, softness: 0.9 } });

    // And the ants march: one `dashPhase` field, tweened in `update`. Nothing is
    // rebuilt — the phase slides the rect's UV origin at submit time — and a dash
    // cut by the rule's end simply travels through it.
    this.ants = this.add
      .msdfText(1040, 566, "Inter", "marching", 30)
      .setColor("#ffd23f")
      .setOrigin(0.5)
      .setUnderline({ thickness: 1.4, dash: { length: 0.16, gap: 0.1, radius: 1 } });
  }

  /** The one row the controls touch. */
  private buildPlayground(): void {
    this.playground = this.add
      .msdfText(640, 645, "Inter", "P L A Y G R O U N D", 40)
      .setColor("#fff6d5")
      .setOrigin(0.5);
    this.applyPlayground();
  }

  /**
   * Re-push the whole decoration spec. Cheap by design: highlight, underline
   * and strikethrough are decoration-lane, so none of this reflows the text.
   */
  private applyPlayground(): void {
    const p = this.params;
    this.playground.setHighlight({
      color: 0xd6304a,
      // Two different things: `alpha` fades the pill as a shape (face and ring
      // together), `faceAlpha` hollows it out — and a `faceAlpha` of 0 is what
      // frees the colour slot for the two-tone ramp below.
      alpha: p.alpha,
      faceAlpha: p.faceAlpha,
      radius: p.radius,
      softness: p.softness,
      borderWidth: p.border,
      borderColor: p.borderColor,
      borderAlpha: p.borderAlpha,
      innerColor: p.twoTone ? p.innerColor : undefined,
      padding: { x: p.padX, y: p.padY },
    });
    // `false` is a solid rule, so the whole dash lane costs nothing when it is
    // off — no sentinel, no fold, the same constant params a rule has always
    // packed. A strikethrough takes the identical spec: the two are one code
    // path that differs only in where the rect lands.
    const dash = p.dash ? { length: p.dashLength, gap: p.dashGap, radius: p.dashRadius } : false;
    this.playground.setUnderline(
      p.underline ? { thickness: p.thickness, offset: p.offset, dash } : false,
    );
    this.playground.setStrikethrough(p.strike ? { dash } : false);
  }

  protected addControls(pane: Pane): void {
    const apply = () => this.applyPlayground();

    const h = pane.addFolder({ title: "Highlight (playground row)" });
    // radius / softness / borderWidth are fractions of the pill's
    // half-thickness: 1 is a stadium, a blur as deep as the pill is thick, or
    // a ring that fills it (with face alpha 0 + two-tone, a glow blob).
    h.addBinding(this.params, "radius", { min: 0, max: 1, step: 0.01 }).on("change", apply);
    h.addBinding(this.params, "softness", { min: 0, max: 1, step: 0.01 }).on("change", apply);
    h.addBinding(this.params, "border", { label: "borderWidth", min: 0, max: 1, step: 0.01 }).on("change", apply);
    h.addBinding(this.params, "borderColor", { label: "border color", view: "color" }).on("change", apply);
    // The three alphas, in the order they compose. A pill is two layers, so each
    // layer has one — drag `face alpha` to 0 and the pill hollows out into its own
    // ring (which is also what frees the two-tone ramp below), drag `border alpha`
    // and the ring goes while the face stays. `alpha` is the *shape's*: it
    // multiplies both, so it is the one that fades the pill as a pill, and the only
    // one that can fade a two-tone glow blob (whose face alpha is 0 by design).
    h.addBinding(this.params, "alpha", { label: "alpha (whole pill)", min: 0, max: 1, step: 0.05 }).on("change", apply);
    h.addBinding(this.params, "faceAlpha", { label: "face alpha", min: 0, max: 1, step: 0.05 }).on("change", apply);
    h.addBinding(this.params, "borderAlpha", { label: "border alpha", min: 0, max: 1, step: 0.05 }).on("change", apply);
    h.addBinding(this.params, "twoTone", { label: "two-tone" }).on("change", apply);
    h.addBinding(this.params, "innerColor", { label: "inner color", view: "color" }).on("change", apply);
    // Em-relative, and negative is legal: the pill's box starts at the run's
    // ascender/descender, so a negative padY crops in towards the letterforms.
    h.addBinding(this.params, "padX", { label: "padding x (em)", min: -0.2, max: 1, step: 0.01 }).on("change", apply);
    h.addBinding(this.params, "padY", { label: "padding y (em)", min: -0.2, max: 1, step: 0.01 }).on("change", apply);

    const u = pane.addFolder({ title: "Underline (playground row)" });
    u.addBinding(this.params, "underline", { label: "enabled" }).on("change", apply);
    u.addBinding(this.params, "thickness", { min: 0.25, max: 4, step: 0.05 }).on("change", apply);
    u.addBinding(this.params, "offset", { label: "offset (em)", min: -0.3, max: 0.3, step: 0.01 }).on("change", apply);
    // Dash length and gap are em-relative to the run's size, like `offset`; the
    // cap radius is a fraction of the dash's own half-thickness, like a pill's.
    // Sweep the radius up with a short length and the dashes become dots.
    // The dash controls drive the strikethrough too — one code path, differing
    // only in where the rect lands.
    u.addBinding(this.params, "dash", { label: "dashed (both rules)" }).on("change", apply);
    u.addBinding(this.params, "dashLength", { label: "dash length (em)", min: 0.01, max: 0.5, step: 0.01 }).on("change", apply);
    u.addBinding(this.params, "dashGap", { label: "dash gap (em)", min: 0.01, max: 0.5, step: 0.01 }).on("change", apply);
    u.addBinding(this.params, "dashRadius", { label: "cap radius", min: 0, max: 1, step: 0.01 }).on("change", apply);

    pane.addBinding(this.params, "strike", { label: "strikethrough" }).on("change", apply);
  }
}
