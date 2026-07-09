import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, GlyphState } from "../../src";

const WORD = "EFFECTS";

const EFFECT_OPTIONS = {
  Wave: "wave",
  Gradient: "gradient",
  Rainbow: "rainbow",
  Typewriter: "typewriter",
  Jitter: "jitter",
  "Pop-in": "popin",
  Fade: "fade",
  Jump: "jump",
  Outline: "outline",
};

/**
 * Per-glyph animation via `setDisplayCallback`. The callback runs once per frame
 * with the whole glyph array; each glyph may be moved, scaled, rotated,
 * recoloured or faded — independently, and with a different colour/alpha per
 * corner, which plain tinting cannot do. `Jump` and `Outline` also drive the
 * per-glyph shadow and per-glyph outline, which the callback controls
 * separately from the fill.
 */
export class EffectsScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = { effect: "wave", speed: 1.5, amplitude: 10 };

  constructor() {
    super({ key: "effects" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x22202c);
    this.heading(
      "Animated Effects",
      "One display callback, nine per-glyph effects.",
    );

    this.text = this.add
      .msdfText(640, 380, "Bangers", WORD, 130)
      .setColor("#ffffff")
      .setOrigin(0.5)
      .setDisplayCallback(this.renderChar);

    this.applyEffectSetup(this.params.effect);
    this.caption(
      "Each glyph is positioned, scaled and tinted independently. Gradient sets a colour per corner; " +
        "Jump drives a per-glyph shadow; Outline recolours each glyph's outline on its own.",
    );

    this.commonTargets.push(this.text);
  }

  /**
   * Enable the object-level shadow / outline that the per-glyph effect modulates.
   * Most effects need neither, so we toggle them as the selection changes rather
   * than leaving a shadow or outline on for everything.
   */
  private applyEffectSetup(effect: string): void {
    if (effect === "jump") {
      this.text.clearOutline();
      this.text.setShadow(0, 6, 0x000000, 0.55);
    } else if (effect === "outline") {
      this.text.clearShadow();
      this.text.setOutline(4, 0x000000, 1);
    } else {
      this.text.clearShadow();
      this.text.clearOutline();
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
          // Different colour per corner; alpha untouched.
          g.fill.color.topLeft = g.fill.color.topRight = 0xff5da8;
          g.fill.color.bottomLeft = g.fill.color.bottomRight = 0x5db8ff;
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
          // its own alpha — outline colour/alpha are now per-glyph attributes.
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
      }
    }
  };

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Effect" });
    f.addBinding(this.params, "effect", { options: EFFECT_OPTIONS }).on(
      "change",
      (e) => this.applyEffectSetup(e.value as string),
    );
    f.addBinding(this.params, "speed", { min: 0.1, max: 3, step: 0.1 });
    f.addBinding(this.params, "amplitude", { min: 0, max: 40, step: 1 });
  }
}
