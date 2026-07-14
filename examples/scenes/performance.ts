import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance } from "../../src";

const WORDS = ["msdf", "crisp", "fast", "batch", "GPU", "2048", "score", "+99", "go!", "0xFF", "Phaser 4"];
const COLORS = ["#9be7ff", "#ffd24a", "#4ade80", "#f78fb3", "#c4b5fd", "#ffffff"];

interface Mover {
  text: MSDFTextInstance;
  vx: number;
  vy: number;
}

/**
 * Stress test: hundreds of independent MSDFText objects, each a separate Game
 * Object, all drawn through one shared batch — so the whole field still costs
 * only one or two draw calls. Pair with the "Capture frame" button.
 */
export class PerformanceScene extends ExampleScene {
  private movers: Mover[] = [];
  private params = { count: 600, styled: false, glyphs: 0, fps: 0 };
  private readouts: { refresh(): void }[] = [];

  constructor() {
    super({ key: "performance" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x0e1018);
    this.heading("Performance", "Hundreds of text objects, one or two draw calls.");
    this.spawn(this.params.count);
    this.caption(
      "Every word is its own MSDFText object, yet they share a single batch. Toggle 'styled' - " +
        "random weights, outlines and shadows change nothing about the draw-call count, because " +
        "they are all per-vertex attributes. Verify with GL Capture.",
    );
  }

  /** Destroy the current field and create `count` fresh movers. */
  private spawn(count: number): void {
    for (const m of this.movers) m.text.destroy();
    this.movers = [];

    let glyphs = 0;
    for (let i = 0; i < count; i++) {
      const word = WORDS[i % WORDS.length];
      const text = this.add
        .msdfText(
          Phaser.Math.Between(40, this.designWidth - 40),
          Phaser.Math.Between(120, this.designHeight - 80),
          "Inter",
          word,
          24,
        )
        .setColor(Phaser.Math.RND.pick(COLORS))
        .setOrigin(0.5);

      // Styled mode: weight, outline and shadow ride per-vertex attributes, so
      // mixing them across the field costs zero extra draw calls.
      if (this.params.styled) {
        text.weight = Phaser.Math.FloatBetween(0, 2);
        if (Math.random() < 0.5) {
          text.setOutline(Phaser.Math.FloatBetween(1, 3), Phaser.Math.RND.pick(COLORS));
        }
        if (Math.random() < 0.3) {
          text.setShadow(0, 0, Phaser.Math.RND.pick(COLORS), 0.8, Phaser.Math.FloatBetween(3, 8));
        }
      }

      glyphs += word.length;
      this.movers.push({
        text,
        vx: Phaser.Math.FloatBetween(-70, 70),
        vy: Phaser.Math.FloatBetween(-70, 70),
      });
    }
    this.params.glyphs = glyphs;
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Performance" });
    f.addBinding(this.params, "count", { min: 10, max: 5000, step: 100 })
      .on("change", (e) => this.spawn(e.value));
    f.addBinding(this.params, "styled", { label: "styled (same draw calls)" })
      .on("change", () => this.spawn(this.params.count));
    this.readouts = [
      f.addBinding(this.params, "glyphs", { readonly: true }),
      f.addBinding(this.params, "fps", { readonly: true, format: (v: number) => v.toFixed(0) }),
    ];
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    const maxX = this.designWidth - 30;
    const maxY = this.designHeight - 70;

    for (const m of this.movers) {
      const t = m.text;
      t.x += m.vx * dt;
      t.y += m.vy * dt;
      if (t.x < 30 || t.x > maxX) m.vx = -m.vx;
      if (t.y < 110 || t.y > maxY) m.vy = -m.vy;
    }

    this.params.fps = this.game.loop.actualFps;
    for (const r of this.readouts) r.refresh();
  }
}
