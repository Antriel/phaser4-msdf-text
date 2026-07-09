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

### Two-tone shadows / glows

**What:** since the shadow-colour migration (a shadow quad is an outline-only
quad — fill alpha 0, shadow colour in `inOutline`), a shadow quad's **fill**
attribute (`inColor`) rides along unused. Feed it a second colour and blend
`mix(outerColor, innerColor, coverage)` in the shadow/outline branch — a glow
that shifts hue outward (white-hot core → orange halo), per-corner on both
colours, batched, free (no new attribute, no new draw call).

**Where it'd land:** the outline/shadow branch in `MSDFBatchHandler.ts`'s
fragment shader; `GlyphShadow` would need a second colour field (or reuse
`fill.color` on the shadow quad — needs a design decision, since today
`fill.color`/`fill.alpha` on a `GlyphState` mean "the glyph's own face").
`examples/scenes/glow.ts` is the natural demo to extend.

### Two-tone outlines

**Same trick, on the layered-outline silhouette pass.** When `outlineLayered`
is set, the silhouette-submission pass zeroes the fill attribute
(`zeroOutline`-style) — that attribute is unused for the same reason as the
shadow case above. Ramping outline colour from inner edge to outer edge (a
"chalk outline" / neon-tube look) is the same `mix(outerColor, innerColor,
coverage)` idea, reusing the same unused slot.

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
