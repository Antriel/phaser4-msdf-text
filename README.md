# phaser4-msdf-text

[![npm](https://img.shields.io/npm/v/phaser4-msdf-text)](https://www.npmjs.com/package/phaser4-msdf-text)
[![license](https://img.shields.io/npm/l/phaser4-msdf-text)](./LICENSE)

MSDF (Multi-channel Signed Distance Field) font rendering for [Phaser 4](https://phaser.io).

[**Live examples →**](https://antriel.github.io/phaser4-msdf-text/)

- Crisp text at any scale (no pixelation when zooming, single texture per font)
- Batched rendering — 1–2 draw calls per text object, regardless of length
- Shader-based outlines — sharp, or rounded corners on MTSDF atlases (no extra draw calls)
- Drop shadows — hard, or soft/glow on MTSDF atlases (extra pass, batched)
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

Register the global plugin in your Phaser game config. The plugin wires up the
`BatchHandlerMSDF` render node, the font cache, and verifies the required
`OES_standard_derivatives` extension — no separate `renderNodes` entry needed.

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

> If you prefer not to wire it up in the game config, call
> `installMSDFPlugin(game)` from `callbacks.postBoot` — it registers the batch
> handler with the renderer directly.

## Use

Load fonts via the standard Phaser loader, then create text via the
`add.msdfText` factory. Rendering goes through a custom `BatchHandler`
(extending `Phaser.Renderer.WebGL.RenderNodes.BatchHandler`), so a page full
of text typically renders in 1–2 draw calls.

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
| [Outline](https://antriel.github.io/phaser4-msdf-text/#outline) | Sharp and rounded shader outlines |
| [Glow & Drop Shadow](https://antriel.github.io/phaser4-msdf-text/#glow) | Hard shadows, soft shadows, and glow |
| [Animated Effects](https://antriel.github.io/phaser4-msdf-text/#effects) | Per-character display callbacks — wave, rainbow, jiggle |
| [Text Layout](https://antriel.github.io/phaser4-msdf-text/#layout) | Alignment, word wrap, and line spacing |
| [Fit Inside](https://antriel.github.io/phaser4-msdf-text/#fitinside) | Reflowing text to fit a box via `fitInside` |
| [Glyph Provenance](https://antriel.github.io/phaser4-msdf-text/#provenance) | `srcIndex` / `line` / `srcLine` — mapping glyphs back to the source |
| [Rich Text](https://antriel.github.io/phaser4-msdf-text/#richtext) | Per-run colour, gradient, shadow, skew; keyword rules and ranges |
| [Per-Run Font](https://antriel.github.io/phaser4-msdf-text/#perrunfont) | Mixed typefaces in one object; shared baselines, per-font metrics |
| [Performance](https://antriel.github.io/phaser4-msdf-text/#performance) | Draw-call count under a heavy text load |
| [Game UI Showcase](https://antriel.github.io/phaser4-msdf-text/#gameui) | A mock game HUD — score counter, combo meter, damage numbers |
| [RPG Loot Cards](https://antriel.github.io/phaser4-msdf-text/#loot) | Procedural item cards — mixed fonts, rarity-keyed outline & glow, crisp through every tilt |

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

// Or use property accessors directly
text.text = 'New content';
text.fontSize = 64;
text.align = 'center';             // 'left' (default), 'center' or 'right'
text.lineSpacing = 10;

text.width;                        // rendered width in local space (read-only)
text.height;                       // rendered height in local space (read-only)
text.getTextBounds();              // { width, height, lines: { count, lengths, shortest, longest } }
```

`align` is the string union `'left' | 'center' | 'right'` (exported as
`MSDFAlign`); `setLeftAlign()` / `setCenterAlign()` / `setRightAlign()` are
chainable shortcuts.

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

`fitInside` sizes text to a box by **reflowing**, not just scaling — it
binary-searches the largest `fontSize` whose *word-wrapped* layout fits the box
on both axes. A naive scale-to-fit is already covered by `setDisplaySize` /
`displayWidth` / `displayHeight`; the reason to touch `fontSize` is that a
larger font wraps to fewer words per line, changing the shape of the block. That
reflow is the whole point.

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

- **Shrink-only by default.** `maxFontSize` defaults to the current `fontSize`,
  so a label never enlarges past what you set. Pass a larger `maxFontSize` to
  allow growth-to-fill.
- **Placement.** With both `x` and `y` (they must be supplied together) the
  block is positioned inside the box via `hAlign`/`vAlign`, respecting the
  object's origin and any pre-existing scale. With neither, the text is only
  resized. A rect with just one of `x`/`y` is treated as size-only (dev-warn).
- **Permanent side effects.** `fitInside` sets both `fontSize` **and**
  `maxWidth` (to the box width) — the wrap width is what keeps the text fitted.
  It is a **one-shot** call: if the text later changes it re-wraps at that width
  but does not re-fit the size; call `fitInside` again.
- The chosen size is **fractional** by design (MSDF is crisp at any scale);
  `Math.floor` the result yourself if you need an integer.
- `lineSpacing` / `letterSpacing` / shadow offset are constant pixels and do
  **not** scale with the fitted size; outline width, shadow offset and rotation
  are ignored (they fall outside `width`/`height`, as elsewhere in the API).

### Outline (shader-based, no extra draw calls)

```ts
text.setOutline(1.5, 0x000000, 1.0);              // width (distance-field units), color, alpha
text.setOutline(1.5, 0x000000, 1.0, true);        // rounded outer corners (MTSDF atlas only)
text.setOutline(3, 0x000000, 1.0, false, true);   // layered — thick outline, no neighbour overlap
text.clearOutline();
text.hasOutline();                            // boolean

// setOutline is a convenience wrapper — the fields can be set or tweened directly:
text.outlineWidth = 2;                        // distance-field units
text.outlineColor = 0x000000;                 // packed 0xRRGGBB
text.outlineAlpha = 1;
text.outlineRounded = true;                   // MTSDF atlas only
text.outlineLayered = true;                   // separate silhouette pass under the fill

// Two-tone: ramp the outline from outlineColor (outer edge) to a second colour
// where it meets the glyph. Neon tube, chalk outline, bevel.
text.setOutlineInnerColor(0xff5ea8);
text.setOutlineInnerColor(null);              // back to a single-colour outline
```

Practical outline widths are roughly 0.5–3.0. The shader can only represent
outlines up to about `distanceRange / 2` distance-field units — beyond that,
the texture's distance field is saturated and the outline stops growing,
showing flat edges around the glyph's atlas cell instead. If you need thicker
outlines, regenerate the atlas with a larger `-pxrange` in `msdf-atlas-gen`
(and matching glyph padding) rather than pushing the width higher at runtime.

`rounded` rounds the outline's outer corners using the atlas's true
signed distance field. It requires an **MTSDF** atlas (generated with
`-type mtsdf`; see [FONTS.md](FONTS.md)). On a plain MSDF font it is ignored
with a one-time console warning and the outline stays sharp. The letterforms
themselves stay crisp either way — only the outline edge rounds.

`layered` fixes the one drawback of the default single-pass outline: because the
outline is computed per glyph, a thick one can spill over and cover the previous
glyph. With `layered`, every glyph's outline silhouette is drawn first and every
glyph's fill goes on top, so neighbouring outlines never cover a glyph's face.
The cost is a second set of glyph quads (≈2× the outline's fragment work, still
within the same 1–2 draw calls), and because the outline now sits *under* the
fill rather than being composited with it in one pass, partially transparent
text shows the outline faintly through the fill. Leave it off (the default)
unless the outline is actually thick enough to overlap. Works on plain MSDF and
MTSDF alike, and combines with `rounded` and the drop shadow.

`setOutlineInnerColor` gives the outline a second colour at its inner edge; it
ramps from `outlineColor` at the outer edge to that colour across the outline
band, so the effect only shows on outlines wide enough to see a gradient in.
It costs nothing — the inner colour rides the silhouette quad's otherwise-idle
fill-colour attribute — but for exactly that reason it **forces `outlineLayered`**
(a combined fill+outline quad has already spent that attribute on the fill). It
needs no MTSDF atlas. The per-corner `outline.innerColor` on a `GlyphState`, and
`outline.innerColor` in a rich-text run, address it per glyph and per run; a run
that sets `outline.color` alone gets a solid outline in that colour.

### Shadow (extra pass, still batched)

```ts
text.setShadow(4, 4, 0x000000, 0.5);              // x, y, color, alpha
text.setShadow(4, 4, 0x000000, 0.5, 6);           // soft shadow, 6-unit blur (MTSDF atlas only)
text.setShadow(0, 0, 0x33ccff, 0.8, 8);           // zero offset + softness reads as a glow
text.clearShadow();
text.hasShadow();

// setShadow is a convenience wrapper — the fields can be set or tweened directly:
text.shadowX = 4;
text.shadowY = 4;
text.shadowColor = 0x000000;                      // packed 0xRRGGBB
text.shadowAlpha = 0.5;
text.shadowSoftness = 6;                          // distance-field units, MTSDF atlas only

// Two-tone: ramp the blur from shadowColor (outer) to a hot core at the glyph.
text.setShadowInnerColor(0xffffff);
text.setShadowInnerColor(null);                   // back to a single-colour shadow
```

`softness` is the shadow blur in **distance-field units** (`0` = hard edge,
the default) — the same units as `outlineWidth`, so the blur scales with the
text at any size. Any value above `0` produces a soft shadow and requires an
**MTSDF** atlas; on a plain MSDF font it is ignored with a one-time console
warning. The maximum usable blur is the atlas `distanceRange` — for softer
shadows than that, regenerate with a larger `-pxrange`.

`setShadowInnerColor` makes the blur a two-tone gradient: `shadowColor` at its
outer edge, the inner colour where it meets the glyph. A soft, zero-offset shadow
with a white inner colour is the classic glow — a white-hot core inside a
coloured halo. Unlike the outline's, it needs no layering (a shadow quad never
has a fill), but it does need `shadowSoftness` above `0` to have a band to ramp
across. The shadow's ramp is weighted toward the outer colour (the outline's is
linear), because a shadow's alpha fades across the same interval and an even ramp
would leave the outer hue only in the parts that have already faded out. Per-glyph
via `shadow.innerColor` on a `GlyphState`, per-run via `shadow.innerColor` in a
style spec.

Shadow colour, alpha, offset and softness are per-glyph state, so a
`displayCallback` or `editGlyphs` can give individual glyphs their own drop
shadow — soft ones included. The shadow pass is normally skipped when the object
has no shadow, so set **`perGlyphShadow = true`** to run it for those glyphs:

```ts
text.perGlyphShadow = true;
text.setDisplayCallback((glyphs) => {
    for (const g of glyphs) { g.setShadowAlpha(0.6); g.shadow.x = 3; g.shadow.y = 3; }
});
```

Rich-text runs that set a shadow (`setRichText` / `addStyle`) turn the pass on
automatically, so `perGlyphShadow` is only needed for callback- or manual-driven
shadows.

### Faux bold — `weight`

```ts
text.weight = 2.5;          // distance-field units; negative thins the glyph
text.setWeight(2.5);        // chainable wrapper
```

`weight` shifts each glyph's distance threshold, so it fattens (or thins) the
letterform. It is measured in **distance-field units**, like `outlineWidth`, and
saturates at half the atlas `distanceRange`. The outline and shadow edges move
with it, so an outlined glyph stays outlined as it thickens.

It widens glyphs **without changing their advance**, so at a high weight letters
can touch. That is the tradeoff against a real bold face; for body text at large
weights, prefer loading the bold atlas.

Weight is per-glyph and per-corner (`g.weight.topLeft`, …), so a faux-bold
gradient down a glyph is free.

### Underline & strikethrough

```ts
text.setUnderline(true);                             // inherit the fill colour
text.setStrikethrough({ color: 0xff5252, offset: 0.02 });
text.setUnderline(false);                            // off
```

Both accept `true`/`false` or a `DecorationSpec`: `{ color?, alpha?, thickness?,
offset? }`. `thickness` multiplies the font's own `underlineThickness`; `offset`
shifts the rule by an em-relative amount (positive is down). Left alone, colour
and alpha **inherit the resolved fill**, so each coloured word gets a matching
rule; naming a colour paints the whole span one colour instead.

They are also `StyleSpec` keys, so segments and overlays can set them per run —
including `underline: false` to punch a hole in an object-level underline.
The rects use a `solid` flag in the vertex `params`, so they **batch with the
glyphs**: a decorated text is still one draw call.

A few things worth knowing:

- Decorations follow the **layout**, not the glyphs. Per-glyph `scale`,
  `rotation` and `skew` move a glyph; the rule under it stays put.
- `displayCallback` cannot see or animate them — they resolve from the style
  layers only, and never reach `GlyphState`.
- A rule splits at line breaks, at `fontScale` and `font` boundaries (thickness
  and position are size- and font-relative, so each segment uses its own metrics)
  and — when the colour is inherited — at every colour change. Its X extent is the
  union of the span's glyph quads, so interior spaces are bridged but
  leading/trailing ones are not.
- Strikethrough sits at `-0.25 em` above the baseline, because msdf-atlas-gen
  emits no strike metric. Use `offset` where that lands wrong for your face.
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
half-thickness** (`min(width, height) / 2`), not pixels — so `radius: 1` is a
stadium at any font size, and a pill keeps its proportions when you `setFontSize`
or `fitInside`.

`softness` fades **inward** from the pill's box, so the box is the outer bound of
everything the pill draws — a rect's quad ends exactly at its box, and an outward
blur would be clipped in half. Give a glow its room with `padding`.

`padding` is em-relative to the object's `fontSize`. It takes a scalar, or
`{ x?, y?, left?, right?, top?, bottom? }` (a named side wins over its axis). The
unpadded box runs from the tallest ascender to the deepest descender on the line,
so **negative padding** is often what you want — it crops inward, pulling the slab
down towards the x-height.

Like a glyph's outline width, all three are continuous and therefore **per-corner**:

```ts
// A tab: rounded on top, square on the bottom, blurred down the right edge.
text.setHighlight({
  color: 0x7fd4ff,
  radius:   { topLeft: 1, topRight: 1,   bottomLeft: 0, bottomRight: 0 },
  softness: { topLeft: 0, topRight: 0.5, bottomLeft: 0, bottomRight: 0.5 },
});
```

A face `alpha` of `0` frees the colour slot for `innerColor`, the inner end of a
colour ramp across the border — the same two-tone mechanism a glowing shadow uses.
Combine it with `borderWidth: 1` (a ring that fills the pill's whole body) and a
`softness` for a glow blob:

```ts
text.setHighlight({ alpha: 0, borderWidth: 1, softness: 0.75, radius: 1,
                    borderColor: 0x2b0a4a, innerColor: 0x9ad8ff, padding: 0.35 });
```

With no face to inset, `borderWidth` there is purely the ramp's depth: `1` spreads
`borderColor → innerColor` over the pill's full half-thickness, lower values reach
the inner colour sooner.

Things worth knowing:

- Pills draw **behind everything**, the text's own drop shadow included, so a
  shadow falls on its pill. They batch with the glyphs: a highlighted, shadowed,
  outlined, underlined text is still one draw call.
- A highlight **never inherits the fill colour** (a slab of text-coloured paint
  behind the text would hide it), so unlike an underline it does not split at
  colour changes, and a colour tween on the object does not drag it along.
- One pill per **visual line**. Its vertical extent is the union of the run's
  metrics — highest ascender, deepest descender — so a pill wraps a run of mixed
  `fontScale`s and mixed `font`s as one shape rather than shattering at each
  boundary.
- Like the other decorations it follows the layout, not the glyphs, and
  `displayCallback` cannot see it.

### Rich text — per-run styling

Style specific words or ranges — colour, gradient, alpha, outline/shadow colour,
scale, rotation, skew, size, typeface — **without markup in the string** and
without hand-counting glyphs. Two entry points: *content* goes in through
`setRichText`, *overlays* go on through `addStyle`. Both take the same
`StyleSpec`.

**Content — `setRichText(segments)`.** Structured styled input. Segment text is
concatenated into the plain text (so `text` still returns the joined string and
wrapping is unchanged); the styles travel *with the content* and are replaced by
the next `setText`/`setRichText`.

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

**Overlays — `addStyle(target, style)`.** Style whatever `target` selects, on top
of the content. Returns a `StyleHandle` (`update` / `remove`).

```ts
const dmg = text.addStyle('DMG', { color: 0xff5252 });         // every "DMG" is red
text.addStyle(/\d+/, { weight: 2, fontScale: 1.2 });           // every number
text.addStyle({ match: 'the', nth: 0, wholeWord: true }, { color: 0x88ccff });
text.addStyle({ start: 6, length: 4 }, { color: 0xffe066 });   // fixed indices
text.addStyle(tokenize, { color: 0x9ae6b4 });                  // (text) => spans

dmg.update({ color: 0xffa500 });   // replace the style (coalesced re-seed)
dmg.remove();                      // drop the overlay
```

The **anchor decides the lifetime**, and that is the whole rule:

- **Content-anchored** — a string, a `RegExp`, a `{ match, … }` object, or a
  `(text) => { start, length }[]` matcher. The spans are re-derived on every text
  change, so the overlay **survives** `setText` and `setRichText`.
- **Position-anchored** — a `{ start, length }` object. It indexes the text you
  passed it against, so **any** text change drops it and kills its handle (no
  clamping; a stale handle no-ops with a one-time warning). Use it for overlays on
  text you know is stable — search hits, your own parser's output.

A bare string matches every occurrence, case-sensitively; the `{ match, … }` form
adds `all`, `nth`, `wholeWord` and `caseSensitive`. A `RegExp` matches every
occurrence of the pattern (its `g`/`y` flags are ignored; zero-length matches are
skipped; use the `i` flag for case-insensitivity). The **matcher function** is the
extension point — a parser's token spans, "every emoji", "every third word" are
all one-liners, re-run on each text change.

`clearStyles()` removes every overlay (segments are content, kept).

A `StyleSpec` accepts: `color`/`alpha` (a scalar, or a per-corner object for a
gradient), `weight`, `outline` (`{ color?, innerColor?, alpha?, width?, rounded? }`),
`shadow` (`{ color?, innerColor?, alpha?, x?, y?, softness? }`),
`scale`/`scaleX`/`scaleY`, `rotation`, `skew`, `underline`, `strikethrough`,
`highlight`, `fontScale` and `font`.
Only the keys you set override the glyph's seeded base. `weight`,
`outline.width` and `shadow.softness` are continuous, so they also take a
per-corner object.

- A per-run **shadow renders on its own** — setting `shadow` on any run turns
  the shadow pass on, so the object needs no shadow of its own. It does need an
  **`alpha`**: glyphs seed a shadow alpha of `0` unless the object has a shadow to
  inherit one from (that is what keeps unstyled glyphs from drawing a shadow when
  the pass runs for a styled run's sake), and a spec applies only the keys it
  names. So `shadow: { color: 0xff0000, x: 2, y: 2 }` is invisible — add
  `alpha: 0.5`.
- A per-run **outline** likewise stands alone: `outline: { width: 2 }` outlines
  just that run, and `width: 0` removes the outline from a run of an otherwise
  outlined text. Differing widths batch together.
- `rounded` and `softness` need an **MTSDF** atlas; on a plain MSDF font they are
  clamped away silently (per-run styles skip the object-level warning).
- Setting `outline.color` on a run makes that run's outline **solid** in that
  colour — `innerColor` follows `color` unless the run sets it too, exactly as it
  does at the object level. A run's `outline.innerColor` still needs the object's
  `outlineLayered` (or `outlineInnerColor`) to have a silhouette pass to ride.

Styles paint in order of increasing dynamism — **segments → overlays →
`displayCallback`** — with overlays in the order they were added, applied
key-by-key. A later layer that sets only `outline` keeps an earlier layer's
`color`; where two do set the same key, the one added last wins. This is what
lets a static keyword colour and an animated callback compose: the callback sees
already-styled glyphs and layers on top. Handle updates coalesce into one re-seed
before the next render (in manual mode a styles re-seed emits `'glyphsreset'`,
once/tick).

| action | segments | content-anchored overlays | position-anchored overlays |
|---|---|---|---|
| `setText` / `setRichText` | replaced with the text | kept; spans re-derived | dropped; handles die |
| `handle.update` / `remove` | — | mutates the overlay | mutates the overlay |
| `clearStyles()` | kept | removed | removed |

**What a style change costs** depends on the *keys*, not on the layer — every
spec layer may carry every key:

| key lane | keys | cost |
|---|---|---|
| appearance | `color`, `alpha`, `weight`, `outline`, `shadow`, `scale`, `rotation`, `skew` | one coalesced per-glyph re-seed |
| decoration | `underline`, `strikethrough`, `highlight` | one coalesced rect rebuild |
| structural | `fontScale`, `font` | a **relayout** |

The one hard line is between specs and glyphs: **specs are layout inputs, the
glyph array is layout output.** `displayCallback` and `editGlyphs` operate on
already-laid-out glyphs, so they are appearance-only by construction —
`GlyphState` has no structural fields, and nothing you do there can reflow the
text. To animate size, tween `fontScale` through a handle's `update` and pay a
rebuild per change.

#### Per-run size — `fontScale`

The appearance keys above seed per-glyph state and never touch layout.
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

It is a **multiplier** on the object's `fontSize`, not an absolute pixel size, so
`setFontSize` and `fitInside` stay coherent: every run keeps its proportion at
any object size, and `fitInside`'s binary search stays monotone. Must be `> 0`.

- **Line metrics are variable.** A line's box grows to its tallest run, and every
  glyph on the line sits on one shared baseline — mixed sizes align by baseline,
  not by top. A blank line keeps the object's own size.
- **Kerning is skipped where the size changes.** A kern pair straddling a run
  boundary has no well-defined size to scale by.
- **Any spec layer may set it** — a segment or any `addStyle` overlay, whatever
  its anchor. Only `displayCallback`/`editGlyphs` cannot, and that is physical:
  `GlyphState` has no structural fields.
- **Cost.** Setting `fontScale` (including through `handle.update`) triggers a
  rebuild rather than the usual coalesced re-seed, and a structural overlay makes
  `setText` a relayout too. An appearance-only update is unaffected.
- `letterSpacing`, `lineSpacing` and shadow offsets are constant pixels and do
  **not** scale with a run.

#### Per-run font — `font`

Mix typefaces in one text object. `font` names a key already loaded with
`this.load.msdfFont(key, ...)`; runs that don't set it use the object's own font.
Structural, exactly like `fontScale`, and legal on the same layers.

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

Everything a run measures with — advance, kerning, ascender, line height, and the
underline position/thickness — comes from **its own** font.

- **Mixed faces align by baseline.** A line's ascent and box height each take the
  largest among the runs on that line, so the baseline is shared. (With one font
  those maxima always coincide, which is why single-font layout is unchanged.)
- **No kerning across a font boundary**, and **no glyph fallback**: a character
  absent from its run's font is skipped, exactly as a missing character is on a
  single-font text. It is never borrowed from the object's font or another run's.
- **An unknown key** falls back to the object's own font with a one-time warning.
- **Cost: a run whose font uses a different atlas texture ends the draw call.**
  That is cheap at text-scale glyph counts. To keep it at one draw call, generate a
  single merged atlas (`msdf-atlas-gen` with `-and`-separated inputs, one
  `-fontname` per input — see [FONTS.md](FONTS.md#merging-several-fonts-into-one-atlas))
  and load it with **one** `this.load.msdfFont(key, ...)` call: the loader
  registers each input font under its own `-fontname` in the `msdfFont` cache,
  all sharing that one texture, so runs naming them never flush.
- **Effects are per-run too.** `rounded` outlines and soft shadows need an MTSDF
  atlas; on a run whose font is plain `msdf` they are clamped away silently, even
  if a neighbouring run supports them.

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
— mutate it in place. The return value is ignored, and the same array is reused
every frame.

Each glyph exposes:

- **transform** — `x`, `y`, `scaleX`, `scaleY`, `rotation` (about the glyph
  centre; `scaleX`/`scaleY = 0` hides it) and `skew`. `setScale(v)` sets both
  axes; `setScale(x, y)` sets them independently (squash/stretch). `skew` is a
  baseline shear (`dx/dy`) — a faux italic; positive leans the top right, and
  the pivot is the glyph's *layout* baseline so a whole line slants as one.
- **`weight`** — per-corner faux bold, in distance-field units.
- **`fill`** — the glyph face: `{ color: Corners, alpha: Corners }`.
- **`shadow`** — `{ color, alpha, x, y, softness: Corners }`, controlled
  independently of the fill. Drawn if the text has a drop shadow, or you set
  `perGlyphShadow = true` (see the Shadow section).
- **`outline`** — `{ color, alpha, width: Corners, rounded: Corners }`. A `width`
  of `0` is what "no outline" means, so a glyph can be outlined even when the
  object is not. `rounded` runs `0` (sharp) to `1` (fully rounded) per corner.
- read-only **`index`**, **`charCode`**, and **provenance** — `srcIndex`,
  `line`, `srcLine` (see below).

#### Glyph provenance — `srcIndex` / `line` / `srcLine`

Every glyph carries three read-only fields that map it back to the text you set:

- **`srcIndex`** — index into the original `text` string, *before* word
  wrapping. `text[glyph.srcIndex]` is that glyph's character. This is the robust
  way to target a glyph by source position: it stays correct across word wrap,
  where counting rendered glyphs does not (inserted line breaks and skipped
  spaces desync the count). `srcIndex` is monotonic across the array but
  non-contiguous, since spaces and newlines produce no glyph.
- **`line`** — visual line index *after* wrapping. Use it to style by rendered
  line, e.g. alternating colours per wrapped line.
- **`srcLine`** — source paragraph index: how many original `'\n'` precede the
  glyph. Wrap-inserted (soft) breaks don't count, so `srcLine` identifies "the
  Nth line of my string" regardless of wrapping. Two glyphs in the same source
  paragraph share `srcLine` even when a soft break splits them onto different
  visual `line`s.

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
`0xRRGGBB` and alpha is a separate `0–1` float — set them independently, with no
bit-packing. Scalar helpers cover the common "all four corners the same" case:

```ts
g.setScale(1.2, 0.8);                      // squash/stretch about the centre
g.setFillColor(0xff0000);                  // recolour the face, alpha untouched
g.setFillAlpha(0.5);                       // fade the face, colour untouched
g.setShadowColor(0x000033); g.setShadowAlpha(0.4);
g.setOutlineColor(0xffd200); g.setOutlineAlpha(1);
g.setWeight(2);                            // faux bold, distance-field units
g.setOutlineWidth(1.5); g.setShadowSoftness(4);
```

Reach into the `Corners` objects directly for a gradient:

```ts
g.fill.color.topLeft = g.fill.color.topRight = 0xff5da8;
g.fill.color.bottomLeft = g.fill.color.bottomRight = 0x5db8ff;
```

`weight`, `outline.width`, `outline.rounded`, `outline.innerColor`,
`shadow.softness` and `shadow.innerColor` are per-corner too, so a faux-bold
gradient, a directional outline, a soft-on-one-side shadow, an outline melting
from sharp to round, or a glow whose core shifts hue across the glyph all cost
nothing extra. The interpolation is linear across the quad's bounding box, not
along the letter contour — a directional ramp, not a contour-following pulse.

#### Persistent per-glyph state (manual mode)

For per-glyph effects that don't change every frame — a fixed gradient,
highlighted spans, a static rainbow — use `editGlyphs()` instead of a callback.
It hands you the same array, seeded once, and the text stops re-seeding it, so
your edits persist with **zero per-frame cost**:

```ts
const glyphs = text.editGlyphs();
glyphs[0].setFillColor(0xff4040);
glyphs[1].setFillColor(0x40ff40);
```

The array is rebuilt and re-seeded whenever the glyph set changes (`setText`,
`setFont`, word-wrap), which clears your edits and emits a `'glyphsreset'`
event so you can re-apply them:

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
`add.msdfText` looks them up by key automatically, but you can pull the
`MSDFFont` directly if you need to inspect glyph metrics or measure text.

> **Texture filtering:** MSDF rendering relies on linear interpolation across
> the distance field. Phaser's default `LINEAR` filtering works correctly. If
> you opt into `NEAREST` (e.g. for a pixel-art project), MSDF edges will alias
> badly — use a bitmap font in that case.

## Generating MSDF fonts

See [FONTS.md](FONTS.md) for the `msdf-atlas-gen` workflow. In short:

```bash
msdf-atlas-gen -font MyFont.ttf -type msdf -size 42 -pxrange 4 \
               -format png -imageout MyFont.png -json MyFont.json
```

## Requirements

- Phaser 4.1+ (peer dependency)
- WebGL with the `OES_standard_derivatives` extension (universally available
  on WebGL 1.0; Phaser 4 fetches it during renderer init)

The plugin throws a clear error during `init()` if the extension is missing.

## License

MIT. Inspired by the MIT-licensed
[Ceramic Engine](https://github.com/ceramic-engine/ceramic) MSDF
implementation.

## References

- [msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen) — font generator
- [msdfgen](https://github.com/Chlumsky/msdfgen) — original MSDF research
- [Phaser 4](https://github.com/phaserjs/phaser)
