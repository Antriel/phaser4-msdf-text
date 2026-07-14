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
width, `.a` softness. Packing lives in `packParams` (`src/MSDFColor.ts`); the
shader decodes with its exact inverse, and there is no second source of truth.
- The upper two channels describe the **outline/shadow layer**, not one named
  effect, which is why each serves two. `.b` is *how far outside the fill edge
  that layer's edge sits* (`outlineEdge = fillEdge - widthNorm`) — an outline's
  **width** on a fill quad; a shadow's **spread** (silhouette dilation) on a
  shadow quad, whose fill is off and whose blur is centred on that same edge.
  `.a` blurs that layer wherever it is set, so a *fill* quad carrying one is an
  outline that **glows**, in one quad, with no shadow pass. Neither is a
  re-decode — same expression, different quad — so neither needs a selector, and
  the soft-on-one-side failure that killed `shadowToneBias` never arises.
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
  **sentinel**: weight byte `255`, or `254` for a *dashed* rect. A rect writes it
  identically to all four corners, so it is uniform across its quad by
  construction — which is what makes it the format's **one legitimate selector**,
  and why the upper three bytes of a solid quad may be *re-decoded* as a pill's
  radius / border / blur, or a dash's radius / **duty** / blur (see Decorations).
  It is a sentinel *value*, not a bit, which is the whole reason it can name two
  variants. `packParams` clips a real glyph's weight to byte `252` and the shader
  takes the solid lane at `253` — a byte of guard band, ~4× a `mediump` varying's
  ULP; the two sentinels sit half a byte either side of their own `254.5` split,
  which needs no guard because neither is interpolated. The cost is the top `3/255`
  of faux bold, where the fill edge has already collapsed onto the field's clamp.
  `packSolidParams` / `packDashParams` are the rect-side packers; `SOLID_PARAMS` is
  the all-zero (hard-edged box) constant.

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

Outline **colour, alpha, width, rounded, softness** and shadow **softness,
spread, rounded** are all per-vertex, so two texts with different outline widths —
or one outlined and one not — batch together. "No outline" means the layer has no
**body**: neither a width nor a softness. At zero width the outline edge coincides
with the fill edge, so `packOutlineAspect` zeroes the outline alpha there rather
than branching in the shader — but it now spares a corner with a softness, because
a blurred zero-width outline *is* a visible body (a glow on the letterform).

**Two-tone** — a quad with **no fill** (every shadow quad; every layered-outline
silhouette) leaves `inColor` idle, so it carries the inner end of a colour ramp
there. The outline/shadow layer mixes `inOutline.rgb` → `inColor.rgb` over `tone`,
gated on the fill alpha byte being exactly `0` — which is simultaneously the "no
fill" signal and the "this rgb is an inner colour" signal. No new attribute, no
new draw call, per-corner on both colours: a glow with a white-hot core inside a
coloured halo, a neon-tube outline.
- `tone` is depth into the layer's own **visible** body, not `coverage` (which is
  a 1-pixel step on a hard outline and would collapse the ramp). That body runs
  from the outermost blur to the fill edge, so its length is exactly
  `widthNorm + halfSoft` — the blur is centred on `outlineEdge`, and `outlineEdge`
  is `widthNorm` below `fillEdge`. Each effect is a corner of that one expression:
  an outline sets only `widthNorm` (the band is `[outlineEdge, fillEdge]`); a soft
  shadow sets only `halfSoft` (**half** the blur, because it is centred on the
  glyph edge and only its outer half shows past the fill — the full blur would
  strand the ramp at `tone = 0.5`); a *spread* shadow sets both.
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
  alpha SDF, which rounds outer corners; the letterform edge stays sharp. It is an
  **amount, not a flag**, at every level: `0..1` object-level (`toRoundedAmount`
  in `MSDFTextStyle.ts` is the one coercion, in the setter, so nothing downstream
  ever sees a boolean), `0..1`-or-`PerCorner` in a `StyleSpec`, and a per-corner
  `Corners` on `GlyphState.outline.rounded`. Intermediates `mix()` sharp into
  round. `true`/`false` are still accepted everywhere and land on the two ends —
  they were the whole API before the byte turned out to have been continuous all
  along.
