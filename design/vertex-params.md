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

`SOFT_SHADOW` (mode 3) differs from the unified branch in **three** ways, and
all three must be accounted for:

1. **It reads `tsdf` rather than `median(rgb)`** — exactly what the per-glyph
   `rounded` channel already expresses: `dist = mix(median, tsdf, rounded)`,
   with a shadow quad setting `rounded = 1` when its softness is nonzero.
2. **The softness denominator.** The unified coverage
   `clamp((dist − edge) / max(softNorm, 1.0 / screenPxRange()) + 0.5)`
   *generalises* the plain AA formula — `softNorm = 0` reproduces
   `clamp(px·(dist − edge) + 0.5)` exactly — so one coverage expression serves
   fill, outline and shadow.
3. **Mode 3 has no `backgroundFade`.** The unified outline layer applies
   `smoothstep(0.0, 0.2, outlineDist)`, but a high-softness glow has real
   alpha in the `dist < 0.2` region (up to ~0.2 at max softness) and the fade
   would eat its outer tail. Suppress the fade for soft quads:
   `fade = max(smoothstep(0.0, 0.2, outlineDist), step(0.5/255.0, softNorm))`
   — any nonzero softness byte disables it; hard quads keep it.

So `uMode` can die as well — but note the **submission change** that implies:
shadow colour today rides the *fill* attribute (`shadowBuf` as `colorData`,
`zeroOutline` beside it). In the unified shader, softness and `rounded` belong
to the **outline layer** — and must, because the fill layer has to stay
`median(rgb)` or a rounded *outline* would also round its glyph's *fill*. So a
shadow quad becomes an **outline-only quad**: fill alpha 0, shadow colour in
the outline attribute, width 0, softness/rounded in params. Side effect worth
checking in the examples: a *hard* shadow (softness 0) keeps the fade and so
gains `backgroundFade` at extreme minification, which today's mode-0 shadow
path doesn't have — arguably a fix, but a visible change.

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

**But one flush gate must be *added*, and step A is where it ships.** Today the
renderer sets `setPxRange`/`setAtlasSize` per object
(`MSDFTextWebGLRenderer.ts:188`) *before* submitting anything. When the next
object uses a different font and `configurePass` finds nothing changed (both
plain, same outline settings), the first flush happens inside `batch()` on the
texture change — *after* the uniforms were already overwritten. The previous
font's queued quads draw with the new font's `pxRange`/`atlasSize`: wrong AA
width, wrong outline thickness. This is a **live latent bug today** — niche (it
needs two fonts with different `distanceRange` or atlas dimensions, adjacent in
the display list, with no other flush trigger), but real. `uUnitRange` set the
same way would carry it forward. So step A does not leave `configurePass` as an
empty husk: it *becomes* `configureFont(texture, unitRange)` — check-and-flush,
set-after-flush — which fixes the existing bug for free and is exactly the gate
step D inherits.

---

## The `params` attribute

A fifth vertex attribute, `inParams`, a normalized `UNSIGNED_BYTE` vec4.
Vertex size goes 24 → 28 bytes (112 bytes per glyph quad, ~17% more buffer
traffic — irrelevant at text-scale glyph counts).

| channel | meaning | encoding |
|---|---|---|
| `.r` | **weight** — faux bold. Shifts the fill's distance threshold. | `128` = neutral; signed around it, spanning ±`distanceRange`/2 |
| `.g` | **flags** — `solid` (underline/strike rects) and `rounded` bits | per-glyph constant; see below |
| `.b` | **outlineWidth** | byte/255 × **half** of `distanceRange`, `0` = no outline |
| `.a` | **shadowSoftness** | fraction of `distanceRange`, `0` = hard edge |

Faux bold is then one line: `textEdge = 0.5 - weight`.

Two encoding details that pack and shader must agree on:

- **`outlineWidth` spans the *useful* range, not the full range.** The outline
  edge is `0.5 − widthNorm` and the distance field clamps at 0, so only
  `widthNorm ∈ [0, 0.5]` does anything — a full-range encoding would waste half
  the byte. Decode `widthNorm = inParams.b * 0.5`: the byte covers exactly the
  useful interval at double the precision (256 steps ≈ 1/128 of
  `distanceRange` per step). `weight` gets the same treatment on each side of
  neutral (±`range`/2 is the useful span, for the same clamping reason).
  `shadowSoftness` keeps the full-range encoding — its useful range genuinely
  is `[0, 1]` of `distanceRange`.
- **`weight`'s neutral point is `128/255`, not `0.5`.** A normalized
  `UNSIGNED_BYTE` 128 decodes to ≈ 0.50196; decode as
  `(inParams.r − 128.0/255.0)` (times the span), or every glyph gets a hair of
  faux bold.

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

