import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance } from "../../src";

/** Score counter screen position — score-fly popups home in on this. */
const SCORE_AT = { x: 150, y: 150 };

/**
 * MSDF text in context — a mock game HUD. Everything here is plain MSDFText
 * driven by ordinary Phaser tweens: a monospace score counter, a decaying
 * combo meter, crit damage numbers, score-fly popups, and a wave banner.
 */
export class GameUIScene extends ExampleScene {
  private score = 0;
  private combo = 0;
  private wave = 0;
  private lastHitTime = 0;

  private scoreText!: MSDFTextInstance;
  private comboText!: MSDFTextInstance;
  private waveBanner!: MSDFTextInstance;
  private levelUp!: MSDFTextInstance;

  constructor() {
    super({ key: "gameui" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x141826);
    this.heading("Game UI Showcase", "Counters, combos, crits and callouts in context.");

    // Monospace score counter, top-left — digits don't jitter as it climbs.
    this.scoreText = this.add
      .msdfText(48, 132, "JetBrainsMono", "SCORE 000000", 34)
      .setColor("#9be7ff");

    // Static hi-score, top-right.
    this.add
      .msdfText(this.designWidth - 48, 132, "JetBrainsMono", "HI 042500", 34)
      .setColor("#ffd24a")
      .setOrigin(1, 0);

    // Combo meter — hidden until the first hit, decays when you stop.
    this.comboText = this.add
      .msdfText(this.scoreText.x + this.scoreText.width / 2, 198, "Bangers", "COMBO x0", 44)
      .setColor("#ffe27a")
      .setAlpha(0)
      .setOrigin(0.5);

    // Wave banner — parked off-screen left, sweeps across on demand.
    this.waveBanner = this.add
      .msdfText(-600, 300, "Anton", "WAVE 1", 110)
      .setColor("#ffffff")
      .setOrigin(0.5)
      .setOutline(2.5, "#10131c", 1)
      .setShadow(0, 6, "#000000", 0.5, 4)
      .setDepth(10);

    // Centre callout — outline + soft glow, hidden until triggered.
    this.levelUp = this.add
      .msdfText(640, 452, "Anton", "LEVEL UP!", 120)
      .setColor("#fff2b0")
      .setOrigin(0.5)
      .setOutline(3, "#5a3a00", 1, true)
      .setLetterSpacing(10)
      .setShadow(0, 0, "#ffae00", 0.9, 10)
      .setDepth(5)
      .setScale(0);

    this.caption(
      "Combo meter, crits, score-fly popups and the wave banner are all plain MSDFText driven by Phaser tweens.",
    );
  }

  // ── Combo ───────────────────────────────────────────────────────────────

  /** Combo colour ramps hotter as the count climbs. */
  private comboColor(n: number): string {
    if (n >= 12) return "#ff4d6d";
    if (n >= 6) return "#ff9d3a";
    return "#ffe27a";
  }

  /** Advance the combo and punch-scale the meter. */
  private registerHit(): void {
    this.combo++;
    this.lastHitTime = this.time.now;

    const c = this.comboText;
    c.setText(`COMBO x${this.combo}`).setColor(this.comboColor(this.combo));

    this.tweens.killTweensOf(c);
    c.setAlpha(1).setScale(1.35);
    this.tweens.add({ targets: c, scale: 1, duration: 260, ease: Phaser.Math.Easing.Back.Out });
  }

  // ── Score ───────────────────────────────────────────────────────────────

  /** Add points and punch-scale the counter. */
  private addScore(points: number): void {
    this.score += points;
    this.scoreText.setText("SCORE " + this.score.toString().padStart(6, "0"));

    const s = this.scoreText;
    this.tweens.killTweensOf(s);
    s.setScale(1.18);
    this.tweens.add({ targets: s, scale: 1, duration: 220, ease: Phaser.Math.Easing.Back.Out });
  }

  /** A "+N" popup that flies from (x, y) into the score counter. */
  private spawnScorePopup(x: number, y: number, points: number): void {
    const popup = this.add
      .msdfText(x, y, "Bangers", `+${points}`, 34)
      .setColor("#7dffb0")
      .setOrigin(0.5);

    this.tweens.add({
      targets: popup,
      x: SCORE_AT.x,
      y: SCORE_AT.y,
      scale: 0.5,
      duration: 600,
      delay: 130,
      ease: Phaser.Math.Easing.Cubic.In,
      onComplete: () => {
        this.addScore(points);
        popup.destroy();
      },
    });
    this.tweens.add({ targets: popup, alpha: 0, duration: 200, delay: 530 });
  }

  // ── Hits ────────────────────────────────────────────────────────────────

  /** Spawn one hit: a damage number (sometimes a crit) + combo + score popup. */
  private spawnHit(): void {
    const x = Phaser.Math.Between(360, 920);
    const y = Phaser.Math.Between(360, 520);
    const crit = Math.random() < 0.25;

    const base = Phaser.Math.Between(20, 90);
    const points = crit ? base * 3 : base;
    const size = crit ? Phaser.Math.Between(86, 110) : Phaser.Math.Between(46, 70);

    const dmg = this.add
      .msdfText(x, y, "Bangers", crit ? `${points}!` : `${points}`, size)
      .setColor(crit ? "#ff3b3b" : "#ffe9a8")
      .setOrigin(0.5)
      .setScale(0.5);

    if (crit) {
      dmg.setOutline(2.5, "#3a0000", 1).setRotation(Phaser.Math.FloatBetween(-0.22, 0.22));

      // A small "CRIT!" tag that floats up alongside the number.
      const tag = this.add
        .msdfText(x, y - size * 0.6, "Bangers", "CRIT!", 30)
        .setColor("#ffd24a")
        .setOrigin(0.5)
        .setRotation(dmg.rotation);
      this.tweens.add({
        targets: tag,
        y: tag.y - 175,
        alpha: 0,
        duration: 1000,
        delay: 160,
        ease: Phaser.Math.Easing.Cubic.Out,
        onComplete: () => tag.destroy(),
      });
    }

    // Pop in, then float up and fade.
    this.tweens.add({ targets: dmg, scale: 1, duration: 200, ease: Phaser.Math.Easing.Back.Out });
    this.tweens.add({
      targets: dmg,
      y: y - (crit ? 175 : 125),
      alpha: 0,
      duration: crit ? 1000 : 820,
      delay: 160,
      ease: Phaser.Math.Easing.Cubic.Out,
      onComplete: () => dmg.destroy(),
    });

    this.registerHit();
    this.spawnScorePopup(x, y, points);
  }

  /** A rapid burst of hits — climbs the combo fast. */
  private comboBurst(): void {
    for (let i = 0; i < 8; i++) {
      this.time.delayedCall(i * 110, () => this.spawnHit());
    }
  }

  // ── Wave + level up ─────────────────────────────────────────────────────

  /** Sweep the wave banner in from the left, hold, then off to the right. */
  private nextWave(): void {
    this.wave++;
    const b = this.waveBanner;

    this.tweens.killTweensOf(b);
    b.setText(`WAVE ${this.wave}`).setX(-600).setAlpha(1);
    this.tweens.add({ targets: b, x: 640, duration: 600, ease: Phaser.Math.Easing.Back.Out });
    this.tweens.add({ targets: b, x: 1900, duration: 520, delay: 1500, ease: Phaser.Math.Easing.Cubic.In });
  }

  /** Animate the centre callout in, hold, then fade out. */
  private triggerLevelUp(): void {
    this.tweens.killTweensOf(this.levelUp);
    this.levelUp.setScale(0).setAlpha(1);
    this.tweens.add({
      targets: this.levelUp,
      scale: 1,
      duration: 480,
      ease: Phaser.Math.Easing.Back.Out,
    });
    this.tweens.add({ targets: this.levelUp, alpha: 0, delay: 1400, duration: 500 });
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Actions" });
    f.addButton({ title: "Attack! (build combo)" }).on("click", () => this.spawnHit());
    f.addButton({ title: "Combo burst x8" }).on("click", () => this.comboBurst());
    f.addButton({ title: "Next wave" }).on("click", () => this.nextWave());
    f.addButton({ title: "Trigger LEVEL UP" }).on("click", () => this.triggerLevelUp());
  }

  update(): void {
    // Combo decays to zero once you stop landing hits.
    if (this.combo > 0 && this.time.now - this.lastHitTime > 1600) {
      this.combo = 0;
      this.tweens.killTweensOf(this.comboText);
      this.tweens.add({ targets: this.comboText, alpha: 0, duration: 300 });
    }
  }
}
