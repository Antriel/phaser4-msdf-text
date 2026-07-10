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
`UNSIGNED_BYTE` vec4, `inParams`: `.r` weight (faux bold), `.g` rounded, `.b`
outline width, `.a` shadow softness. Packing lives in `packParams`
(`src/MSDFColor.ts`); the shader decodes with its exact inverse, and there is no
second source of truth.
- The distance-field channels are **fractions of the atlas `distanceRange`**,
  normalized on the CPU with *that glyph's* font. That is what makes them
  font-independent and what makes `distanceRange` cancel out of every shader
  branch (it survives only inside `screenPxRange()`, coupled to the atlas size as
  `uUnitRange`).
- `.b` spans `[0, distanceRange/2]` and `.r` spans `±distanceRange/2` — the
  distance field clamps at 0, so a full-range encoding would waste half a byte.
  Weight's neutral point is byte `128`, which decodes to `128/255`, **not** `0.5`.
- **All four channels are continuous**, so all four are **per-corner for free** —
  a directional outline, a faux-bold gradient, a soft-on-one-side shadow, an
  outline melting from sharp to round across a glyph. There is no bitfield: GLSL
  ES 1.00 has no `flat` qualifier, so an interpolated bitfield would be garbage.
- `solid` (rect quads: underline, strike, highlight pill) is instead a
  **sentinel**: weight byte `255`. A rect writes it identically to all four
  corners, so it is uniform across its quad by construction — which is what makes
  it the format's **one legitimate selector**, and why the upper three bytes of a
  solid quad may be *re-decoded* as a pill's radius / border / blur (see
  Decorations). `packParams` clips a real glyph's weight to byte `253` and the
  shader splits at `254` — a byte of guard band each side, ~4× a `mediump`
  varying's ULP. The cost is the top `2/255` of faux bold, where the fill edge has
  already collapsed onto the field's clamp. `packSolidParams` is the rect-side
  packer; `SOLID_PARAMS` is its all-zero (hard-edged box) constant.

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

Outline **colour, alpha, width, rounded** and shadow **softness** are all
per-vertex, so two texts with different outline widths — or one outlined and one
not — batch together. A width of `0` *is* what "no outline" means; since at zero width the
outline edge coincides with the fill edge, `packOutlineAspect` zeroes the outline
alpha wherever the width is zero rather than branching in the shader.

**Two-tone** — a quad with **no fill** (every shadow quad; every layered-outline
silhouette) leaves `inColor` idle, so it carries the inner end of a colour ramp
there. The outline/shadow layer mixes `inOutline.rgb` → `inColor.rgb` over `tone`,
gated on the fill alpha byte being exactly `0` — which is simultaneously the "no
fill" signal and the "this rgb is an inner colour" signal. No new attribute, no
new draw call, per-corner on both colours: a glow with a white-hot core inside a
coloured halo, a neon-tube outline.
- `tone` is depth into the layer's own **visible** body, not `coverage` (which is
  a 1-pixel step on a hard outline and would collapse the ramp). It normalizes by
  `widthNorm` for an outline — the band is exactly `[outlineEdge, fillEdge]` — and
  by **half** of `softNorm` for a shadow, because the blur is centred on the glyph
  edge and only its outer half shows past the fill. The full blur would strand the
  ramp at `tone = 0.5`.
- An outline keeps that ramp **linear** (its alpha is a flat `1` across the band).
  A shadow **squares** it, because its alpha falls off over the same interval, and
  a linear ramp would strand the outer hue where the shadow has already faded out.
  `softStep` — which `fade` computes anyway — blends the two. It may only ever
  *weight a blend between behaviours that agree at both ends*, never *select how
  another channel decodes*: it is a per-corner interpolated value like everything
  else here, and a soft-on-one-side shadow crosses it mid-quad. That rule is why
  the deferred `shadowToneBias` byte was rejected — see `design/future-ideas.md`.
- A two-tone **outline forces `outlineLayered`**: a combined fill+outline quad has
  already spent `inColor` on the fill. Shadows need no such thing. Neither needs
  an MTSDF atlas.
