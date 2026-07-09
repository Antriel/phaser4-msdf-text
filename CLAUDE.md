# Project: Phaser 4 MSDF Font Rendering

## Overview
MSDF (Multi-channel Signed Distance Field) font rendering plugin for the
Phaser 4 game engine. MSDF fonts stay crisp at any scale without pixelation,
from a single texture per font. Published as the npm package
`phaser4-msdf-text`.

## Technology stack
- **Engine**: Phaser 4 (TypeScript), WebGL renderer
- **Rendering**: custom `BatchHandler` render node with inline GLSL shaders
- **Font data**: JSON atlas produced by `msdf-atlas-gen` (`.json` + `.png`)
- **Build**: Vite (library mode) + `tsc` for declarations

## How it works

**MSDF rendering**
- The atlas PNG stores a distance field in its RGB channels. MTSDF atlases
  additionally carry a true (single-channel) SDF in the alpha channel.
- The fragment shader takes the `median()` of the three channels to recover
  the signed distance, then derives coverage from it.
- Anti-aliasing uses the canonical msdfgen `screenPxRange()` method: the
  transition width is the distance range expressed in screen pixels, derived
  from the screen-space derivative of the *texture coordinates*
  (`fwidth(texCoord)`). Texcoords interpolate linearly across the quad, so the
  AA width stays uniform across each glyph and crisp at any zoom — unlike
  `fwidth` of the sampled field, which wobbles near texel boundaries.
- `pxRange` (the atlas `distanceRange`) and the atlas pixel dimensions are read
  from the font JSON at runtime, and reach the shader as a single per-texture
  ratio, `uUnitRange = distanceRange / atlasSize`.

**The `params` attribute** — every per-glyph effect rides one normalized
`UNSIGNED_BYTE` vec4, `inParams`: `.r` weight (faux bold), `.g` flags, `.b`
outline width, `.a` shadow softness. Packing lives in `packParams`
(`src/MSDFColor.ts`); the shader decodes with its exact inverse, and there is no
second source of truth.
- The numeric channels are **fractions of the atlas `distanceRange`**, normalized
  on the CPU with *that glyph's* font. That is what makes them font-independent
  and what makes `distanceRange` cancel out of every shader branch (it survives
  only inside `screenPxRange()`, coupled to the atlas size as `uUnitRange`).
- `.b` spans `[0, distanceRange/2]` and `.r` spans `±distanceRange/2` — the
  distance field clamps at 0, so a full-range encoding would waste half a byte.
  Weight's neutral point is byte `128`, which decodes to `128/255`, **not** `0.5`.
- `.g` is a bitfield (`PARAM_ROUNDED`, `PARAM_SOLID`) and must be written
  identically to all four vertices of a quad: GLSL ES 1.00 has no `flat`
  qualifier, so anything else would interpolate into garbage. The other three
  channels are continuous, so they are **per-corner for free** — a directional
  outline, a faux-bold gradient, a soft-on-one-side shadow.

**Outline** — outline and fill composite in one quad (fill *over* outline; the
outline edge is `fillEdge - width`). Because that is per-glyph, a thick outline
can spill over the previous glyph. Setting `outlineLayered` switches to a
two-pass *submission*: every glyph's outline silhouette (fill alpha zeroed) is
submitted first, then every glyph's fill (outline alpha zeroed) on top, so
neighbouring outlines never cover a glyph's face. Both passes land in the **same
draw call** — within one draw, quads composite in submission order under alpha
blending. Tradeoffs: a second set of glyph quads, and the outline now composites
under the fill, so translucent text shows the outline through the fill. Every
pass shares the `submitOneGlyph` helper in `MSDFTextWebGLRenderer.ts`.

Outline **colour, alpha, width** and shadow **softness** are all per-vertex, so
two texts with different outline widths — or one outlined and one not — batch
together. A width of `0` *is* what "no outline" means; since at zero width the
outline edge coincides with the fill edge, `packOutlineAspect` zeroes the outline
alpha wherever the width is zero rather than branching in the shader.

**MTSDF effects** — atlases generated with `-type mtsdf` carry a true SDF in
the alpha channel alongside the MSDF in RGB. The fill layer always uses
`median(rgb)` for crisp text (corners preserved) — it has to, or a rounded
*outline* would also round its glyph's *fill* — and the outline/shadow layer uses
`mix(median, tsdf, rounded)`:
- Rounded outline (`setOutline(..., rounded)`) — the outline edge comes from the
  alpha SDF, which rounds outer corners; the letterform edge stays sharp.
- Soft shadow / glow (`setShadow(..., softness)`) — a shadow quad is an
  **outline-only quad**: fill alpha 0, shadow colour in the `inOutline`
  attribute, width 0, softness (and `rounded`, when soft) in `params`. Softness
  is measured in **distance-field units** (like `outlineWidth`), so the blur
  scales with the text at any size; it is bounded by the atlas `distanceRange`,
  with a 1-screen-pixel AA floor. A *hard* shadow keeps the `backgroundFade`
  guard, which the old mode-0 shadow path did not have.
