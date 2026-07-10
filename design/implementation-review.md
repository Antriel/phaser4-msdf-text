# Implementation review — design docs vs. code (2026-07)

A full pass comparing every doc in `design/` (and the claims `CLAUDE.md` makes)
against `src/` as of `4f7a03d` (branch `fit-inside-and-rich-text`). The bottom
line: **the implementation matches the designs** — every load-bearing claim
checked out (the list is at the end, so this doubles as a sanity-check record).
What follows is the small stuff: one real behavioural bug, a few sharp edges and
stale doc lines, and three performance candidates relevant to the old-Android
regression noted during development.

> **Status (follow-up pass):** bugs 1–5 and the stale doc lines are **fixed**.
> Performance **A is implemented** (the shader now branches). **B and C are not**,
> deliberately: neither runs in the `performance.ts` stress scene — B is wrap
> (spawn-time only, and that scene never wraps), C needs styled runs plus a
> display callback (that scene has neither). They stay on the shelf until a
> profile of a *wrapping* or *styled-callback* text asks for them.

## Bugs / sharp edges

### 1. `editGlyphs()` / `resetGlyphs()` don't consume a pending `_stylesDirty` — the next render clobbers fresh manual edits

`editGlyphs` (`MSDFText.ts:1129`) handles `_dirty` but not `_stylesDirty`:

```
setUnderline(...)        // or color = …, handle.update(…) — sets _stylesDirty
const glyphs = text.editGlyphs();   // seeds a correct array… but the flag stays set
glyphs[3].setFillColor(0x0000ff);   // manual edit
// next render: _stylesDirty → applyStylesDirty → prepareGlyphStates
//   → the edit is wiped and 'glyphsreset' fires for no user-visible reason
```

The array `editGlyphs` returns is already freshly seeded *and* styled, so the
pending flag has nothing left to apply — except `rebuildDecorations`, which is
the one thing that must still run. Fix sketch, for both `editGlyphs` and
`resetGlyphs` (`MSDFText.ts:1141`):

```ts
if (this._dirty) {
    this.rebuildText();                 // clears _stylesDirty via refreshGlyphs
} else if (this._stylesDirty) {
    this._stylesDirty = false;
    this.rebuildDecorations();          // the only work prepareGlyphStates doesn't cover
}
```

Narrow window (a style/decoration change and an `editGlyphs` in the same tick),
but it violates the manual-mode contract: the user made no restyle request
between their edit and the reset.

### 2. `setFont`'s `align` parameter — stale numeric typing and JSDoc

`MSDFText.ts:785` types it `align?: number` and the JSDoc says "alignment
(0/1/2)". Everywhere else — the constructor, the `align` accessor, the public
`MSDFTextInstance.setFont` — alignment is the `MSDFAlign` string union, per the
locked decision in `design/README.md`. A JS caller following that JSDoc and
passing `1` gets silent left-alignment (`applyAlignment` compares against
`'center'`/`'right'` and matches nothing). Fix: type it `MSDFAlign` and reword
the JSDoc. Two-line change; no behaviour change for correct callers.

### 3. A styled shadow without `alpha` is invisible — document it