- The gate's one leak — a *combined* quad whose fill alpha is `0` — is plugged at
  pack time, not in the shader: `packFillAspect` writes the **outline's** colour
  into those corners, so the mix is an identity. Same spirit as
  `packOutlineAspect` zeroing alpha at zero width.
- Object level: `outlineInnerColor` / `shadowInnerColor`, sentinel `-1` = "inherit
  the outer colour". `GlyphState` never sees the sentinel — `seedGlyph` resolves
  it, so an untouched glyph packs an identity mix. A style run's `outline.color`
  re-seeds that run's `innerColor` (mirroring the object-level default), or a run
  that merely recoloured an outline would ramp into the *object's* inner colour.

**MTSDF effects** — atlases generated with `-type mtsdf` carry a true SDF in
the alpha channel alongside the MSDF in RGB. The fill layer always uses
`median(rgb)` for crisp text (corners preserved) — it has to, or a rounded
*outline* would also round its glyph's *fill* — and the outline/shadow layer uses
`mix(median, tsdf, rounded)`:
- Rounded outline (`setOutline(..., rounded)`) — the outline edge comes from the
  alpha SDF, which rounds outer corners; the letterform edge stays sharp. The
  object-level flag seeds `0` or `1`, but `GlyphState.outline.rounded` is a
  per-corner `0..1` `Corners`: intermediates `mix()` sharp into round.
- Soft shadow / glow (`setShadow(..., softness)`) — a shadow quad is an
  **outline-only quad**: fill alpha 0 (its colour slot freed for the two-tone
  inner colour), shadow colour in the `inOutline`
  attribute, width 0, softness in `params` — with `rounded` tracking softness
  corner for corner, so a shadow's hard side stays crisp against the fill it
  sits behind (uniform softness reproduces the old per-glyph flag). Softness
  is measured in **distance-field units** (like `outlineWidth`), so the blur
  scales with the text at any size; it is bounded by the atlas `distanceRange`,
  with a 1-screen-pixel AA floor. A *hard* shadow keeps the `backgroundFade`
  guard, which the old mode-0 shadow path did not have.
- Both are clamped to zero at **pack time** on plain `msdf` atlases (the renderer
  checks `fieldType`); `MSDFText` warns once if they are requested object-level
  on such a font. Per-run styles clamp silently.

**Shaders** — one über-shader, two lanes, inline string arrays in
`src/MSDFBatchHandler.ts`:
- Vertex: uniform `uProjectionMatrix`; attributes `inPosition`, `inTexCoord`,
  `inColor` (fill colour — or, at zero alpha, the two-tone inner colour),
  `inOutline` (outline / shadow colour), `inParams`. Each vertex is 28 bytes: 4
  floats (pos + texcoord) + three `UNSIGNED_BYTE` vec4s.
- Fragment: uniforms `uMainSampler` and `uUnitRange` — that is all. `screenTexSize`
  is computed once and serves both lanes: for a glyph it gives the msdfgen AA
  width; for a rect, whose UVs span its own `0..1` box, it *is* the rect's pixel
  size, which is the entire input of the `roundedBox` SDF. It uses the true
  gradient magnitude, `length(vec2(dFdx(u), dFdy(u)))` per axis, **not** `fwidth`
  — whose `|dFdx| + |dFdy|` overestimates by `|cos θ| + |sin θ|` and softens a
  rotated edge to 1.41px. Two `sqrt`; the derivative fetches were paid either way.
- The **glyph lane** derives `fill` / `outline` / `tone` from the distance field;
  the **solid lane** derives the same triple from `-boxDist`. They are the two
  sides of an `if` on the `solid` sentinel — **dynamically uniform per primitive**,
  so no triangle diverges and it stays one program in one batch. Both feed one
  honest fill-over-outline composite, where the outline's colour is itself the
  two-tone `mix`. A glyph's outline layer *is* a pill's border ring; a glyph's
  fill *is* the pill's face, inset by that ring. Degenerate cases are exact: zero
  outline alpha is a plain fill, zero fill alpha is a bare silhouette, and a rect
  with all three payload bytes zero is a hard-edged box.
- The texture fetch and every derivative sit **above** the branch, where control
  flow is unconditionally uniform — implicit-LOD sampling and `dFdx` require it.
  `screenTexSize` is therefore shared; `px` is glyph-lane only.
