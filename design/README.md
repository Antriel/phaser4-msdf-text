# Planned features — design & implementation docs

Design specs for two new capabilities, worked out in a design session and
frozen here so a fresh session can implement them without re-deriving the
decisions. Each doc is self-contained: motivation, API, algorithm, the exact
files/methods to touch, edge cases, and how to verify.

## The two features

1. **`fitInside(rect, options)`** — size text to fit a box, reflowing (not just
   scaling). Fully independent of everything else.
2. **Rich text** — per-run styling (colour, alpha, gradient, outline, shadow,
   scale, skew) without markup in the string, via structured segments and
   imperative range/word helpers.

## Implementable units (Phase 1) and landing order

```
rich-text-provenance.md ── foundational; builds the `computeWrap` seam
        │
        ├──► fit-inside.md          (consumes computeWrap(.., fontSize).text)
        │
        └──► rich-text-styling.md   (needs srcIndex for source→glyph mapping)
                 └─ skew: self-contained, can land at any time
```

**Recommended landing order: provenance → fit-inside → styling.** Only
provenance is a hard dependency for styling; fit-inside is technically
independent — but it needs `wrapText` parameterised by font size, and
provenance's `computeWrap` *is* that seam. Land provenance first and the seam
is built exactly once, with nothing to coordinate.

- **`rich-text-provenance.md`** — foundational. Adds `srcIndex` / `line` /
  `srcLine` to each glyph and fixes the bug where word-wrap's inserted newlines
  corrupt source-position counting. Independently valuable; the styling API
  builds on it.
- **`fit-inside.md`** — standalone apart from the `computeWrap` seam above.
- **`rich-text-styling.md`** — the `setRichText` / `setTextStyle` /
  `addStyleRange` surface (three entry points by style lifetime). Depends on
  provenance for source→glyph mapping. Also contains the **skew** feature,
  which has no dependency on the rest and can land at any time.

All three of the above are **implemented**, as is:

- **`vertex-params.md`** — the `params` vertex attribute (steps A–C): per-glyph
  outline width / rounded / shadow softness, faux weight, underline and
  strikethrough. See Phase 2 below.

## Phase 2 — status

**2a (per-run size, `fontScale`) is implemented.** Structural keys live on
`SegmentSpec` *and* `setTextStyle`'s new `RuleStyleSpec` (the refinement in
`rich-text-styling.md` superseded the original "segments only" call); ranges and
`displayCallback` stay appearance-only. Per-run size is a **multiplier** on the
object `fontSize`, which is what keeps `setFontSize` and `fitInside`'s monotone
binary search coherent. The metrics refactor landed as `_sizeScales` (a
source-indexed `Float32Array`, `null` on the uniform fast path) threaded through
`wrapLines` → `MSDFFont.measureLines` → `rebuildText`, with `measureLines` now
returning per-line `baselines[]`. Kerning is skipped across a size boundary.
Batching was untouched, exactly as predicted.

**`vertex-params.md` (steps A–C) is implemented.** The `params` byte4 landed as
designed: four uniforms and the four shader modes are gone, `uPxRange` +
`uAtlasSize` collapsed into `uUnitRange`, `configurePass` became
`configureFont(unitRange)` (fixing the latent multi-font uniform-ordering bug),
and the fill-over-outline composite replaced the `mix`. A shadowed, outlined,
underlined text is one draw call. `rounded` stayed a bit; the sentinel trick that
would free a continuous byte for per-corner `rounded` is still deferred.
`GlyphState` and `StyleSpec` gained `weight`, `outline.width`, `outline.rounded`
and `shadow.softness` (per-corner where continuous), plus `underline` /
`strikethrough` and the object-level `weight` / `setUnderline` /
`setStrikethrough`. Demo: `examples/scenes/vertex-params.ts`.

Two implementation notes not in the design doc, both forced by per-glyph width:

- **Outline width 0 must zero the outline alpha at pack time.** At zero width the
  outline edge coincides with the fill edge, so the outline layer would otherwise
  fringe every unoutlined glyph's antialiased edge. `packOutlineAspect` in the
  renderer does this; the shader stays branch-free. A shadow quad is exempt — it
  is an outline-only quad *with* width 0, and needs its alpha.