**Gotcha — solid rects and `screenPxRange()`.** A rect with constant texcoords
gives `fwidth(outTexCoord) = 0` → `1/0 = Inf`; if coverage is computed
unconditionally and then selected by the flag, Inf/NaN leaks through the
select. Assign rect quads a real UV extent (`0..1` across the quad) so every
intermediate stays finite — no branch needed, and those UVs are exactly what
future rect effects want (dashed lines via `fract(u·n)`, rounded/soft pills via
a UV box-SDF; see *What this unlocks*). Skipping the `texture2D` fetch is then
optional — the atlas has no mipmaps, so sampling unconditionally and selecting
with `mix` is simplest and avoids non-uniform-control-flow pedantry.

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
4. `configurePass` is **replaced by `configureFont(texture, unitRange)`** — a
   check-and-flush on the per-texture ratio, set *after* the flush. This is not
   new machinery for 2b's sake: setting `uUnitRange` per object without a flush
   check would carry today's latent multi-font uniform bug forward (finding 3).
   The shadow / silhouette / fill loops in `MSDFTextWebGLRenderer.ts` stay as
   **submission-order** loops (back to front), but no longer flush. Within one
   draw call, quads composite in submission order under alpha blending —
   ordering is preserved for free.
5. The object-level `outlineWidth` / `outlineRounded` / `shadowSoftness` fields
   are simply packed into every glyph's params. `isMtsdf` becomes a pack-time
   clamp of `rounded` and `softness` to `0`. Shadow quads move their colour to
   the **outline attribute** (fill alpha 0) — see the mode-collapse section for
   why that is forced, not a preference.

**Gotcha — `BatchMSDFChar`'s argument list.** `batch()` takes 22 positional
args (20 numeric) and this adds four more packed u32s, mirroring the two colour
sets — fine, it is an internal hot path. `BatchMSDFChar` itself grows a third
`params: PackedCorners` argument beside `colorData`/`outlineData`: the renderer
already keeps reusable module-level `PackedCorners` buffers (`fillBuf`,
`outlineBuf`, …), so a `paramsBuf` simply joins them. (A bundling `QuadAttribs`
object was considered and rejected — an extra indirection that breaks the
existing buffer pattern for no gain.) `packColor` in `MSDFColor.ts` is the
model; add `packParams(weight, flags, width, softness)` beside it.

**Verification.** The examples render as before (modulo the AA-edge shift noted
above — look, don't assume), and the draw-call count for a shadowed, outlined
text drops from 3 to 1. Two text objects with different outline widths share a
draw call. Two adjacent texts using fonts with different `distanceRange` /
atlas dimensions AA correctly (the pre-A renderer gets this wrong — finding 3).

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

Rects use the `solid` flag, so they **batch with the glyphs**: no per-rect
`uMode`, no flush. This is the whole reason `solid` lives in `params`.

#### API

```ts
interface DecorationSpec {
    color?:     ColorValue | PerCorner<ColorValue>; // default: inherit the resolved fill
    alpha?:     number;      // default: inherit the resolved fill alpha
    thickness?: number;      // multiplier on the font's underlineThickness; default 1
    offset?:    number;      // em-relative shift from the default position; default 0
}

// StyleSpec — so segments, rules AND ranges (all appearance lane):
underline?:     boolean | DecorationSpec;   // true = inherit everything
strikethrough?: boolean | DecorationSpec;
```

Object-level, mirroring `setOutline`/`setShadow`:

```ts
setUnderline(enable: boolean | DecorationSpec): this;
setStrikethrough(enable: boolean | DecorationSpec): this;
```

Decorations are **appearance-lane** (toggling never reflows) but they are *not*
per-glyph state: they resolve per source character through the normal
key-by-key paint order (object level → segments → rules → ranges; overlaps
resolve like any other key, later layer wins), and are then merged into rects.
`GlyphState` never carries them and **`displayCallback` cannot see or animate
them** — frozen for day one; revisit only with a real use case. Per-glyph
transforms (scale/rotation/skew) move glyphs, not decorations: decorations
follow the layout. Document both.

#### Geometry

- Resolve per source char, then merge consecutive decorated chars into rects,
  **splitting** at:
  1. visual line boundaries (`_characters[i].line`);
  2. `fontScale` boundaries — thickness and position are size-relative, so
     each segment uses its own size (like browsers across font-size spans);
  3. resolved fill colour/alpha changes, **when colour is inherited** — each
     coloured word's underline matches it. An explicit `color`/`alpha` in the
     spec suppresses this split (one colour for the whole span).
- **Underline:** `y = baselineY + underlineY·size`,
  `h = underlineThickness · size · thickness`. `MSDFFontParser` **already**
  carries `underlineY` / `underlineThickness` (normalized, y-down
  sign-corrected) — the metric data is free.
- **Strikethrough:** msdf-atlas-gen emits no strike metric (no x-height
  either). Frozen default: `−0.25 em` above the baseline (≈ mid-x-height for
  typical fonts), same thickness metric. The `offset` field is the tuning knob
  for fonts where that sits wrong.
- **X extent:** union of the segment's glyph quad extents
  (`char.x` … `char.x + char.w`). Spaces have no entry in `_characters`, but
  the union bridges interior gaps; leading/trailing spaces in a span don't
  extend the rect. Document.

#### Storage & rendering

- Rects live in a `_decorRects` array (position/size + packed corner colours +
  an over/under flag) — **not** in `_characters`: the GlyphState array,
  `editGlyphs()` and the per-glyph loops all assume one quad per renderable
  char and must never see rects. Rebuilt by the same coalesced pass that seeds
  styles (rebuild / `_stylesDirty`) — rects read `_characters`, which layout
  owns, so they stay in sync without a dirty flag of their own.
- Rect quads: `solid` flag set; UVs `0..1` (finite `fwidth` — see the NaN
  gotcha above); colour in the fill attribute; outline attribute zero;
  `weight` / `outlineWidth` / `softness` zero (reserved — see *What this
  unlocks*).
- Submission order: **underline before the fill loop** (under the glyphs,
  after shadows and silhouettes), **strikethrough after the fill loop** (over
  the glyphs) — matches browsers. Decorations cast no shadow and take no
  outline (day one; document).

---

## What step D (per-run font) inherits

Recorded here so the fresh session doesn't re-derive it. Full context in
`rich-text-styling.md`.

- The renderer's only flush gate is `configureFont(texture, unitRange)` —
  **already built in step A** (it replaced `configurePass`); 2b extends it to
  switch textures per glyph run.
- **Gotcha:** it must set the new binding *after* the flush, never before.
  `MSDFBatchHandler.run()` reads `_unitRange` at draw time via `setupUniforms`,
  so setting it early would render the *previous* font's queued glyphs with the
  *new* font's range. (This is not hypothetical: the pre-step-A renderer sets
  `pxRange`/`atlasSize` per object before any flush and *has* this bug in
  multi-font scenes — see finding 3. Step A's `configureFont` fixes it; 2b
  keeps it fixed.)
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

