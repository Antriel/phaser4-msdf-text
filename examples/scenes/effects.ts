import * as Phaser from "phaser";
import type { FolderApi, Pane } from "tweakpane";
import { ExampleScene } from "../harness/ExampleScene";
import { addModeControls, type Mode } from "../harness/modes";
import type { MSDFTextInstance, GlyphState, DecorationState } from "../../src";

const WORD = "EFFECTS";

// What a decoding glyph churns through before it settles. A code the font does
// not have falls back to the character the text actually says, so an over-broad
// alphabet degrades quietly rather than dropping the glyph.
const SCRAMBLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

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
  private captionText!: MSDFTextInstance;
  private params = {
    effect: "wave",
    speed: 1.5,
    amplitude: 10,
    softness: 5,
    spread: 4,
    cornerWeight: 3.6,
    cornerWidth: 3.0,
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
      .setDisplayCallback(this.renderChar)
      // The second lane. Decorations are rects, not glyphs, so `displayCallback`
      // cannot see them — this one gets the underlines and pills instead, and runs
      // *after* the glyph callback, so it can read the finished glyph array.
      .setDecorationCallback(this.renderDecor);

    // Retexted per mode from `activate()` — the initial mode fills it in.
    this.captionText = this.caption("");

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
    // Not part of clearOutline: the inner colour has no body of its own, so a
    // stray one only shows once another mode sets an outline — clear it here.
    this.text.setOutlineInnerColor(null);
    this.text.perGlyphShadow = false;
    // Decorations are the decoration lane's business, but *whether there are any*
    // is still an object-level spec — the callback animates rects, it does not
    // conjure them.
    this.text.setUnderline(
      effect === "typewriter" ? { thickness: 0.9, offset: 0.05 } : false,
    );
    this.text.setHighlight(
      effect === "stamp"
        ? {
            color: 0xd6304a,
            radius: 0.4,
            borderWidth: 0.12,
            borderColor: 0xffd23f,
            padding: { x: 0.16, y: 0.06 },
          }
        : false,
    );

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
    } else if (effect === "orbit") {
      // A hard shadow with some spread, so a wide band of it shows past the
      // glyph; the callback aims the offset and ramps the per-corner softness
      // so only the far side of the throw blurs.
      this.text.setShadow(0, 0, 0x100c1c, 0.8, 0, 2);
    } else if (effect === "aurora") {
      // A zero-width layered outline with softness is a glow silhouette pass
      // under the fill; the inner colour makes it two-tone. The callback then
      // re-writes all of its per-corner channels every frame.
      this.text.setOutline(0, 0xffffff, 1, 1, true, 6);
      this.text.setOutlineInnerColor(0xffffff);
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
          // Reveal sweeps across the word, holds, then restarts. `visible` — not a
          // zero scale or a zero alpha, both of which still submit the quad and
          // hand the GPU nothing to draw. An untyped glyph here costs no quad at
          // all, and the underline behind it is trimmed to match in `renderDecor`.
          if (i >= this.typedCount(now)) g.visible = false;
          break;
        }

        case "decode": {
          // A different letterform in the same slot. The layout is untouched — the
          // slot keeps the original character's pen position and advance — so the
          // word churns in place instead of breathing as the letters change width,
          // which is what calling setText every frame would do (and it would
          // relayout the whole text besides).
          const settle = 0.7 + i * 0.22;
          const t = (now * speed) % (WORD.length * 0.22 + 3);
          if (t < settle) {
            // Bucketed, not per-frame: 20 changes a second reads as a churn, 60
            // reads as a strobe. Deterministic in (bucket, i), so no Math.random.
            const bucket = Math.floor(t * 20);
            g.setGlyph(SCRAMBLE[(bucket * 31 + i * 17) % SCRAMBLE.length]);
            g.setFillAlpha(0.55);
          }
          break;
        }

        case "stamp": {
          // The glyphs land with the pill behind them; `renderDecor` drives the
          // pill itself. Both read the same clock — the two callbacks are separate
          // lanes, not separate timelines.
          const t = this.stampPhase(now);
          g.setScale(Phaser.Math.Easing.Back.Out(t));
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
          g.fill.color.bottomLeft = g.fill.color.bottomRight =
            this.params.bottomColor;
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
          w.topLeft = w.topRight = this.params.cornerWeight * phase;
          w.bottomLeft = w.bottomRight = 0;
          const o = g.outline.width;
          o.topLeft = o.bottomLeft = 0.2;
          o.topRight = o.bottomRight = this.params.cornerWidth;
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

        case "orbit": {
          // A light orbiting the word. The shadow is thrown opposite it, and
          // the per-corner softness ramps across the quad so the penumbra
          // widens toward the throw's far side while the near edge stays hard
          // against the glyph — the soft-on-one-side shadow one softness value
          // cannot express. The ramp sweeps through every diagonal as the
          // light passes the corners.
          const ang = now * 1.1 * speed;
          const dx = Math.cos(ang),
            dy = Math.sin(ang);
          g.shadow.x = -dx * 12;
          g.shadow.y = -dy * 12;
          const soft = this.params.softness;
          // Each corner follows the throw angle directly, then shaped with a dead zone so
          // the near side still reaches a visibly hard 0-softness edge.
          const HARD = 0.12;
          const FULL = Math.SQRT1_2;
          const throwAng = ang + Math.PI;
          const c = (cornerAng: number) => {
            const facing = Math.cos(throwAng - cornerAng);
            const t = Phaser.Math.Clamp((facing - HARD) / (FULL - HARD), 0, 1);
            return soft * t * t * (3 - 2 * t);
          };
          const s = g.shadow.softness;
          s.topLeft = c((-3 * Math.PI) / 4);
          s.topRight = c(-Math.PI / 4);
          s.bottomLeft = c((3 * Math.PI) / 4);
          s.bottomRight = c(Math.PI / 4);
          break;
        }

        case "aurora": {
          // Every per-corner channel of the outline layer at once, on the
          // zero-width layered glow set up in applyEffectSetup: the outer
          // colour, the two-tone ramp's *inner* colour (per-corner as well —
          // four ramps meeting mid-glyph), and the softness, which swings the
          // glow from one side of each letter to the other. The fill's
          // per-corner alpha dips on the glowing side, so the glow bleeds
          // through the letterform — the layered-outline translucency
          // tradeoff, spent on purpose.
          const o = g.outline;
          const drift = now * 0.1 * speed + i * 0.04;
          const outer = o.color,
            inner = o.innerColor;
          outer.topLeft = this.hue(drift);
          outer.topRight = this.hue(drift + 0.12);
          outer.bottomRight = this.hue(drift + 0.24);
          outer.bottomLeft = this.hue(drift + 0.36);
          // Opposite hues, desaturated toward white — a pale core distinct
          // from its own corner's halo.
          inner.topLeft = this.hue(drift + 0.5, 0.35);
          inner.topRight = this.hue(drift + 0.62, 0.35);
          inner.bottomRight = this.hue(drift + 0.74, 0.35);
          inner.bottomLeft = this.hue(drift + 0.86, 0.35);
          const swing = 0.5 + 0.5 * Math.sin(now * 1.4 * speed + i * 0.35);
          const soft = this.params.softness;
          const s = o.softness;
          s.topLeft = s.bottomLeft = soft * (1 - swing);
          s.topRight = s.bottomRight = soft * swing;
          const a = g.fill.alpha;
          a.topLeft = a.bottomLeft = 1 - 0.35 * (1 - swing);
          a.topRight = a.bottomRight = 1 - 0.35 * swing;
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
          const taper =
            this.params.taper * (0.5 + 0.5 * Math.sin(now * 1.2 * speed));
          // Shrink toward `cx` by `taper` at the top, not at all at the bottom.
          const dx = (x: number, y: number) => (cx - x) * taper * (1 - y / h);
          const ox = g.offsetX;
          const xl = g.x,
            xr = g.x + g.width;
          const yt = g.y,
            yb = g.y + g.height;
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
          const ox = g.offsetX,
            oy = g.offsetY;
          const p = (k: number) => Math.sin(now * 4 * speed - i * 0.5 + k);
          ox.topLeft = amp * p(0);
          oy.topLeft = amp * p(1.7);
          ox.topRight = amp * p(2.1);
          oy.topRight = amp * p(3.9);
          ox.bottomLeft = amp * p(4.2);
          oy.bottomLeft = amp * p(0.8);
          ox.bottomRight = amp * p(5.5);
          oy.bottomRight = amp * p(2.8);
          break;
        }
      }
    }
  };

  /** `0..1` hue (+ optional saturation) to `0xRRGGBB`, for per-corner colour ramps. */
  private hue(h: number, s = 1): number {
    const c = Phaser.Display.Color.HSVToRGB(
      ((h % 1) + 1) % 1,
      s,
      1,
    ) as Phaser.Types.Display.ColorObject;
    return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
  }

  /** How many glyphs the typewriter has typed by now. Shared by both callbacks. */
  private typedCount(now: number): number {
    return (now * 3 * this.params.speed) % (WORD.length + 6);
  }

  /** The stamp's 0..1 landing progress. Shared by both callbacks. */
  private stampPhase(now: number): number {
    return Math.min(1, (now * this.params.speed) % 2.6);
  }

  /**
   * Decoration callback — the lane `displayCallback` cannot reach. It runs once a
   * frame with every underline, strikethrough and highlight pill the text laid
   * out, *after* the glyph callback, so `text.glyphs` is final by the time it
   * reads it.
   *
   * The array is transient: re-seeded from the built rects every frame, so both
   * effects below recompute from the clock rather than accumulating. There is no
   * manual mode to take instead — a rect is a *merge* of adjacent characters, so
   * it has no identity that would survive a re-wrap for edits to be re-applied to.
   */
  private renderDecor = (
    rects: DecorationState[],
    text: MSDFTextInstance,
  ): void => {
    const now = this.time.now / 1000;

    if (this.params.effect === "typewriter") {
      const glyphs = text.glyphs;
      if (!glyphs) return;

      for (const r of rects) {
        // `glyphStart`/`glyphEnd` are the window of glyphs this rect was merged
        // from — direct indices into the array, so following your own glyphs is a
        // loop and not a search. Trim the rule to the last one the typewriter has
        // reached, and hide it entirely before the first.
        let right = r.x;
        let typed = false;
        for (let i = r.glyphStart; i < r.glyphEnd; i++) {
          const g = glyphs[i];
          if (!g.visible) break;
          right = Math.max(right, g.x + g.width);
          typed = true;
        }
        r.visible = typed;
        r.w = Math.max(0, right - r.x);
      }
      return;
    }

    if (this.params.effect === "stamp") {
      const t = this.stampPhase(now);
      for (const r of rects) {
        // A per-rect transform, about the rect's own centre — and exact under the
        // box SDF, because radius/border/softness are fractions of the pill's
        // half-thickness, so they scale with it: `radius: 0.4` stays 0.4 of a
        // pill half its size. It lands rotated slightly off-square, like a stamp.
        r.setScale(Phaser.Math.Easing.Back.Out(t));
        r.rotation = (1 - t) * -0.22;
        r.setAlpha(t);
      }
    }
  };

  protected addControls(pane: Pane): void {
    // Knobs are read live by the callback each frame, so bindings need no
    // change handlers — existing at all is what wires them.
    const speed = (f: FolderApi) =>
      f.addBinding(this.params, "speed", { min: 0.1, max: 3, step: 0.1 });
    const amplitude = (f: FolderApi) =>
      f.addBinding(this.params, "amplitude", { min: 0, max: 40, step: 1 });
    const softness = (f: FolderApi) =>
      f.addBinding(this.params, "softness", { min: 0, max: 16, step: 0.5 });

    const mode = (
      key: string,
      label: string,
      caption: string,
      controls?: (f: FolderApi) => void,
    ): Mode => ({
      key,
      label,
      activate: () => {
        this.applyEffectSetup(key);
        this.captionText.setText(caption);
      },
      controls,
    });

    addModeControls(
      pane,
      [
        mode(
          "wave",
          "Wave",
          "Per-glyph position: the callback runs once per frame with the whole glyph array, and moving a glyph never touches the layout.",
          (f) => {
            speed(f);
            amplitude(f);
          },
        ),
        mode(
          "gradient",
          "Gradient",
          "A different colour per corner of every quad — plain tinting cannot do that. Both pickers are read live each frame.",
          (f) => {
            f.addBinding(this.params, "topColor", {
              label: "top color",
              view: "color",
            });
            f.addBinding(this.params, "bottomColor", {
              label: "bottom color",
              view: "color",
            });
          },
        ),
        mode(
          "rainbow",
          "Rainbow",
          "Per-glyph fill colour, two hues per quad, drifting along the word.",
          speed,
        ),
        mode(
          "typewriter",
          "Typewriter + rule",
          "glyph.visible skips the quad entirely — no zero-alpha submissions. A second, decoration callback trims the underline to the typed glyphs, which the glyph callback cannot reach.",
          speed,
        ),
        mode(
          "decode",
          "Decode (glyph swap)",
          "setGlyph draws a different letterform in a fixed slot: the layout keeps the original pen position and advance, so the word churns in place instead of breathing.",
          speed,
        ),
        mode(
          "stamp",
          "Stamp (pill pop-in)",
          "The decoration callback scales and rotates the highlight pill about its own centre; glyphs and pill land on the same clock, in separate lanes.",
          speed,
        ),
        mode(
          "jitter",
          "Jitter",
          "Per-glyph position, re-randomized every frame — the glyph array is re-seeded from the object before each callback, so nothing accumulates.",
          amplitude,
        ),
        mode(
          "popin",
          "Pop-in",
          "Per-glyph scale with a stagger. A glyph at scale 0 keeps its slot — the layout never reflows.",
          speed,
        ),
        mode(
          "fade",
          "Fade",
          "Per-glyph fill alpha, separate from colour — one call, no bit-packing.",
          speed,
        ),
        mode(
          "jump",
          "Jump",
          "Independent scaleX/scaleY squash-and-stretch, plus a per-glyph shadow: its offset and alpha track each glyph's own hop, independent of the fill.",
          speed,
        ),
        mode(
          "outline",
          "Outline",
          "Outline colour and alpha are per-glyph vertex data, so every glyph cycles its own hue — and it all stays one draw call.",
          speed,
        ),
        mode(
          "cornerramp",
          "Corner ramp",
          "Every params channel is continuous, so all are per-corner: bold fades in at the top, the outline thickens toward the right and melts from sharp to rounded as it grows.",
          (f) => {
            speed(f);
            f.addBinding(this.params, "cornerWeight", {
              label: "weight (top)",
              min: 0,
              max: 4,
              step: 0.1,
            });
            f.addBinding(this.params, "cornerWidth", {
              label: "outline (right)",
              min: 0,
              max: 4,
              step: 0.1,
            });
          },
        ),
        mode(
          "glowbeat",
          "Glow beat",
          "Per-glyph shadow softness with a zero offset reads as a glow — each glyph pulses on its own beat, in the same draw call.",
          (f) => {
            speed(f);
            softness(f);
          },
        ),
        mode(
          "sticker",
          "Sticker pump",
          "Shadow spread dilates the silhouette without blurring it — softness cannot do that. It is per-corner, so the slab swells toward the bottom-right and stays crisp.",
          (f) => {
            speed(f);
            f.addBinding(this.params, "spread", { min: 0, max: 6, step: 0.1 });
          },
        ),
        mode(
          "orbit",
          "Orbit light (soft-side shadow)",
          "Shadow softness is per-corner: the penumbra widens only on the side away from the light and stays hard against the glyph — a soft-on-one-side shadow no single value can express.",
          (f) => {
            speed(f);
            softness(f);
          },
        ),
        mode(
          "aurora",
          "Aurora (two-tone corners)",
          "A zero-width layered glow with every per-corner channel live: outer colour, two-tone inner colour and softness, which swings the glow from side to side. The fill's per-corner alpha dips so the glow bleeds through the letterform.",
          (f) => {
            speed(f);
            softness(f);
          },
        ),
        mode(
          "lean",
          "Lean (skew pivot)",
          "skew shears about the layout baseline; skewPivot slides that pivot down in em. The baseline is the one line a whole line shares, so any pivot keeps the text slanting as one.",
          (f) => {
            f.addBinding(this.params, "skew", {
              min: -0.6,
              max: 0.6,
              step: 0.01,
            });
            f.addBinding(this.params, "skewPivot", {
              label: "pivot (em)",
              min: -1,
              max: 1,
              step: 0.01,
            });
          },
        ),
        mode(
          "ribbon",
          "Ribbon wave",
          "offsetY written as a field over text space: neighbouring corners sample the same wave, so the word bends as one continuous ribbon — a vertical shear scale/rotation/skew cannot produce.",
          (f) => {
            speed(f);
            amplitude(f);
          },
        ),
        mode(
          "keystone",
          "Keystone",
          "offsetX makes a trapezium — impossible for any affine transform, which only ever maps a rectangle to a parallelogram. The honest cost: letterforms crease along the quad diagonal at a hard taper.",
          (f) => {
            speed(f);
            f.addBinding(this.params, "taper", {
              min: 0,
              max: 0.9,
              step: 0.01,
            });
          },
        ),
        mode(
          "jelly",
          "Jelly",
          "Four corners, four phases — a non-parallelogram wobble beyond the transform lane. Em-relative, so a narrow I and a wide W wobble alike.",
          (f) => {
            speed(f);
            amplitude(f);
          },
        ),
      ],
      "wave",
    );
  }
}
