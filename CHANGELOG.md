# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (pre-1.0,
so minor versions may carry breaking changes).

## [0.3.0]

### Added
- **Per-glyph outline and shadow in the display callback.** Outline colour/alpha
  and shadow colour/alpha/offset are now controllable per glyph, independently of
  the fill, so a glyph's shadow no longer inherits the fill's colour. Outline
  colour moved from a shader uniform to a per-vertex attribute (+4 bytes/vertex);
  as a bonus, differently-coloured outlines now batch together without a flush.
- **Manual per-glyph mode — `editGlyphs()` / `resetGlyphs()`.** Take ownership of
  the per-glyph state array for persistent effects (fixed gradients, highlighted
  spans, static rainbows) at **zero per-frame cost** — the text stops re-seeding
  it. A rebuild (`setText`, `setFont`, re-wrap) re-seeds and emits a
  `'glyphsreset'` event so you can re-apply your edits.
- New **"Jump"** (per-glyph shadow) and **"Outline"** (per-glyph outline) effects
  in the examples app.

### Changed
- **BREAKING (display callback):** the callback now runs **once per frame** with
  `(glyphs, text)` — the whole array of per-glyph state — instead of once per
  glyph with a single ARGB-packed object. Return value is ignored; mutate in
  place. Colour is plain `0xRRGGBB` and alpha a separate `0–1` float, on three
  independent aspects (`fill`, `shadow`, `outline`), each with a per-corner
  `color`/`alpha` `Corners` object and `setXColor`/`setXAlpha` helpers. The old
  `data.tint` (ARGB) and `data.color` shape is gone. Migration: loop the array,
  and replace `data.tint.topLeft = (data.tint.topLeft & 0xff000000) | rgb` with
  `g.fill.color.topLeft = rgb` (or `g.setFillColor(rgb)`); per-glyph alpha
  becomes `g.setFillAlpha(a)`.
- **BREAKING (per-glyph scale):** the glyph state's single `scale` is now
  `scaleX` + `scaleY`, so glyphs can squash/stretch. `setScale(v)` sets both;
  `setScale(x, y)` sets them independently. Migration: `g.scale = v` →
  `g.setScale(v)`.
- **BREAKING (per-glyph setters):** the colour helpers are renamed for symmetry
  with the alpha helpers — `setFill`→`setFillColor`, `setShadow`→`setShadowColor`,
  `setOutline`→`setOutlineColor`. The aspect colour field is `color`, not `tint`
  (`g.fill.tint` → `g.fill.color`, likewise on `shadow`/`outline`).
- **BREAKING (drop shadow naming):** the `drop` prefix is gone everywhere.
  `setDropShadow`/`clearDropShadow`/`hasDropShadow` → `setShadow`/`clearShadow`/
  `hasShadow`; `dropShadowX/Y/Color/Alpha/Softness` → `shadowX/Y/Color/Alpha/Softness`.
- **BREAKING (alignment):** `align` is now the string union
  `'left' | 'center' | 'right'` (exported as `MSDFAlign`) instead of `0`/`1`/`2`;
  the `MSDFText.ALIGN_*` constants are removed. The `setLeftAlign` /
  `setCenterAlign` / `setRightAlign` helpers are unchanged.
- **BREAKING (colour model):** dropped the inherited Phaser `Tint` component —
  there is now a single base `color`/`setColor` per object, with no per-corner
  object-level tint multiply. Per-corner gradients live on the glyph state
  (`g.fill.color.*`). `setTint`/`tintTopLeft`/… are no longer on `MSDFText`.
- Removed `CharacterData` from the public API — it was the pre-redesign callback
  type and is now an internal layout detail; use `GlyphState` instead.

### Performance
- The display callback fires **once per frame** (with the whole glyph array)
  instead of once per glyph per pass — it used to re-run for every glyph on
  every render pass (shadow, outline, fill). Colour packing dropped the ARGB
  unpack/divide/repack roundtrip the old path needed.

## [0.2.0]

### Added
- **Per-glyph / per-corner alpha in the display callback.** The `data.tint`
  corners are now authoritative `0xAARRGGBB` (ARGB): the alpha byte, seeded with
  the glyph's effective per-corner alpha, is used as-is, so a callback can fade
  individual glyphs (or corners) and `0x00xxxxxx` renders fully transparent.
  Free at render time — alpha already rode in the per-vertex tint.
- **Layered outline option (`outlineLayered`).** Draws every glyph's outline
  silhouette first, then every glyph's fill on top, so a thick outline can't
  overlap a neighbouring glyph. Costs a second set of glyph quads and composites
  the outline under the fill. Default stays the single combined pass.
- New **"Fade"** effect in the examples app demonstrating per-glyph alpha.

### Changed
- **BREAKING (display callback):** a callback that writes a bare `0xRRGGBB` into
  a `data.tint` corner now renders that glyph transparent, because the alpha byte
  is honoured. Preserve the seeded alpha when recolouring —
  `(data.tint.topLeft & 0xff000000) | rgb` — or use `data.color`, the RGB-only
  shorthand that keeps the object's alpha. This diverges from Phaser's
  BitmapText, which re-stamps the object alpha after the callback and so cannot
  express per-letter alpha.

## [0.1.1]

### Fixed
- Alpha was ignored on plain text (the no-outline, no-shadow branch); object and
  per-corner alpha now apply to plain glyphs.

## [0.1.0]

Initial release.

- MSDF and MTSDF font rendering for Phaser 4 via a custom `BatchHandler` render
  node, crisp at any scale from a single-texture atlas.
- `msdf-atlas-gen` JSON/PNG loader (`this.load.msdfFont`), layout with word wrap,
  kerning, letter spacing, and alignment.
- Outline (combined pass), drop shadow, and — on MTSDF atlases — rounded outline
  corners and soft shadow / glow off the true-SDF alpha channel.
- Per-character display callbacks (position, scale, rotation, tint).