- Both are clamped to zero at **pack time** on plain `msdf` atlases (the renderer
  checks `fieldType`); `MSDFText` warns once if they are requested object-level
  on such a font. Per-run styles clamp silently.

**Shaders** — one über-shader, one branch, inline string arrays in
`src/MSDFBatchHandler.ts`:
- Vertex: uniform `uProjectionMatrix`; attributes `inPosition`, `inTexCoord`,
  `inColor` (fill colour), `inOutline` (outline / shadow colour), `inParams`.
  Each vertex is 28 bytes: 4 floats (pos + texcoord) + three `UNSIGNED_BYTE`
  vec4s.
- Fragment: uniforms `uMainSampler` and `uUnitRange` — that is all. Coverage is
  one expression for fill, outline and shadow (`softNorm = 0` reproduces the
  plain AA ramp exactly), then an honest fill-over-outline composite. Its
  degenerate cases are exact: zero outline alpha is a plain fill, zero fill alpha
  is a bare silhouette. The `solid` flag short-circuits coverage to 1 for
  underline/strike rects; those rects carry real `0..1` UVs so `fwidth()` stays
  nonzero and no Inf leaks through the `mix`.
- Output is premultiplied alpha (`vec4(rgb * a, a)`) — required by Phaser 4's
  batched pipeline.
- Uses `#extension GL_OES_standard_derivatives : enable` for `fwidth`.
  Phaser 4 fetches this extension unconditionally in
  `WebGLRenderer.setExtensions`, so no game-config flag is needed.
  `installMSDFPlugin()` verifies it and throws a clear error if absent.

**Flush points** — the renderer's only gate is `configureFont(unitRange)`, a
check-and-flush that must set the new value **after** the flush, since uniforms
are read at draw time (`setupUniforms`). Setting it early would render the
previous font's queued quads with the new font's range. The texture is the batch
handler's own gate, inside `batch()`. Nothing else flushes: a shadowed, outlined,
underlined text is **one draw call**.

**Decorations** — underline / strikethrough are appearance-lane but
glyph-independent. They resolve per *source* character through the normal paint
order (object level → segments → rules → ranges), then merge into `_decorRects`,
splitting at line breaks, `fontScale` boundaries, and — when the colour is
inherited — resolved fill colour/alpha changes. Rects deliberately live outside
`_characters`: the `GlyphState` array, `editGlyphs()` and every per-glyph loop
assume one quad per renderable char and must never see a rect. Consequently
`displayCallback` cannot see or animate them, and per-glyph transforms move
glyphs, not decorations. Rect quads set `PARAM_SOLID` and batch with the glyphs;
underlines submit before the fill loop, strikethroughs after. An inherited
colour is resolved at *submit* time, so tweening the object's colour or alpha
drags the underline along.

**Per-glyph state** — the display callback and `editGlyphs()` both operate on an
array of `GlyphState` (`src/MSDFGlyphState.ts`), one per renderable glyph. Each
carries a transform, a per-corner `weight`, and three independent aspects —
`fill`, `shadow` (+ `x`/`y`/`softness`), `outline` (+ `width`/`rounded`) — with
per-corner `0xRRGGBB` colour and a separate `0-1` alpha (kept split so V8 holds a
stable hidden class and SMI/double field reps across the per-glyph loop; packing
lives in `src/MSDFColor.ts`). `MSDFText._glyphMode` picks the source:
- `static` (0) — no array; the renderer fills every quad from the object-level
  colour/alpha/outline/shadow (the cheap default; nothing per-glyph allocated).
- `callback` (1) — `MSDFText.prepareGlyphStates` re-seeds the array from the
  object each frame, then the renderer hands it to `displayCallback(glyphs, text)`
  before any pass. Transient.
- `manual` (2) — the user owns the array via `editGlyphs()`; it is seeded once
  and persists. A rebuild re-seeds and emits `'glyphsreset'`.
The callback runs **once per frame** with the whole glyph array, not once per
glyph and not once per pass, so the passes read already-resolved state and a
glyph's shadow/outline are independent of its fill.

**Rich-text lanes** — the three style layers (`_segmentRuns` content,
`_styleRules` policy, `_rangeRuns` override; painted in that order, then
`displayCallback`) split into three lanes:
- **Appearance** — colour/alpha/weight/outline/shadow/scale/rotation/skew. Seeds
  `GlyphState`. `_hasAppearance` gates the per-glyph array and `applyStyleRuns`.
  A change sets `_stylesDirty` (one coalesced re-seed before the next render).
- **Decoration** — `underline`/`strikethrough`. Appearance-lane timing
  (`_stylesDirty`), but they never touch `GlyphState`; `_hasDecorations` gates
  `rebuildDecorations`, which runs in *every* glyph mode because it reads
  `_characters`, not the glyph array.
- **Structural** — `fontScale` (a *multiplier* on the object `fontSize`; absolute
  px would go stale under `setFontSize` and break `fitInside`'s monotone binary
  search). It never reaches `GlyphState`; it is painted into `_sizeScales`, a
  `Float32Array` of per-**source**-character multipliers (`null` = uniform, the
  fast path), which feeds wrap, measurement and layout. A change sets `_dirty` —
  a rebuild, not a re-seed.

