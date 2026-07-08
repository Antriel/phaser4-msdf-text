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

## Phase 2 (out of scope for the first cut)

The "variable line-metrics" phase, sketched at the end of
`rich-text-styling.md`: per-run **size** and per-run **font** (both change
layout, share the same metrics refactor, and — for `font` — batch only when
runs share a texture + `distanceRange`), plus optional faux **weight** (needs
a vertex attribute + shader threshold) and **underline/strikethrough**
(needs run-span geometry + a solid-colour path). Key calls, frozen in that
doc's "Phase 2 insights": split into **2a size / 2b font** (size is pure
layout math, no batching impact); per-run size is a **multiplier** on the
object `fontSize` (keeps `fitInside` and `setFontSize` coherent); structural
keys live on `SegmentSpec` only; the `params` vertex byte4 is fully allocated
(weight, solid/rounded flags, outline width, shadow softness — promoting
today's per-batch uniforms to per-glyph state); one über-shader throughout
(variant programs can't share a batch); 2b first draft may simply flush on
texture change — the merged-atlas (`-and`) single-batch path is a later
optimisation.

## Locked design decisions (rationale lives in the docs)

- `fitInside` is **shrink-only by default** (`maxFontSize` defaults to the
  current `fontSize`); pass a larger `maxFontSize` to allow growth.
- `fitInside` takes a single `RectLike` argument (our own type), not an
  overload and not scattered `x/y`. `x/y` optional ⇒ absent means size-only.
- Alignment is expressed as string unions (matching the rest of the API), never
  Phaser `Align` constants.
- The per-glyph model is split into two lanes: **appearance** (seeded into
  `GlyphState`, per-frame safe, animatable — colour/alpha/outline/shadow/scale/
  rotation/skew) vs **structural** (changes layout, rebuild-only — `fontSize`,
  `font`; Phase 2). `displayCallback` stays appearance-only.
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
