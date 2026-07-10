# Style API unification — one spec, one overlay primitive

**Status: proposal** — nothing here is implemented. Written as the answer to:
do `addStyleRange` and the segments/rules API need different specs
(`StyleSpec` vs `RuleStyleSpec`)? Can the four styling entry points be unified
into a more cohesive API without losing the performance the appearance/
structural split bought — and is there performance to *gain*?

Short answers, argued below: **no, the two specs don't need to differ** — the
restriction on ranges guards a boundary that moved out from under it; **yes,
unify** — one spec across all three declarative layers (Tier 1), and optionally
one `addStyle` primitive replacing `setTextStyle`/`addStyleRange` (Tier 2); the
unification is **performance-neutral** for every existing path, with one small
win available and the real perf candidates already catalogued in
`implementation-review.md`.

## What the split actually is today

The four entry points, inventoried. The styling pipeline is
**segments → rules → ranges → `displayCallback`**, painted key-by-key:

| | segments (`setRichText`) | rules (`setTextStyle`) | ranges (`addStyleRange`) | callback / `editGlyphs` |
|---|---|---|---|---|
| spec type | `SegmentSpec` | `RuleStyleSpec` | `StyleSpec` | `GlyphState` mutation |
| appearance keys | ✓ | ✓ | ✓ | ✓ |
| decoration keys | ✓ | ✓ | **✓** | ✗ (`future-ideas.md`) |
| structural keys | ✓ | ✓ | **✗ stripped + warn** | ✗ (no fields exist) |
| lifetime | replaced with content | persistent, re-matched | dropped on text change | per-frame / user-owned |
| handle | none (re-call) | `StyleHandle<RuleStyleSpec>` | `StyleHandle` | n/a |

Two things jump out of that table:

1. Among the three *declarative* layers, the **only** user-visible asymmetry is
   the structural row. Ranges already carry decoration keys — `rebuildDecorations`
   (`MSDFText.ts:1595`) paints segments → rules → **ranges** identically. The
   spec types differ by exactly two optional keys.
2. The naming is off: `setTextStyle` **adds** a rule — calling it twice creates
   two rules — while every other `set*` in the API replaces. `addStyleRange`
   got the honest verb.

And one enabling fact checked against git: **the entire rich-text surface is
unreleased.** `main` is at 0.3.0 and contains none of `setRichText` /
`setTextStyle` / `addStyleRange`; it all lives on `fit-inside-and-rich-text`.
Renames and semantic changes are free until this branch merges and publishes.

## Re-examining the three reasons ranges are appearance-only

`rich-text-styling.md` ("Refinement — where structural keys may live") gave two
hard reasons and one soft. None of the three binds anymore:

**(a) The handle-update contract** — *"`handle.update()` promises cheap
re-seed, never relayout; a structural key through that path would silently
reflow."* This contract was already forfeited — deliberately, honestly — when
structural **rules** were surfaced: a rule handle's update with a changed
`fontScale`/`font` routes to a rebuild, via `refreshStyleState` comparing the
structural maps and setting `_dirty` itself (`MSDFText.ts:562-568`). The
mechanism is layer-agnostic; the contract is already *per-key*, not per-layer.
Extending the identical behaviour to range handles adds no new kind of cost —
it removes the one place where the same signature means a different rule.

**(b) Pipeline ordering** — *"ranges are applied after layout."* This
conflates when a spec is **registered** with when each of its key lanes is
**consumed**. All three stores hold source-index spans over `_text`, registered
before the next layout; the lanes are consumed at different pipeline points
regardless of which store a span came from — structural keys painted into
`_sizeScales`/`_fontMap` at `refreshStyleState` time (pre-layout), decoration
keys resolved in `rebuildDecorations` (post-layout, reads `_characters`),
appearance keys stamped in `applyStyleRuns` (post-layout, reads the glyph
array). Ranges already carry keys from two lanes consumed at two different
points. `addStyleRange` runs `refreshStyleState` immediately — exactly where
the structural maps are built. Painting a range span into those maps is
mechanically identical to painting a rule's cached match: one more loop in
`buildSizeScales` (`MSDFText.ts:707`) and `buildFontMap` (`MSDFText.ts:589`).

