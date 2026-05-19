# phaser4-msdf-font

MSDF (Multi-channel Signed Distance Field) font rendering for [Phaser 4](https://phaser.io).

- Crisp text at any scale (no pixelation when zooming, single texture per font)
- Batched rendering — 1–2 draw calls per text object, regardless of length
- Shader-based outlines (no extra draw calls)
- Drop shadows (extra pass, batched)
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
import Phaser from 'phaser';
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
        const font = this.cache.custom.msdfFont.get('arial');

        const text = this.add.msdfText(400, 300, font, 'Hello, MSDF!', 48);
        text.setColor('#ffffff');
        text.setAlign('center');
        text.setOrigin(0.5);
    }
}
```

Or via the creator API:

```ts
const text = this.make.msdfText({
    x: 400, y: 300,
    font,
    text: 'Hello, MSDF!',
    fontSize: 48,
    color: 0xffffff,
    align: 'center',
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
text.setAlign('center');           // 'left' | 'center' | 'right'
text.setLineSpacing(10);

// Or use property accessors directly
text.text = 'New content';
text.fontSize = 64;
text.align = 'center';
text.lineSpacing = 10;

text.getTextWidth();
text.getTextHeight();
text.getTextBounds();              // { width, height, lines: { count, lengths, shortest, longest } }
```

### Word wrap

```ts
text.setMaxWidth(400);             // Wrap to fit 400px (0 disables)
// Or:  text.maxWidth = 400;
text.wordWrapCharCode = 32;        // Default: space. Use 45 for hyphen, etc.
```

### Outline (shader-based, no extra draw calls)

```ts
text.setOutline(1.5, 0x000000, 1.0);  // width (distance-field units), color, alpha
text.clearOutline();
text.hasOutline();                    // boolean
```

Practical outline widths are roughly 0.5–3.0 — values much larger than your
font's `distanceRange` produce artifacts.

### Shadow (extra pass, still batched)

```ts
text.setShadow(4, 4, 0x000000, 0.5);  // offsetX, offsetY, color, alpha
text.clearShadow();
text.hasShadow();
```

### Per-character display callback

```ts
text.setDisplayCallback((data) => {
    data.y += Math.sin(data.index * 0.5 + time * 0.003) * 15;
    return data;
});

text.clearDisplayCallback();
```

The callback receives mutable position, scale, rotation, and per-corner tint
for each character every frame. Reuses a single shared object — don't hold a
reference to `data` between calls.

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

Fonts land in `this.cache.custom.msdfFont` as parsed `MSDFFont` instances.

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

MIT (project planned). Inspired by the MIT-licensed
[Ceramic Engine](https://github.com/ceramic-engine/ceramic) MSDF
implementation.

## References

- [msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen) — font generator
- [msdfgen](https://github.com/Chlumsky/msdfgen) — original MSDF research
- [Phaser 4](https://github.com/phaserjs/phaser)
