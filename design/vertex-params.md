# The `params` vertex attribute — per-glyph effects, one draw call

**Status:** designed, not implemented. **Dependencies:** none. Everything here
lives in the appearance lane and in code we already own (shader, batch handler,
renderer, glyph state, style resolver). It does **not** touch layout,
measurement, wrap, or the font parser.

This doc covers steps **A–C** of the remaining rich-text roadmap. Per-run
**font** (2b) is step D and lives in `rich-text-styling.md`; it is deliberately
*after* this work, for reasons this doc establishes.

## Why this comes first

The remaining features split along two axes: **the vertex layout** (per-glyph
outline width / rounded / shadow softness, faux weight, underline) and **per-run
font**. They are not symmetric halves of one job:

- The vertex-layout work is **subtractive**. It deletes four uniforms, collapses
  four shader modes into one, deletes every uniform-driven batch flush, and
  deletes three limitations already documented in `README.md` / `MSDFTextTypes.ts`.
- Per-run font is **additive**. It touches the loader, parser, `MSDFFont`, wrap,
  measurement, `rebuildText`, style resolution, and the renderer, and it
  introduces the first per-glyph flush gate the renderer has ever had.

Doing the vertex layout first is not "clear the easy one." It removes the thing
that makes 2b expensive (see *The pxRange collapse* below), and it ships a
draw-call win on its own with **zero public API change**.

Bundling them is the wrong call for a second reason: step A changes the shader
for every existing user, and step D changes layout for every existing user. Land
them together and any visual regression has two suspects.

---

## Discovery — three findings that shape the plan

These were derived by reading the current shader and renderer. They are the
reason the plan looks the way it does. Verify them once in code; they are the
load-bearing claims.

### 1. The pxRange collapse — `uPxRange` is per-*texture*, never per-glyph

`README.md` currently says per-run fonts "make texture and both atlas uniforms
per-glyph and need flush points beside the existing `configurePass` ones."
That overstates the problem. Look at where `uPxRange` appears in
`MSDFBatchHandler.ts`:

| site | expression | after normalising |
|---|---|---|
| `screenPxRange()` | `vec2(uPxRange) / uAtlasSize` | a per-texture **ratio** |
| mode 1 / 2 | `outlineEdge = 0.5 - (uOutlineWidth / uPxRange)` | `0.5 - widthNorm` |
| mode 3 | `soft = max(uShadowSoftness, uPxRange/pxRange)`; `alpha = clamp(uPxRange*(tsdf-0.5)/soft + 0.5)` | `alpha = clamp((tsdf-0.5)/max(softNorm, 1.0/pxRange) + 0.5)` |

Mode 3's cancellation is exact: with `softNorm = uShadowSoftness / uPxRange`,
`soft = uPxRange · max(softNorm, 1/pxRange)`, and the `uPxRange` factor divides
out of numerator and denominator.

So if `outlineWidth` and `shadowSoftness` are packed as **fractions of the
atlas `distanceRange`** — which is exactly the quantisation the Phase 2 notes
already call for — then `uPxRange` **vanishes from every mode branch** and
survives only inside `screenPxRange()`, coupled to `uAtlasSize` as a single
ratio.

Consequences, both large:

- **`uPxRange` and `uAtlasSize` never need to be per-glyph.** They are
  per-texture. A merged (`-and`) atlas carries one `distanceRange` by
  construction, so glyphs sharing a texture always share both values.
  Per-run font is therefore a **texture-binding problem and nothing else**.
- The per-glyph effect params become **font-independent**. A glyph from a
  `distanceRange 4` font and one from a `distanceRange 8` font both encode
  "outline = 0.15 of the range" and render at visually consistent widths.
  Normalisation happens on the CPU at pack time, using *that glyph's* font.

Fold the two uniforms into one `uUnitRange` vec2 (`distanceRange / atlasSize`,
computed CPU-side) while you're in there.

### 2. The mode collapse — modes 0, 1 and 2 are the same formula

There is a latent bug waiting the moment `outlineWidth`/`outlineAlpha` go
per-glyph. Today's `OUTLINE_COMBINED` branch computes:

```glsl
vec3 rgb = mix(outOutline.rgb, outColor.rgb, textMix);
float a  = coverage * mix(outOutline.a, outColor.a, textMix) * backgroundFade;
```