The fact that makes this *safe*, not just possible: **range spans index the
source string, and a structural reflow doesn't move source indices.** Wrap
changes rendered layout, never `_text`. A structural range cannot go stale by
its own doing, nor invalidate a neighbour. The staleness hazard that motivated
"drop on any text change, no clamping" never arises from reflow — that
lifecycle rule stays exactly as it is and keeps doing its job.

**(c) Lane cleanliness** — *"keeping post-layout overlays appearance-only lets
`displayCallback` and per-frame seeding never touch layout."* This holds and
must keep holding for the **callback** — but its enforcement there is physical,
not conventional: `GlyphState` has no structural fields, so the callback
*cannot* reflow no matter what we do to ranges. Structural range keys would go
through the maps, never through `GlyphState`. Lane cleanliness is a per-key
invariant, and it is preserved per-key.

The boundary the original rule was groping for is real, but it sits one step
further out:

> **Specs are layout inputs; the glyph array is layout output.** Every
> spec-based layer (segments, rules, ranges) may carry any key, and each key
> lane has its own documented cost. The imperative per-glyph surface
> (`displayCallback`, `editGlyphs`) operates on already-laid-out glyphs and is
> appearance-only by construction.

That is simpler to document than the current rule, it is *physically* enforced
at its one hard edge, and it answers the user question directly: from the
caller's standpoint there is indeed no reason ranges and segments support
different specs.

## Tier 1 — one spec, per-key cost model

The minimal unification, and the part this proposal considers settled:

- **`StyleSpec` absorbs `fontScale` and `font`.** `RuleStyleSpec` is deleted
  (unreleased — no alias needed). `SegmentSpec extends StyleSpec { text }` is
  the only remaining subtype, and its extra key is inherent (content).
- **`StyleHandle` loses its generic parameter.** One handle type.
- **`addStyleRange` honours the full spec.** `resolveRangeStyle`
  (`MSDFText.ts:1898`) and `_structuralRangeWarned` are deleted; range creation
  calls `resolveStyle` directly like the other layers.
- **`buildSizeScales` and `buildFontMap` gain the ranges loop**, painted after
  rules — the same segments → rules → ranges order as the appearance and
  decoration passes. (Both functions' "ranges are excluded by construction"
  comments go.)
- **Docs switch from a per-method rule to a per-key cost model:**
  - *appearance* keys → coalesced re-seed (`_stylesDirty`);
  - *decoration* keys → coalesced rect rebuild (same flag);
  - *structural* keys → relayout (`refreshStyleState` detects the map change
    and sets `_dirty`), on **any** spec layer, including via any handle's
    `update`.

Nothing about lifecycle changes. Ranges still die on any text change; a dying
structural range reflows the text back automatically (the text change already
set `_dirty`, and the map comparison agrees). `setRichText`'s same-text path
still drops ranges. `clearStyles` still removes rules + ranges.

Edge cases checked:

- **`fitInside`** — `_maxLineUnit` is recomputed in `refreshStyleState` from
  the maps, so a structural range participates automatically; `fontScale` stays
  a multiplier, so the binary search's monotonicity argument is unchanged.
- **Kerning / wrap / measurement agreement** — automatic: the maps are the
  single source all three consumers read. No new agreement burden.
- **Manual mode** — a structural range add sets `_dirty` → `rebuildText` →
  `refreshGlyphs` → `'glyphsreset'`, the existing contract.
- **The Uint8Array 255-font cap** and missing-font fallback are unchanged
  (ranges go through the same `indexOf`).

The design-doc rule that survives verbatim: structural keys never reach
`GlyphState`, and `displayCallback`/`editGlyphs` stay appearance-only forever.
The escape hatch for "animated size that reflows" is explicit and honest:
tween `fontScale` through a handle's `update` and pay a rebuild per change.

