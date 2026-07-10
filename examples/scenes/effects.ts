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
        "pulses a per-glyph shadow softness.",
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
      ],
      "wave",
    );
  }
}
