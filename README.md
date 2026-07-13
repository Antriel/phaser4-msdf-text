# phaser4-msdf-text

[![npm](https://img.shields.io/npm/v/phaser4-msdf-text)](https://www.npmjs.com/package/phaser4-msdf-text)
[![license](https://img.shields.io/npm/l/phaser4-msdf-text)](./LICENSE)

MSDF (Multi-channel Signed Distance Field) font rendering for [Phaser 4](https://phaser.io).

[**Live examples →**](https://antriel.github.io/phaser4-msdf-text/)

- Crisp text at any scale (no pixelation when zooming, single texture per font)
- Batched rendering — 1–2 draw calls per text object, regardless of length
- Shader-based outlines — sharp, or rounded corners on MTSDF atlases (no extra draw calls)
- Drop shadows — hard, or soft/glow on MTSDF atlases (extra pass, batched)
- Rich text — per-run colour, size, typeface, effects; no markup in the string
- Per-character display callbacks (wave, rainbow, jiggle, rotate, scale, …)
- Word wrapping with configurable wrap character

## Install

```bash
npm install phaser4-msdf-text
```

Phaser 4 is a peer dependency — install it alongside if you haven't already:

```bash
npm install phaser@^4.1.0
```

## Setup

Register the global plugin in your game config. It wires up the render node
and font cache, and verifies the required `OES_standard_derivatives` extension.

```ts
import * as Phaser from 'phaser';
import { MSDFPlugin } from 'phaser4-msdf-text';

new Phaser.Game({
    type: Phaser.WEBGL,
    width: 800,
    height: 600,
    plugins: {
        global: [
            { key: 'MSDFPlugin', plugin: MSDFPlugin, start: true },
        ],
    },
    scene: [MyScene],
});
```

> Alternatively, call `installMSDFPlugin(game)` from `callbacks.postBoot`.

## Use

Load fonts via the standard Phaser loader, then create text via `add.msdfText`:

```ts
class MyScene extends Phaser.Scene {
    preload() {
        // Loads <key>.png and <key>.json by default, or pass explicit URLs.
        this.load.msdfFont('arial', 'assets/fonts/Arial.png', 'assets/fonts/Arial.json');
    }

    create() {
        const text = this.add.msdfText(400, 300, 'arial', 'Hello, MSDF!', 48);
        text.setColor(0xffffff);
        text.setCenterAlign();
        text.setOrigin(0.5);
    }
}
```

Or via the creator API:

```ts
const text = this.make.msdfText({
    x: 400, y: 300,
    font: 'arial',
    text: 'Hello, MSDF!',
    fontSize: 48,
    color: 0xffffff,
    align: 'center',  // 'left' (default), 'center' or 'right'
    // Optional effects — same fields as setOutline / setShadow:
    outline: { width: 1.5, color: 0x000000, rounded: true },
    shadow:  { offsetX: 4, offsetY: 4, alpha: 0.5, softness: 6 },
});
```

## Examples

Live, interactive demos — each link opens that example directly:

| Example | What it shows |
|---|---|
| [Crisp at Any Scale](https://antriel.github.io/phaser4-msdf-text/#crisp) | MSDF vs. bitmap fonts under extreme zoom — no pixelation |
| [Style Lab](https://antriel.github.io/phaser4-msdf-text/#stylelab) | Outline, glow, shadow and weight — every knob, live |
| [Animated Effects](https://antriel.github.io/phaser4-msdf-text/#effects) | Per-character display callbacks — wave, rainbow, jiggle |
| [Rich Text](https://antriel.github.io/phaser4-msdf-text/#richtext) | Per-run colour, gradient, shadow, skew; keyword rules and ranges |
| [Mixed Fonts & Sizes](https://antriel.github.io/phaser4-msdf-text/#fonts) | Multiple typefaces and sizes in one object, shared baselines |
| [Highlights & Decorations](https://antriel.github.io/phaser4-msdf-text/#decor) | Underline, strikethrough, and highlight pills |
| [Fit Inside](https://antriel.github.io/phaser4-msdf-text/#fitinside) | Reflowing text to fit a box via `fitInside` |
| [Game UI Showcase](https://antriel.github.io/phaser4-msdf-text/#gameui) | A mock game HUD — score counter, combo meter, damage numbers |
| [RPG Loot Cards](https://antriel.github.io/phaser4-msdf-text/#loot) | Procedural item cards — mixed fonts, rarity-keyed outline & glow |
| [Performance](https://antriel.github.io/phaser4-msdf-text/#performance) | Draw-call count under a heavy text load |

Each example's source is in [`examples/scenes/`](./examples/scenes).

## API

### Text properties

```ts
// Chainable setters (Phaser-idiomatic)
text.setText('New content');
text.setFontSize(64);
text.setColor(0xff8800);           // packed 0xRRGGBB
text.setColor('#ff8800');          // hex string or 'rgb(255, 136, 0)'
text.setColor({ r: 255, g: 136, b: 0 });  // object (0-255), optional `a`
text.setColor(0xff8800, 0.5);      // optional alpha (0-1) overrides color's alpha
text.setCenterAlign();             // also setLeftAlign() / setRightAlign()
text.setLineSpacing(10);
text.setLetterSpacing(2);          // extra px after each character

// Or use property accessors directly
text.text = 'New content';
text.fontSize = 64;
text.align = 'center';             // 'left' (default), 'center' or 'right'
text.lineSpacing = 10;
text.letterSpacing = 2;

text.width;                        // rendered width in local space (read-only)
text.height;                       // rendered height in local space (read-only)
text.getTextBounds();              // { width, height, lines: { count, lengths, shortest, longest } }
```

### Word wrap

```ts
text.setMaxWidth(400);             // Wrap to fit 400px (0 disables)
// Or:  text.maxWidth = 400;
text.wordWrapCharCode = 32;        // Default: space. Use 45 for hyphen, etc.
```

### Fit to a box (`fitInside`)

```ts
// Resize only: shrink the font until the wrapped text fits 400×200.
text.fitInside({ width: 400, height: 200 });

// Resize and place: also position the block inside the box.
text.fitInside(
    { x: 100, y: 60, width: 400, height: 200 },
    { hAlign: 'center', vAlign: 'middle' },
);

// Allow growth-to-fill (default is shrink-only).
text.fitInside({ width: 400, height: 200 }, { maxFontSize: 120 });
```

`fitInside` binary-searches the largest `fontSize` whose **word-wrapped**
layout fits the box on both axes. It reflows rather than scales — a larger
font wraps to fewer words per line, changing the shape of the block. (A naive
scale-to-fit is already covered by `setDisplaySize`.)

```ts
interface RectLike { x?: number; y?: number; width: number; height: number; }

interface FitOptions {
    maxFontSize?: number;  // upper bound; default = current fontSize (shrink-only)
    minFontSize?: number;  // floor (> 0); default 1
    hAlign?: 'left' | 'center' | 'right';    // default 'left'
    vAlign?: 'top' | 'middle' | 'bottom';    // default 'top'
    precision?: number;    // binary-search tolerance in px; default 0.25
}
```

- **Shrink-only by default** — `maxFontSize` defaults to the current
  `fontSize`; pass a larger one to allow growth-to-fill.
- With both `x` and `y` (supplied together) the block is also positioned via
  `hAlign`/`vAlign`, respecting origin and scale; with neither, it is only
  resized.
- It sets both `fontSize` **and** `maxWidth` (the box width), and it is
  **one-shot**: later text changes re-wrap at that width but don't re-fit the
  size — call it again.
- The chosen size is fractional by design (MSDF is crisp at any scale);
  `Math.floor` it yourself if you need an integer.
- `lineSpacing` / `letterSpacing` / shadow offset are constant pixels and do
  not scale with the fitted size; outline width, shadow offset and rotation
  fall outside `width`/`height` and are ignored.

### Outline (shader-based, no extra draw calls)

```ts
text.setOutline(1.5, 0x000000, 1.0);              // width (distance-field units), color, alpha
text.setOutline(1.5, 0x000000, 1.0, true);        // rounded outer corners (MTSDF atlas only)
text.setOutline(3, 0x000000, 1.0, false, true);   // layered — thick outline, no neighbour overlap
text.setOutline(0, 0x00e5ff, 1.0, false, false, 7); // width 0 + softness = a glow, in the fill's quad
text.clearOutline();
text.hasOutline();                            // boolean

// setOutline is a convenience wrapper — the fields can be set or tweened directly:
text.outlineWidth = 2;                        // distance-field units
text.outlineColor = 0x000000;                 // packed 0xRRGGBB
text.outlineAlpha = 1;
text.outlineRounded = true;                   // MTSDF atlas only
text.outlineSoftness = 4;                     // blur the outer edge; MTSDF atlas only
text.outlineLayered = true;                   // separate silhouette pass under the fill

// Two-tone: ramp the outline from outlineColor (outer edge) to a second colour
// where it meets the glyph. Neon tube, chalk outline, bevel.
text.setOutlineInnerColor(0xff5ea8);
text.setOutlineInnerColor(null);              // back to a single-colour outline
```

Practical widths are roughly 0.5–3.0 — the shader saturates around
`distanceRange / 2` distance-field units. For thicker outlines, regenerate the
atlas with a larger `-pxrange` rather than pushing the width higher.

`rounded` rounds the outline's outer corners; the letterforms stay sharp. It
requires an **MTSDF** atlas (`-type mtsdf`; see [FONTS.md](FONTS.md)) — on
plain MSDF it is ignored with a one-time warning.

`outlineSoftness` blurs the outline's *outer* edge, in the same distance-field
units as the width. The blur straddles the outline edge, so its inner half
disappears under the opaque fill and only the outside softens. With
`outlineWidth` at `0` the outline **is** the blur — a glow hugging the
letterform — and because it rides the fill's own quad, that glow costs no extra
pass and no extra quads, unlike the shadow-based glow below. MTSDF atlas only.

`layered` fixes thick outlines spilling over neighbouring glyphs: every
outline silhouette draws first, every fill on top. Costs a second set of glyph
quads (still 1–2 draw calls), and translucent text shows the outline through
the fill — leave it off unless the outline is actually thick enough to
overlap. Works on plain MSDF, combines with `rounded` and the shadow.

`setOutlineInnerColor` ramps the outline from `outlineColor` at the outer edge
to a second colour where it meets the glyph, so it only shows on outlines wide
enough to see a gradient in. It costs nothing — the inner colour rides an
otherwise-idle vertex attribute — but for exactly that reason it **forces
`outlineLayered`**. No MTSDF needed. Per-glyph via `outline.innerColor` on a
`GlyphState`, per-run via `outline.innerColor` in a style spec.

### Shadow (extra pass, still batched)

```ts
text.setShadow(4, 4, 0x000000, 0.5);              // x, y, color, alpha
text.setShadow(4, 4, 0x000000, 0.5, 6);           // soft shadow, 6-unit blur (MTSDF atlas only)
text.setShadow(0, 0, 0x33ccff, 0.8, 8);           // zero offset + softness reads as a glow
text.setShadow(5, 8, 0x1c1633, 1, 0, 3.5);        // hard + spread 3.5 = a chunky "sticker" slab
text.clearShadow();
text.hasShadow();

// setShadow is a convenience wrapper — the fields can be set or tweened directly:
text.shadowX = 4;
text.shadowY = 4;
text.shadowColor = 0x000000;                      // packed 0xRRGGBB
text.shadowAlpha = 0.5;
text.shadowSoftness = 6;                          // blur, distance-field units, MTSDF atlas only
text.shadowSpread = 2;                            // dilation, distance-field units, any atlas
text.shadowRounded = false;                       // default true; MTSDF atlas only

// Two-tone: ramp the blur from shadowColor (outer) to a hot core at the glyph.
text.setShadowInnerColor(0xffffff);
text.setShadowInnerColor(null);                   // back to a single-colour shadow
```

`softness` is the blur in **distance-field units** (`0` = hard edge, the
default), so it scales with the text at any size. Any value above `0` requires
an **MTSDF** atlas; on plain MSDF it is ignored with a one-time warning. The
maximum usable blur is the atlas `distanceRange` — for softer, regenerate with
a larger `-pxrange`.

`shadowSpread` **dilates the shadow's silhouette before it is blurred** —
Photoshop's *spread* next to its *size*. It is what fattens a shadow without
also mushing it (softness can only buy size at the cost of focus), and it is the
only way to reach a fat **hard** shadow: spread with no softness is the chunky
offset slab behind cartoon lettering. It dilates the same field a thick outline
does, so unlike softness it needs no MTSDF atlas, and it saturates at the same
place — half the atlas `distanceRange`. One bound worth knowing: a *hard* spread
past roughly `0.3 × distanceRange` starts to fade at its outer band, where the
shader's deep-background guard reads the raw field. Any nonzero softness lifts
that guard entirely.

`shadowRounded` (default **`true`**) takes the dilated/blurred silhouette from
the true SDF rather than the corner-preserving `median(rgb)` the fill uses. It is
on by default — unlike `outlineRounded` — because it does nothing at all until a
spread or a softness lifts the shadow's edge off the glyph contour, and where it
does bite, a sharp dilation of `median(rgb)` grows a mitre spike at every corner
of every letter. Set it `false` if you want those spikes. MTSDF atlas only.

`setShadowInnerColor` makes the blur a two-tone gradient: `shadowColor` at the
outer edge, the inner colour at the glyph. A soft, zero-offset shadow with a
white inner colour is the classic glow. It needs `shadowSoftness` above `0` to
have a band to ramp across, but no layering. Per-glyph via `shadow.innerColor`
on a `GlyphState`, per-run via a style spec.

Shadow colour, alpha, offset, softness, spread and rounding are per-glyph state,
so a `displayCallback` or `editGlyphs` can give individual glyphs their own shadow.
The pass is skipped when the object has no shadow, so set
**`perGlyphShadow = true`** to run it for those glyphs (rich-text runs that set
a shadow turn the pass on automatically):

```ts
text.perGlyphShadow = true;
text.setDisplayCallback((glyphs) => {
    for (const g of glyphs) { g.setShadowAlpha(0.6); g.shadow.x = 3; g.shadow.y = 3; }
});
```

### Faux bold — `weight`

```ts
text.weight = 2.5;          // distance-field units; negative thins the glyph
text.setWeight(2.5);        // chainable wrapper
```

`weight` shifts each glyph's distance threshold to fatten (or thin) the
letterform, in distance-field units, saturating at half the atlas
`distanceRange`. Outline and shadow edges move with it. It does **not** change
the advance, so at high weights letters can touch — prefer a real bold atlas
for body text. Per-glyph and per-corner (`g.weight.topLeft`, …), so a
faux-bold gradient is free.

### Underline & strikethrough

```ts
text.setUnderline(true);                             // inherit the fill colour
text.setStrikethrough({ color: 0xff5252, offset: 0.02 });
text.setUnderline(false);                            // off
```

Both accept `true`/`false` or `{ color?, alpha?, thickness?, offset? }`.
`thickness` multiplies the font's own `underlineThickness`; `offset` is
em-relative (positive is down). Left alone, colour and alpha **inherit the
resolved fill**, so each coloured word gets a matching rule. They are also
`StyleSpec` keys, so segments and overlays can set them per run — including
`underline: false` to punch a hole in an object-level underline. The rects
batch with the glyphs: a decorated text is still one draw call.

- Decorations follow the **layout**, not the glyphs: per-glyph `scale`,
  `rotation` and `skew` move a glyph, its rule stays put, and
  `displayCallback` cannot see them.
- A rule splits at line breaks, at `fontScale`/`font` boundaries, and — when
  the colour is inherited — at colour changes. Interior spaces are bridged;
  leading/trailing ones are not.
- Strikethrough sits at `-0.25 em` above the baseline (msdf-atlas-gen emits no
  strike metric); use `offset` where that lands wrong for your face.
- Decorations cast no shadow and take no outline.

### Highlight pills

A rounded, optionally soft, optionally bordered box painted **behind** a run of
text — a marker highlight, or the damage-number pill.

```ts
// Marker pen: a soft, translucent wash behind the whole text.
text.setHighlight({ color: 0xffe066, alpha: 0.85, radius: 0.45, softness: 0.3,
                    padding: { x: 0.12, y: 0.04 } });

// Damage pill: a stadium with a crisp border.
text.setHighlight({ color: 0xd6304a, radius: 1, borderWidth: 0.18,
                    borderColor: 0xffd23f, padding: 0.3 });

// Per-word, via any style layer.
text.addStyle('CRIT', { highlight: { color: 0xff5252, radius: 1 }, color: 0xffffff });

text.setHighlight(false);   // off
```

`radius`, `borderWidth` and `softness` are **fractions of the pill's own
half-thickness** (`min(width, height) / 2`), not pixels — `radius: 1` is a
stadium at any font size, and a pill keeps its proportions under `setFontSize`
or `fitInside`.

`softness` fades **inward** — the box is the outer bound of everything the
pill draws — so give a glow its room with `padding`. `padding` is em-relative:
a scalar, or `{ x?, y?, left?, right?, top?, bottom? }` (a named side wins over
its axis). The unpadded box runs from the tallest ascender to the deepest
descender, so **negative padding** is often what you want — it crops inward,
towards the x-height.

Like a glyph's outline width, all three are continuous and therefore
**per-corner**:

```ts
// A tab: rounded on top, square on the bottom, blurred down the right edge.
text.setHighlight({
  color: 0x7fd4ff,
  radius:   { topLeft: 1, topRight: 1,   bottomLeft: 0, bottomRight: 0 },
  softness: { topLeft: 0, topRight: 0.5, bottomLeft: 0, bottomRight: 0.5 },
});
```

A face `alpha` of `0` frees the colour slot for `innerColor`, the inner end of
a colour ramp across the border — the same two-tone mechanism a glowing shadow
uses. With `borderWidth: 1` (a ring that fills the pill's whole body, so the
ramp spans the full half-thickness) and a `softness`, that is a glow blob:

```ts
text.setHighlight({ alpha: 0, borderWidth: 1, softness: 0.75, radius: 1,
                    borderColor: 0x2b0a4a, innerColor: 0x9ad8ff, padding: 0.35 });
```

- Pills draw **behind everything**, the text's own drop shadow included, and
  batch with the glyphs — still one draw call.
- A highlight **never inherits the fill colour** (it would hide the text), so
  it doesn't split at colour changes and a colour tween doesn't drag it along.
- One pill per **visual line**; its vertical extent is the union over the run,
  so mixed `fontScale`s and mixed `font`s wrap as one shape.
- Like the other decorations it follows the layout, not the glyphs, and
  `displayCallback` cannot see it.

### Rich text — per-run styling

Style specific words or ranges — colour, gradient, effects, size, typeface —
**without markup in the string**. Two entry points, both taking the same
`StyleSpec`: *content* goes in through `setRichText`, *overlays* go on through
`addStyle`.

**Content — `setRichText(segments)`.** Segment text is concatenated into the
plain text (`text` still returns the joined string; wrapping is unchanged);
the styles travel with the content and are replaced by the next
`setText`/`setRichText`.

```ts
text.setRichText([
    'Deal ',
    { text: '50', color: 0xffd23f, scale: 1.15 },   // styled run
    ' fire damage to ',
    { text: 'all', color: { topLeft: 0xff5da8, topRight: 0xff5da8,   // gradient
                             bottomLeft: 0x5db8ff, bottomRight: 0x5db8ff } },
    ' enemies.',
]);
text.text; // → "Deal 50 fire damage to all enemies."  (plain string, wraps normally)
```

**Overlays — `addStyle(target, style)`.** Style whatever `target` selects, on
top of the content. Returns a `StyleHandle` (`update` / `remove`).

```ts
const dmg = text.addStyle('DMG', { color: 0xff5252 });         // every "DMG" is red
text.addStyle(/\d+/, { weight: 2, fontScale: 1.2 });           // every number
text.addStyle({ match: 'the', nth: 0, wholeWord: true }, { color: 0x88ccff });
text.addStyle({ segment: 'weapon' }, { color: 0xffd23f });     // a named segment
text.addStyle({ start: 6, length: 4 }, { color: 0xffe066 });   // fixed indices
text.addStyle(tokenize, { color: 0x9ae6b4 });                  // (text) => spans

dmg.update({ color: 0xffa500 });   // replace the style (coalesced re-seed)
dmg.remove();                      // drop the overlay
```

The **anchor decides the lifetime**, and that is the whole rule:

- **Content-anchored** — a string, a `RegExp`, a `{ match, … }` object, a
  `{ segment }` name, or a `(text) => { start, length }[]` matcher. Spans are
  re-derived on every text change, so the overlay **survives** `setText` and
  `setRichText`.
- **Position-anchored** — a `{ start, length }` object. It indexes the text you
  passed it against, so **any** text change drops it and kills its handle (a
  stale handle no-ops with a one-time warning). Use it for text you know is
  stable — search hits, your own parser's output.

A bare string matches every occurrence, case-sensitively; `{ match, … }` adds
`all`, `nth`, `wholeWord`, `caseSensitive`. A `RegExp` matches every occurrence
(`g`/`y` flags ignored, zero-length matches skipped; use `i` for
case-insensitivity). The matcher function is the extension point — a parser's
token spans, "every emoji", "every third word" are one-liners, re-run on each
text change. `clearStyles()` removes every overlay (segments are content,
kept).

**Named segments — `{ segment: id }`.** Give a segment an `id` and an overlay
can address it by name, wherever it currently sits:

```ts
const render = (weapon: string) => text.setRichText([
    'You found the ',
    { text: weapon, id: 'weapon' },   // no style of its own — just a name
    '!',
]);

render('Blade of Embers');
const rarity = text.addStyle({ segment: 'weapon' }, { color: 0xffd23f });

rarity.update({ color: 0xb388ff });   // restyle the piece; nothing else moves
render('Cinderfang');                 // new content, same id — the overlay follows
```

This answers the one wart of content styling: `setRichText` replaces the
content, dropping every position-anchored overlay as collateral, but a named
piece keeps its own handle. A segment needs no style keys to carry an id, ids
need not be unique, and an overlay whose id is currently absent is alive but
empty — it revives when a later `setRichText` brings the id back.

A `StyleSpec` accepts: `color`/`alpha` (a scalar, or a per-corner object for a
gradient), `weight`,
`outline` (`{ color?, innerColor?, alpha?, width?, rounded?, softness? }`),
`shadow` (`{ color?, innerColor?, alpha?, x?, y?, softness?, spread?, rounded? }`),
`scale`/`scaleX`/`scaleY`, `rotation`, `skew`, `underline`, `strikethrough`,
`highlight`, `fontScale` and `font`. Only the keys you set override the
glyph's seeded base; `weight` and every continuous effect channel
(`outline.width`/`.softness`, `shadow.softness`/`.spread`) also take per-corner
objects.

- A per-run **shadow** turns the shadow pass on by itself — but it needs an
  explicit **`alpha`**: glyphs seed a shadow alpha of `0` unless the object has
  a shadow to inherit, so `shadow: { color: 0xff0000, x: 2, y: 2 }` is
  invisible — add `alpha: 0.5`.
- A per-run **outline** likewise stands alone: `outline: { width: 2 }` outlines
  just that run, `width: 0` removes it from a run of an outlined text, and
  differing widths batch together.
- `rounded` and `softness` (on either layer) need an **MTSDF** atlas; on plain
  MSDF they are clamped away silently. `shadow.spread` does not — it dilates the
  same field a thick outline does.
- `outline.color` on a run makes that run's outline **solid** in that colour —
  `innerColor` follows `color` unless set too. A run's `outline.innerColor`
  still needs the object's `outlineLayered` (or `outlineInnerColor`) for a
  silhouette pass to ride.

Styles paint in order of increasing dynamism — **segments → overlays →
`displayCallback`** — with overlays in the order added, applied key-by-key: a
later layer that sets only `outline` keeps an earlier layer's `color`; where
two set the same key, last wins. A static keyword colour and an animated
callback therefore compose. Handle updates coalesce into one re-seed before
the next render (in manual mode a styles re-seed emits `'glyphsreset'`,
once/tick).

| action | segments | content-anchored overlays | position-anchored overlays |
|---|---|---|---|
| `setText` / `setRichText` | replaced with the text | kept; spans re-derived | dropped; handles die |
| `handle.update` / `remove` | — | mutates the overlay | mutates the overlay |
| `clearStyles()` | kept | removed | removed |

**What a style change costs** depends on the *keys*, not the layer:

| key lane | keys | cost |
|---|---|---|
| appearance | `color`, `alpha`, `weight`, `outline`, `shadow`, `scale`, `rotation`, `skew` | one coalesced per-glyph re-seed |
| decoration | `underline`, `strikethrough`, `highlight` | one coalesced rect rebuild |
| structural | `fontScale`, `font` | a **relayout** |

The one hard line: **specs are layout inputs, the glyph array is layout
output.** `displayCallback` and `editGlyphs` operate on already-laid-out
glyphs, so they are appearance-only by construction — `GlyphState` has no
structural fields. To animate size, tween `fontScale` through a handle's
`update` and pay a rebuild per change.

#### Per-run size — `fontScale`

`fontScale` and `font` are the **structural** keys — they change advance, wrap
and line height, so they reflow the text instead of re-seeding it.

```ts
text.setRichText([
    { text: 'Blade of Embers\n', fontScale: 1.5, color: 0xffd23f },  // heading run
    'Deals ',
    { text: '50', fontScale: 1.5 },                                  // inline, same baseline
    ' fire damage.\n',
    { text: 'Forged in dragonflame long ago.', fontScale: 0.65 },    // fine print
]);

// Also legal as an overlay — every "Burn" is red and 1.4x:
const burn = text.addStyle('Burn', { color: 0xff5252, fontScale: 1.4 });
burn.update({ color: 0xff5252, fontScale: 2 });   // reflows (see below)
```

It is a **multiplier** on the object's `fontSize` (must be `> 0`), not an
absolute pixel size, so `setFontSize` and `fitInside` stay coherent.

- A line's box grows to its tallest run, and every glyph sits on one shared
  baseline — mixed sizes align by baseline, not by top.
- Kerning is skipped where the size changes across a run boundary.
- Any spec layer may set it; only `displayCallback`/`editGlyphs` cannot.
- Cost: a rebuild rather than the usual coalesced re-seed, including through
  `handle.update`.
- `letterSpacing`, `lineSpacing` and shadow offsets are constant pixels and do
  not scale with a run.

#### Per-run font — `font`

Mix typefaces in one text object. `font` names a key already loaded with
`this.load.msdfFont(key, ...)`; runs that don't set it use the object's own
font. Structural, exactly like `fontScale`, and legal on the same layers.

```ts
text.setRichText([
    { text: 'DRAGONFLAME\n', font: 'Anton', fontScale: 1.7 },  // display face
    'Deals ',
    { text: '50', font: 'Bangers', color: 0xffd23f },          // accent face
    ' fire damage. Cooldown ',
    { text: 'readySec()', font: 'JetBrainsMono', underline: true },
]);

// Also an overlay — every "fire" in the accent face:
text.addStyle('fire', { font: 'Bangers', color: 0xff8c42 });
```

Everything a run measures with — advance, kerning, ascender, line height,
underline metrics — comes from **its own** font.

- **Mixed faces align by baseline**: a line's ascent and box height each take
  the largest among its runs.
- **No kerning across a font boundary**, and **no glyph fallback**: a character
  absent from its run's font is skipped, never borrowed from another font.
- An unknown key falls back to the object's own font with a one-time warning.
- **Cost: a run whose font uses a different atlas texture ends the draw call.**
  Cheap at text-scale glyph counts; to stay at one draw call, generate a merged
  atlas (see [FONTS.md](FONTS.md#merging-several-fonts-into-one-atlas)) and
  load it with **one** `this.load.msdfFont` call — every font in it shares one
  texture, so runs naming them never flush.
- Effects are per-run too: `rounded`/`softness` on a run whose font is plain
  `msdf` are clamped away silently, even if a neighbouring run supports them.

### Per-glyph display callback

```ts
text.setDisplayCallback((glyphs, text) => {
    const t = text.scene.time.now;
    for (let i = 0; i < glyphs.length; i++) {
        glyphs[i].y += Math.sin(i * 0.5 + t * 0.003) * 15;
    }
});

text.clearDisplayCallback();
```

The callback runs **once per frame** (not once per glyph) with the full array
of per-glyph state and the text object. Each `glyphs[i]` is seeded with the
text's effective position, colour, alpha, outline and shadow before you get it
— mutate it in place. The same array is reused every frame.

Each glyph exposes:

- **transform** — `x`, `y`, `scaleX`, `scaleY`, `rotation` (about the glyph
  centre; scale `0` hides it) and `skew`, a baseline shear (faux italic;
  positive leans the top right, pivoting on the layout baseline so a whole line
  slants as one). `setScale(v)` sets both axes, `setScale(x, y)` independently.
- **`weight`** — per-corner faux bold, in distance-field units.
- **`fill`** — the glyph face: `{ color: Corners, alpha: Corners }`.
- **`shadow`** — `{ color, alpha, x, y, softness, spread, rounded }` (all but
  `x`/`y` per-corner), independent of the fill. Drawn if the text has a shadow,
  or `perGlyphShadow = true`.
- **`outline`** — `{ color, alpha, width, rounded, softness }` (all but `color`
  and `alpha` per-corner). No width *and* no softness means "no outline", so a
  glyph can be outlined — or made to glow — even when the object is not.
- read-only **`index`**, **`charCode`**, and **provenance** — `srcIndex`,
  `line`, `srcLine` (see below).

#### Glyph provenance — `srcIndex` / `line` / `srcLine`

Three read-only fields map each glyph back to the text you set:

- **`srcIndex`** — index into the original `text` string, *before* word
  wrapping: `text[glyph.srcIndex]` is that glyph's character. Robust across
  wrapping, where counting rendered glyphs desyncs (spaces and newlines produce
  no glyph — `srcIndex` is monotonic but non-contiguous).
- **`line`** — visual line index *after* wrapping.
- **`srcLine`** — source paragraph index: how many original `'\n'` precede the
  glyph. Soft (wrap-inserted) breaks don't count, so it identifies "the Nth
  line of my string" regardless of wrapping.

```ts
// Colour the word starting at source index 12, wrap-proof:
text.setDisplayCallback((glyphs) => {
    for (const g of glyphs) {
        if (g.srcIndex >= 12 && g.srcIndex < 17) g.setFillColor(0xffd200);
    }
});

// Alternating colours per wrapped line:
text.setDisplayCallback((glyphs) => {
    for (const g of glyphs) g.setFillColor(g.line % 2 ? 0x88ccff : 0xffffff);
});
```

`Corners` is `{ topLeft, topRight, bottomLeft, bottomRight }`. Colour is plain
`0xRRGGBB` and alpha a separate `0–1` float — no bit-packing. Scalar helpers
cover the "all four corners the same" case:

```ts
g.setScale(1.2, 0.8);                      // squash/stretch about the centre
g.setFillColor(0xff0000);                  // recolour the face, alpha untouched
g.setFillAlpha(0.5);                       // fade the face, colour untouched
g.setShadowColor(0x000033); g.setShadowAlpha(0.4);
g.setOutlineColor(0xffd200); g.setOutlineAlpha(1);
g.setWeight(2);                            // faux bold, distance-field units
g.setOutlineWidth(1.5); g.setOutlineSoftness(3);
g.setShadowSoftness(4); g.setShadowSpread(2); g.setShadowRounded(1);
```

Reach into the `Corners` objects directly for a gradient:

```ts
g.fill.color.topLeft = g.fill.color.topRight = 0xff5da8;
g.fill.color.bottomLeft = g.fill.color.bottomRight = 0x5db8ff;
```

`weight`, every effect channel on both layers (`outline.width`/`.rounded`/
`.softness`, `shadow.softness`/`.spread`/`.rounded`) and both `innerColor`s are
per-corner too — a faux-bold gradient, a directional outline, a soft-on-one-side
shadow, a shadow that spreads to one side all cost nothing extra. Interpolation
is linear across the quad's bounding box, not along the letter contour.

#### Persistent per-glyph state (manual mode)

For per-glyph effects that don't change every frame, use `editGlyphs()`
instead of a callback. It hands you the same array, seeded once, and the text
stops re-seeding it — your edits persist with **zero per-frame cost**:

```ts
const glyphs = text.editGlyphs();
glyphs[0].setFillColor(0xff4040);
glyphs[1].setFillColor(0x40ff40);
```

The array is rebuilt and re-seeded whenever the glyph set changes (`setText`,
`setFont`, word-wrap), which clears your edits and emits `'glyphsreset'` so
you can re-apply them:

```ts
text.on('glyphsreset', () => { /* re-apply per-glyph colours */ });
```

Call `text.resetGlyphs()` to re-seed to the current defaults on demand.

## Loading details

`this.load.msdfFont(key, textureURL?, fontDataURL?, textureXhrSettings?, fontDataXhrSettings?)`

Defaults to `<key>.png` / `<key>.json` if URLs are omitted, following Phaser's
`bitmapFont` convention. Also accepts a config object or array of configs.

```ts
this.load.msdfFont({
    key: 'arial',
    textureURL: 'assets/fonts/Arial.png',
    fontDataURL: 'assets/fonts/Arial.json',
});
```

Fonts land in `this.cache.custom.msdfFont` as parsed `MSDFFont` instances —
`add.msdfText` looks them up by key, or pull the `MSDFFont` directly to
inspect glyph metrics or measure text.

> **Texture filtering:** MSDF relies on linear interpolation of the distance
> field. Phaser's default `LINEAR` filtering is correct; `NEAREST` (e.g. for a
> pixel-art project) aliases badly — use a bitmap font in that case.

## Generating MSDF fonts

See [FONTS.md](FONTS.md) for the `msdf-atlas-gen` workflow. In short:

```bash
msdf-atlas-gen -font MyFont.ttf -type msdf -size 42 -pxrange 4 \
               -format png -imageout MyFont.png -json MyFont.json
```

## Requirements

- Phaser 4.1+ (peer dependency)
- WebGL with the `OES_standard_derivatives` extension (universally available
  on WebGL 1.0; Phaser 4 fetches it during renderer init). The plugin throws a
  clear error during `init()` if it is missing.

## License

MIT. Inspired by the MIT-licensed
[Ceramic Engine](https://github.com/ceramic-engine/ceramic) MSDF
implementation.

## References

- [msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen) — font generator
- [msdfgen](https://github.com/Chlumsky/msdfgen) — original MSDF research
- [Phaser 4](https://github.com/phaserjs/phaser)