Set a glyph's outline alpha to zero — which is precisely what "this glyph in an
otherwise-outlined text has no outline" means — and you get
`a = coverage * colorA * textMix`, i.e. roughly `colorA · coverage²`. The
glyph's antialiased edge is wrong. At nonzero outline alpha, the fill's AA edge
is tinted by the outline colour. This never shows today because outline-ness is
a per-batch uniform and the no-outline case is routed to mode 0. Per-glyph
outline width destroys that invariant.

Rewrite the branch as an honest **fill-over-outline** composite:

```glsl
float af = fillAlpha    * textMix;                        // fill coverage
float ao = outlineAlpha * outlineCoverage * backgroundFade;
float a       = af + ao * (1.0 - af);
vec3  rgbPre  = Cf * af + Co * ao * (1.0 - af);
gl_FragColor  = vec4(rgbPre, a);                          // already premultiplied
```

Now check the degenerate cases:

- `outlineAlpha = 0` ⇒ `a = af`, `rgbPre = Cf·af`. **That is mode 0, exactly.**
- `fillAlpha = 0` ⇒ `a = ao`, `rgbPre = Co·ao`. **That is mode 2, exactly.**

So `PLAIN`, `OUTLINE_COMBINED` and `OUTLINE_SILHOUETTE` are one branch. The
layered path stays two *submission* loops (all silhouettes, then all fills),
each zeroing one of the two alphas — which is the same trick as the existing
`zeroOutline` constant at `MSDFTextWebGLRenderer.ts:44`, generalised.

`SOFT_SHADOW` (mode 3) is the one genuinely different branch, because it reads
`tsdf` rather than `median(rgb)`. But that difference is exactly what the
per-glyph `rounded` channel already expresses — `dist = mix(median, tsdf,
rounded)` — with a shadow quad setting `rounded = 1` when its softness is
nonzero. So `uMode` can die as well.

**Honesty caveat:** the over-composite is *more* correct than today's `mix`, so
the fill's AA edge will shift very slightly. This is not a pixel-identical
refactor. Verify it by eye against the existing examples before/after — do not
assert identity.

### 3. Every uniform flush point disappears

`configurePass` (`MSDFTextWebGLRenderer.ts:62`) calls `batchHandler.run()` —
a full draw — whenever `uMode`, `uOutlineWidth`, `uOutlineRounded` or
`uShadowSoftness` change. After findings 1 and 2 there is nothing left for it to
flush on. Which means:

- Text with a drop shadow costs **one draw call instead of two**. Layered
  outline + shadow goes from three to one.
- Two text objects with *different* outline widths — or one outlined and one
  not — batch together, provided they share an atlas.
- The MTSDF guard (`isMtsdf`, `MSDFTextWebGLRenderer.ts:194`) moves from a
  per-object check to a **pack-time clamp** of `rounded`/`softness`. That is
  exactly what per-run font will need anyway, since `fieldType` becomes
  per-glyph. Another 2b cost paid early.
- `perGlyphShadow`'s documented "per-glyph shadows are always hard-edged"
  limitation is deleted.
- `StyleSpec`'s "`outline` deliberately omits `width`/`rounded`, `shadow` omits
  `softness`" is deleted — they join the appearance lane like everything else,
  and go per-corner for free.

After this, the renderer's **only** remaining flush gate is the texture, which
is precisely the gate step D needs.

---

## The `params` attribute

A fifth vertex attribute, `inParams`, a normalized `UNSIGNED_BYTE` vec4.
Vertex size goes 24 → 28 bytes (112 bytes per glyph quad, ~17% more buffer
traffic — irrelevant at text-scale glyph counts).

| channel | meaning | encoding |
|---|---|---|
| `.r` | **weight** — faux bold. Shifts the fill's distance threshold. | `128` = neutral; signed around it, bounded by the distance range |
| `.g` | **flags** — `solid` (underline/strike rects) and `rounded` bits | per-glyph constant; see below |
| `.b` | **outlineWidth** | fraction of `distanceRange`, `0` = no outline |
| `.a` | **shadowSoftness** | fraction of `distanceRange`, `0` = hard edge |

