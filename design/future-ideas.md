# Future ideas — unbuilt follow-ups from the vertex-params / rich-text work

Everything in `fit-inside.md`, `rich-text-provenance.md`, `rich-text-styling.md`
and `vertex-params.md` is implemented. While building that work, several cheap
follow-ups surfaced as consequences of the new layout — deliberately **not**
built, either because they were out of scope for the doc they were found in, or
explicitly deferred pending real demand. This doc collects them in one place so
a future session can pick one up without re-reading four design docs to
re-derive it.

None of this is scheduled. Treat each entry as a napkin sketch, not a spec —
verify the referenced code still looks the way it's described before starting.

## From `vertex-params.md` — free byte, and unused attribute slots

### ~~The `rounded` sentinel trick~~ — **built**

`params.g` is now the raw continuous `rounded` byte, per-corner, and `solid` is
a sentinel (`weight` byte `255`) rather than a bit. `PARAM_ROUNDED` /
`PARAM_SOLID` are gone; `SOLID_PARAMS` replaces them.

The doc's open problem — that `packParams` saturates, so byte `255` in `weight`
was not an impossible input — was settled by **clipping a real glyph's weight to
byte `253`** and having the shader split at `254`. That leaves a full byte of
guard band on each side of the threshold (~4× a `mediump` varying's ULP near
`1.0`, so interpolation can't cross it), at the cost of the top `2/255` of the
faux-bold range — an extreme where the fill edge has already collapsed onto the
distance field's own clamp and letters overlap.

`GlyphState.outline.rounded` went `boolean` → `Corners` (`0..1` per corner);
`setOutline(..., rounded)` still seeds its ends. Shadow quads now derive
`rounded` from `shadow.softness` corner for corner instead of one per-glyph flag
from `maxCorner(softness)`.

### ~~Two-tone shadows / glows~~ and ~~two-tone outlines~~ — **built**

Both landed together, since they are one shader change. A quad with **no fill**
— every shadow quad, and every layered-outline silhouette — leaves `inColor`
idle, so it carries the inner end of a colour ramp there instead. The shader
mixes `outOutline.rgb` → `outColor.rgb` over `tone`, gated on the fill alpha byte
being exactly zero (which is both "no fill" and "this rgb is an inner colour").
No new attribute, no new draw call, per-corner on both colours.

The design questions the sketch left open were settled thus:

- **A second colour field, not a reuse of `fill.color`.** `GlyphShadow` and
  `GlyphOutline` each gained an `innerColor: Corners`, seeded from the new
  object-level `shadowInnerColor` / `outlineInnerColor` (sentinel `-1` = "inherit
  the outer colour", i.e. no ramp — so an untouched glyph packs an identity mix).
  `fill.color` keeps meaning "the glyph's own face" everywhere.
- **`tone` is not `coverage`.** Coverage is a 1-pixel step on a hard outline, so
  it would have collapsed the outline ramp. `tone` is instead depth into the
  layer's own *visible* body, normalized: `widthNorm` for an outline (the band
  spans `[outlineEdge, fillEdge]` exactly), and **half** of `softNorm` for a
  shadow, because the blur is centred on the glyph edge and only its outer half
  shows. Normalizing by the full blur would strand the ramp at `tone = 0.5`.
- **The outline's ramp is linear; the shadow's is squared.** An outline's alpha is
  a flat `1` across its band, so a linear ramp gives both colours equal screen
  area. A shadow's alpha falls off across the *same* interval that `tone` spans,
  so a linear ramp puts the outer hue exactly where the shadow has already faded
  to nothing — the effect reads as a faint wash. Squaring holds the outer hue
  through the opaque middle of the halo and keeps the inner colour to the hot core
  against the glyph, which is the "white-hot core, coloured halo" this doc asked
  for. `softStep` (which `fade` already computes) blends the two curves.
- **A two-tone outline forces `outlineLayered`.** A combined fill+outline quad
  has already spent `inColor` on the fill, so there is nowhere to put a second
  colour; the renderer's `layered` gate now also opens on
  `outlineInnerColor >= 0`. Shadows need no such thing.
- **The one leak, plugged.** A *combined* quad with a zero fill alpha trips the
  shader's gate, and would have tinted the outline it leaves behind with the
  (invisible) face colour. `packFillAspect` substitutes the outline's own colour
  into those corners at pack time, making the mix an identity — the same trick as
  `packOutlineAspect` zeroing alpha at zero width.
- **Per-run `outline.color` seeds the run's `innerColor`.** Otherwise a run that
  only recoloured the outline would ramp into whatever inner colour the *object*
  had. `applyStyleToGlyph` mirrors the object-level "inner defaults to color".

#### The `shadowToneBias` byte — considered, rejected

A knob controlling where the shadow's colour ramp crosses over, instead of the
fixed square. It looked free: a shadow quad never has an outline width, so
`params.b` is idle on exactly the quads that could use it, and the shader could
mask it out of `widthNorm` with `isShadow = step(0.5/255, softNorm)`.

**It is not sound.** `softness` is per-corner, so `isShadow` is a per-corner
interpolated value, and a soft-on-one-side shadow (a supported effect) crosses its
threshold *inside the quad*. `widthNorm` would then fade the bias byte in as a
phantom outline width and the shadow would grow a spurious band across the middle
of the glyph. This is the garbage-bitfield failure the whole `params` design
avoids: GLSL ES 1.00 has no `flat` qualifier.

The general rule this settles, worth stating once: **an interpolated channel may
weight a blend between two behaviours that agree at its endpoints, but it may
never select how another channel is decoded.** `tone = mix(tone, tone*tone,
softStep)` is safe — both curves are monotonic and agree at `0` and `1`, so any
intermediate `softStep` yields a valid ramp. `widthNorm *= 1.0 - isShadow` is not.
The one selector in the format (`solid`) is safe only because it is uniform across
its quad by construction and carries a byte of guard band on each side.

Rescuing it would mean zeroing the bias whenever *any* corner's softness is zero —
a per-quad scan that also kills per-corner bias, which was the only reason to put
it in a vertex attribute. And the effect it buys is narrow: `tone` is a monotonic
remap of a two-colour lerp, so almost everything an animated bias expresses is
already reachable by animating `innerColor` / `color`, which take any hue path
rather than sliding one boundary. Its inward end is degenerate (it pushes the hot
core under the opaque fill), and it cannot make a ring — that needs a
non-monotonic function, not a remap. Revisit only with a concrete effect that the
colour endpoints demonstrably cannot express.

### ~~Highlight pills~~ — **built**

`setHighlight(spec)` at the object level, `highlight` on the decoration lane of
every style layer. A pill is a `solid` quad whose three idle `params` bytes carry
a corner radius, a border width and an edge blur, all read by a rounded-box SDF in
the fragment shader.

The sketch's guess — that `rectQuad`'s `0..1` UVs, added only to keep `fwidth()`
finite, were "exactly what a UV box-SDF needs" — held, and better than expected:
`1.0 / fwidth(outTexCoord)` *is* the rect's screen size in pixels, so the pill
needed no attribute, no uniform and no draw call the decorations didn't already
have. `screenPxRange()` was inlined because both lanes want that same vector.

What the build settled beyond the sketch:

- **The two lanes are one expression.** A glyph's outline layer is a pill's border
  ring, and a glyph's fill is the pill's face inset by that ring, so the solid lane
  computes the same `fill` / `outline` / `tone` triple against `-boxDist` that the
  glyph lane computes against `outlineDist - outlineEdge`, and the two `mix()` on
  `solid`. Two-tone therefore came along for free: a pill with `alpha: 0` and
  `borderWidth: 1` is a ring that fills its own body and ramps `borderColor` →
  `innerColor` across it — a glow blob, through the same gate a glowing shadow uses.
- **The three channels are fractions of the pill's half-thickness**, `min(w,h)/2`,
  which is the only length a quad knows about itself. That makes `radius: 1` a
  stadium at any size and lets the whole pill scale with the camera. They are
  continuous, so per-corner: a tab rounded only at the top, a pill blurred on one
  side.
- **The blur fades inward, not outward.** A glyph's shadow blurs symmetrically
  about its edge because a glyph quad has bleed room around the letterform; a rect's
  quad ends *exactly* at its box, so a centred blur loses its outer half to a hard
  clip — and takes the outer end of the two-tone ramp with it, which is why the
  first cut of the glow blob read as a single colour. Shifting the ramp inward by
  half its width makes the pill's box the outer bound of everything it draws.
  Inflating the quad instead was rejected: the inset would have to be a per-*quad*
  constant, and `softness` is per-corner, so the shader cannot recover it from an
  interpolated byte (this is the `shadowToneBias` failure again, one level up).
  `padding` — which the caller owns, and which may be negative — is the knob for
  giving a glow its room.
- **`solid` may select a decode; the other three bytes may not.** Re-reading `.g`
  as a radius rather than a rounding weight is exactly the thing the `params`
  format forbids — except that `weight = 255` is written to all four corners by
  construction, so it is uniform across the quad in the same way, and for the same
  reason, that the `solid` short-circuit itself is. This is the sole legitimate
  application of the rule stated under `shadowToneBias` below.
- **Merging is a union, not a split.** A highlight never inherits the fill colour
  (a slab of text-coloured paint behind the text would hide it), so unlike
  underline there is no colour-change split; and the vertical extent takes the
  highest ascender and deepest descender over the run, so a pill wraps mixed sizes
  and mixed fonts as one shape. Only a line break or a different spec starts a rect.
- **Underlines now antialias.** The solid lane's coverage is the box SDF's, which
  at a rect's boundary is `0.5` rather than the old flat `1.0`. Underlines and
  strikethroughs gained a half-pixel AA edge — a visible change to existing output,
  and an improvement at fractional positions and under rotation.
- **`fwidth` was replaced by the true gradient magnitude.** `|dFdx| + |dFdy|`
  overestimates by `|cos θ| + |sin θ|`, so `1/fwidth` *under*estimates the quad and
  scales the whole box space down. The shape survives — both axes take the same
  factor, so it is a uniform scale — but the antialiasing width, a constant `1.0`
  in that space, does not: a rotated edge softened to 1.41px, which reads as bad AA
  rather than as blur. `length(vec2(dFdx(u), dFdy(u)))` per axis is exact at every
  angle. The derivative fetches were already being paid, so the true cost is **two
  `sqrt` per fragment**; the glyph lane, which shares the vector, gets a sharper
  rotated edge out of it too.

### Dashed / dotted underline

**What:** `fract(u · n)` against the rect's own `0..1` U coordinate, thresholded
in the `solid` branch — same UV groundwork as the pill above. `n` (dash count)
needs to reach the shader per-rect.

**No longer free.** The sketch here assumed a `solid` quad's `rounded`,
`outlineWidth` and `shadowSoftness` bytes were all dead weight, so a dash count
could ride any one of them. Highlight pills spent all three (radius, border,
blur). Nothing is left.

**The escape is that `solid` is a sentinel *value*, not a bit,** and it currently
burns the whole range `[254, 255]` to mean one thing. Make weight byte `255` mean
"box/pill" and `254` mean "dashed", and the three payload bytes get reinterpreted
per variant — a dash count, a duty cycle, a cap radius. The guard-band question
that dominated the original sentinel design does not recur: the byte of guard
below `254` exists to stop a *glyph's* interpolated weight from crossing in, and a
real glyph still clips at `253`. Telling `254` from `255` is safe for exactly the
reason `solid` is safe — both are constant across their quad by construction, so
there is nothing to interpolate. (At `mediump` near `1.0` they are ~8 ULP apart
anyway.)

## From `rich-text-styling.md` — skew alternatives

**Bottom-pivot skew variant.** Today's skew always pivots on the layout
baseline (`Yb = baselineY`), which is the deliberate default (see
`rich-text-styling.md`'s "Skew + per-glyph scale" note — keeps a mixed-scale
line slanting as one line). The doc notes the same formula with `Yb = charY +
h` gives a bottom-pivot variant instead, which some callers may want (e.g.
skewing about a glyph's own visual base rather than the shared line baseline).
Not built; no API surface sketched (would need a mode flag or a second
`skewPivot` field on `GlyphState`).

**Shader-based skew.** Today's skew is a CPU-side matrix compose in
`submitOneGlyph`/`BatchMSDFChar`, chosen so no shader change was needed. A
shader-based version (skew factor riding a vertex attribute) stays possible if
we ever want skew decoupled from the CPU transform path — no concrete reason to
want that today.

## From `vertex-params.md` — decorations in the display callback

**What:** `displayCallback` and `GlyphState` cannot see or animate
underline/strikethrough — decorations resolve once (per source character,
through the style layers) into `_decorRects`, which live outside
`_characters`/`GlyphState` entirely. This was **frozen for day one, revisit
only with a real use case** (`vertex-params.md`, step C) — not a technical
wall, just scope discipline: `GlyphState` assumes one quad per renderable char,
and rects are a different shape. If a real use case shows up (animated
underline color following a tween, a "typewriter" strike-through reveal), the
rect array would need its own lightweight per-rect state object, seeded and
read back the same way glyphs are.

## Not on this list (explicitly rejected, not deferred)

For completeness — these were considered and the docs give a reason to *not*
revisit them without new evidence:

- **Tree-shaking the rich-text/vertex-params surface** — a few hundred bytes,
  Phaser's `Class` bundles prototype methods regardless. Revisit only on a real
  bundle-size measurement.
- **Splitting the shader into basic/dynamic variants** — different programs
  can't share a batch, defeating the point of batched text. Revisit only on a
  real perf measurement.
- **Cross-font glyph fallback** — a character missing from its run's font is
  skipped, never borrowed from another run's font. Consistency over
  cleverness; revisit only with real demand.
- **An analytic seed for `fitInside`'s binary search** (estimate `lo`/`hi` from
  `currentSize · boxW / measuredWidth` instead of the free `boxH /
  lineHeight` bound) — `fitInside` is a one-shot call, ~15 iterations to
  sub-pixel is already cheap. Only worth it if a profile says otherwise.
- **An object-level `setStyle(spec)` — "layer 0"** (`style-api-unification.md`
  question 5). Superficially cohesive: the same `StyleSpec` that segments and
  `addStyle` overlays take, seeding the object's own defaults. It doesn't work,
  for a reason that survives any amount of polish: **on a run, an absent key
  means "inherit"; at the object level, an absent key means "the default."**
  Same shape, opposite semantics — `setStyle({ color })` would have to leave the
  outline alone (matching every other spec layer) while looking exactly like a
  call that resets the object to one colour. It also drags in keys no spec has
  (`outlineLayered`, `perGlyphShadow`, the `-1` sentinel on `outlineInnerColor` /
  `shadowInnerColor`), and every object-level field is already a plain,
  directly-tweenable field with a chainable `set*` wrapper. Revisit only if the
  object level stops being the seed for the spec layers.
