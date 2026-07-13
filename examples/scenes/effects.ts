import * as Phaser from "phaser";
import type { FolderApi, Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import { addModeControls, type Mode } from "../harness/modes";
import type { MSDFTextInstance, GlyphState } from "../../src";

const WORD = "EFFECTS";

/**
 * Per-glyph animation via `setDisplayCallback`. The callback runs once per
 * frame with the whole glyph array; each glyph may be moved, scaled, rotated,
 * recoloured or faded — independently, and with a different colour/alpha per
 * corner, which plain tinting cannot do.
 *
 * Modes are legitimate here — each effect is different *content* — so the
 * controls folder is rebuilt per effect: only the knobs an effect reads exist
 * while it is selected.
 */
export class EffectsScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = {
    effect: "wave",
    speed: 1.5,
    amplitude: 10,
    softness: 5,
    spread: 4,
    taper: 0.45,
    skew: 0.3,
    skewPivot: 0,
    topColor: 0xff5da8,
    bottomColor: 0x5db8ff,
  };

  constructor() {
    super({ key: "effects" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x22202c);
    this.heading(
      "Animated Effects",
      "One display callback, a menu of per-glyph effects.",
    );

    this.text = this.add
      .msdfText(640, 380, "Bangers", WORD, 130)
      .setColor("#ffffff")
      .setOrigin(0.5)
      .setDisplayCallback(this.renderChar);

    this.caption(
      "Each glyph is positioned, scaled and tinted independently. Corner ramp drives weight, " +
        "outline width and rounding per corner — every params channel is continuous. Glow beat " +
        "pulses a per-glyph shadow softness; Sticker pump pulses a per-corner shadow spread, which " +
        "fattens the shadow's silhouette instead of blurring it. The last four drive the quad's " +
        "corners directly: Lean slides the skew pivot, while Ribbon, Keystone and Jelly write " +
        "offsetX/offsetY, which reach shapes — trapezia, vertical shear — that no combination of " +
        "scale, rotation and skew can produce.",
    );

    this.commonTargets.push(this.text);
  }

  /**
   * Reset the object-level shadow / outline, then apply what the given effect
   * modulates. Runs from each mode's `activate()`, so switching effects never
   * leaves a stray shadow or outline (or perGlyphShadow) behind.
   */
  private applyEffectSetup(effect: string): void {
    this.params.effect = effect;
    this.text.clearShadow();
    this.text.clearOutline();
    this.text.perGlyphShadow = false;

    if (effect === "jump") {
      this.text.setShadow(0, 6, 0x000000, 0.55);
    } else if (effect === "outline") {
      this.text.setOutline(4, 0x000000, 1);
    } else if (effect === "cornerramp") {
      this.text.setOutline(1, 0xffd23f);
    } else if (effect === "glowbeat") {
      // A soft shadow is an outline-only quad reading the true SDF, so softness
      // is per-glyph like everything else; the callback owns it entirely.
      this.text.perGlyphShadow = true;
    } else if (effect === "sticker") {
      // A hard, offset, rounded shadow — no softness at all. The callback then
      // pumps its *spread*, which dilates the silhouette rather than blurring
      // it, so the slab fattens and stays crisp. Softness cannot do this: it
      // buys size only by mushing the edge.
      this.text.setShadow(0, 0, 0, 1, 0, 2);
      // this.text.setOutline(3, 0xffffff, 1, true, true);
    }
  }

  /** Display callback — mutates the per-glyph array for the selected effect. */
  private renderChar = (glyphs: GlyphState[]): void => {
    const now = this.time.now / 1000;
    const { speed, amplitude, effect } = this.params;

    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];

      switch (effect) {
        case "wave":
          g.y += Math.sin(i * 0.55 + now * 4 * speed) * amplitude;
          break;

        case "rainbow": {
          const hue = (i * 0.07 + now * 0.2 * speed) % 1;
          const hueBot = (hue + 0.18) % 1;
          const ct = Phaser.Display.Color.HSVToRGB(
            hue,
            1,
            1,
          ) as Phaser.Types.Display.ColorObject;
          const cb = Phaser.Display.Color.HSVToRGB(
            hueBot,
            1,
            1,
          ) as Phaser.Types.Display.ColorObject;
          // Colour is plain 0xRRGGBB; alpha is untouched, so glyphs stay opaque.
          g.fill.color.topLeft = g.fill.color.topRight =
            Phaser.Display.Color.GetColor(ct.r, ct.g, ct.b);
          g.fill.color.bottomLeft = g.fill.color.bottomRight =
            Phaser.Display.Color.GetColor(cb.r, cb.g, cb.b);
          break;
        }

        case "typewriter": {
          // Reveal sweeps across the word, holds, then restarts.
          const cycle = (now * 3 * speed) % (WORD.length + 6);
          if (i >= cycle) g.setScale(0);
          break;
        }

        case "jitter":
          g.x += (Math.random() - 0.5) * amplitude;
          g.y += (Math.random() - 0.5) * amplitude;
          break;

        case "popin": {
          // All glyphs start hidden, then spring in one by one; the loop repeats.
          const stagger = 0.18;
          const period = WORD.length * stagger + 3;
          const cycleTime = (now * speed) % period;
          const local = cycleTime - i * stagger;
          g.setScale(
            local <= 0 ? 0 : local < 1 ? Phaser.Math.Easing.Back.Out(local) : 1,
          );
          break;
        }

        case "fade": {
          // Per-glyph alpha: a wave of transparency sweeps the word. Colour is
          // left as seeded; only alpha changes — one call, no bit-packing.
          g.setFillAlpha(0.5 + 0.5 * Math.sin(i * 0.6 - now * 3 * speed));
          break;
        }

        case "gradient": {
          // Different colour per corner; alpha untouched. Both pickers are read
          // live, every frame.
          g.fill.color.topLeft = g.fill.color.topRight = this.params.topColor;
          g.fill.color.bottomLeft = g.fill.color.bottomRight = this.params.bottomColor;
          break;
        }

        case "jump": {
          // Glyphs hop up one by one; as each lifts, its shadow falls further
          // away and fades — per-glyph shadow offset + alpha, independent of fill.
          const stagger = 0.15;
          const period = WORD.length * stagger + 2;
          const local = ((now * speed) % period) - i * stagger;
          const lift = local > 0 && local < 1 ? Math.sin(local * Math.PI) : 0;
          // Squash-and-stretch: airborne glyphs stretch tall and narrow, using
          // the independent per-glyph scaleX / scaleY axes.
          g.setScale(1 - 0.22 * lift, 1 + 0.45 * lift);
          g.y -= lift * 24;
          g.shadow.x = lift * 7;
          g.shadow.y = 6 + lift * 18;
          g.setShadowAlpha(0.55 * (1 - 0.5 * lift));
          break;
        }

        case "outline": {
          // Fill stays white; only the outline cycles hue per glyph and pulses
          // its own alpha — outline colour/alpha are per-glyph attributes.
          const hue = (i * 0.07 + now * 0.2 * speed) % 1;
          const c = Phaser.Display.Color.HSVToRGB(
            hue,
            1,
            1,
          ) as Phaser.Types.Display.ColorObject;
          g.setOutlineColor(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
          g.setOutlineAlpha(0.55 + 0.45 * Math.sin(i * 0.6 - now * 3 * speed));
          break;
        }

        case "cornerramp": {
          // Every params channel is continuous, so all four interpolate across
          // the quad exactly like the colour corners do — rounding included.
          // The ramp is linear across the quad's bounding box, not the letter
          // contour. Animated weight on top, directional outline on the right,
          // sharp median(rgb) on the left melting into rounded true-SDF on the
          // right as the width grows.
          const phase = Math.sin(now * 1.5 * speed + i * 0.25) * 0.5 + 0.5;
          const w = g.weight;
          w.topLeft = w.topRight = 3.6 * phase;
          w.bottomLeft = w.bottomRight = 0;
          const o = g.outline.width;
          o.topLeft = o.bottomLeft = 0.2;
          o.topRight = o.bottomRight = 3.0;
          const r = g.outline.rounded;
          r.topLeft = r.bottomLeft = 0;
          r.topRight = r.bottomRight = 1;
          break;
        }

        case "glowbeat": {
          // Each glyph glows on its own beat: per-glyph shadow colour, alpha
          // and softness, with a zero offset so the shadow reads as a glow.
          const pulse = 0.5 + 0.5 * Math.sin(now * 2.5 * speed - i * 0.3);
          g.setShadowColor(0x7fd4ff);
          g.setShadowAlpha(0.35 + 0.65 * pulse);
          g.setShadowSoftness(this.params.softness * pulse);
          break;
        }

        case "sticker": {
          // Spread is per-corner like every other params channel, so the slab can
          // swell unevenly: it grows most under the bottom-right, where the
          // shadow is thrown, and stays tight at the top-left. The edge stays
          // hard throughout — nothing here is ever blurred.
          const pulse = 0.5 + 0.5 * Math.sin(now * 2.2 * speed - i * 0.35);
          const grow = this.params.spread * pulse;
          const s = g.shadow.spread;
          s.topLeft = 1;
          s.topRight = s.bottomLeft = 1 + grow * 0.5;
          s.bottomRight = 1 + grow;
          break;
        }

        case "lean": {
          // `skew` shears about the layout baseline; `skewPivot` slides that pivot
          // down, in em. Because the pivot is measured from the baseline — which a
          // whole line *shares* — every value keeps the line slanting as one line.
          // Drag the pivot past the descenders and the word leans about its visual
          // base instead of its baseline.
          g.skew = this.params.skew;
          g.skewPivot = this.params.skewPivot;
          break;
        }

        case "ribbon": {
          // The deform written as a **field over text space**: each corner samples
          // the same wave at its own absolute x, so a glyph's right edge and its
          // neighbour's left edge land on the same curve and the word warps as one
          // continuous ribbon — nothing has to be matched up between quads by hand.
          // Both corners of an edge move together, so each quad stays a
          // parallelogram (a *vertical* shear — which, incidentally, is the one
          // affine map skew/rotate/scale cannot produce between them).
          const wave = (x: number) =>
            Math.sin(x * 0.014 + now * 3 * speed) * amplitude * 1.6;
          const oy = g.offsetY;
          oy.topLeft = oy.bottomLeft = wave(g.x) / g.em;
          oy.topRight = oy.bottomRight = wave(g.x + g.width) / g.em;
          break;
        }

        case "keystone": {
          // A trapezium — the shape the transform lane provably cannot make, since
          // any affine map of a rectangle is a parallelogram. Again a field over
          // text space, so the *word* keystones rather than each letter doing it
          // alone: every corner is pulled toward the text's vertical centre line by
          // an amount that depends only on its own absolute y.
          //
          // This is also where the honest cost shows: a quad is two triangles with
          // an affine UV map each, so at a strong taper the letterforms crease
          // along the quad diagonal. There is no per-vertex perspective divide here.
          const cx = this.text.width / 2;
          const h = this.text.height || 1;
          const taper = this.params.taper * (0.5 + 0.5 * Math.sin(now * 1.2 * speed));
          // Shrink toward `cx` by `taper` at the top, not at all at the bottom.
          const dx = (x: number, y: number) => (cx - x) * taper * (1 - y / h);
          const ox = g.offsetX;
          const xl = g.x, xr = g.x + g.width;
          const yt = g.y, yb = g.y + g.height;
          ox.topLeft = dx(xl, yt) / g.em;
          ox.topRight = dx(xr, yt) / g.em;
          ox.bottomLeft = dx(xl, yb) / g.em;
          ox.bottomRight = dx(xr, yb) / g.em;
          break;
        }

        case "jelly": {
          // Four corners, four phases — a wobble no combination of scale, rotation
          // and skew can express, because it leaves the quad non-parallelogram on
          // most frames. The deform is em-relative, so it reads identically on a
          // narrow `I` and a wide `W`, and it survives a font-size change.
          const amp = (amplitude / 130) * 1.4;
          const ox = g.offsetX, oy = g.offsetY;
          const p = (k: number) => Math.sin(now * 4 * speed - i * 0.5 + k);
          ox.topLeft = amp * p(0);       oy.topLeft = amp * p(1.7);
          ox.topRight = amp * p(2.1);    oy.topRight = amp * p(3.9);
          ox.bottomLeft = amp * p(4.2);  oy.bottomLeft = amp * p(0.8);
          ox.bottomRight = amp * p(5.5); oy.bottomRight = amp * p(2.8);
          break;
        }
      }
    }
  };

  protected addControls(pane: Pane): void {
    // Knobs are read live by the callback each frame, so bindings need no
    // change handlers — existing at all is what wires them.
    const speed = (f: FolderApi) => f.addBinding(this.params, "speed", { min: 0.1, max: 3, step: 0.1 });
    const amplitude = (f: FolderApi) => f.addBinding(this.params, "amplitude", { min: 0, max: 40, step: 1 });

    const mode = (key: string, label: string, controls?: (f: FolderApi) => void): Mode => ({
      key,
      label,
      activate: () => this.applyEffectSetup(key),
      controls,
    });

    addModeControls(
      pane,
      [
        mode("wave", "Wave", (f) => {
          speed(f);
          amplitude(f);
        }),
        mode("gradient", "Gradient", (f) => {
          f.addBinding(this.params, "topColor", { label: "top color", view: "color" });
          f.addBinding(this.params, "bottomColor", { label: "bottom color", view: "color" });
        }),
        mode("rainbow", "Rainbow", speed),
        mode("typewriter", "Typewriter", speed),
        mode("jitter", "Jitter", amplitude),
        mode("popin", "Pop-in", speed),
        mode("fade", "Fade", speed),
        mode("jump", "Jump", speed),
        mode("outline", "Outline", speed),
        mode("cornerramp", "Corner ramp", speed),
        mode("glowbeat", "Glow beat", (f) => {
          speed(f);
          f.addBinding(this.params, "softness", { min: 0, max: 16, step: 0.5 });
        }),
        mode("sticker", "Sticker pump", (f) => {
          speed(f);
          f.addBinding(this.params, "spread", { min: 0, max: 6, step: 0.1 });
        }),
        mode("lean", "Lean (skew pivot)", (f) => {
          f.addBinding(this.params, "skew", { min: -0.6, max: 0.6, step: 0.01 });
          f.addBinding(this.params, "skewPivot", {
            label: "pivot (em)",
            min: -1,
            max: 1,
            step: 0.01,
          });
        }),
        mode("ribbon", "Ribbon wave", (f) => {
          speed(f);
          amplitude(f);
        }),
        mode("keystone", "Keystone", (f) => {
          speed(f);
          f.addBinding(this.params, "taper", { min: 0, max: 0.9, step: 0.01 });
        }),
        mode("jelly", "Jelly", (f) => {
          speed(f);
          amplitude(f);
        }),
      ],
      "wave",
    );
  }
}