`seedGlyph` (`MSDFText.ts:1290`) seeds the glyph shadow alpha to `0` unless the
*object* has a shadow (deliberately, so unstyled glyphs draw nothing when the
shadow pass runs for a styled run's sake). Consequence: a run style of
`shadow: { color: 0xff0000, x: 2, y: 2 }` renders **no shadow** — the offsets
and colour land on a zero-alpha aspect, and `applyStyleToGlyph` only applies
present keys. Both example scenes that style shadows set `alpha` explicitly,
which is how this stayed invisible.

Auto-defaulting the alpha at resolve time would break key-by-key layering
(a later layer that sets only `shadow.x` must not smuggle an alpha in), so the
seed-side behaviour is right. The fix is one sentence in `README.md`'s rich-text
shadow section and on `StyleSpec.shadow`: *a styled shadow needs `alpha` (or an
object-level shadow to inherit it from).*

### 4. `fitInside`'s free upper bound assumes `lineSpacing >= 0`

The bound `hi = boxH / _maxLineUnit` (`MSDFText.ts:849`) relies on
"totalHeight ≥ tallest line ≥ size × maxLineUnit". With a **negative**
`lineSpacing` (legal everywhere else) `totalHeight` can undercut the tallest
line, so the bound can cap `hi` below a size that actually fits and `fitInside`
under-sizes. The same caveat applies to the doc's monotonicity argument
(negative letter/line spacing makes the fit predicate only *approximately*
monotone). Cheap guard: only apply the `boxH / _maxLineUnit` clamp when
`this._lineSpacing >= 0`; otherwise start from `maxFontSize`. Or document
negative spacing as unsupported inside `fitInside` — either is fine, currently
it is silently wrong in a corner nobody has hit.

### 5. `_missingFontWarned` gates two unrelated warnings

In `buildFontMap` (`MSDFText.ts:603-621`) the missing-font warning and the
">255 distinct fonts" warning share one flag, so whichever fires first
suppresses the other. Trivial; split the flag if it ever matters.

## Performance candidates

Context: measurable frame cost appeared on old Android when `inParams` widened
the vertex, and again as features grew the fragment shader. None of this is
urgent — but if a profiling pass happens, these are the three places to look,
in order. All three keep the locked decisions intact (one über-shader, one
batch, no variant programs).

### A. Branch the fragment shader on `solid` — it is dynamically uniform per quad

Today every **glyph** fragment also evaluates the whole solid lane
(`roundedBox` with its `length()`, three clamps) and every **rect** fragment
evaluates the whole glyph lane, then they `mix()` on `solid`
(`MSDFBatchHandler.ts:144-180`). But `solid` is constant across any one quad
*by construction* — that is the entire sentinel design — so
`if (outParams.r >= 254.0/255.0)` is dynamically uniform per primitive:
no divergence inside a triangle, one program, one batch. The texture fetch and
all derivative work (`duvdx`/`duvdy`/`screenTexSize`/`px`) stay above the
branch; each side then produces the same `(fillCoverage, outlineCoverage,
tone, fade)` quadruple and the composite below is shared.

This is exactly the "revisit only on a real measurement" bar the design docs
set — `examples/scenes/performance.ts` on the old-Android device is the
measurement. Expected win: ~a dozen ALU ops per glyph fragment, which is the
bulk of what pills added to the per-fragment cost. (Honesty caveat: on very old
GPUs branches are not free; if the measurement says no, the mix stays.)

Side benefit: on devices without `GL_FRAGMENT_PRECISION_HIGH` (mediump
fragments — the same old-Android class), `roundedBox` evaluated on a *glyph*
quad works on atlas-scaled coordinates (`(uv − 0.5) × screenTexSize`, which at
deep zoom reaches tens of thousands) and its `length()` squares them — past
`~65504` that overflows mediump. Today the garbage is mixed out by `solid = 0`
and clamps, so nothing visible is known to break, but the branch removes the
undefined arithmetic instead of relying on it staying benign.

**Implemented.** The `mix()` triple became an `if (outParams.r >= 254.0/255.0)`
with `fillCoverage` / `outlineCoverage` / `tone` / `fade` declared above it and
assigned by whichever side runs. `texture2D`, `dFdx`/`dFdy` and `screenTexSize`
stay above the branch (uniform control flow, as implicit-LOD sampling requires);
`px` moved down into the glyph lane, its only consumer. The shared tail —
`tone = mix(tone, tone*tone, softStep)`, the two-tone gate, the composite — is
byte-for-byte the arithmetic it was, so output is unchanged on both lanes.

`performance.ts` is **fill-rate bound**, which is the evidence for A: at 5000
texts / 21817 glyphs the baseline was ~25 FPS portrait and ~19 FPS landscape.
The glyph count is identical in both; only the pixels each quad covers changed.
A CPU-bound scene would not care about the aspect ratio.

### B. `wrapLines`'s `measure()` re-walks the line at every word boundary — *not done*

`MSDFTextWrap.ts:70-93` measures `committed line + pending word` from scratch
each time a wrap char or paragraph end is hit — O(line²) per line for long
lines. Parity with the old string-based wrapper (which measured
`currentLine + word` the same way), so not a regression — but it is the
dominant cost of a rebuild on long paragraphs, and `fitInside` multiplies it by
~15 bisection iterations. The indices-first shape makes an incremental version
straightforward: carry the committed line's width, the pending word's width,
and the boundary kern between the last committed char and the first word char
(each updated in O(1) per character); the soft-break trim needs only the
width of the trailing run of wrap chars, also trackable incrementally. Wrap
becomes O(n) with identical output — the three-way advance/kerning agreement is
unaffected because the arithmetic per character is unchanged, only cached.

Invisible to `performance.ts`: those texts are single short words with no
`maxWidth`, and they are built once at spawn, not per frame. The scene that would
show this is a long wrapped paragraph, especially under `fitInside`.

### C. `applyRun` scans every glyph for every run — per frame in callback+styles mode — *not done*

`MSDFText.ts:1218` is O(runs × glyphs) per re-seed, which the styling design
accepted for typical counts — but in **callback** mode with styles it runs every
frame. `_characters` (hence the glyph array) is monotone in `srcIndex`, so each
run's span is a contiguous window: binary-search the start and break when
`srcIndex >= end`. Only worth doing if a profiled text actually combines a
display callback with many styled runs. `performance.ts` is not that text: it has
no styles and no display callback, so it never leaves static mode and `applyRun`
is never called.

## Stale doc lines (design docs and code docs) — *all fixed*

- **`design/rich-text-styling.md:35`** — "per-run `font` (2b) is still open —
  see the end" contradicted the doc's own status header (2b implemented). The
  "as shipped" paragraph about `outline`/`shadow` omissions was likewise reworded
  to say it describes the *first* shipped state.
- **`src/MSDFTextTypes.ts`** (the `StyleSpec` doc comment) — "a per-run
  `font` is still unimplemented". It shipped; `RuleStyleSpec.font` two screens
  below documents it correctly.
- `design/vertex-params.md` still describes `.g` as a flags bitfield and
  "`rounded` stays a bit on day one" — that doc is explicitly historical and
  `future-ideas.md` records the supersession, so no change needed; noted here
  only so nobody "fixes" it.

## Verified correct (the sanity-check record)

Checked claim-by-claim against the shader, packers, renderer and text object;
all of these hold:

- **Packing/decoding round-trip** — the shader decodes `inParams` as the exact
  inverse of `packParams` (neutral weight `128/255`, width byte spanning
  `[0, 0.5]` at ×510, softness full-range); glyph weight clips at byte `253`,
  shader splits at `254/255`, rects write `255` to all four corners.
- **AA** — canonical `screenPxRange()` from texcoord derivatives, with true
  per-axis gradient magnitude (not `fwidth`), 1-px floor; one `screenTexSize`
  serving both lanes; solid-lane coverage is the box SDF's (antialiased
  underlines).
