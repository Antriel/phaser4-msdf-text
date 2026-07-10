# Style API unification — one spec, one overlay primitive

**Status: Tiers 1 and 2 implemented; Tier 3 still a proposal.** `StyleSpec` is
the one spec, `addStyle(target, style)` the one overlay primitive;
`setTextStyle`, `addStyleRange`, `RuleStyleSpec` and `StyleHandle`'s generic
parameter are gone. RegExp and function anchors shipped with it. Decisions taken
on the open questions are recorded inline at the bottom.

Written as the answer to:
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
`implementation-review.md`. A follow-up question — should `setRichText` return
segment handles for direct update/animation? — is answered in Tier 3: no
handles (argued there), but segments gain an `id` anchor and every spec layer
gains a scoped `displayCallback`.

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
    | { segment: string }                     // a named setRichText segment (Tier 3a)
    | ((text: string) => { start: number; length: number }[]);  // custom matcher

addStyle(target: StyleTarget, style: StyleSpec): StyleHandle;
```

- **Lifetime falls out of the anchor kind**, which is the teachable rule the
  three-lifetimes table was always circling: *styles anchored to content
  survive text changes (re-derived); styles anchored to positions don't
  (dropped, handle dies).* A string/RegExp/function/segment anchor is
  content-anchored; a `{start, length}` anchor is position-anchored. No third
  lifetime to learn.
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

## Tier 3 — addressing pieces of content: segment ids and per-overlay callbacks

Prompted by the question: should `setRichText` return handles, so a long text's
segments can be updated/animated directly instead of re-calling `setRichText`?

### Why `setRichText` stays handle-less — the honest accounting

Segment handles look like a fast path but mostly aren't. The same-text
`setRichText` path (`MSDFText.ts:1863`) already skips relayout; it and a
hypothetical `segmentHandle.update()` converge on the identical
`refreshStyleState()` + `_stylesDirty` → one coalesced **whole-array** re-seed.
The dominant cost is the same through either door, and a structural change
(`fontScale`/`font`) routes to the same rebuild through either door too. What a
handle would actually save is the string re-concat and N× `resolveStyle` —
noise next to the re-seed — plus one real wart: the same-text path **drops all
ranges as collateral** (`_rangeRuns.length = 0`).

And the lifetime story is bad on its own terms: segments are replaced
wholesale, never diffed, so every handle from call k dies at call k+1. A handle
that dies every time its owner's method is called is worse DX than no handle.
`setRichText` also returns `this` (chainable); changing that return type spends
API budget on the weakest design in the space.

The wart and the want are both answered by anchors, not handles:

### 3a — segment identity: `id` + the `{ segment }` anchor

`SegmentSpec` gains an optional `id?: string`. `addStyle({ segment: 'dmg' },
style)` anchors an overlay to whichever spans currently carry that id —
**content-anchored** by the Tier 2 rule: on any text/segments change it
re-derives (all segments with the id, in order, like a rule's multi-match); if
the id is absent it holds an empty `runs` and revives when a later
`setRichText` brings the id back. That is strictly stronger than a segment
handle could be — it *survives* content replacement — and it composes with
everything an overlay already does (decoration keys, structural keys, creation-
order painting, `remove()`).

The wart falls out too: updating one named piece is `handle.update(...)` on its
overlay, which touches no other layer — no range collateral, no segment-array
reconstruction at the call site. `setRichText`'s job shrinks to what it was
always best at: *content*, with inline styling for the static parts.

Internals: `ResolvedTarget` gains a `segment` kind; deriving its runs is a walk
of `_segmentRuns` — which therefore need to retain their `id` (and, for
unstyled-but-named segments, a run must be kept even when `hasStyleKeys` is
false; today those are elided at `MSDFText.ts:1849`. Keep the elision for
anonymous unstyled strings, keep a span for anything with an `id`).

### 3b — the imperative lane joins the spec: `displayCallback` as a style key

The animation half of the question — "animate a segment directly, not via the
global `displayCallback`" — should *not* be answered with `handle.update()` per
frame: that pays `resolveStyle` + `refreshStyleState` per call, and when any
structural key exists anywhere, `refreshStyleState` rebuilds and compares both
O(text) maps *every frame* (perf item 1 helps only the no-structural case).
Callback mode re-seeds per frame anyway and pays none of that. The right
primitive is a **scoped display callback**, and the right place for it is the
spec, not the handle:

```ts
interface StyleSpec {
    ...
    /** Per-frame imperative hook over this spec's glyphs. Appearance-only. */
    displayCallback?: DisplayCallback;
}
```

Spec, not handle, because then it rides every layer for free — and the original
use case needs no id, no handle, no overlay at all:

```ts
text.setRichText([
    'Quest complete. ',
    { text: '+250 XP', color: 0xff3333, displayCallback: wobble },
]);
text.addStyle(/\d+/, { weight: 2, displayCallback: pulse });  // every number pulses
```

Semantics — each point picked to fall out of an existing rule rather than add
one:

- **It is a fourth key lane: imperative.** The per-key cost model gains a row:
  a `displayCallback` key forces per-frame glyph mode while present. Physically
  appearance-only, exactly like the object callback — `GlyphState` has no
  structural fields, so a scoped callback cannot reflow no matter what it does.
  The Tier 1 boundary sentence extends without strain: specs are layout inputs,
  the glyph array is layout output, and callbacks (object-level or spec-level)
  operate on the output.
- **Invocation order is paint order.** In the callback stage (after
  `applyStyleRuns`): segments' callbacks, then overlays' in creation order,
  then the object-level `displayCallback` last with the full array — most
  dynamic last, and the object callback keeps its "sees the final composed
  state" contract... for everything except later scoped callbacks, which is the
  same overlap rule as every other key: later wins.
- **One call per span, not per overlay.** A rule matching five `DMG`s gets five
  calls, each with that occurrence's glyphs — the span is the natural animation
  unit (each occurrence pulses from its own start; array position is the local
  index). Segments and position anchors have one span, so they degenerate to
  one call. Signature stays `DisplayCallback` (`(glyphs, text) => void`); the
  slice array is a reused scratch buffer, valid only during the call —
  documented like callback mode's transient states, because it *is* one.
- **Mode derivation.** `refreshStyleState` computes `_hasGlyphCallbacks` in the
  same O(runs) loops as the other `_has*` flags; the effective glyph mode is
  callback when the object callback is set *or* any spec carries one.
  `setDisplayCallback(undefined)` no longer unconditionally returns to static —
  it falls back to whatever the specs imply. **Manual mode wins conflicts**:
  `editGlyphs()` owns the array, so spec callbacks are suppressed under manual
  mode with a one-time warn (same shape as the structural-range warn this
  proposal deletes).
- **Renderer seam.** The per-span dispatch lives next to the existing object
  callback call (`MSDFTextWebGLRenderer.ts:568`), behind `_hasGlyphCallbacks` —
  a text without spec callbacks executes not one new instruction. Span → glyph
  window lookup is `applyRun`'s scan today and a binary search after
  `implementation-review.md` C (the glyph array is `srcIndex`-monotone), which
  this feature makes slightly more attractive but does not require.

Honest cost, stated in docs: one animated segment puts the whole text in
callback mode — whole-array re-seed per frame, same as the object callback
always cost. Scoping bounds the *user's* per-frame work, not the seeding. A
dirty-span-only re-seed is a conceivable optimization; not proposed (it breaks
callback mode's one simplicity, "re-seed everything, then run callbacks").

Considered and dropped: exposing `handle.spans` (readonly resolved runs) so
callers could slice the global callback themselves. It's a cheap primitive but
a leaky one — it hands out store internals and still leaves every caller
re-implementing the span→glyph walk. 3b subsumes the use case; revisit only if
a concrete need for *reading* spans (not styling them) shows up.

## What stays firm

- **`displayCallback` / `editGlyphs` are appearance-only, forever** — enforced
  by `GlyphState` having no structural fields. Tier 3b's scoped callbacks
  inherit the same physical enforcement. Decorations stay invisible to
  the callback — object-level or scoped (separate `future-ideas.md` item,
  unchanged).
- **Range/position-anchored death on text change, no clamping.** Unchanged; it
  was never about reflow and reflow doesn't threaten it.
- **Coalescing** — `_stylesDirty` for re-seeds, `_dirty` for rebuilds,
  `refreshStyleState` as the single place deciding which. Unchanged.
- **The batching, flush-gate, packers and shader are untouched.** Tiers 1–2
  reach nothing past `MSDFText.ts` / `MSDFTextStyle.ts` / `MSDFTextTypes.ts`;
  Tier 3b adds one dispatch call at the renderer's existing `displayCallback`
  site and nothing below it — no `params` implication at all.
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

Tier 3 (on top of Tier 2 — 3a needs `StyleTarget`; 3b is independent of it in
principle but shares the store walk):

- `src/MSDFTextTypes.ts` — `SegmentSpec.id`; `{ segment: string }` in
  `StyleTarget`; `StyleSpec.displayCallback`; JSDoc for the imperative lane's
  cost row.
- `src/MSDFText.ts` — keep a run for any segment with an `id` even when
  style-less (`setRichText`, today's `hasStyleKeys` elision);
  `_hasGlyphCallbacks` in `refreshStyleState`; glyph-mode derivation reads it
  (`setDisplayCallback(undefined)` falls back to spec-implied mode); manual-mode
  suppression warn; per-span dispatch helper (reused scratch array).
- `src/MSDFTextStyle.ts` — `resolveTarget` segment kind; `resolveStyle` carries
  the callback through; `styleHasAppearanceKeys` must **not** count it (a
  callback-only spec needs the glyph array via `_hasGlyphCallbacks`, but gains
  nothing from an `applyStyleRuns` visit — decide whether `_hasAppearance`
  should be true whenever `_hasGlyphCallbacks` is; simplest: yes, the array is
  needed either way).
- `src/MSDFTextWebGLRenderer.ts` — call the dispatch helper between
  `applyStyleRuns` and the object callback (the one renderer-file exception to
  "renderer untouched"; it is three lines at the existing callback site).
- `examples/scenes/rich-text.ts` — a named segment with a scoped
  `displayCallback` (the motivating "one animated line" case) and an
  `addStyle({ segment })` recolour of the same span.

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

Tier 3:

- `addStyle({ segment: 'x' }, …)` styles the named segment; after a
  `setRichText` that keeps the id the overlay follows it to its new span; while
  the id is absent it draws nothing and the handle stays alive; `setText`
  (plain) empties it the same way.
- A segment carrying only `displayCallback` (no style keys) still animates —
  the id-less elision must not drop it.
- Scoped callback on a five-match rule: five calls per frame, each slice local;
  mutating a slice glyph does not leak into the next span's call (scratch
  array refilled).
- Order: a scoped callback's writes are visible to the object callback; the
  object callback still wins where both touch the same glyph.
- Manual mode (`editGlyphs`) with a spec callback present: one-time warn,
  callbacks suppressed, edits intact.
- Removing the last spec callback (handle `remove()`, `setText` dropping a
  position-anchored overlay, `setRichText` replacing segments) with no object
  callback returns the mode to static — and to manual if `editGlyphs` owns it.
- No spec callbacks, no object callback: renderer hot path executes zero new
  instructions (profile the static-text benchmark before/after).

## Open questions

1. **Tier 2 scope** — ✅ **Decided: both, now.** Tiers 1 and 2 landed together.
2. **Sugar** — ✅ **Decided: none.** `addStyle` is the only overlay method;
   `setTextStyle` and `addStyleRange` were removed outright, not aliased.
3. **RegExp + function anchors** — ✅ **Decided: both in scope**, and both
   shipped with Tier 2. `wholeWord` / `all` / `nth` apply to a RegExp too (the
   whole-word gate is the same neighbour predicate); `caseSensitive` does not —
   the pattern's `i` flag governs, and the `g`/`y` flags are ignored rather than
   honoured (a normalized global copy is built at `resolveTarget` time, so the
   caller's `lastIndex` is never touched). Zero-length matches are skipped.
   The function anchor is documented experimental. **A matcher that throws
   propagates** — a runtime exception in the caller's code is the caller's to
   handle, not ours to swallow into a silent no-match. `onTextChanged` pays for
   that by compacting the overlay store *before* running any user code and
   refreshing the derived state in a `finally`, so the exception leaves the text
   object consistent: overlays the re-derive never reached keep their previous
   spans, which the paint loops clamp like any other stale span.
4. **`handle.update` semantics** — ✅ **Decided: keep replace.** Documented on
   `StyleHandle`. Revisit only on real friction.
5. **Object-level spec entry** (`setStyle(spec)` seeding the object defaults
   from the same `StyleSpec` shape — "layer 0") — ❌ **Decided: no**, with the
   reasoning recorded in `future-ideas.md` under "explicitly rejected". The
   defect is semantic, not ergonomic: on a run an absent key means *inherit*, at
   the object level it means *the default*. Same shape, opposite meaning. It also
   drags in keys no spec has (`outlineLayered`, `perGlyphShadow`, the `-1`
   sentinel colours), and every object-level field is already plain and tweenable.
6. **Tier 3 scope** — ✅ **Decided: 3a in, 3b deferred behind finding C.**

   The proposal argued for both on "do it while the surface is unpublished."
   That was load-bearing for Tier 2, which *removed* methods. It does not hold
   here: `SegmentSpec.id`, the `{ segment }` anchor and `StyleSpec.displayCallback`
   are all purely **additive** keys, safe to add after publishing. (The one
   exception is `setDisplayCallback(undefined)` changing from "always static" to
   "fall back to the spec-implied mode" — small and containable.)

   So each is judged on its own merits. **3a is in**: a dozen lines, and it
   closes the one wart Tiers 1–2 knowingly left behind (updating a named piece
   means re-calling `setRichText`, which drops every position-anchored overlay
   as collateral). **3b is deferred**: per-span dispatch runs `applyRun`'s
   span→glyph scan *once per span per frame*, which makes finding C
   (`implementation-review.md`) a prerequisite rather than a nicety — and the
   object-level `displayCallback` already covers the motivating use case by
   filtering on `g.srcIndex`, which is exactly what `examples/scenes/rich-text.ts`
   does today. 3b is ergonomics over an existing capability, not a new one.
7. **Per-span vs per-overlay callback calls** — moot until 3b is real.
   **Deferred with it**; the per-span reasoning above stands as the starting
   position.

## Next steps (for a fresh session)

In order. Both are self-contained, and the first is the second's prerequisite in
spirit if not in letter:

1. **`implementation-review.md` finding C** — binary-search the span→glyph window
   in `MSDFText.applyRun`. The glyph array is monotone in `srcIndex`, so each run
   is a window, not a scan. No API surface. It got materially more attractive
   with Tier 2: a RegExp anchor like `/\d+/` can produce dozens of spans where a
   literal rule produced one or two, and `applyStyleRuns` walks the whole glyph
   array once per span on **every re-seed**. It is also 3b's prerequisite.
2. **Tier 3a** — `SegmentSpec.id`, a `segment` kind in `ResolvedTarget`, and
   `addStyle({ segment: 'dmg' }, style)`. Two implementation notes the sketch
   above doesn't state: `deriveRuns` needs the segment runs passed alongside
   `text` (a segment anchor resolves against `_segmentRuns`, not the string), and
   `setRichText` must stop eliding runs for **unstyled-but-named** segments while
   keeping the elision for anonymous unstyled strings. Ordering is already safe:
   `setRichText` assigns `_segmentRuns` before calling `onTextChanged`, and
   `setText` clears them before calling it. A segment anchor is content-anchored,
   so it survives a `setRichText` that keeps the id, and holds empty `runs`
   (alive, drawing nothing) while the id is absent.

## Notes from the implementation

Two things the proposal got slightly wrong, worth recording:

- **Perf item 1 (skip the map rebuild when nothing structural is in play) was
  dropped as worthless.** Its own premise contradicts its trigger: the guard it
  proposes (`!hasStructural && both maps null`) only fires in the case where the
  builders were *already* O(runs) with no allocation, and `computeMaxLineUnit`
  already early-returns there. The case it claims to fix — an appearance-only
  update while structural keys exist elsewhere — has non-null maps and so takes
  the full path regardless. Not implemented; the two catalogued candidates in
  `implementation-review.md` (B, C) remain the real targets.
- **`implementation-review.md` finding 1 was already fixed** on this branch —
  `consumePendingStyles` exists and both `editGlyphs` and `resetGlyphs` call it.

One behaviour kept deliberately, and it is the one wart Tier 3a exists to close:
`setRichText`'s **same-text path still drops position-anchored overlays.** The
plain string is unchanged, so a `{ start, length }` span is arguably still valid
— but the *content* under it was replaced, and "position anchors die when the
content changes" is the rule worth being able to state without an exception.
