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

### The `rounded` sentinel trick (frees a continuous per-corner byte)

**Who benefits: real glyphs' outline/shadow rendering — not the rects.** The
rects (`solid` quads) are only the *enabler* below; they gain nothing from this
themselves. The payoff is that a normal glyph's outline or shadow could get a
per-corner `rounded` gradient (one corner sharp-MSDF, the opposite corner
rounded-SDF, or animated over time) instead of today's all-or-nothing
per-glyph switch.

**What:** `params.g` (`flags`) is a bitfield — `PARAM_ROUNDED | PARAM_SOLID` —
and bitfields can't be per-corner (GLSL ES 1.00 has no `flat` qualifier, so an
interpolated bitfield is garbage). That forces `rounded` to be constant across
all four corners of a quad, even though the shader already treats it as
continuous (`mix(median(rgb), tsdf, rounded)`) and a genuinely per-corner value
would blend sharp-MSDF into rounded-SDF beautifully.

**The unlock:** `solid` quads (underline/strike rects) never use `weight`,
`outlineWidth` or `shadowSoftness` — the shader short-circuits their coverage to
`1.0` before those channels are read at all. So `solid` could be signalled by a
**sentinel value** in one of those three channels instead of a dedicated bit in
`flags` (e.g. reserve `weight`'s top byte value to mean "this is a solid quad";
the shader checks that channel first and only falls through to normal per-glyph
math otherwise). A constant sentinel is safe under interpolation for the same
reason a bitfield isn't — a rect's four corners already carry identical values
by construction, so there's nothing to interpolate. That frees `flags` down to
a single remaining job (`PARAM_ROUNDED`), which then no longer needs to *be* a
bitfield — `params.g` can become the raw continuous `rounded` byte directly,
decoded exactly like `outlineWidth`.

**Open problem, not resolved by the original design doc:** picking the sentinel
isn't free. `packParams` saturates (`toByte(weightNorm * 255 + 128)` clamps at
both ends), so byte value `255` in `weight` already means "any weight strong
enough to clip" — not a unique, otherwise-impossible input. Reserving `255` as
the solid-sentinel means real text at max faux bold would misread as a solid
rect. Whichever channel/value is chosen needs either a value that legitimate
glyph data genuinely can't produce, or a deliberate, documented sacrifice of
that channel's extreme (arguably fine for max faux bold, which is already a
degenerate, glyphs-overlap extreme — but that's a call for whoever builds this,
not a settled decision).

**Cost:** `packParams`/the shader's flag decode need a branch on the sentinel
instead of a mask check; `PARAM_SOLID` disappears as a constant. Contained to
`MSDFColor.ts` (`packParams`, `PARAM_ROUNDED`/`PARAM_SOLID`) and the fragment
shader's flag decode in `MSDFBatchHandler.ts`.

**Prerequisite:** none — everything it touches already exists. Confirmed still
current: `PARAM_ROUNDED = 1`, `PARAM_SOLID = 2` in `src/MSDFColor.ts`.

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
count) would need to reach the shader per-rect, which the current `params`
byte4 has no free channel for on a `solid` quad *unless* combined with the
`rounded`-sentinel trick above (freeing a channel on `solid` quads specifically,
since they don't need `weight`/`outlineWidth`/`shadowSoftness` today).

**Dependency:** cleanest if done after the `rounded` sentinel trick, since that
establishes the pattern of repurposing a `solid` quad's unused channels.

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