- Soft shadow / glow (`setShadow(..., softness)`) — a shadow quad is an
  **outline-only quad**: fill alpha 0 (its colour slot freed for the two-tone
  inner colour), shadow colour in the `inOutline` attribute, softness in
  `params`. Softness is measured in **distance-field units** (like
  `outlineWidth`), so the blur scales with the text at any size; it is bounded by
  the atlas `distanceRange`, with a 1-screen-pixel AA floor. A *hard* shadow keeps
  the `backgroundFade` guard, which the old mode-0 shadow path did not have.
- Soft **outline** (`outlineSoftness`) — the same `.a` byte on a *fill* quad.
  `outlineCoverage` never cared which pass it was in, so setting it blurs the
  outline edge; the blur's inner half hides under the opaque fill, so only the
  outside softens. At zero width the outline *is* the glow, hugging the
  letterform, in one quad with no shadow pass. This is why `packOutlineAspect`'s
  zero-width gate had to learn about softness.
- Rounded **shadow** (`shadowRounded`, per-corner `GlyphShadow.rounded`) — the
  same `0..1` amount, independent, no longer derived from softness. It defaults to
  `1`, unlike `outlineRounded`, and that is not an inconsistency: rounding is a
  *no-op* until the shadow's edge leaves the glyph contour (which needs a spread or
  a softness), and where it does bite, a sharp dilation of `median(rgb)` grows a
  mitre spike at every corner. So `1` reproduces the old derived rule exactly and is
  what a spread wants; `0` is opt-in spikes, and the range between files them down
  by degrees.
- All three (both `rounded`s, both `softness`es) are clamped to zero at **pack
  time** on plain `msdf` atlases (the renderer checks `fieldType`); `MSDFText`
  warns once if a softness or a rounded *outline* is requested object-level on such
  a font. Per-run styles clamp silently. `shadowRounded` never warns — it is a
  default, not a request. **`shadow.spread` is not clamped**: it dilates
  `median(rgb)` exactly as a thick outline does, so it needs no true SDF.

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
  with all three payload bytes zero is a hard-edged box. The solid lane nests one
  further branch — the dash fold — uniform per quad for the same reason, and it
  only rewrites the box's `x` coordinate and half-extent before the shared math.
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
order (object level → segments → overlays), then merge into `_decorRects`.
Rects deliberately live outside `_characters`: the `GlyphState` array,
`editGlyphs()` and every per-glyph loop assume one quad per renderable char and
must never see a rect. Consequently `displayCallback` cannot see or animate them,
and per-glyph transforms move glyphs, not decorations. Every rect is a `solid`
quad and batches with the glyphs; each carries a `pass` (`PASS_HIGHLIGHT` /
`PASS_UNDERLINE` / `PASS_STRIKE`, exported by the renderer) placing it in the
back-to-front submission order — pills behind everything, the text's own drop
shadow included; underlines before the fill loop; strikethroughs after.

- **The decoration callback** (`setDecorationCallback`, `DecorationState` in
  `src/MSDFDecorState.ts`) is the lane that *can* animate them. `_decorRects` is to
  `_characters` as `_decorStates` is to `_glyphStates`: a pristine built array, and
  a per-frame mutable copy seeded from it (`seedRect` ≈ `seedGlyph` — it resolves
  the "absent means inherit" colour exactly as `seedGlyph` resolves the `-1`
  `innerColor` sentinel, so a callback never sees a sentinel). It runs **after**
  `displayCallback`, so `parent.glyphs` is final and a rect's `glyphStart`/
  `glyphEnd` — free, since `buildDecorRects` already brackets exactly those
  indices — index straight into it.
- **A second callback, not a third argument to `displayCallback`.** Decorations
  live in *every* glyph mode (`rebuildDecorations` reads `_characters`, not the
  glyph array), so folding the two together would force a full per-frame re-seed of
  every glyph state on a text that only wanted to animate three rects.
