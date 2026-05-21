# Generating MSDF Fonts

`phaser4-msdf-text` loads a `.png` atlas plus a `.json` layout file in
[`msdf-atlas-gen`](https://github.com/Chlumsky/msdf-atlas-gen) format. You can
produce that pair either online with SnowB or from the command line with
`msdf-atlas-gen` itself.

## Easiest: SnowB (online, no install)

[SnowB Bitmap Font](https://snowb.org/) is a free in-browser generator. Pick
your font, choose the **MSDF** distance-field mode, and export using the
**MSDF Atlas JSON** option (not the AngelCode/BMFont export — that schema is
different and won't load). You get a `.png` + `.json` pair with no toolchain to
install.
Note that in my testing `snowb` can have bad exports for some fonts.

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
| `-type` | `msdf` or `mtsdf` | `msdf` for crisp text; `mtsdf` also enables rounded outlines and soft shadows (see below) |
| `-size` | 42 | Base glyph size (px per em); higher = more atlas detail |
| `-pxrange` | 4 | Distance-field range (2–8). Read from the JSON at runtime; outline width scales with it |
| `-outerpxpadding` | 2 | Gutter between glyphs; prevents neighbour-glyph bleed under LINEAR sampling. Raise to 4+ for heavy stretching |
| `-potr` | — | Power-of-two atlas dimensions |
| `-imageout` | — | Atlas PNG output |
| `-json` | — | Layout/metrics JSON output |

Useful extras: `-chars "[32,126]"` limits the character set, `-allglyphs`
includes every glyph in the font, `-nokerning` drops kerning pairs.

## MTSDF: rounded outlines and soft shadows

Generate with `-type mtsdf` to enable `setOutline(..., { rounded: true })` and
`setShadow(..., { softness })`. MTSDF keeps the same 3-channel MSDF in the RGB
channels (text stays exactly as crisp) and adds a *true* signed distance field
in the alpha channel — that extra channel is what rounds outline corners and
softens/blurs shadows.

```bash
msdf-atlas-gen \
  -font MyFont.ttf \
  -type mtsdf \
  -size 42 \
  -pxrange 8 \
  -outerpxpadding 2 \
  -potr \
  -imageout MyFont.png \
  -json MyFont.json
```

The atlas PNG becomes RGBA. The runtime detects the `mtsdf` type from the JSON
and loads the texture **without** premultiplied alpha, so the distance field in
the alpha channel is preserved — no extra setup needed. Effect softness (shadow
blur, outline corner radius) is bounded by `distanceRange`, so pick a larger
`-pxrange` (8–16) than you would for plain MSDF if you want generous soft
shadows. Requesting a rounded outline or soft shadow on a plain `msdf` atlas is
ignored with a one-time console warning.

## Troubleshooting

**Blurry text** — confirm the texture uses LINEAR filtering (Phaser's default;
don't force NEAREST for MSDF fonts).

**Neighbour-glyph pixels bleed onto character edges** — regenerate with
`-outerpxpadding 2` (or higher). The default ~1 px gutter is not enough for
LINEAR sampling to stay inside a glyph's slot.

**Outlines won't get thicker** — shader outlines saturate past roughly
`distanceRange / 2`. Regenerate the atlas with a larger `-pxrange` rather than
pushing the runtime outline width higher.

**Missing kerning data** — some fonts store kerning data in GPOS, which
`msdf-atlas-gen` does not read.
