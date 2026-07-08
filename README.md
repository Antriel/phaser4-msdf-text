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
| [Rich Text](https://antriel.github.io/phaser4-msdf-text/#richtext) | Per-run colour, gradient, skew; keyword rules and ranges |
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
```

`softness` is the shadow blur in **distance-field units** (`0` = hard edge,
the default) — the same units as `outlineWidth`, so the blur scales with the
text at any size. Any value above `0` produces a soft shadow and requires an
**MTSDF** atlas; on a plain MSDF font it is ignored with a one-time console
warning. The maximum usable blur is the atlas `distanceRange` — for softer
shadows than that, regenerate with a larger `-pxrange`.

### Rich text — per-run styling

Style specific words or ranges — colour, gradient, alpha, outline/shadow colour,
scale, rotation, skew — **without markup in the string** and without
hand-counting glyphs. Three entry points over one mechanism, distinguished by
**lifetime**:

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

**Policy — `setTextStyle(match, style, opts?)`.** A persistent keyword rule that
**survives text changes** and is re-matched against the new text each time.
Returns a handle. Substring match by default; `wholeWord`, `nth`,
`caseSensitive` and `all` are options.

```ts
const dmg = text.setTextStyle('DMG', { color: 0xff5252 });   // every "DMG" is red
text.setTextStyle('the', { color: 0x88ccff }, { nth: 0, wholeWord: true }); // just the 1st word "the"

text.setText('Take 99 DMG');   // the new "DMG" is red too — the rule re-matched
dmg.update({ color: 0xffa500 }); // recolour (coalesced re-seed, no relayout)
dmg.remove();                    // drop the rule
```

**Override — `addStyleRange(start, length, style)`.** A transient range anchored
to indices in the current text. **Any text change drops all ranges** and kills
their handles (no clamping — a stale handle no-ops with a one-time warning). Use
it for highlights over text you know is stable (search hits, your own parser).

```ts
const hit = text.addStyleRange(6, 4, { color: 0xffe066, scale: 1.06 });
hit.remove();
```

`clearStyles()` removes all rules **and** ranges (segments are content, kept).

A `StyleSpec` (and the `SegmentSpec` used by `setRichText`) accepts:
`color`/`alpha` (a scalar, or a per-corner object for a gradient), `outline`
(`{ color?, alpha? }`), `shadow` (`{ color?, alpha?, x?, y? }`), `scale`/
`scaleX`/`scaleY`, `rotation` and `skew`. Only the keys you set override the
glyph's seeded base. Outline **width**/**rounded** and shadow **softness** stay
object-level (per-batch), so per-run `outline`/`shadow` only tune colour/alpha/
offset — and only render when the object itself has an outline/shadow enabled.

Styles paint in order of increasing dynamism — **segments → rules → ranges →
`displayCallback`** — applied key-by-key, so a later layer that sets only
`outline` keeps an earlier layer's `color`. This is what lets a static keyword
colour and an animated callback compose: the callback sees already-styled
glyphs and layers on top. Handle updates coalesce into one re-seed before the
next render (in manual mode a styles re-seed emits `'glyphsreset'`, once/tick).

| action | segments | rules | ranges |
|---|---|---|---|
| `setText` / `setRichText` | replaced with the text | kept; re-matched | dropped; handles die |
| `handle.update` / `remove` | — | mutates the rule | mutates the range |
| `clearStyles()` | kept | removed | removed |

Per-run **`fontSize`** and **`font`** (which change layout) are a planned Phase 2
and are not part of this appearance-only surface.

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
- **`fill`** — the glyph face: `{ color: Corners, alpha: Corners }`.
- **`shadow`** — `{ color, alpha, x, y }`, controlled independently of the fill
  (only drawn if the text has a drop shadow).
- **`outline`** — `{ color, alpha }` (only drawn if the text has an outline).
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
```

Reach into the `Corners` objects directly for a gradient:

```ts
g.fill.color.topLeft = g.fill.color.topRight = 0xff5da8;
g.fill.color.bottomLeft = g.fill.color.bottomRight = 0x5db8ff;
```

Outline **width** and shadow **softness** stay per-object (set via `setOutline`
/ `setShadow`); outline and shadow **colour, alpha and offset** are per-glyph.

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
