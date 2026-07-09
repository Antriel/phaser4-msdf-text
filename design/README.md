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

Everything below is implemented. Cheap follow-ups that surfaced along the way
but were deliberately left unbuilt are collected in
**[`future-ideas.md`](./future-ideas.md)** rather than scattered across these
docs — read that one when looking for the next small thing to build.

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

**Everything in Phase 2 is implemented, including step E** (the merged atlas).

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
would free a continuous byte for per-corner `rounded` is still deferred (see
`future-ideas.md`).
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

**2b (per-run font) is implemented.** `font` (an `msdfFont` cache key) joined
`fontScale` on `SegmentSpec` and `RuleStyleSpec`. It landed exactly as the split
predicted: `_characters` grew a `fontIdx`, the style layer resolves font keys
against the scene cache (in `MSDFText.buildFontMap`, not in the `this`-free
`resolveStyle`), and the renderer gained its first per-glyph flush gate. The
metrics refactor 2a built carried none of that weight.

Measurement moved out of `MSDFFont` into `src/MSDFMeasure.ts` as free functions
over a `LayoutRuns` (`{ base, scales, fonts, fontList }`, both maps `null` on the
uniform fast path) — the one architectural move the doc said 2b would force.
`maxScaleIn` became `lineMetrics`, which maximises ascent and line height
**independently** (with mixed fonts they can come from different runs; with one
font they can't, so single-font layout is unchanged). The renderer resolves one
`FontBinding` per font and only touches the gate inside the loops when the text
actually has more than one — so the single-font path is byte-for-byte the pre-2b
one. Demo: `examples/scenes/per-run-font.ts`.

Three things the design doc didn't anticipate:

- **Line metrics need two independent maxima**, not one "max metric on this line".
- **Decoration rects grew a `fontIdx`.** Underline position/thickness are
  font-relative, so a rect splits at a font boundary — and carrying the run's
  texture keeps a `solid` quad from forcing an extra flush.
- **`refreshStyleState` must rebuild `_runFonts` unconditionally**, because
  `setFont` swaps slot 0 out from under an otherwise unchanged `_fontMap`.

**Step E (merged `-and` atlas) is implemented.** `MSDFFontParser` gained
`parseMSDFFontSet`, which reads a JSON's `variants` array (one entry per
`-font ... -and -font ...` input, each named by that font's `-fontname`) and
returns one `MSDFFontData` per variant — a plain single-font JSON still yields
exactly one entry, so `MSDFFontFile.addToCache` calls it unconditionally.
Every variant is registered in the `msdfFont` cache under its own name, all
constructed with the **same** `textureKey`, since the atlas is uploaded once
for the whole file. No renderer change was needed, exactly as predicted:
`MSDFFont.textureKey` was already the renderer's only flush signal (2b), so
two fonts sharing one texture already batched — the merged atlas just makes
that the common case instead of an edge case. The one non-obvious bit: the
loader's pre-queue dedup (`addMSDFFont`) used to check
`msdfFontCache.has(key)`, but a merged file's `key` is only ever a texture
load key now, never itself a cache entry — switched to
`textureManager.exists(key)`, which is accurate for both the single-font and
merged cases since `textureKey` always equals the load `key`. Demo: the
existing `examples/scenes/per-run-font.ts` runs unmodified against a merged
atlas (`examples/harness/fonts.ts`), confirming mixed-font text collapses to
one draw call.

**Why `vertex-params.md` went first.** It was a *subtractive* refactor — it
deleted four uniforms, collapsed the four shader modes into one, and removed
every uniform-driven batch flush, shipping a draw-call win with no API change.
Per-run font is purely additive. And it corrected a claim this file used to make:
per-run fonts do **not** make `uPxRange`/`uAtlasSize` per-glyph. Once outline
width and shadow softness are normalised as fractions of `distanceRange`,
`uPxRange` cancels out of every shader branch and survives only as a per-texture
ratio. **Per-run font turned out to be a texture-binding problem and nothing
else** — the gate was already built: `configureFont(unitRange)` replaced
`configurePass` and fixed the live multi-font uniform-ordering bug on the way. 2b's
renderer work was extending that gate to switch textures, as predicted.

Frozen calls that shipped as written: kerning only between glyphs sharing a font
*and* size; one über-shader throughout (variant programs can't share a batch); no
cross-font glyph fallback (a char missing from its run's font is skipped, same as
a missing char always was); flush on texture change — the merged-atlas (`-and`)
single-batch path is a later optimisation (step E).

## Locked design decisions (rationale lives in the docs)

- `fitInside` is **shrink-only by default** (`maxFontSize` defaults to the
  current `fontSize`); pass a larger `maxFontSize` to allow growth.
- `fitInside` takes a single `RectLike` argument (our own type), not an
  overload and not scattered `x/y`. `x/y` optional ⇒ absent means size-only.
- Alignment is expressed as string unions (matching the rest of the API), never
  Phaser `Align` constants.
- The per-glyph model is split into two lanes: **appearance** (seeded into
  `GlyphState`, per-frame safe, animatable — colour/alpha/outline/shadow/scale/
  rotation/skew) vs **structural** (changes layout, rebuild-only — `fontScale`
  and `font`). `displayCallback` stays appearance-only.
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
