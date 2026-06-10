import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, DisplayCallbackData } from "../../src";

const WORD = "EFFECTS";

const EFFECT_OPTIONS = {
  Wave: "wave",
  Gradient: "gradient",
  Rainbow: "rainbow",
  Typewriter: "typewriter",
  Jitter: "jitter",
  "Pop-in": "popin",
  Fade: "fade",
};

/**
 * Per-character animation via `setDisplayCallback`. The callback runs once per
 * glyph per frame and may move, scale, rotate, recolour, or fade it (a
 * different tint and alpha per corner, which plain tinting cannot do).
 */
export class EffectsScene extends ExampleScene {
  private text!: MSDFTextInstance;
  private params = { effect: "wave", speed: 1.5, amplitude: 10 };

  constructor() {
    super({ key: "effects" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x12101c);
    this.heading("Animated Effects", "One display callback, seven per-glyph effects.");

    this.text = this.add
      .msdfText(640, 380, "Bangers", WORD, 130)
      .setColor("#ffffff")
      .setOrigin(0.5)
      .setDisplayCallback(this.renderChar);

    this.caption(
      "Each glyph is positioned, scaled and tinted independently - Gradient even sets a different colour per corner.",
    );

    this.commonTargets.push(this.text);
  }

  /** Display callback — mutates per-glyph data for the selected effect. */
  private renderChar = (d: DisplayCallbackData): DisplayCallbackData => {
    const now = this.time.now / 1000;
    const { speed, amplitude } = this.params;

    switch (this.params.effect) {
      case "wave":
        d.y += Math.sin(d.index * 0.55 + now * 4 * speed) * amplitude;
        break;

      case "rainbow": {
        const hue = (d.index * 0.07 + now * 0.2 * speed) % 1;
        const hueBot = (hue + 0.18) % 1;
        const ct = Phaser.Display.Color.HSVToRGB(hue, 1, 1) as Phaser.Types.Display.ColorObject;
        const cb = Phaser.Display.Color.HSVToRGB(hueBot, 1, 1) as Phaser.Types.Display.ColorObject;
        const top = Phaser.Display.Color.GetColor(ct.r, ct.g, ct.b);
        const bot = Phaser.Display.Color.GetColor(cb.r, cb.g, cb.b);
        // `tint` is authoritative ARGB — preserve each corner's seeded alpha
        // byte, or the glyph renders transparent.
        d.tint.topLeft = top | (d.tint.topLeft & 0xff000000);
        d.tint.topRight = top | (d.tint.topRight & 0xff000000);
        d.tint.bottomLeft = bot | (d.tint.bottomLeft & 0xff000000);
        d.tint.bottomRight = bot | (d.tint.bottomRight & 0xff000000);
        break;
      }

      case "typewriter": {
        // Reveal sweeps across the word, holds, then restarts.
        const cycle = (now * 3 * speed) % (WORD.length + 6);
        if (d.index >= cycle) d.scale = 0;
        break;
      }

      case "jitter":
        d.x += (Math.random() - 0.5) * amplitude;
        d.y += (Math.random() - 0.5) * amplitude;
        break;

      case "popin": {
        // All glyphs start hidden, then spring in one by one; the loop repeats.
        const stagger = 0.18;
        const period = WORD.length * stagger + 3;
        const cycleTime = (now * speed) % period;
        const local = cycleTime - d.index * stagger;
        d.scale = local <= 0 ? 0 : local < 1 ? Phaser.Math.Easing.Back.Out(local) : 1;
        break;
      }

      case "fade": {
        // Per-glyph alpha: a wave of transparency sweeps the word. Pack white
        // RGB with a per-glyph alpha byte (ARGB) into every corner.
        const a = 0.5 + 0.5 * Math.sin(d.index * 0.6 - now * 3 * speed);
        const packed = (((a * 255) | 0) << 24 | 0xffffff) >>> 0;
        d.tint.topLeft = d.tint.topRight = packed;
        d.tint.bottomLeft = d.tint.bottomRight = packed;
        break;
      }

      case "gradient": {
        // `tint` is authoritative ARGB — keep the seeded alpha (0xff here).
        const a = d.tint.topLeft & 0xff000000;
        d.tint.topLeft = d.tint.topRight = 0xff5da8 | a;
        d.tint.bottomLeft = d.tint.bottomRight = 0x5db8ff | a;
        break;
      }
    }

    return d;
  };

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Effect" });
    f.addBinding(this.params, "effect", { options: EFFECT_OPTIONS });
    f.addBinding(this.params, "speed", { min: 0.1, max: 3, step: 0.1 });
    f.addBinding(this.params, "amplitude", { min: 0, max: 40, step: 1 });
  }
}