## Tier 2 — one overlay primitive: `addStyle(target, style)`

After Tier 1, `setTextStyle` and `addStyleRange` differ in exactly one thing:
**the anchor** — a matcher that re-derives its spans on every text change, vs
fixed indices that die on one. Same spec, same handle, same paint semantics,
same stores shape (`{ spans, style }`). Two methods whose only real difference
is an argument type is the classic signature for one method:

```ts
type StyleTarget =
    | string                                  // match every occurrence (today's defaults)
    | RegExp                                  // match by pattern (persistent)
    | { match: string | RegExp;               // match with options
        all?: boolean; nth?: number;
        wholeWord?: boolean; caseSensitive?: boolean }
    | { start: number; length: number }       // fixed indices (transient)
    | ((text: string) => { start: number; length: number }[]);  // custom matcher

addStyle(target: StyleTarget, style: StyleSpec): StyleHandle;
```

- **Lifetime falls out of the anchor kind**, which is the teachable rule the
  three-lifetimes table was always circling: *styles anchored to content
  survive text changes (re-derived); styles anchored to positions don't
  (dropped, handle dies).* A string/RegExp/function anchor is content-anchored;
  a `{start, length}` anchor is position-anchored. No third lifetime to learn.
- **The function anchor is the extension point** that subsumes every "can I
  match X" feature request — regex was the obvious one (and is also offered
  directly), but a parser's token spans, "every emoji", "every nth word" all
  become caller-side one-liners. It re-runs on text change like a rule match;
  cost is the caller's own function, paid only at text-change time. RegExp
  semantics: find all matches (`nth`/`all` still filter via the object form),
  `i` flag for case; the sticky/global flags are ignored rather than honoured.
- **`setRichText` stays.** Content is genuinely different: segments own their
  text, are replaced with it, and have no handles. The API story becomes two
  sentences: *content* goes in through `setRichText`; *overlays* go on through
  `addStyle` and come off through their handles or `clearStyles`.

### Paint order: creation order within one store

Merging `_styleRules` + `_rangeRuns` into one `_overlays` array replaces
"layer order, then creation order within a layer" with plain **creation order**
— segments → overlays (in `addStyle` order) → `displayCallback`. "The style you
added last wins on overlapping keys" is a simpler rule than "ranges beat rules
regardless of when either was added", and the one behavioural difference (a
rule added *after* a range now beats it on overlap) is a case the old model got
arguably backwards anyway. Unreleased, so nobody observes the change.

The "increasing dynamism" rationale isn't lost — it survives where it is
load-bearing: content first, per-frame callback last.

### Internals

- `_styleRules: StyleRule[]` + `_rangeRuns: StyleRun[]` + `_rangeGen` collapse
  into `_overlays: StyleOverlay[]`:

  ```ts
  interface StyleOverlay {
      anchor: ResolvedTarget;    // matcher | regexp | fn | fixed-span | dead
      style: ResolvedStyle;
      runs: RuleMatch[];         // cached spans; re-derived or emptied on text change
  }
  ```

- `onTextChanged` becomes one loop: content-anchored overlays re-derive `runs`;
  position-anchored overlays are spliced out and marked dead (replacing the
  `_rangeGen` generation check with a per-overlay flag — the rule handles'
  `removed` pattern, now shared).
- `refreshStyleState`, `applyStyleRuns`, `rebuildDecorations`,
  `buildSizeScales`, `buildFontMap` each drop from three store loops to two.
  One `makeStyleHandle` replaces `makeRuleHandle` + `makeRangeHandle`.

### Sugar, or not