Faux bold is then one line: `textEdge = 0.5 - weight`.

### `flags` must stay constant across a quad's four vertices

This shader is GLSL ES 1.00 (WebGL1: `attribute`/`varying`,
`GL_OES_standard_derivatives`). There is **no `flat` qualifier** — every
attribute interpolates. A packed bitfield cannot survive interpolation, so the
`flags` byte is written identically to all four vertices of a quad, i.e. it is
per-glyph, not per-corner. The renderer must not be tempted otherwise.

The other three channels are continuous and interpolate happily, so they are
**per-corner for free**, exactly like `inColor`/`inOutline` already are:

- per-corner `outlineWidth` → a directional/asymmetric outline (animate the
  corners for a wobble)
- per-corner `shadowSoftness` → soft on one edge, crisp on the other
- per-corner `weight` → a faux-bold gradient

Two honesty caveats to document if surfaced: (1) interpolation is **linear
across the quad's bounding box in texcoord space**, not along the letter
contour — a directional ramp, not a contour-following pulse; (2) it should
mirror the existing per-corner colour model (`PerCorner<number>` on the relevant
`GlyphState` / `StyleSpec` fields).

### `rounded` stays a bit on day one

Ironically `uOutlineRounded` is *already* continuous in the shader
(`mix(dist, tsdf, rounded)`), so a per-corner `rounded` would blend sharp-MSDF
into rounded-SDF beautifully. It just needs its **own continuous byte**, which
the byte4 doesn't have while `solid` occupies a bit.

The escape hatch, if we ever want it: `solid` quads (underline/strike rects)
never use `weight`, `outlineWidth` or `shadowSoftness`, so `solid` can become a
**sentinel value** in one of those channels rather than a dedicated bit — safe,
because all four corners of a rect share their values and a rect quad never
shares interpolation with a glyph quad. That frees a real byte for continuous
per-corner `rounded`. **Do not build this on day one.** `rounded` is a bit.

### Why `solid` is a real flag and not a texture trick

An underline needs full coverage with no atlas sample. There is no guaranteed
solid texel in an msdf-atlas-gen atlas, and "sample the interior of some glyph"
is fragile (`backgroundFade = smoothstep(0.0, 0.2, dist)` will eat a rect whose
sampled distance is low). A `solid` bit that short-circuits to `coverage = 1.0`
and skips the texture fetch is the safe route.

---

## Sequence

### Step A — shader + vertex layout (no public API change)

1. Add `inParams` to `vertexBufferLayout` in `MSDFBatchHandler.ts`; widen
   `batch()` to take four packed `params` u32s alongside the two colour sets.
2. Rewrite the fragment shader as one branch: `dist = mix(median(rgb), tsdf,
   rounded)` for the outline/shadow layer, `median(rgb)` for the fill;
   over-composite fill onto outline; `solid` short-circuits coverage.
3. Delete `uOutlineWidth`, `uOutlineRounded`, `uShadowSoftness`, `uMode` and the
   `MSDFMode` constants. Replace `uPxRange` + `uAtlasSize` with `uUnitRange`.
4. `configurePass` loses its body. The shadow / silhouette / fill loops in
   `MSDFTextWebGLRenderer.ts` stay as **submission-order** loops (back to
   front), but no longer flush. Within one draw call, quads composite in
   submission order under alpha blending — ordering is preserved for free.
5. The object-level `outlineWidth` / `outlineRounded` / `shadowSoftness` fields
   are simply packed into every glyph's params. `isMtsdf` becomes a pack-time
   clamp of `rounded` and `softness` to `0`.

**Gotcha — `BatchMSDFChar`'s argument list.** `batch()` already takes 20
positional args and this adds four more. Introduce a single `QuadAttribs`
(`{ color: PackedCorners; outline: PackedCorners; params: PackedCorners }`) and
pass that, rather than growing the positional list again. `PackedCorners` and
`packColor` in `MSDFColor.ts` are the model; add a `packParams(weight, flags,
width, softness)` beside it.

