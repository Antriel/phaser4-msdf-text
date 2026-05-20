# Generating MSDF Fonts

`phaser4-msdf-font` loads a `.png` atlas plus a `.json` layout file in
[`msdf-atlas-gen`](https://github.com/Chlumsky/msdf-atlas-gen) format. You can
produce that pair either online with SnowB or from the command line with
`msdf-atlas-gen` itself.

## Easiest: SnowB (online, no install)

[SnowB Bitmap Font](https://snowb.org/) is a free in-browser generator. Pick
your font, choose the **MSDF** distance-field mode, and export using the
**MSDF Atlas JSON** option (not the AngelCode/BMFont export — that schema is
different and won't load). You get a `.png` + `.json` pair with no toolchain to
install.

## Command line: msdf-atlas-gen

For scripted or batch generation, use
[`msdf-atlas-gen`](https://github.com/Chlumsky/msdf-atlas-gen) — prebuilt
binaries are on its releases page.

```bash
msdf-atlas-gen \
  -font MyFont.ttf \
  -type msdf \
  -size 42 \
  -pxrange 4 \
  -outerpxpadding 2 \
  -potr \
  -yorigin top \
  -imageout MyFont.png \
  -json MyFont.json
```

Then load the pair in a scene:

```ts
this.load.msdfFont('myfont', 'assets/fonts/MyFont.png', 'assets/fonts/MyFont.json');
```

### Parameter reference

| Parameter | Suggested | Purpose |
|---|---|---|
| `-font` | — | Input `.ttf` / `.otf` file |
| `-type msdf` | required | Multi-channel SDF (best quality) |
| `-size` | 42 | Base glyph size (px per em); higher = more atlas detail |
| `-pxrange` | 4 | Distance-field range (2–8). Read from the JSON at runtime; outline width scales with it |
| `-outerpxpadding` | 2 | Gutter between glyphs; prevents neighbour-glyph bleed under LINEAR sampling. Raise to 4+ for heavy stretching |
| `-potr` | — | Power-of-two atlas dimensions |
| `-yorigin top` | — | Y-axis origin. Either `top` or `bottom` works — the loader handles both |
| `-imageout` | — | Atlas PNG output |
| `-json` | — | Layout/metrics JSON output |

Useful extras: `-chars "[32,126]"` limits the character set, `-allglyphs`
includes every glyph in the font, `-nokerning` drops kerning pairs.

## Troubleshooting

**Blurry text** — confirm the texture uses LINEAR filtering (Phaser's default;
don't force NEAREST for MSDF fonts).

**Neighbour-glyph pixels bleed onto character edges** — regenerate with
`-outerpxpadding 2` (or higher). The default ~1 px gutter is not enough for
LINEAR sampling to stay inside a glyph's slot.

**Outlines won't get thicker** — shader outlines saturate past roughly
`distanceRange / 2`. Regenerate the atlas with a larger `-pxrange` rather than
pushing the runtime outline width higher.