- Branching (rather than evaluating both lanes and `mix()`ing, as it did before)
  is what keeps a glyph from running `roundedBox` on atlas-scaled coordinates,
  whose `length()` squares them — past `~65504` that overflows a **mediump**
  fragment at deep zoom. The old code relied on the garbage being mixed out.
- `fade` (the deep-background haze guard) is forced to `1` on a solid quad, whose
  `outlineDist` is a stray atlas texel with nothing to say.
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
underlined, highlighted text is **one draw call**. With per-run fonts the gate runs per glyph,
so a text mixing N atlas textures costs N draws per pass — the only reason to
merge atlases.

**Decorations** — highlight / underline / strikethrough are appearance-lane but
glyph-independent. They resolve per *source* character through the normal paint
order (object level → segments → rules → ranges), then merge into `_decorRects`.
Rects deliberately live outside `_characters`: the `GlyphState` array,
`editGlyphs()` and every per-glyph loop assume one quad per renderable char and
must never see a rect. Consequently `displayCallback` cannot see or animate them,
and per-glyph transforms move glyphs, not decorations. Every rect is a `solid`
quad and batches with the glyphs; each carries a `pass` (`PASS_HIGHLIGHT` /
`PASS_UNDERLINE` / `PASS_STRIKE`, exported by the renderer) placing it in the
back-to-front submission order — pills behind everything, the text's own drop
shadow included; underlines before the fill loop; strikethroughs after.

- **Underline / strikethrough** (`buildDecorRects`) split at line breaks,
  `fontScale` and `font` boundaries, and — when the colour is inherited — resolved
  fill colour/alpha changes. An inherited colour is resolved at *submit* time, so
  tweening the object's colour or alpha drags the underline along. Their params
  are the constant `SOLID_PARAMS`.