- **Composite** — honest fill-over-outline with exact degenerate cases; fill
  always `median(rgb)`; outline/shadow layer `mix(msdf, tsdf, rounded)`;
  `fade` suppressed by softness and forced to 1 on solid.
- **Two-tone** — zero-fill-alpha gate; `tone` normalised by
  `max(widthNorm, softNorm/2)` with the linear↔squared blend on `softStep`
  (a blend between behaviours that agree at both ends — never a selector); the
  combined-quad leak plugged at pack time (`packFillAspect`,
  `packRectCorner`); `seedGlyph` resolves the `-1` sentinel so `GlyphState`
  never carries it; a run's `outline.color`/`shadow.color` re-seeds that run's
  `innerColor`; `outlineInnerColor >= 0` forces layering.
- **Flush discipline** — `configureFont` flushes before setting `uUnitRange`;
  single-font texts configure once outside the loops; the texture is
  `batch()`'s own gate; decoration rects carry their run's `fontIdx`/texture.
- **Measurement agreement** — `wrapLines`, `measureSpan` and `rebuildText` make
  identical advance/kerning calls (kern only within same font *and* scale;
  missing chars skipped, never borrowed; `fontIdx` equality ⟺ font identity
  because `buildFontMap` dedups by object). Line ascent and box height are
  maximised independently; blank lines take base-font metrics.
- **MTSDF clamps** — per *binding* at pack time (static and per-glyph paths);
  object-level `setOutline`/`setShadow` warn once, per-run styles clamp
  silently.
- **Style lanes** — appearance/structural/decoration gating
  (`refreshStyleState` compares scales, font map *and* font list — the
  `setFont`-swaps-slot-0 case); ranges strip structural keys for JS callers
  with a one-time warning; handle lifecycle (`_rangeGen`), coalescing, and
  paint order (segments → rules → ranges → callback) all as specified.
- **Decorations** — split rules (line / `fontScale` / `font` / inherited-colour
  identity), submit-time resolution of inherited colour, highlight union with
  em-relative (and legally negative) padding, `PASS_*` back-to-front order,
  zero-size rects not emitted.
- **`fitInside`** — matches the spec: shrink-only default, both-dimension
  predicate, `computeWrap` at the candidate size with run-aware measurement,
  `_maxLineUnit` upper bound (generalising the doc's single-font
  `lineHeight`), fractional result, both permanent mutations, origin-robust
  `placeInBox` with the partial-anchor dev-warn.
- **Loader** — `pma = false` upload path; merged-atlas variants registered under
  their own names sharing one `textureKey`; pre-queue dedup via
  `textureManager.exists`.