## What this unlocks (recorded so we don't re-derive; none of it is scope)

Cheap follow-ups that fall out of the new layout — most are one shader line
plus one optional API key:

- **Two-tone shadows / glows.** After the shadow-colour migration, a shadow
  quad's *fill* attribute is unused. Feed it a second colour and
  `mix(outerColor, innerColor, coverage)` — a glow that shifts hue outward
  (white-hot core → orange halo). Per-corner on both colours, batched, free.
- **Two-tone outlines.** Same trick on the layered-outline silhouette pass,
  whose fill attribute is zeroed today: outline colour ramping from the inner
  edge to the outer edge.
- **Highlight pills.** Step C's span machinery + a padded rect + a UV box-SDF
  (the `0..1` rect UVs exist precisely for this) → rounded, optionally soft
  marker-highlights behind words — the damage-number "pill" for the cost of a
  rect variant.
- **Dashed / dotted underline.** `fract(u · n)` against the rect UVs in the
  solid path.
- **Per-corner weight / width / softness animation.** Faux-bold gradients,
  directional outlines, soft-one-side shadows, glyph "pop" pulses, glow
  breathing — all per-glyph via the existing callback, all in one draw call.

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
- **`configureFont` ships in step A, not step D.** Deleting `configurePass`
  without a replacement would carry today's live multi-font uniform-ordering
  bug forward (finding 3); the check-and-flush on `uUnitRange` is step A's
  job, and 2b merely extends it with the texture.
- **Encodings:** `outlineWidth` byte spans `[0, distanceRange/2]` (the useful
  interval, at double precision); `weight` spans ±`range`/2 around a neutral
  decoded as `128/255` (not `0.5`); `shadowSoftness` spans the full range.
  Pack helper and shader must agree — there is no second source of truth.
- **Decorations resolve from the style layers only** (plus the object level):
  `GlyphState` / `displayCallback` never see them; inherited colour splits the
  rect per colour run; strikethrough defaults to `−0.25 em`; underline draws
  under the fill, strikethrough over it.
- **No cross-font glyph fallback, ever** (relevant from 2b): a character
  missing from its run's font is skipped, exactly as a missing character is
  today. Consistency over cleverness.
- **A, B, C land together as one release** (one coherent appearance-lane change).
  **D and E stay separate** — one suspect per regression.
- Each step lands with a demo page in `examples/`, per repo convention.
- When A–C land, the stale docs are part of the step, not a follow-up: the
  shader/outline/MTSDF sections of `CLAUDE.md`, the per-batch-uniform
  limitation notes in `README.md` / `MSDFTextTypes.ts`, and `design/README.md`.