Only layers resolved *before* the layout pass may carry structural keys, so
`SegmentSpec` and `setTextStyle`'s `RuleStyleSpec` have `fontScale` and
`StyleSpec` (ranges, callback — applied *after* layout) never will.
`MSDFText.refreshStyleState()` recomputes all of `_hasStyles` /
`_hasAppearance` / `_hasDecorations` / `_sizeScales` and is the single place that
decides re-seed vs rebuild.

**Variable line metrics** — with `_sizeScales`, `MSDFFont.measureLines` returns a
`baselines[]` array: a line's box height and ascent both take the largest size on
that line, and `rebuildText` places every glyph on that shared baseline (mixed
sizes align by **baseline**, not by top). Kerning is applied only *within* a
same-size run — `measureSpan`, `wrapLines` and `rebuildText` must all make that
same call or wrapped lines mismeasure. Per-run **`font`** is unimplemented, but it
is now purely a **texture-binding problem**: since the `params` channels are
normalized by `distanceRange` at pack time, `uUnitRange` is per-texture, not
per-glyph. It needs `configureFont` extended to switch textures per run, plus a
font map alongside `_sizeScales` — unlike `fontScale`, which is pure layout math
on one atlas.

**Font data** — `msdf-atlas-gen` JSON, parsed by `src/MSDFFontParser.ts` into a
runtime `MSDFFont`. Contains `atlas` metadata (type, `distanceRange`, size,
dimensions, `yOrigin`), normalized `metrics`, per-glyph plane/atlas bounds, and
kerning pairs.

## Source layout
```
src/
  index.ts                 # Public entry point / exports
  MSDFPlugin.ts            # Global plugin; installMSDFPlugin, cache + extension check
  MSDFFontFile.ts          # Registers the `this.load.msdfFont` loader
  MSDFFontParser.ts        # Parses msdf-atlas-gen JSON
  MSDFFont.ts              # Parsed font: glyph metrics, kerning, measurement
  MSDFText.ts              # Text GameObject (layout, wrap, outline, shadow, decorations, per-glyph state)
  MSDFTextTypes.ts         # Public type surface (StyleSpec / RuleStyleSpec / MSDFTextInstance)
  MSDFTextStyle.ts         # Rich-text style engine (resolve, match, apply) — no instance state
  MSDFTextWrap.ts          # Pure word-wrap + source-index map
  MSDFGlyphState.ts        # Per-glyph state type + factory (callback / editGlyphs)
  MSDFColor.ts             # Vertex-attribute packing (packColor, packParams, flag bits)
  MSDFTextFactory.ts       # add.msdfText factory
  MSDFTextCreator.ts       # make.msdfText creator
  MSDFTextWebGLRenderer.ts # Per-object render function
  MSDFBatchHandler.ts      # Custom BatchHandler render node + GLSL
  BatchMSDFChar.ts         # Packs a character quad into the batch buffer
  phaser-augmentations.ts  # Phaser type augmentations

examples/                  # Vite dev app (`npm run dev`) with feature demos
public/assets/fonts/       # Sample fonts for the dev app only (not shipped to npm)
```

## Documentation
- **CLAUDE.md** — this file: project context and conventions
- **README.md** — installation, API reference, usage
- **FONTS.md** — generating MSDF font atlases

## Gotchas / invariants
- **Premultiplied alpha (shader output)** — all shader output must be
  `vec4(rgb * a, a)`.
- **Atlas upload (no premultiply)** — `MSDFFontFile` uploads the atlas itself
  via `createTexture2D` + `addGLTexture` with `pma = false`. Phaser's default
  image path premultiplies on upload, which would multiply an MTSDF atlas's
  alpha SDF into RGB and corrupt it. `pma = false` is a no-op for plain MSDF
  (alpha is 255 everywhere), so the single path serves both.
- **LINEAR filtering** — MSDF relies on linear interpolation of the distance
  field; NEAREST breaks it. Phaser's default LINEAR is correct.
- **V coordinates** — `MSDFFontParser` flips V based on the atlas `yOrigin`
  (`top` → `1 - y/H`, `bottom` → no flip) and normalizes to `v0 < v1`.
  `MSDFText` then swaps `v0`/`v1` again for the batched quad orientation — see
  the note in `MSDFText.ts` around the glyph build.
- **Generation params** — typical `distanceRange` 4 (range 2–8), generation
  `size` 42. `pxRange` is taken from the JSON automatically; there is no
  separate value to keep in sync.

## References
- msdf-atlas-gen — https://github.com/Chlumsky/msdf-atlas-gen
- msdfgen (original MSDF research) — https://github.com/Chlumsky/msdfgen
- Phaser 4 — https://github.com/phaserjs/phaser
- Shader approach inspired by the MIT-licensed Ceramic Engine —
  https://github.com/ceramic-engine/ceramic