- **Decoration colours are resolved at submit time, not baked.** A rect stores
  `undefined` for an inherited colour/alpha and the renderer fills in the
  object's live values, so tweening the text's colour drags an inherited
  underline along with it.

**Still out of scope:**

- **Per-run font (2b)** — `rich-text-styling.md`, "Phase 2".

The **2a/2b split held for a sharper reason than "size is cheaper"**: the shared
"variable line-metrics" refactor turned out to be *all* of 2a and *none* of the
hard part of 2b. 2b's cost is in the renderer and loader, not the metrics —
`_characters` grow a font reference, the style layer starts resolving font keys
against the cache, and the renderer gains its first per-glyph flush gate. None of
that got cheaper by riding along with 2a.

**Why `vertex-params.md` went first.** It was a *subtractive* refactor — it
deleted four uniforms, collapsed the four shader modes into one, and removed
every uniform-driven batch flush, shipping a draw-call win with no API change.
Per-run font is purely additive. And it corrected a claim this file used to make:
per-run fonts do **not** make `uPxRange`/`uAtlasSize` per-glyph. Once outline
width and shadow softness are normalised as fractions of `distanceRange`,
`uPxRange` cancels out of every shader branch and survives only as a per-texture
ratio. **Per-run font is a texture-binding problem and nothing else** — and the
gate is already built: `configureFont(unitRange)` replaced `configurePass` and
fixed the live multi-font uniform-ordering bug on the way. 2b's renderer work is
just extending that gate to switch textures.

Remaining frozen calls for 2b: kerning only between glyphs sharing a font *and*
size; one über-shader throughout (variant programs can't share a batch); no
cross-font glyph fallback (a char missing from its run's font is skipped, same
as today); the first draft may simply flush on texture change — the
merged-atlas (`-and`) single-batch path is a later optimisation.

## Locked design decisions (rationale lives in the docs)

- `fitInside` is **shrink-only by default** (`maxFontSize` defaults to the
  current `fontSize`); pass a larger `maxFontSize` to allow growth.
- `fitInside` takes a single `RectLike` argument (our own type), not an
  overload and not scattered `x/y`. `x/y` optional ⇒ absent means size-only.
- Alignment is expressed as string unions (matching the rest of the API), never
  Phaser `Align` constants.
- The per-glyph model is split into two lanes: **appearance** (seeded into
  `GlyphState`, per-frame safe, animatable — colour/alpha/outline/shadow/scale/
  rotation/skew) vs **structural** (changes layout, rebuild-only — `fontScale`,
  and `font` in 2b). `displayCallback` stays appearance-only.
- The shader stays a single über-shader, and `params` channels are per-corner
  where continuous but per-glyph where packed (GLSL ES 1.00 has no `flat`).
  Rationale in `vertex-params.md`.
- Rich-text styles have **three lifetimes**: content segments (`setRichText`,
  replaced with the text), persistent rules (`setTextStyle` — renamed from
  `setWordStyle`; re-matched on every text change), and transient ranges
  (`addStyleRange` — dropped on any text change, handles die; **no clamping**
  of stale ranges). Paint order = increasing dynamism: segments → rules →
  ranges → `displayCallback`, key-by-key.
- Handle updates coalesce through a `_stylesDirty` flag (one re-seed per tick);
  a styles re-seed in manual mode emits `'glyphsreset'` once per tick.
  `clearStyles()` removes rules + ranges (segments are content, not policy).
- Segments are resolved at `setRichText` call time (no reference kept); the
  update path is calling `setRichText` again — unchanged concatenated text
  skips relayout.
- `fitInside` placement requires `x` **and** `y` (one alone ⇒ size-only); the
  chosen size is fractional by design; `lineSpacing`/`letterSpacing`/shadow
  offsets don't scale with the fitted size (doc-only).
- Skew pivots on the **baseline**, computed on the CPU (no shader needed) —
  and stays on the *layout* baseline even when per-glyph scale moves the
  glyph's visual baseline (keeps a mixed-scale line slanting as one line).
- Each feature lands with a demo page in `examples/` — that is the
  verification artifact, per the repo's convention.