Recommendation: **`addStyle` is the only overlay method; `setTextStyle` and
`addStyleRange` are removed** (not aliased — they're unpublished). The common
cases read well without sugar:

```ts
text.addStyle('DMG', { color: 0xff3333 });                    // was setTextStyle
text.addStyle({ start: 5, length: 3 }, { color: 0xffff00 });  // was addStyleRange
text.addStyle(/\d+/, { weight: 2, fontScale: 1.2 });          // new for free
```

The fair alternative — keeping both as two-line wrappers — costs little code
but re-introduces the two-methods-one-mechanism surface this tier exists to
remove, and `setTextStyle`'s verb problem would still need a rename. If sugar
is kept, `addStyleRule` is the honest name.

## What stays firm

- **`displayCallback` / `editGlyphs` are appearance-only, forever** — enforced
  by `GlyphState` having no structural fields. Decorations stay invisible to
  the callback (separate `future-ideas.md` item, unchanged).
- **Range/position-anchored death on text change, no clamping.** Unchanged; it
  was never about reflow and reflow doesn't threaten it.
- **Coalescing** — `_stylesDirty` for re-seeds, `_dirty` for rebuilds,
  `refreshStyleState` as the single place deciding which. Unchanged.
- **The renderer, packers and shader are untouched.** Nothing in either tier
  reaches past `MSDFText.ts` / `MSDFTextStyle.ts` / `MSDFTextTypes.ts` — no
  batching, flush-gate or `params` implication at all.
- Structural keys still never appear on `GlyphState`, and `fontScale` stays a
  multiplier (all the `fit-inside` and `setFontSize` reasoning intact).

## Performance

**The unification itself is neutral.** Unstyled texts don't enter any of this
code. Appearance-only styling takes the identical path (the ranges loop in the
two map builders runs zero iterations when no range has structural keys — the
same as the rules loop today). A *structural range* costs exactly what a
structural rule costs, which was already accepted and documented.

Honest accounting of what "better performance" is actually available here:

1. **Skip the map rebuild when nothing structural is in play** (small, new).
   Today every `handle.update()` / `addStyleRange` / `clearStyles` calls
   `buildSizeScales` + `buildFontMap` + three comparisons. When no store
   carries a structural key those are O(runs) with a couple of tiny
   allocations — cheap — but when structural keys *do* exist, an
   appearance-only handle update rebuilds and compares both O(text) maps.
   Fix: compute `hasStructural` in the same O(runs) loops that already compute
   `_hasAppearance`; when it is false **and** both current maps are `null`,
   skip straight past the builders (still refreshing `_runFonts[0]` — the
   `setFont` slot-0 swap — and `_maxLineUnit`'s base). The maps-non-null case
   must keep the full path, since it may be the transition *to* no structural
   keys, which has to null the maps and set `_dirty`.
2. **The already-catalogued candidates are unaffected** and remain the real
   targets: `implementation-review.md` A (shader `solid` branch), B (O(line²)
   wrap measure), C (`applyRun` scanning every glyph per run — the glyph array
   is monotone in `srcIndex`, so each run is a binary-searchable window). C
   gets marginally easier after Tier 2 (one overlay list to walk), and none of
   them get harder.
3. Tier 2 is a code-size and surface reduction, not a speed change.

## Files / methods to touch

Tier 1:

- `src/MSDFTextTypes.ts` — move `fontScale`/`font` (with their doc comments,
  reworded per-key) into `StyleSpec`; delete `RuleStyleSpec`; de-genericise
  `StyleHandle`; update `setRichText`/`setTextStyle`/`addStyleRange` JSDoc to
  the per-key cost model.
- `src/MSDFText.ts` — `buildSizeScales` / `buildFontMap`: add the ranges loop;
  delete `resolveRangeStyle` + `_structuralRangeWarned`; range creation and
  `makeRangeHandle.update` call `resolveStyle`.
- `src/MSDFTextStyle.ts` — no behaviour change (`resolveStyle` already handles
  the structural keys for every caller). Add `styleHasStructuralKeys` if the
  perf item ships.
- `README.md` / `CLAUDE.md` — the rich-text lanes paragraph: structural keys
  are legal on all three spec layers; the cost table becomes per-key.
- `examples/scenes/rich-text.ts` — demonstrate a structural range (e.g. a
  transient `fontScale` bump on a selection).

Tier 2 (on top):

- `src/MSDFText.ts` — `_overlays` store replacing `_styleRules`/`_rangeRuns`/
  `_rangeGen`; `addStyle`; one `makeStyleHandle`; `onTextChanged` single loop;
  collapse the three-store loops in `refreshStyleState`, `applyStyleRuns`,
  `rebuildDecorations`, `buildSizeScales`, `buildFontMap` to two; delete
  `setTextStyle`/`addStyleRange` (or reduce to sugar, per the open question).
- `src/MSDFTextStyle.ts` — `resolveTarget` (string/RegExp/object/fn/span →
  `ResolvedTarget`); extend `matchRuns` with the RegExp branch; `TextStyleOpts`
  folds into the object target form.
- `src/MSDFTextTypes.ts` — `StyleTarget`, `addStyle` on `MSDFTextInstance`.
- `examples/` — `rich-text.ts`, `per-run-font.ts`, `vertex-params.ts`,
  `highlight.ts` (25 call sites total, mechanical).
- While in the area: fix `implementation-review.md` finding 1 (`editGlyphs`/
  `resetGlyphs` not consuming a pending `_stylesDirty`) — the handle rework
  touches the same seams.
- `design/rich-text-styling.md` — it is a rationale record; add a superseded
  note at the "Refinement" section pointing here rather than rewriting it.

## Verification checklist

- `addStyleRange(5, 3, { fontScale: 1.5 })` (or the `addStyle` span form)
  reflows: the run grows, wrap and line height respond, the line shares one
  baseline. `handle.remove()` reflows back. `setText` drops it and reflows back.
- A structural range + `fitInside`: the fitted size accounts for the scaled
  run; re-running `fitInside` after `handle.update({ fontScale: 2 })` converges.
- `addStyle('the', …)` behaves byte-for-byte like today's
  `setTextStyle('the', …)` (all/nth/wholeWord/caseSensitive via the object
  form); `addStyle(/\d+/, …)` styles every number and re-matches on `setText`.
- Function anchor: spans re-derive on text change; a throwing matcher doesn't
  corrupt the store (decide: catch-and-warn vs let it propagate).
- Creation order: overlay B added after overlay A wins where they overlap,
  regardless of anchor kinds; segments still lose to any overlay; the callback
  still sees the final composed state.
- Position-anchored overlays die on text change (handle no-ops + one-time
  warn); content-anchored ones survive `setText` *and* `setRichText`.
- Appearance-only handle updates never set `_dirty` (assert in the example
  harness); structural updates never *miss* setting it.
- Single-font, no-style text: `refreshStyleState` fast path leaves
  `_sizeScales`/`_fontMap` `null` and allocates nothing per update.

## Open questions

1. **Tier 2 scope** — take the single `addStyle` now, or land Tier 1 alone and
   let `setTextStyle`/`addStyleRange` ship as-is? Recommendation: do both while
   the surface is unpublished; Tier 2's cost is mostly renames in examples, and
   the naming wart (`setTextStyle` adds) should not ship regardless.
2. **Sugar** — keep `addStyleRule`/`addStyleRange` as wrappers over `addStyle`?
   Recommendation: no; one primitive, two-line migration notes in the README.
3. **RegExp + function anchors** — in scope for Tier 2, or a fast-follow?
   They're each ~a dozen lines inside `matchRuns`/`resolveTarget`, and the
   function anchor is the piece that ends the matcher feature-request treadmill.
   Recommendation: RegExp in scope; function anchor in scope but flagged
   experimental in docs.
4. **`handle.update` semantics** — it *replaces* the style today. A
   `patch()`-style merge is tempting DX but makes "what is this overlay's style
   now" stateful and unreadable; recommendation: keep replace, document it,
   revisit only on real friction.
5. **Object-level spec entry** (`setStyle(spec)` seeding the object defaults
   from the same `StyleSpec` shape — "layer 0") — cohesive, but it overlaps
   the whole existing setter surface and drags in keys specs don't have
   (`outlineLayered`, …). Out of scope here; park in `future-ideas.md` if
   wanted.