- **Two modes, not three: there is no manual mode for rects.** A glyph has an
  identity (`srcIndex`) that survives a re-wrap, which is what makes `editGlyphs`
  meaningful. A rect is a *merge artifact* — "consecutive chars, same line, same
  resolved spec, same font, same inherited colour" — so a wrap-width change turns
  one rect into two and there is nothing stable for a user to re-apply edits to. The
  cost argument for manual mode evaporates anyway: a text has a handful of rects, so
  seeding all of them costs less than seeding one glyph.
- **`dashCount` is the state's one selector**, and legally so: it is per-*quad*, so
  it may re-decode the middle channel (border width → dash duty) for the same reason
  the `solid` sentinel may. Setting it on a solid rule dashes it at runtime, which is
  why `dashDuty` is seeded to `0.5` even on rules that have no dash spec.
- **A rect is one quad, so a callback reaches any parallelogram and no curve.** A
  rule follows a line sheared or rotated *as a line* exactly (a linear map of its
  baseline is a parallelogram) but cannot bend along a per-glyph wave. Translate,
  scale and rotate are exact under the box SDF; a **non-parallelogram** deform makes
  `screenTexSize` vary across the quad, so `radius`/`borderWidth`/`softness` — being
  fractions of the *local* half-thickness — drift along the taper. Recorded, not
  fixed: a tapering pill whose radius follows its thickness is what you'd have asked
  for. The escape hatch for a genuine wave is a build-side "one rect per character"
  spec key, not more callback power; it is not built.

- **Underline / strikethrough** (`buildDecorRects`) split at line breaks,
  `fontScale` and `font` boundaries, and — when the colour is inherited — resolved
  fill colour/alpha changes. An inherited colour is resolved at *submit* time, so
  tweening the object's colour or alpha drags the underline along. A solid rule's
  params are the constant `SOLID_PARAMS`.
