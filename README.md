# phaser4-msdf-font

MSDF (Multi-channel Signed Distance Field) font rendering for [Phaser 4](https://phaser.io).

- Crisp text at any scale (no pixelation when zooming, single texture per font)
- Batched rendering — 1–2 draw calls per text object, regardless of length
- Shader-based outlines — sharp, or rounded corners on MTSDF atlases (no extra draw calls)
- Drop shadows — hard, or soft/glow on MTSDF atlases (extra pass, batched)
- Per-character display callbacks (wave, rainbow, jiggle, rotate, scale, …)
- Word wrapping with configurable wrap character

## Install

```bash
npm install phaser4-msdf-font
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
import { MSDFPlugin } from 'phaser4-msdf-font';

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
    align: 1,  // 0 = left, 1 = center, 2 = right
    // Optional effects — same fields as setOutline / setDropShadow:
    outline: { width: 1.5, color: 0x000000, rounded: true },
    shadow:  { offsetX: 4, offsetY: 4, alpha: 0.5, softness: 6 },
});
```

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
text.align = 1;                    // 0 = left, 1 = center, 2 = right
text.lineSpacing = 10;

text.width;                        // rendered width in local space (read-only)
text.height;                       // rendered height in local space (read-only)
text.getTextBounds();              // { width, height, lines: { count, lengths, shortest, longest } }
```

`align` mirrors Phaser's `BitmapText`: it is a number, and `MSDFText.ALIGN_LEFT`,
`MSDFText.ALIGN_CENTER` and `MSDFText.ALIGN_RIGHT` are exported as `0`/`1`/`2`.

### Word wrap

```ts
text.setMaxWidth(400);             // Wrap to fit 400px (0 disables)
// Or:  text.maxWidth = 400;
text.wordWrapCharCode = 32;        // Default: space. Use 45 for hyphen, etc.
```

### Outline (shader-based, no extra draw calls)

```ts
text.setOutline(1.5, 0x000000, 1.0);          // width (distance-field units), color, alpha
text.setOutline(1.5, 0x000000, 1.0, true);    // rounded outer corners (MTSDF atlas only)
text.clearOutline();
text.hasOutline();                            // boolean

// setOutline is a convenience wrapper — the fields can be set or tweened directly:
text.outlineWidth = 2;                        // distance-field units
text.outlineColor = 0x000000;                 // packed 0xRRGGBB
text.outlineAlpha = 1;
text.outlineRounded = true;                   // MTSDF atlas only
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

### Shadow (extra pass, still batched)

```ts
text.setDropShadow(4, 4, 0x000000, 0.5);          // x, y, color, alpha
text.setDropShadow(4, 4, 0x000000, 0.5, 6);       // soft shadow, 6-unit blur (MTSDF atlas only)
text.setDropShadow(0, 0, 0x33ccff, 0.8, 8);       // zero offset + softness reads as a glow
text.clearDropShadow();
text.hasDropShadow();

// setDropShadow is a convenience wrapper — the fields can be set or tweened directly
// (named to match Phaser's BitmapText):
text.dropShadowX = 4;
text.dropShadowY = 4;
text.dropShadowColor = 0x000000;                  // packed 0xRRGGBB
text.dropShadowAlpha = 0.5;
text.dropShadowSoftness = 6;                      // distance-field units, MTSDF atlas only
```

`softness` is the shadow blur in **distance-field units** (`0` = hard edge,
the default) — the same units as `outlineWidth`, so the blur scales with the
text at any size. Any value above `0` produces a soft shadow and requires an
**MTSDF** atlas; on a plain MSDF font it is ignored with a one-time console
warning. The maximum usable blur is the atlas `distanceRange` — for softer
shadows than that, regenerate with a larger `-pxrange`.

### Per-character display callback

```ts
text.setDisplayCallback((data) => {
    data.y += Math.sin(data.index * 0.5 + time * 0.003) * 15;
    return data;
});

text.clearDisplayCallback();
```

The callback receives mutable position, scale, rotation, and tint for each
character every frame, and must return the (modified) object.

Tinting follows Phaser's `BitmapText` display-callback convention:

- `data.color` — a `0xRRGGBB` shorthand that recolours all four corners. It
  resets to `0` before every call; assign a colour to use it. As in Phaser, a
  literal black `0x000000` reads as "unset" — use `data.tint` for solid black.
- `data.tint` — `{ topLeft, topRight, bottomLeft, bottomRight }` for a
  per-corner gradient. Each corner is handed in as a packed `0xAARRGGBB` value;
  assign plain `0xRRGGBB` colours back. The object's per-corner alpha is
  re-applied by the renderer, so `tint` can't override alpha.

`data` is a single shared object — don't hold a reference to it between calls.
Shadows automatically follow callback transforms.

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