- **Highlight pills** (`buildHighlightRects`) never inherit the fill colour — a
  slab of text-coloured paint behind the text would hide it — so there is no
  colour-change split and no submit-time resolution. Their vertical extent is a
  **union**: the highest ascender and deepest descender over the run, so one pill
  wraps mixed sizes and mixed fonts as one shape. Only a line break or a different
  resolved spec starts a new rect. `radius` / `borderWidth` / `softness` are packed
  per corner by `packSolidParams` into the three bytes a solid quad leaves idle,
  each a fraction of the pill's **half-thickness** (`min(w,h)/2` — the only length
  a quad knows about itself), so `radius: 1` is a stadium at any size and the pill
  scales with the camera. The border ring rides `inOutline`, its alpha zeroed at
  zero width exactly as `packOutlineAspect` does for a glyph outline. A face
  `alpha` of `0` frees `inColor` for the two-tone ramp's inner end, so `alpha: 0,
  borderWidth: 1` (a ring that fills its own body) plus a `softness` is a glow blob.
  `softness` fades **inward** — a rect's quad ends exactly at its box, so an
  outward blur would be clipped in half; the box is the outer bound of everything
  the pill draws, and `padding` (em-relative, and legally negative) is how a caller
  gives a glow room.

Because the solid lane's coverage is now the box SDF's, **underlines are
antialiased**: at a rect's boundary coverage is `0.5`, not the flat `1.0` it was
before pills.

**Per-glyph state** — the display callback and `editGlyphs()` both operate on an
array of `GlyphState` (`src/MSDFGlyphState.ts`), one per renderable glyph. Each
carries a transform, a per-corner `weight`, and three independent aspects —
`fill`, `shadow` (+ `x`/`y`/`softness`), `outline` (+ `width`/`rounded`) — with
per-corner `0xRRGGBB` colour and a separate `0-1` alpha (kept split so V8 holds a
stable hidden class and SMI/double field reps across the per-glyph loop; packing
lives in `src/MSDFColor.ts`). `shadow` and `outline` also carry a per-corner
`innerColor` for the two-tone ramp. `MSDFText._glyphMode` picks the source:
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
- **Decoration** — `underline`/`strikethrough`/`highlight`. Appearance-lane timing
  (`_stylesDirty`), but they never touch `GlyphState`; `_hasDecorations` gates
  `rebuildDecorations`, which runs in *every* glyph mode because it reads
  `_characters`, not the glyph array.
- **Structural** — `fontScale` (a *multiplier* on the object `fontSize`; absolute
  px would go stale under `setFontSize` and break `fitInside`'s monotone binary
  search) and `font` (an `msdfFont` cache key; an unknown key warns once and falls
  back to the base font). Neither reaches `GlyphState`. They are painted into two
  parallel source-indexed maps — `_sizeScales` (`Float32Array` of multipliers) and
  `_fontMap` (`Uint8Array` of `_runFonts` indices) — both `null` on the uniform
  fast path, both feeding wrap, measurement and layout. A change sets `_dirty` —
  a rebuild, not a re-seed.

Only layers resolved *before* the layout pass may carry structural keys, so
`SegmentSpec` and `setTextStyle`'s `RuleStyleSpec` have `fontScale` / `font` and
`StyleSpec` (ranges, callback — applied *after* layout) never will;
`resolveRangeStyle` strips them for JS callers. `MSDFText.refreshStyleState()`
recomputes all of `_hasStyles` / `_hasAppearance` / `_hasDecorations` /
`_sizeScales` / `_fontMap` / `_maxLineUnit` and is the single place that decides
re-seed vs rebuild. It rebuilds `_runFonts` unconditionally, because `setFont`
swaps slot 0 out from under an otherwise unchanged map.

**Variable line metrics** — measurement is **not** a method on one font. It lives
in `src/MSDFMeasure.ts` as free functions over a `LayoutRuns` — `{ base, scales,
fonts, fontList }`, where `scales`/`fonts` are index-keyed maps and both are
`null` on the uniform fast path. `measureLines` returns a `baselines[]` array: a
line's ascent and box height each take the **largest of that metric** over the
characters on the line (taken independently, since with mixed fonts the tallest
ascender and tallest line box need not be the same run; with one font they always
are, so single-font layout is bit-identical to before). `rebuildText` places every
glyph on that shared baseline — mixed sizes *and* mixed fonts align by
**baseline**, not by top.

`measureSpan`, `wrapLines` and `rebuildText` must make **identical** advance and
kerning calls or wrapped lines mismeasure. The two shared rules: a character
missing from *its run's* font is skipped (no advance, and **no cross-font
fallback**, ever); kerning applies only between two characters in the same font at
the same size. `MSDFFont` keeps thin single-font wrappers (`measureText`,
`measureLines`) for direct callers.

**Per-run font** is a **texture-binding problem and nothing else** — because the
`params` channels are normalized by `distanceRange` at pack time, `uUnitRange` is
per-texture, never per-glyph. `_fontMap` (a source-indexed `Uint8Array`, `null`
when uniform) indexes `_runFonts`, whose slot **0 is always the object's own
font**; `_runFrames` holds the parallel texture frames (slot 0 `null` — the base
font's frame is the object's own). Each `_characters[i]` carries a `fontIdx`, and
the renderer resolves one `FontBinding` per font (texture, `uUnitRange`,
`1/distanceRange`, `isMtsdf`) then calls `configureFont` per glyph — but only when
there is more than one font, so the single-font path configures once outside the
loops. A run on a different texture ends the draw call; a merged (`-and`) atlas
avoids that with no renderer change. `fieldType` is per-font, so the MTSDF clamp
is per-binding.

**Merged atlases** — `msdf-atlas-gen -font a -and -font b ...` (each input given
a `-fontname`) packs several fonts into one texture and emits a `variants` array
in the JSON instead of top-level `metrics`/`glyphs`. `MSDFFontParser.parseMSDFFontSet`
yields one `MSDFFontData` per variant (a plain single-font JSON still yields
exactly one, so the loader calls it unconditionally); `MSDFFontFile.addToCache`
registers each under its own `-fontname` in the `msdfFont` cache, all
constructed with the **same** `textureKey`. Nothing downstream (renderer,
`_runFonts`, `configureFont`) knows or cares that several cache entries share a
texture — that sharing *is* what keeps the flush gate from firing, per the
paragraph above.

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
  MSDFFont.ts              # Parsed font: glyph metrics, kerning, single-font measurement
  MSDFMeasure.ts           # Run-aware measurement (LayoutRuns, measureSpan, measureLines)
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