- **Dashed / dotted rules** (`DecorationSpec.dash`) are the second solid sentinel
  (`254`, `packDashParams`). The dash **count takes no byte**: a dashed rect spans
  one unit of U *per dash* instead of `0..1`, so `screenTexSize.x` — the derivative
  the pill already reads as its width — comes out as one period in pixels, and the
  shader folds U into a single cell with `fract`. That is what frees `.b` to be a
  **duty cycle** (the shader zeroes the border on this variant, or a duty byte would
  inset the dash's face by a phantom ring), while `.g`/`.a` keep their pill meanings
  — so a `radius` of `1` with a dash as long as the rule is thick *is* a dot, and
  `softness` blurs it. The fold is seamless because `roundedBox` is **even in x
  about the cell centre**: `fract` 0 and `fract` 1 are the same distance, so a dash
  cut by the rect's own edge grows no sliver where U wraps. `buildDecorRects` rounds
  the count so each rect fits whole dashes (a rule always begins and ends the same
  way; a rule shorter than 1.5 periods is one centred dash) — at the cost of grids
  that don't line up across a *split* rule, which is accepted, not fixed.
  Consequence worth stating: the vertex shader is **`highp`**, not `mediump`, since
  a long rule's U runs to tens of units.
- **`dashPhase`** (object level, default `0`) is the marching-ants knob and the one
  decoration input resolved at *submit* rather than rebuild: it negates and slides
  the rects' U origin (`u0 = -phase`, `u1 = count - phase`), so tweening it costs no
  rebuild, no re-seed and no relayout. It counts whole periods, so it is seamlessly
  periodic — the renderer wraps it into `[0, 1)`, which is exact.
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
  zero width exactly as `packOutlineAspect` does for a glyph outline. A
  `faceAlpha` of `0` frees `inColor` for the two-tone ramp's inner end, so
  `faceAlpha: 0, borderWidth: 1` (a ring that fills its own body) plus a `softness`
  is a glow blob. `softness` fades **inward** — a rect's quad ends exactly at its
  box, so an outward blur would be clipped in half; the box is the outer bound of
  everything the pill draws, and `padding` (em-relative, and legally negative) is
  how a caller gives a glow room.
- **A pill has three alphas, because it is two layers.** `faceAlpha` and
  `borderAlpha` are the layers' own; **`alpha` is the shape's**, and is a *pack-time
  modulation* multiplied into both (`packRectCorner`, `packBorderRing`) — the same
  lane, for the same reasons, as the object's `objAlpha`, which sits above it. It is
  what fades a pill *as a pill*, which neither layer's own alpha can do, and it costs
  no vertex byte, no rebuild and no re-seed.
  - The face keeps a separate alpha **because a zero there is a sentinel**, not a
    fade: it is what hands `inColor` to the two-tone ramp. Splitting the two means
    the group alpha can never break a pill — `0 × faceAlpha` is still the zero byte
    the gate reads, so dimming a glow blob dims it *as a blob* instead of collapsing
    it into a plain fill.
  - A rule has one layer, so its `alpha` already *is* its whole alpha and it takes
    no `faceAlpha` key; its rect packs the identity. That is what makes `alpha` mean
    "how visible this rect is" on every rect kind — the pill's extra key is the
    exception that pays for itself, and `DecorationState` mirrors all three.

Because the solid lane's coverage is now the box SDF's, **underlines are
antialiased**: at a rect's boundary coverage is `0.5`, not the flat `1.0` it was
before pills.

**Quad deform** — `GlyphState.offsetX` / `offsetY` are per-corner displacements
of the glyph's quad, in **em**, applied in the quad's local frame (so the glyph's
scale/rotation compose on top). They are the general primitive under the
transform lane, and the reasoning is worth keeping:
- Any affine map of a rectangle is a **parallelogram**, so `scale` + `rotation` +
  `skew` can only move the four corners subject to opposite edges staying
  parallel. Writing the corners drops that constraint — trapezia, jelly, melt.
- The current transform set is *not even complete for affine*: its linear part is
  `Shear · Rotate · Scale`, and `Rotate · Scale` is exactly the column-orthogonal
  matrices, so a target `M` is reachable only if some `k` makes `Shear(-k)·M`
  column-orthogonal. For a pure **vertical shear** `[[1,0],[1,1]]` that condition
  is `k² + k + 1 = 0` — no real root. The deform reaches it; the transform lane
  cannot. This is why no `skewY` knob was added: the primitive subsumes it.
- It likewise subsumes `skew` at **every** pivot (a shear moves corner *i* by
  `-k·(yᵢ - pivot)`, a constant per corner), so `skew`/`skewPivot` survive purely
  as sugar, not as capability.
- **Cost: the affine UV crease.** A quad is two triangles with an affine UV map
  each, so a non-parallelogram kinks the letterform along the shared diagonal
  (the PS1 warp). Accepted, not overlooked: correcting it needs a homogeneous `q`
  per vertex (28 → 32 byte vertex, a divide in the fragment shader), and it is
  invisible under motion or mild taper. Verified in the `Keystone` / `Jelly`
  demos — the crease shows on a hard static taper and hides under animation.
- Em-relative, not box-relative, so one value moves a narrow `i` and a wide `W`
  by the same pixels — which is what lets a deform be written as a **field over
  text space** (`f(x, y)` at each corner's absolute position) and warp a line
  coherently, since neighbouring quads' corners then land on the same curve for
  free. `GlyphState` exposes readonly `width` / `height` / `em` / `baselineOffset`
  for exactly that.
- **No matrix, so no slow path.** `BatchMSDFChar` displaces the four corners
  before the transform; a deform alone does not push a glyph onto
  `submitOneGlyph`'s per-glyph-matrix branch. Decoration rects pass `null` — no
  `GlyphState` owns one.
- **Not a `StyleSpec` key**, deliberately: the same four offsets on every glyph of
  a run is one shape repeated, and every interesting deform is a function of where
  the glyph *landed* — i.e. layout output, which is the glyph array's side of the
  hard boundary below.

**`skewPivot`** — where `skew` shears from, as an em offset **below the layout
baseline** (`0` = the baseline; the old, only behaviour). Parametrized from the
baseline rather than as a fraction of the glyph's box because the baseline is the
one anchor a *line* shares: any constant value then keeps every glyph on a line
pivoting about the same horizontal line, so the "a mixed-scale line slants as one
line" invariant holds at **every** value instead of only at the default. A 0–1
fraction of the box could not even name the baseline — it sits at a different
fraction of every glyph's box (`g` vs `x`) — and would shear a mixed line apart.

**Per-glyph state** — the display callback and `editGlyphs()` both operate on an
array of `GlyphState` (`src/MSDFGlyphState.ts`), one per renderable glyph. Each
carries a transform (incl. `skew`/`skewPivot` and the `offsetX`/`offsetY` deform),
a per-corner `weight`, and three independent aspects —
`fill`, `shadow` (+ `x`/`y`/`softness`/`spread`/`rounded`), `outline` (+
`width`/`rounded`/`softness`) — with per-corner `0xRRGGBB` colour and a separate
`0-1` alpha (kept split so V8 holds a stable hidden class and SMI/double field
reps across the per-glyph loop; packing lives in `src/MSDFColor.ts`). `shadow` and
`outline` also carry a per-corner `innerColor` for the two-tone ramp.

Two fields are not vertex data:
- **`visible`** — the renderer's three glyph loops `continue` on it, so a hidden
  glyph costs no quad. It exists because a zero alpha and a zero scale *both still
  submit* (the loops gate on `char.w`, the layout box, never on the state): an
  unrevealed typewriter glyph was costing up to three quads of nothing.
- **`glyph`** / `setGlyph(char)` — the **one hole in the vertex format**, since
  `inTexCoord` was the only slot `GlyphState` could not reach. It substitutes a
  letterform at *render* time: `resolveGlyphQuad` (renderer) rebuilds the quad from
  the substitute's own bearings/size/UVs at the original's **pen**, so the slot —
  and therefore every advance after it — is untouched and the word churns *in
  place*. That is what `setText`-per-frame cannot do (it relayouts, and the line
  breathes as the substitutes' widths differ). It needs one field on the char quad,
  `penX` (`x` already has the *original's* left bearing folded in), which
  `applyAlignment` must shift alongside `x`. The bearing delta comes back out of
  band in `swapDX`/`swapDY` so that `g.x`/`g.y` keep meaning "where the slot is".
  A code the run's font lacks falls back to the original — never to another font.
  `width`/`height` keep describing the layout box, so a deform field stays anchored
  to the slot.

`MSDFText._glyphMode` picks the source:
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

**Rich-text lanes** — the two style layers (`_segmentRuns` content, `_overlays`
from `addStyle`; painted in that order — and within the overlays, plain creation
order, so the style added last wins — then `displayCallback`) split into three
key lanes:
- **Appearance** — colour/alpha/weight/outline/shadow/scale/rotation/skew/skewPivot
  (but *not* the quad deform — see above). Seeds
  `GlyphState`. `_hasAppearance` gates the per-glyph array and `applyStyleRuns`.
  A change sets `_stylesDirty` (one coalesced re-seed before the next render).
- **Decoration** — `underline`/`strikethrough`/`highlight`. Appearance-lane timing
  (`_stylesDirty`), but they never touch `GlyphState`; `_hasDecorations` gates
  `rebuildDecorations`, which runs in *every* glyph mode because it reads
  `_characters`, not the glyph array.
- **Structural** — `fontScale` (a *multiplier* on the object `fontSize`; absolute
  px would go stale under `setFontSize` and break `fitInside`'s monotone binary
  search), `font` (an `msdfFont` cache key; an unknown key warns once and falls
  back to the base font) and `space` (see below). None reaches `GlyphState`. They
  are painted into four parallel source-indexed maps — `_sizeScales`
  (`Float32Array` of multipliers), `_fontMap` (`Uint8Array` of `_runFonts`
  indices) and `_padBefore`/`_padAfter` (`Float32Array` of em pads) — all `null` on
  the uniform fast path, all feeding wrap, measurement and layout. A change sets
  `_dirty` — a rebuild, not a re-seed.

**`space`** — extra advance at a run's edges, em-relative to *the run's own size*
(so it scales with `fontScale` and keeps `fitInside` monotone, for the same reason
`fontScale` is a multiplier). It is the manual reconciliation of two faces where
the no-kerning-across-a-font-boundary rule leaves a gap nobody chose; **negative
is legal** and is half the use case.
- Modelled as a pad on the run's edge **characters**, not as a gap between runs. A
  boundary has no index, so it could not live in the source-indexed maps the whole
  structural lane is built on, and it would need a rule for who owns a boundary two
  runs both touch. As a character pad it needs neither: `before` writes the run's
  first index and `after` its last, so run A's `after` and run B's `before` land on
  *different* slots and both apply (they add — horizontal margins don't collapse in
  CSS either), while two rules on the *same* edge resolve by layer order like every
  other painted map.
- The pad rides its character's advance, added **inside** the same `if (char)` guard
  in all three passes (`measureSpan`, `wrapLines`'s `add()`, `rebuildText`), which
  is what makes the "identical advance calls" invariant hold *by construction*: a
  character missing from its run's font takes its pads with it, and a pad on a `\n`
  never fires. It does not suppress kerning — where the run boundary is also a
  font/size change, kerning was already skipped; where it isn't, the two add.
- Consequences accepted, not overlooked: a pad at a line's end is real width, so it
  nudges a centred line — exactly as `letterSpacing`'s trailing slot already does
  (`measureSpan` documents that) — and a `before` pad on a wrapped character reads
  as an indent. Trimming either would add a fourth rule the three passes must agree
  on, for a cosmetic gain.
- **`setSpacingCallback`** (`SpacingCallback`, `SpacingPads`) is the same two maps'
  per-character lane: it runs as their **last layer** inside `buildPads`, after the
  segments and overlays, and may add to or overwrite what they painted. It is not a
  third frame-time callback — spacing is a layout *input*, so it runs at **rebuild**
  time and `refreshSpacing()` (a relayout) is how a caller re-runs it when its own
  inputs moved. It re-runs on every rebuild against the current string, so like a
  `StyleMatcher` anchor it is content-anchored and survives a text change.
  It exists for the *bulk* case only: a span anchor of length 1 already reaches one
  character (`addStyle({start, length: 1}, {space})`), so what the spec layers can't
  do is N characters with N *different* values without N overlays. (A *uniform* pad
  is not a use for it either — that is `letterSpacing`.) Its motivating case is a
  rule over the **font boundaries**, which is why `refreshStyleState` publishes the
  structural maps *before* it calls `buildPads`: the callback reads them back through
  `fontAt(i)` / `fontScaleAt(i)` (public, source-indexed), and a spacing rule that
  cannot see the fonts cannot space the one gap that has no kern pair to fall back on.
- **Not writable on `GlyphState`** — the pads are advance, so they feed wrap, line
  width, alignment and the rects; a writable field there would mean a relayout per
  frame in callback mode. `GlyphState.padBefore`/`padAfter` are therefore a
  **readonly** mirror (in px, like `em`/`baselineOffset`). The per-frame lane for
  spacing is `offsetX`, whose prefix sum *is* an advance — and which deliberately
  leaves the line's wrap and alignment alone.

**Specs are layout inputs; the glyph array is layout output.** That is the one
hard boundary, and it is enforced physically rather than by convention: every
spec layer takes the same `StyleSpec` and may carry any key (the cost is per
*key*, per the lanes above, never per method), while `displayCallback` /
`editGlyphs` operate on already-laid-out glyphs and are appearance-only because
`GlyphState` has no structural fields. `MSDFText.refreshStyleState()` recomputes
all of `_hasStyles` / `_hasAppearance` / `_hasDecorations` / `_sizeScales` /
`_fontMap` / `_padBefore` / `_padAfter` / `_maxLineUnit` and is the single place
that decides re-seed vs rebuild. It rebuilds `_runFonts` unconditionally, because `setFont` swaps slot 0
out from under an otherwise unchanged map.

**Overlay anchors** — `addStyle(target, style)` is the only overlay primitive.
`resolveTarget` (`MSDFTextStyle.ts`) normalizes the public `StyleTarget` into a
`ResolvedTarget` whose `kind` is the *only* thing that decides lifetime:
`match` / `regexp` / `segment` / `fn` are **content-anchored** (re-derived on
every text change, so they survive it); `span` is **position-anchored**
(spliced out and marked `dead`, which is what its handle checks). `onTextChanged`
is that one loop. The `fn` anchor is the extension point that ends the
matcher-feature treadmill; a matcher that throws **propagates** — it is the
caller's exception, not ours to swallow into a silent no-match. `onTextChanged`
pays for that by compacting the store *before* running any user code and
refreshing derived state in a `finally`, so the throw leaves the text object
consistent. Range spans index the **source** string, and a structural reflow
never moves source indices — which is what makes a structural key safe on a
position anchor.

- The **`segment` anchor** (`addStyle({ segment: id }, style)`) is the odd one:
  its "content" is `_segmentRuns`, not the string, so `deriveRuns` takes both and
  every caller must install its segments *first* (`setRichText` assigns them,
  `setText` clears them). It is also the only anchor that can legitimately
  resolve to **no spans and stay alive** — waiting for a later `setRichText` to
  bring its `id` back. Its reason to exist: `setRichText` replaces content, so it
  drops every position-anchored overlay; a named segment is how a caller restyles
  one piece repeatedly without that collateral. `setRichText` therefore keeps a
  run for a **named-but-unstyled** segment — its `ResolvedStyle` is empty, so
  every key-gated paint loop skips it anyway — while still eliding anonymous
  unstyled strings.
- `applyRun` **binary-searches** its span's glyph window rather than scanning.
  The glyph array is *strictly* increasing in `srcIndex` (newlines, spaces and
  characters missing from their run's font never become quads), so a source span
  is contiguous. A RegExp anchor makes dozens-of-spans overlays ordinary, and
  every span is walked on every re-seed — per frame, in callback mode.

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

`rebuildText` **keeps** what that measure produced, in `_lines` (public readonly
`text.lines`: per line `index` / `x` / `width` / `top` / `baselineY` / `bottom`) —
it used to throw all but the baselines away, and `getTextBounds()` then re-ran the
whole wrap *and* measure on every call. That is a per-frame relayout from the one
place it is most natural to call: a display callback, since a deform written as a
field over text space needs a domain to normalize against. `getTextBounds()` now
reads the cache (rebuilding only when `_dirty`), and a line's alignment inset **is**
its `LineInfo.x`, so `applyAlignment` reads it from there rather than repeating the
formula. (One behaviour change: on *empty* text `getTextBounds()` reports zero lines
rather than one, which now agrees with `text.width`/`.height`, both already `0`.)

`measureSpan`, `wrapLines` and `rebuildText` must make **identical** advance and
kerning calls or wrapped lines mismeasure. The three shared rules: a character
missing from *its run's* font is skipped (no advance, and **no cross-font
fallback**, ever); kerning applies only between two characters in the same font at
the same size; the `space` pads ride a character's own advance, inside that same
skip guard. `MSDFFont` keeps thin single-font wrappers (`measureText`,
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
  MSDFTextTypes.ts         # Public type surface (StyleSpec / StyleTarget / MSDFTextInstance)
  MSDFTextStyle.ts         # Rich-text style engine (resolve, match, apply) — no instance state
  MSDFTextWrap.ts          # Pure word-wrap + source-index map
  MSDFGlyphState.ts        # Per-glyph state type + factory (callback / editGlyphs)
  MSDFDecorState.ts        # Per-rect state type + factory (decoration callback)
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
- **Object alpha is a pack-time modulation** — `text.alpha` (and the per-corner
  `alphaTopLeft`…) never reaches a `GlyphState` or a `DecorationState`. The
  renderer publishes it as `objAlpha` and multiplies it into every colour
  attribute as it packs. It **has** to live there: a style run *overwrites* what
  the seed wrote — that is what a run is — so an alpha folded into the seed was
  silently discarded by any run naming an `alpha` of its own, and by any callback
  setting one. That was a real bug: a per-run shadow ignored `text.alpha`, and a
  highlight pill (whose `alpha` and `borderAlpha` always resolve, defaulting to
  `1`) never faded at all. Consequences: an alpha change costs **no re-seed and no
  rebuild** (so `Components.Alpha` needs no override, and a fade tween on a styled
  text is free), and a pill's border ring is packed at *submit* rather than baked
  at rebuild — its alpha has to see the object's live value. The zero-alpha
  two-tone sentinel is read off the *modulated* byte, which is the one the shader
  sees.
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
