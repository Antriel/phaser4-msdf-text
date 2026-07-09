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

### Highlight pills

**What:** step C's decoration-rect machinery already gives every `solid` rect
real `0..1` UVs across its own quad (`rectQuad` in
`MSDFTextWebGLRenderer.ts:90`) — added originally just to keep `fwidth()`
finite, but it's exactly what a UV box-SDF needs. A padded rect behind a word
(inset the rect a few px in each direction) plus a rounded-box SDF in the
fragment shader (only active when `solid` is set) gives a rounded, optionally
soft marker-highlight/pill behind a run of text — the "damage number" pill
look — for the cost of a rect variant, no new draw call.

**Where it'd land:** a new rect kind alongside `_decorRects` (or a flag on the
existing one), a box-SDF branch gated on `solid` in the fragment shader, and
API surface analogous to `setUnderline`/`setStrikethrough` (`setHighlight`? —
needs padding/corner-radius fields, unlike underline which is metric-derived).

### Dashed / dotted underline

**What:** `fract(u · n)` against the rect's own `0..1` U coordinate, thresholded
in the `solid` branch — same UV groundwork as the pill idea above. `n` (dash
count) needs to reach the shader per-rect.

**Now unblocked:** the sentinel trick above established that a `solid` quad's
`rounded`, `outlineWidth` and `shadowSoftness` channels are all dead weight —
the shader short-circuits coverage before reading any of them. A dash count can
ride any one of the three (`outlineWidth`'s byte gives 255 dashes at double
precision). Only `weight` is spoken for, since it carries the sentinel itself.

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
