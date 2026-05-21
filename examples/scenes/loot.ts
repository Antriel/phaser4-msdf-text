import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import type { MSDFTextInstance, DisplayCallbackData } from "../../src";

/**
 * MSDF text in composition — a gallery of procedurally generated RPG item
 * cards. Each card is a Phaser container of MSDFText: an Anton name, an Inter
 * sub-line, mono stat values and a RobotoCondensed flavour quote, with outline
 * and glow keyed to the item's rarity. One featured card rerolls with a flip;
 * the rest drift across the scene, staying crisp through every scale and tilt.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

const between = Phaser.Math.Between;
const pick = <T>(a: readonly T[]): T => a[between(0, a.length - 1)];

/** Pack 0-255 RGB channels into the ABGR u32 a display-callback tint expects. */
function packABGR(r: number, g: number, b: number): number {
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Linear blend between two `0xRRGGBB` colours. */
function lerpColor(from: number, to: number, t: number): number {
  const r = Math.round(((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * t);
  const g = Math.round(((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * t);
  const b = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * t);
  return (r << 16) | (g << 8) | b;
}

/** Auto-shrink a text object so it fits `maxW` — crisp at any computed size. */
function fitWidth(t: MSDFTextInstance, maxW: number): void {
  if (t.width > maxW) t.setScale(maxW / t.width);
}

// ── Item model ──────────────────────────────────────────────────────────────

interface Rarity {
  name: string;
  color: number; // drives name colour, border, header tint and gem
  weight: number; // random-roll weighting
  statCount: number; // number of rolled stat rows
}

/** The classic loot ramp — index doubles as the "force rarity" control value. */
const RARITIES: Rarity[] = [
  { name: "Common", color: 0xb8c0cc, weight: 10, statCount: 2 },
  { name: "Uncommon", color: 0x57d361, weight: 10, statCount: 3 },
  { name: "Rare", color: 0x4d9bff, weight: 10, statCount: 3 },
  { name: "Epic", color: 0xc44dff, weight: 10, statCount: 4 },
  { name: "Legendary", color: 0xff9d2a, weight: 10, statCount: 5 },
  { name: "Mythic", color: 0xff3b6b, weight: 10, statCount: 6 },
];

interface BaseType {
  noun: string;
  category: string;
  heroLabel: string;
  heroRange: [number, number];
}

const BASE_TYPES: BaseType[] = [
  { noun: "Greatsword", category: "Two-Handed Sword", heroLabel: "Damage", heroRange: [60, 240] },
  { noun: "War Axe", category: "One-Handed Axe", heroLabel: "Damage", heroRange: [40, 180] },
  { noun: "Longbow", category: "Bow", heroLabel: "Damage", heroRange: [35, 160] },
  { noun: "Spellblade", category: "Dagger", heroLabel: "Damage", heroRange: [25, 120] },
  { noun: "Battle Staff", category: "Staff", heroLabel: "Spell Power", heroRange: [50, 210] },
  { noun: "Tower Shield", category: "Shield", heroLabel: "Armor", heroRange: [80, 360] },
  { noun: "Greathelm", category: "Heavy Helm", heroLabel: "Armor", heroRange: [40, 200] },
  { noun: "Plate Cuirass", category: "Heavy Chest", heroLabel: "Armor", heroRange: [90, 420] },
  { noun: "Signet Ring", category: "Ring", heroLabel: "Item Power", heroRange: [10, 90] },
  { noun: "Amulet", category: "Amulet", heroLabel: "Item Power", heroRange: [10, 90] },
];

const PREFIXES = [
  "Vorpal", "Blazing", "Frozen", "Ancient", "Savage", "Gilded", "Cursed",
  "Radiant", "Venomous", "Thunderous", "Eternal", "Grim", "Hallowed", "Ruinous",
];

const SUFFIXES = [
  "of the Bear", "of Doom", "of the Phoenix", "of Frost", "of the Viper",
  "of Kings", "of the Void", "of Slaying", "of the Wyrm", "of Embers", "of the Storm",
];

/** Evocative one-word names reserved for legendary and mythic drops. */
const UNIQUE_NAMES = [
  "Dawnbreaker", "Worldender", "Gravecaller", "Sunderheart", "Oathkeeper",
  "Nightfall", "Stormcrux", "Ashweaver", "Direwail", "The Last Lament",
];

interface StatDef {
  label: string;
  range: [number, number];
  percent: boolean;
}

const STAT_POOL: StatDef[] = [
  { label: "Strength", range: [4, 60], percent: false },
  { label: "Dexterity", range: [4, 60], percent: false },
  { label: "Intellect", range: [4, 60], percent: false },
  { label: "Vitality", range: [4, 60], percent: false },
  { label: "Critical Strike", range: [2, 35], percent: true },
  { label: "Attack Speed", range: [2, 25], percent: true },
  { label: "Life on Hit", range: [3, 40], percent: false },
  { label: "Movement Speed", range: [2, 18], percent: true },
  { label: "Thorns", range: [5, 80], percent: false },
];

const FLAVOR = [
  "Forged in a forgotten age, for a war long since lost.",
  "It hums faintly, as if it remembers every hand that held it.",
  "The last gift of a king with no kingdom left to give.",
  "Many have carried it. None of them grew old.",
  "Still warm to the touch, though the forge went cold an age ago.",
  "Whispers follow the bearer into every quiet room.",
  "Pried from a cold and unwilling hand.",
  "Lighter than it has any right to be.",
];

/** Affix powers — the marquee line on legendary and mythic cards. */
const POWERS = [
  "Strikes set the air ablaze.",
  "Slain foes erupt into flame.",
  "Critical hits chain to nearby enemies.",
  "Killing blows refund your dash.",
  "The first strike of each fight always crits.",
  "Wounds you deal can never be healed.",
  "Every third hit lands twice.",
  "Slaying an elite restores your health.",
  "Movement leaves a trail of cinders.",
  "Your critical hits explode on impact.",
];

interface Item {
  name: string;
  rarity: Rarity;
  category: string;
  heroLabel: string;
  heroValue: number;
  stats: { label: string; value: string }[];
  power?: string; // legendary / mythic affix power
  flavor: string;
  value: number; // gold
}

/** Weighted random rarity roll. */
function rollRarity(): Rarity {
  const total = RARITIES.reduce((s, r) => s + r.weight, 0);
  let n = Math.random() * total;
  for (const r of RARITIES) {
    if ((n -= r.weight) <= 0) return r;
  }
  return RARITIES[0];
}

/** Roll a complete item — pass a rarity to force it, or `null` to roll one. */
function generateItem(forced: Rarity | null): Item {
  const rarity = forced ?? rollRarity();
  const tier = RARITIES.indexOf(rarity);
  const base = pick(BASE_TYPES);
  const itemLevel = between(8, 95);

  // Name: top tiers often get a unique name; the rest stack affixes — which
  // run long enough to exercise the name's auto-shrink-to-fit.
  let name: string;
  if (tier >= 4 && Math.random() < 0.6) {
    name = pick(UNIQUE_NAMES);
  } else {
    const wantPrefix = tier >= 2 || Math.random() < 0.4;
    const wantSuffix = tier >= 1 && (tier >= 3 || Math.random() < 0.6);
    name = [wantPrefix ? pick(PREFIXES) : "", base.noun, wantSuffix ? pick(SUFFIXES) : ""]
      .filter(Boolean)
      .join(" ");
  }

  // Stats: distinct picks from the pool, rolled toward the item level.
  const lvlScale = 0.45 + (itemLevel / 95) * 0.55;
  const pool = Phaser.Utils.Array.Shuffle([...STAT_POOL]).slice(0, rarity.statCount);
  const stats = pool.map((s) => {
    const v = Math.round(Phaser.Math.Linear(s.range[0], s.range[1], Math.random() * lvlScale));
    return { label: s.label, value: s.percent ? `+${v}%` : `+${v}` };
  });

  const heroValue = Math.round(
    Phaser.Math.Linear(base.heroRange[0], base.heroRange[1], Math.random() * lvlScale),
  );

  return {
    name,
    rarity,
    category: base.category,
    heroLabel: base.heroLabel,
    heroValue,
    stats,
    power: tier >= 4 ? pick(POWERS) : undefined,
    flavor: pick(FLAVOR),
    value: itemLevel * (12 + tier * 22) + between(0, 200),
  };
}

// ── Card ────────────────────────────────────────────────────────────────────

const CARD_W = 300;
const CARD_H = 448;

// Palette shared by every card; only the rarity colour changes per item.
const PANEL_BG = 0x141722;
const DIM = 0xaab0be; // stat / hero labels
const HERO = 0xf2efe6; // the big hero number
const STAT_GREEN = 0x83e88d; // rolled bonuses
const GOLD = 0xffce54; // sell value
const OUTLINE = 0x0a0c12;
const EMBER_GLOW = 0xff5a1e; // affix-power flame glow

// Mythic shimmer: base name colour is white, so the per-glyph tint paints the
// red letterform and a gold band sweeping along it (a multiply tint can darken
// but not brighten, so the bright state has to be the base).
const MYTHIC_TINT = packABGR(0xff, 0x3b, 0x6b);
const SHIMMER_TINT = packABGR(0xff, 0xe6, 0x9c);

/**
 * One loot card: a Phaser container holding a Graphics panel and a stack of
 * MSDFText objects. `setItem` tears the text down and rebuilds it for a new
 * item — the panel and the name's effects are re-keyed to the new rarity.
 */
class LootCard {
  readonly container: Phaser.GameObjects.Container;
  item!: Item;

  private readonly panel: Phaser.GameObjects.Graphics;
  private parts: MSDFTextInstance[] = [];
  private nameText!: MSDFTextInstance;
  private powerText?: MSDFTextInstance; // affix power line, legendary / mythic only

  constructor(private scene: Phaser.Scene) {
    this.panel = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.panel]);
  }

  /** Rebuild the card for `item`. `effects` gates the rarity outline / glow. */
  setItem(item: Item, effects: boolean): void {
    this.item = item;
    this.parts.forEach((t) => t.destroy());
    this.parts = [];
    this.powerText = undefined;

    const color = item.rarity.color;
    const top = -CARD_H / 2;
    this.drawPanel(color);

    // Name — Anton, rarity colour.
    this.nameText = this.text(0, top + 29, "Anton", item.name, 30, color).setOrigin(0.5);

    // Sub-line — rarity + item category, small caps.
    const sub = this.text(
      0,
      top + 80,
      "Inter",
      `${item.rarity.name} · ${item.category}`.toUpperCase(),
      11,
      color,
    )
      .setOrigin(0.5)
      .setLetterSpacing(1.5)
      .setAlpha(0.85);
    fitWidth(sub, CARD_W - 36);

    // Hero stat — a quiet label over one big mono number.
    this.text(0, top + 102, "Inter", item.heroLabel.toUpperCase(), 11, DIM)
      .setOrigin(0.5)
      .setLetterSpacing(2);
    this.text(0, top + 138, "JetBrainsMono", String(item.heroValue), 42, HERO).setOrigin(0.5);

    // Rolled stats — label left, value right, spread to fill the mid band so
    // a 2-stat common and a 6-stat mythic both sit balanced.
    const bandTop = top + 178;
    const bandBottom = top + 312;
    item.stats.forEach((s, i) => {
      const y = bandTop + (bandBottom - bandTop) * ((i + 0.5) / item.stats.length);
      this.text(-CARD_W / 2 + 22, y, "Inter", s.label, 14, DIM).setOrigin(0, 0.5);
      this.text(CARD_W / 2 - 22, y, "JetBrainsMono", s.value, 14, STAT_GREEN).setOrigin(1, 0.5);
    });

    // Affix power (legendary & mythic) — a flame-tinted line above the flavour.
    // It is item content, so it always shows; `effects` only gates the fire.
    let flavorY = top + 332;
    if (item.power) {
      const power = this.text(0, flavorY, "RobotoCondensed", item.power, 14, color)
        .setOrigin(0.5, 0)
        .setMaxWidth(CARD_W - 44)
        .setCenterAlign();
      this.powerText = power;
      if (effects) {
        // White base so the per-corner fire tint reads at full strength.
        power.color = 0xffffff;
        power.setDropShadow(0, 0, EMBER_GLOW, 0.7, 8).setDisplayCallback(this.fireShimmer);
      }
      flavorY += power.height + 12;
    }

    // Flavour — RobotoCondensed, wrapped within the card width.
    this.text(0, flavorY, "RobotoCondensed", item.flavor, 13, DIM)
      .setOrigin(0.5, 0)
      .setMaxWidth(CARD_W - 48)
      .setCenterAlign()
      .setAlpha(0.65);

    // Footer — sell value in gold.
    this.text(0, top + 430, "JetBrainsMono", `${item.value.toLocaleString()} g`, 15, GOLD).setOrigin(
      0.5,
      1,
    );

    this.applyNameEffect(effects);
    // Shrink after letter spacing.
    fitWidth(this.nameText, CARD_W - 70);
  }

  /** Brief white flash on the name, settling to its rarity colour. */
  flashName(): void {
    const name = this.nameText;
    const target = name.color;
    const flash = { t: 0 };
    this.scene.tweens.add({
      targets: flash,
      t: 1,
      duration: 420,
      ease: "Quad.Out",
      onUpdate: () => {
        name.color = lerpColor(0xffffff, target, flash.t);
      },
    });
  }

  /** Per-frame: pulse the name glow, and flicker the affix-power flame. */
  update(time: number): void {
    // Legendary & mythic names carry a slow, even pulse.
    if (RARITIES.indexOf(this.item.rarity) >= 4 && this.nameText.hasDropShadow()) {
      const s = (Math.sin(time * 0.005) + 1) / 2;
      this.nameText.dropShadowSoftness = 5 + s * 6;
      this.nameText.dropShadowAlpha = 0.5 + s * 0.4;
      this.nameText.dropShadowX = 2 + s * 2;
      this.nameText.dropShadowY = 3 + s * 2;
    }
    // Affix power — two out-of-step sines give the glow an irregular flicker.
    if (this.powerText && this.powerText.hasDropShadow()) {
      const f = 0.55 + 0.28 * Math.sin(time * 0.013) + 0.17 * Math.sin(time * 0.029);
      this.powerText.dropShadowSoftness = 5 + f * 7;
      this.powerText.dropShadowAlpha = 0.45 + f * 0.4;
    }
  }

  destroy(): void {
    this.container.destroy(); // destroys the panel and every text child
  }

  /** Create an MSDFText, register it for teardown, parent it to the card. */
  private text(
    x: number,
    y: number,
    font: string,
    content: string,
    size: number,
    color: number,
  ): MSDFTextInstance {
    const t = this.scene.add.msdfText(x, y, font, content, size).setColor(color);
    this.parts.push(t);
    this.container.add(t);
    return t;
  }

  /** Draw the rounded panel, header band, dividers, border and rarity gem. */
  private drawPanel(color: number): void {
    const g = this.panel;
    const x = -CARD_W / 2;
    const y = -CARD_H / 2;
    g.clear();

    g.fillStyle(PANEL_BG, 0.97);
    g.fillRoundedRect(x, y, CARD_W, CARD_H, 16);

    g.fillStyle(color, 0.24);
    g.fillRoundedRect(x, y, CARD_W, 58, { tl: 16, tr: 16, bl: 0, br: 0 });

    g.lineStyle(1, color, 0.28);
    g.lineBetween(x + 16, y + 164, x + CARD_W - 16, y + 164); // above the stats
    g.lineBetween(x + 16, y + 320, x + CARD_W - 16, y + 320); // above the lower block

    g.lineStyle(2, color, 0.9);
    g.strokeRoundedRect(x, y, CARD_W, CARD_H, 16);

    // Rarity gem — a small diamond with a highlight, in the header corner.
    const gx = x + 26;
    const gy = y + 29;
    const pt = (px: number, py: number) => new Phaser.Math.Vector2(px, py);
    g.fillStyle(color, 1);
    g.fillPoints([pt(gx, gy - 7), pt(gx + 7, gy), pt(gx, gy + 7), pt(gx - 7, gy)], true);
    g.fillStyle(0xffffff, 0.55);
    g.fillPoints([pt(gx, gy - 7), pt(gx + 3, gy - 2), pt(gx - 3, gy - 2)], true);
  }

  /** Outline / shadow / glow on the name, escalating with rarity. */
  private applyNameEffect(effects: boolean): void {
    const name = this.nameText;
    name.clearOutline().clearDropShadow().clearDisplayCallback();
    if (!effects) return;

    const tier = RARITIES.indexOf(this.item.rarity);
    if (tier >= 1)
      name
        .setOutline(tier >= 4 ? 3.5 : 2.6, OUTLINE, 1, tier >= 4)
        .setLetterSpacing(tier >= 4 ? 2 : 1);
    if (tier === 3) {
      name.setDropShadow(0, 3, 0x000000, 0.8, 4);
      name.dropShadowX = 4;
      name.dropShadowY = 4;
    }
    if (tier >= 4) {
      // Legendary & mythic: a warm glow, pulsed each frame in update().
      name.setDropShadow(0, 0, this.item.rarity.color, 0.8, 8);
    }
    if (tier === 5) {
      // Mythic: a gold shimmer sweeps the glyphs — see MYTHIC_TINT note above.
      name.color = 0xffffff;
      name.setDisplayCallback(this.shimmer);
    }
  }

  /** Mythic display callback — paints the name red with a travelling highlight. */
  private shimmer = (d: DisplayCallbackData): DisplayCallbackData => {
    const sweep = Math.sin(d.index * 0.55 - (this.scene.time.now / 1000) * 3.5);
    const c = sweep > 0.6 ? SHIMMER_TINT : MYTHIC_TINT;
    d.tint.topLeft = d.tint.topRight = d.tint.bottomLeft = d.tint.bottomRight = c;
    return d;
  };

  /**
   * Affix-power display callback — a flame gradient: red-orange across the top
   * corners, yellow-white along the base, rippling per glyph with a fast
   * flicker. Left and right corners run out of phase, so the heat shimmers
   * diagonally across the line — a per-corner tint a plain colour can't do.
   */
  private fireShimmer = (d: DisplayCallbackData): DisplayCallbackData => {
    const t = this.scene.time.now / 1000;
    const flicker = 0.82 + 0.18 * Math.sin(t * 19 + d.index * 2.3);
    // `warm` shifts the hue red->yellow and brightens it; `phase` offsets the
    // ripple so each corner catches the heat at a slightly different moment.
    const ember = (warm: number, phase: number): number => {
      const wave = Math.sin(d.index * 0.55 - t * 4.5 + phase);
      const hue = 0.015 + warm * 0.09 + 0.02 * wave;
      const value = Math.min(1, (0.68 + warm * 0.32) * flicker);
      const c = Phaser.Display.Color.HSVToRGB(hue, 1, value) as Phaser.Types.Display.ColorObject;
      return packABGR(c.r, c.g, c.b);
    };
    d.tint.topLeft = ember(0, 0);
    d.tint.topRight = ember(0, 0.8);
    d.tint.bottomLeft = ember(1, 0);
    d.tint.bottomRight = ember(1, 0.8);
    return d;
  };
}

// ── Scene ───────────────────────────────────────────────────────────────────

const DRIFTER_COUNT = 6;
const DRIFT_SCALE = 0.62;
const WRAP_MARGIN = 240; // how far off-screen a drifter goes before wrapping

/** A drifting card plus its motion state. */
interface Drifter {
  card: LootCard;
  vx: number;
  vy: number;
  swayPhase: number;
  swaySpeed: number;
  breathPhase: number;
}

/**
 * RPG loot cards — a featured card you can reroll with a flip, plus a gallery
 * of cards drifting past behind it. Every card is plain MSDFText in a Phaser
 * container; the text stays crisp through all the drift, tilt and breathing.
 */
export class LootScene extends ExampleScene {
  private featured!: LootCard;
  private drifters: Drifter[] = [];
  private rerolling = false;
  private params = { forceRarity: -1, driftSpeed: 1, effects: true };

  constructor() {
    super({ key: "loot" });
  }

  protected build(): void {
    this.cameras.main.setBackgroundColor(0x0d0f17);
    this.heading("RPG Loot Cards", "Procedural item cards - four fonts, rarity-keyed colour and effects.");

    // Drifting gallery — seeded one card per rarity so all six colours show.
    for (let i = 0; i < DRIFTER_COUNT; i++) {
      const card = new LootCard(this);
      card.container
        .setPosition(between(170, this.designWidth - 170), between(150, this.designHeight - 150))
        .setScale(DRIFT_SCALE)
        .setDepth(1);
      card.setItem(generateItem(RARITIES[i % RARITIES.length]), this.params.effects);

      const angle = Math.random() * Math.PI * 2;
      const speed = Phaser.Math.FloatBetween(16, 32);
      this.drifters.push({
        card,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: Phaser.Math.FloatBetween(0.3, 0.7),
        breathPhase: Math.random() * Math.PI * 2,
      });
    }

    // Featured card — centred, full size, on top, rerollable.
    this.featured = new LootCard(this);
    this.featured.container.setPosition(this.designWidth / 2, this.designHeight / 2 + 6).setDepth(20);
    this.featured.setItem(generateItem(RARITIES[4]), this.params.effects);

    this.caption(
      "Legendary and mythic items gain a flame-lit affix power; the featured card rerolls with a flip.",
    );
  }

  /** Flip the featured card over and reveal a freshly rolled item. */
  private rerollFeatured(): void {
    if (this.rerolling) return;
    this.rerolling = true;

    const c = this.featured.container;
    this.tweens.add({
      targets: c,
      scaleX: 0,
      duration: 160,
      ease: "Cubic.In",
      onComplete: () => {
        const forced = this.params.forceRarity < 0 ? null : RARITIES[this.params.forceRarity];
        this.featured.setItem(generateItem(forced), this.params.effects);
        this.featured.flashName();
        this.tweens.add({
          targets: c,
          scaleX: 1,
          duration: 340,
          ease: "Back.Out",
          onComplete: () => {
            this.rerolling = false;
          },
        });
      },
    });
  }

  /** Roll a fresh item into every drifting card. */
  private rerollDrifters(): void {
    for (const d of this.drifters) {
      d.card.setItem(generateItem(null), this.params.effects);
    }
  }

  /** Re-key every card so the rarity-effects toggle takes effect immediately. */
  private applyEffects(): void {
    this.featured.setItem(this.featured.item, this.params.effects);
    for (const d of this.drifters) d.card.setItem(d.card.item, this.params.effects);
  }

  protected addControls(pane: Pane): void {
    const f = pane.addFolder({ title: "Loot" });
    f.addButton({ title: "Reroll featured (flip)" }).on("click", () => this.rerollFeatured());
    f.addBinding(this.params, "forceRarity", {
      label: "rarity",
      options: { Random: -1, Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4, Mythic: 5 },
    });
    f.addButton({ title: "Reroll drifters" }).on("click", () => this.rerollDrifters());
    f.addBinding(this.params, "driftSpeed", { label: "drift speed", min: 0, max: 2.5, step: 0.1 });
    f.addBinding(this.params, "effects", { label: "rarity effects" }).on("change", () =>
      this.applyEffects(),
    );
  }

  update(_time: number, delta: number): void {
    const t = this.time.now;
    const dt = delta / 1000;

    for (const d of this.drifters) {
      const c = d.card.container;
      c.x += d.vx * this.params.driftSpeed * dt;
      c.y += d.vy * this.params.driftSpeed * dt;

      // Gentle tilt sway + breathing scale — the "floating" feel.
      c.rotation = Math.sin(t * 0.001 * d.swaySpeed + d.swayPhase) * 0.07;
      c.setScale(DRIFT_SCALE * (1 + Math.sin(t * 0.0014 + d.breathPhase) * 0.035));

      // Wrap around the screen, respawning as a new item on the way back in.
      let wrapped = false;
      if (c.x < -WRAP_MARGIN) {
        c.x = this.designWidth + WRAP_MARGIN;
        wrapped = true;
      } else if (c.x > this.designWidth + WRAP_MARGIN) {
        c.x = -WRAP_MARGIN;
        wrapped = true;
      }
      if (c.y < -WRAP_MARGIN) {
        c.y = this.designHeight + WRAP_MARGIN;
        wrapped = true;
      } else if (c.y > this.designHeight + WRAP_MARGIN) {
        c.y = -WRAP_MARGIN;
        wrapped = true;
      }
      if (wrapped) d.card.setItem(generateItem(null), this.params.effects);

      d.card.update(t);
    }

    // Featured card — a slow idle breath while it is not mid-flip.
    if (!this.rerolling) {
      this.featured.container.setScale(1 + Math.sin(t * 0.0016) * 0.012);
    }
    this.featured.update(t);
  }
}