**Verification.** The examples render as before (modulo the AA-edge shift noted
above — look, don't assume), and the draw-call count for a shadowed, outlined
text drops from 3 to 1. Two text objects with different outline widths share a
draw call.

### Step B — expose the new knobs (nearly free after A)

- `GlyphState` gains `weight`, `outlineWidth`, `shadowSoftness`, `rounded`.
- `StyleSpec` gains `weight`, `outline.width`, `outline.rounded`,
  `shadow.softness` — all appearance lane, all animatable, all per-corner where
  continuous.
- `MSDFTextStyle.ts`: `resolveStyle` and `applyStyleToGlyph` grow the new keys;
  `styleHasAppearanceKeys` grows the matching clauses. Nothing else changes —
  `_hasAppearance` / `_stylesDirty` / the three-store paint order are untouched.
- Faux bold falls out of the `weight` channel.

**Document:** faux bold widens glyphs **without changing advance**, so letters
can touch at high weight; the threshold shift is bounded by `pxRange`, just like
outline width.

### Step C — underline / strikethrough

- Run-span rectangle geometry. The spans are already known: segments and rules
  carry `start`/`length` over `_text`, and `_characters[i].srcIndex` maps back.
  A span's rect is the union of its glyphs' advances on each visual line (split
  the rect at line boundaries — use `_characters[i].line`).
- `MSDFFontParser` **already** carries `underlineY` and `underlineThickness`
  (normalized, y-down sign-corrected) — the geometry data is free.
- Rects use the `solid` flag, so they **batch with the glyphs**: no per-rect
  `uMode`, no flush. This is the whole reason `solid` lives in `params`.
- Submission order: rects go with the fill loop (or before it, for a strike
  *under* the glyph — pick one and document).

---

## What step D (per-run font) inherits

Recorded here so the fresh session doesn't re-derive it. Full context in
`rich-text-styling.md`.

- The renderer's only flush gate is `configureFont(texture, unitRange)`,
  mirroring what `configurePass` used to be.
- **Gotcha:** it must set the new binding *after* the flush, never before.
  `MSDFBatchHandler.run()` reads `_unitRange` at draw time via `setupUniforms`,
  so setting it early would render the *previous* font's queued glyphs with the
  *new* font's range. (`batch()`'s own texture check at
  `MSDFBatchHandler.ts:360` has the same ordering requirement and gets it right
  today only because the uniforms happen to be per-object.)
- The structural map generalises: `_sizeScales` is a source-indexed
  `Float32Array` with `null` as the uniform fast path. The font map is the
  **same shape** — a `Uint8Array` of indices into a small `_runFonts:
  MSDFFont[]`, `null` when uniform — re-indexed onto the wrapped string by the
  same `wrappedScales` walk.
- The kerning gate at `MSDFText.ts:1441` becomes `scale === prevScale &&
  fontIdx === prevFontIdx`, and `MSDFFont.measureSpan` must make the identical
  call or wrapped lines mismeasure.
- The one architectural move 2b forces: **measurement stops being a method on a
  single `MSDFFont`** and becomes a function over a run-aware font source.
  `maxScaleIn` generalises from "max multiplier on this line" to "max line
  metric on this line", since `lineHeight` / `ascender` now vary per run too.
- Step E (merged `-and` atlas: parser yields N fonts, loader uploads the texture
  once) makes `configureFont`'s flush never fire. Pure optimisation, no renderer
  change, strictly after D.

---

## Locked decisions

- **Stay one über-shader.** Dynamic shader composition (which Phaser 4 uses
  elsewhere) means different programs for differently-featured texts, and
  different programs cannot share a batch — defeating the point of batched text.
  The added fragment cost (one threshold add; attribute reads instead of uniform
  reads) is negligible at text-scale glyph counts, and step A *removes* draw
  calls. Revisit only on a real measurement — the same bar as tree-shaking.
- **Normalise `outlineWidth` / `shadowSoftness` by `distanceRange` at pack
  time**, not in the shader. 256 steps over the range is imperceptible, and it
  is what makes the params font-independent.
- **`flags` is per-glyph, never per-corner** (no `flat` in GLSL ES 1.00).
- **`rounded` is a bit on day one.** The sentinel trick that frees a continuous
  byte is documented above and deliberately deferred.
- **A, B, C land together as one release** (one coherent appearance-lane change).
  **D and E stay separate** — one suspect per regression.
- Each step lands with a demo page in `examples/`, per repo convention.
