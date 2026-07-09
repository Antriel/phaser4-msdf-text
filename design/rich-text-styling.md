# Rich text — per-run styling API (+ skew)

**Status: implemented** — Phase 1 (the three entry points, the three-store paint
order, handle coalescing, skew), Phase 2a (per-run size, `fontScale`) and Phase 2b
(per-run **font**) have all landed. This doc is kept as the *rationale* record: it
explains why the API has the shape it has, and the "Verification" list below
doubles as a regression checklist.

Per-glyph outline width / rounded / shadow softness, faux **weight** and
**underline/strikethrough** moved to their own plan — see
[`vertex-params.md`](./vertex-params.md), which landed **before** 2b and is what
made 2b a texture-binding problem and nothing else.

**Still open:** step E (the merged `-and` atlas, so mixed-font runs share one
texture and `configureFont`'s flush never fires). Pure optimisation.

## Goal

Style specific words/ranges — colour, alpha, gradient, outline, shadow, scale,
skew — **without markup in the string** and without the user hand-counting
glyphs in a `displayCallback`. Three entry points over one internal mechanism,
distinguished by **lifetime**:

- **Content** — `setRichText(segments)`: structured styled-text input. The
  styles are part of the content and are replaced together with it.
- **Policy** — `setTextStyle(match, style)`: a persistent rule ("all `DMG`
  text is red"). Survives text changes; re-matched against the current text.
- **Override** — `addStyleRange(start, length, style)`: index-anchored to the
  current text; dropped on any text change.

Everything in the list above is **appearance-lane**: it seeds `GlyphState`, never
changes layout, composes with `displayCallback`, and is animatable. Structural
per-run styling is the other lane: `fontScale` shipped as Phase 2a; per-run
`font` (2b) is still open — see the end.

## The appearance/structural split (why this is all seeding)

Locked decision from the design session:

| property | lane | applied | reflows? | per-frame animatable |
|---|---|---|---|---|
| colour, alpha, gradient | appearance | seed | no | yes |
| outline, shadow | appearance | seed | no | yes |
| scale, rotation, **skew** | appearance | seed | no | yes |
| **`fontScale`**, **`font`** | structural | rebuild | **yes** | no |

`displayCallback` stays appearance-only (its contract is "mutate resolved state,
we read it straight to the GPU" — there is no relayout hook in that path).
Structural size/font are set on segments and rules, and take effect on rebuild.
Do **not** put `fontScale` on `GlyphState`.

### Refinement — where structural keys may live (pre-layout vs post-layout)

The original rule was blunt: *"structural keys on `SegmentSpec` only."* The
sharper rule that supersedes it is about **pipeline position, not doc type**:

> A structural key may live on any style layer that is resolved **before** the
> layout pass. It must never live on a layer that is an **overlay applied after
> layout** (ranges, `displayCallback`).

Three reasons, two hard and one soft:

- **(a) The handle-update contract (hard).** `handle.update()` promises "cheap
  re-seed, never relayout" (sets `_stylesDirty`, coalesces to one re-seed/tick,
  never touches `_dirty`). A structural key reached through that path would
  silently reflow — two update costs wearing one signature. Any layer that
  *does* allow structural keys must route its update to a **rebuild**, honestly.
- **(b) Pipeline ordering (hard for ranges, soft for rules).** Segments are
  resolved into `_text` + runs at `setRichText` time, i.e. **before** layout, so
  their size/font data is available exactly where the layout pass needs it.
  Rules are re-matched on every text change and their `runs` are cached at that
  point — **also before** the layout pass — so a *structural rule* has no hard
  pipeline blocker either. Ranges are the opposite: index-anchored to the
  *current* text and explicitly transient (dropped on any text change, no
  clamping). Reflowing a transient post-layout overlay fights the very model
  that makes ranges predictable.
- **(c) Lane cleanliness (soft).** Keeping the post-layout overlays
  appearance-only is what lets `displayCallback` and per-frame seeding never
  touch layout.

**Consequence for the design:**

- **`SegmentSpec` (content)** — structural keys allowed (as before).
- **`setTextStyle` rules** — structural keys **may** be allowed (e.g. a
  persistent `fontScale` policy, "every matched `H1` is 1.5×"). If offered, the
  rule's `handle.update()` routes to a rebuild, not a re-seed, and `setText`
  cost becomes rule-dependent — both documented. This needs a **distinct
  rule-style type** (`RuleStyleSpec extends StyleSpec` with the structural keys
  added), because rules and ranges cannot share one `StyleSpec` if only rules
  may carry structural keys.
- **`addStyleRange` ranges + `displayCallback`** — appearance-only, **forever**.
  `StyleSpec` (the range/override spec) never gains structural keys.

`fontSize`/`font` still never go on `GlyphState` regardless — a structural key
feeds the *layout input*, not the per-glyph seed.

**Decision: surface structural rules.** `setTextStyle` gets a `RuleStyleSpec`
that carries the structural keys, so "every `DMG` is red **and bold and big**"
is expressible as one persistent rule — not a thing the user can do in a segment
but mysteriously can't do in a rule. Ordering allows it (rules re-match before
layout), so the only reason to withhold it would be internal convenience, which
is a bad reason to make the API inconsistent. The costs are accepted and
documented: the rule's `handle.update()` routes to a rebuild (not a re-seed),
and `setText` cost becomes rule-dependent. The constraint that stays firm is
post-layout overlays — `addStyleRange`/`displayCallback` remain appearance-only
forever.

## Types

```ts
// A per-corner value (reuse the existing Corners shape from MSDFColor).
type PerCorner<T> = { topLeft: T; topRight: T; bottomLeft: T; bottomRight: T };

interface StyleSpec {
    color?:   ColorValue | PerCorner<ColorValue>;   // fill; per-corner ⇒ gradient
    alpha?:   number | PerCorner<number>;
    outline?: { color?: ColorValue; alpha?: number };
    shadow?:  { color?: ColorValue; alpha?: number; x?: number; y?: number };
    scale?:   number;                                // uniform
    scaleX?:  number;
    scaleY?:  number;
    rotation?: number;                               // radians
    skew?:    number;                                // shear factor; see Skew
}

// Structural keys (fontScale today; font in 2b) live on RuleStyleSpec, which
// setTextStyle and SegmentSpec both take — both resolve before layout. They must
// never reach StyleSpec, which is the range/override spec applied AFTER layout —
// see "Refinement: where structural keys may live" above. Ranges/callback stay
// appearance-only forever so handle.update() keeps its "cheap re-seed, never
// relayout" contract.
interface RuleStyleSpec extends StyleSpec { fontScale?: number; }
interface SegmentSpec extends RuleStyleSpec { text: string; }
type Segment = string | SegmentSpec;   // bare string = unstyled run

// One handle type for rules and ranges.
interface StyleHandle {
    update(style: StyleSpec): void;   // replace the style → coalesced re-seed
    remove(): void;                   // drop the rule/range → coalesced re-seed
}
```

Only the keys present in a `StyleSpec` override the seeded base; everything else
inherits the text object's defaults. `color`/`alpha` accept either a scalar (all
four corners) or a `PerCorner` (gradient).

`outline` omits `width`/`rounded`, and `shadow` omits `softness` — **as shipped**,
because those are per-batch uniforms, so per-run values would break batching. Do
**not** solve that with segment-level "breaks-batching" configs (an awkward
middle that builds a flush mechanism we'd later delete). The plan of record is to
promote them to per-glyph state via the `params` vertex attribute — see
[`vertex-params.md`](./vertex-params.md) — at which point they join the
appearance lane like everything else, per-corner included.

## Entry point 1 — `setRichText(segments)` (content)

```ts
setRichText(segments: Segment[]): this;
```

- Concatenates segment text into `this._text` (so the `text` getter still
  returns the plain string, and measurement/wrap/layout are unchanged).
- Records the source ranges + resolved styles as internal runs (below).
- Rebuilds. Chainable.

The segments **own their text**, so this is the source of truth for the
mapping. Changing content is natural: build a new array (longer/shorter
segments) and call `setRichText` again — offsets recompute automatically.

**Updating:** we do **not** hold a reference to the caller's array — segments
are resolved into `_text` + runs at call time (no aliasing questions). To
change a segment's colour or text, mutate the segment objects (or build a new
array) and call `setRichText(segments)` again. If the concatenated text equals
the current `this._text`, the layout rebuild is skipped — only the run list
and glyph seeding refresh (cheap; no `_dirty`). That optimisation *is* the
update path — no separate refresh API.

## Entry point 2 — `setTextStyle(match, style, opts?)` (persistent rule)

```ts
setTextStyle(match: string, style: StyleSpec, opts?: {
    all?: boolean;          // default true — every occurrence
    nth?: number;           // target a single occurrence (0-based); overrides `all`
    wholeWord?: boolean;    // default false — substring match
    caseSensitive?: boolean;// default true
}): StyleHandle;
```

- **Renamed from `setWordStyle`.** Substring matching is the sensible default
  ("DMG" should hit "50 DMG"), and a function called *word* style that
  substring-matches by default is untrue to its name. Under `setTextStyle`,
  `wholeWord` is honestly an option, not a broken promise.
- A rule is **persistent policy**: it survives `setText`/`setRichText` and is
  re-matched against the new text on every text change. `nth` re-resolves too
  ("the 2nd occurrence in whatever the text now is"). Matches are cached as
  runs (below), so per-frame seeding never searches strings.
- The handle's `update`/`remove` affect the rule as a whole (all matched
  occurrences together).

## Entry point 3 — `addStyleRange(start, length, style)` (transient range)

```ts
addStyleRange(start: number, length: number, style: StyleSpec): StyleHandle;
```

- Anchored to indices over the current `this.text`, which the caller owns.
  **Any text change (`setText` or `setRichText`) drops all ranges and kills
  their handles** — `update`/`remove` become no-ops (dev-warn once). No
  clamping: a clamped-but-stale run silently styles the wrong characters, dead
  is predictable. (This supersedes the earlier clamp/drop-out-of-bounds
  design.)
- Use for transient styling of text known to be stable: search-hit
  highlighting, ranges computed by your own parser.

**Guidance to document:** styles that belong to the content ⇒ `setRichText`
(they travel with the text). "Every X looks like this" keyword policy ⇒
`setTextStyle` (survives text changes). Transient highlights over stable text
⇒ `addStyleRange`.

## Handle updates — coalescing, and manual mode

`handle.update`/`handle.remove`/`clearStyles` do not re-seed immediately: they
set a `_stylesDirty` flag and the re-seed happens **once, lazily, before the
next render** (the existing pre-render path). Updating ten handles in one tick
costs one re-seed. In callback mode the array is re-seeded every frame anyway,
so the flag only matters for static/manual.

In **manual mode** a styles-dirty re-seed rebuilds the array from base + runs,
clobbering the user's manual edits — it emits `'glyphsreset'`, the same
contract as a text rebuild, and thanks to coalescing the event fires once per
tick, not once per handle. This is deliberate: a handle update is an explicit
request to restyle, so we assume the user wants the data to change; the event
is how they re-apply their edits on top.

```ts
clearStyles(): this;
```

Removes all rules **and** ranges (their handles die). Segments are content,
not policy — they are replaced by the next `setText`/`setRichText`, not by
`clearStyles`. Without this, a rule whose handle was lost would be
unremovable.

## Lifecycle summary

| action | segments (`setRichText`) | rules (`setTextStyle`) | ranges (`addStyleRange`) |
|---|---|---|---|
| `setText(t)` | cleared | kept; re-matched vs `t` | dropped; handles dead |
| `setRichText(s)` | replaced from `s` | kept; re-matched | dropped; handles dead |
| `handle.update/remove` | — | mutates the rule; styles-dirty | mutates the range; styles-dirty |
| `clearStyles()` | kept | removed; handles dead | removed; handles dead |

## Internal representation — three stores, one paint order

```ts
// start/length are indices into this._text (source string).
interface StyleRun  { start: number; length: number; style: ResolvedStyle; }
interface StyleRule { match: string; opts: Required<TextStyleOpts>;
                      style: ResolvedStyle; runs: StyleRun[]; } // runs = cached matches

private _segmentRuns: StyleRun[];   // content layer — rebuilt with the text
private _styleRules:  StyleRule[];  // policy layer — `runs` re-cached on text change
private _rangeRuns:   StyleRun[];   // override layer — emptied on text change
private _hasStyles:   boolean;      // any of the three non-empty
private _stylesDirty: boolean;      // handle changed → lazy coalesced re-seed
```

- Rule matching runs only on text change and rule creation, cached into
  `rule.runs` — a substring search per rule per text set, trivial.
- **Paint order = layer order, then creation order within a layer:**
  **segments → rules → ranges → `displayCallback`**, applied key-by-key (a
  later layer that only sets `outline` doesn't clobber an earlier layer's
  `color`). Rationale: layers are ordered by increasing dynamism — content
  styles travel with the string, rules are object-level policy over any
  content, ranges are imperative one-off overrides, the callback is per-frame.
  Same principle that already puts `displayCallback` last. Layer beats
  creation time: a rule created *after* a range still applies *before* it.
  Consequence to document: on overlap, a rule's `color` beats a segment's
  `color` — if you want the segment to win, don't also match it with a rule.
- `ResolvedStyle` normalises `ColorValue`→packed int and `scale`→`scaleX/
  scaleY` once, at creation, so per-frame seeding does no parsing.

## Seeding integration

`_hasStyles` forces the per-glyph array even when there is no callback and no
manual control (styling is inherently per-glyph). Fold run application into the
existing seeding pass:

```
prepareGlyphStates():
    ensure array length == glyph count
    for each glyph i: seedGlyph(states[i], chars[i], i)   // base seed (unchanged)
    if _hasStyles: applyStyleRuns(states)                 // NEW — overrides
    return states

applyStyleRuns(states):
    for run in _segmentRuns, then each rule's cached runs, then _rangeRuns:
        for each glyph g whose g.srcIndex in [run.start, run.start+run.length):
            apply run.style's present keys onto g (fill/outline/shadow/scale/
            rotation/skew, per-corner where given)
```

Map by `g.srcIndex` (from the provenance work). For non-overlapping sorted runs
a merge walk is O(glyphs); the simple runs×glyphs loop is fine for typical
counts.

### Mode interaction (renderer)

Today: `perGlyph = glyphMode !== STATIC`. Change to:

```
perGlyph = glyphMode !== STATIC || src._hasStyles
```

- **static + styles, no callback** — seed + `applyStyleRuns` **once on rebuild
  or when `_stylesDirty`** (persist across frames, like manual mode); the
  renderer reads the array without re-seeding. Hook this into the rebuild path
  (extend the current `refreshManualGlyphs` to also fire when `_hasStyles`,
  e.g. rename to `refreshGlyphs`) and run it lazily pre-render when
  `_stylesDirty`.
- **callback + styles** — `prepareGlyphStates` re-seeds + applies runs each
  frame, *then* the callback runs. **Order: base seed → segments → rules →
  ranges → displayCallback.** So static keyword colours and a dynamic
  wave/rainbow compose — the callback sees already-styled glyphs and layers on
  top. This composition is the thing the count-the-chars workaround can't do
  cleanly.
- **manual + styles** — runs apply during the seed; user edits then persist on
  top (they own the array). A rebuild — or a styles-dirty re-seed from
  `handle.update` — re-seeds + re-applies runs and emits `'glyphsreset'`.

No new glyph *mode* constant is required — `_hasStyles` is an orthogonal flag
that only affects whether the array is built and whether `applyStyleRuns` runs.

## Skew — **implemented**

A CPU baseline shear — faux italic. Shipped as `GlyphState.skew`, applied by
`applyBaselineShear` + `submitOneGlyph` in `MSDFTextWebGLRenderer.ts`. Notes kept
for the rationale (especially the pivot decision, which looks like a bug and
isn't).

- **`GlyphState.skew: number`** — horizontal shear factor (`dx/dy`); positive
  leans the top of the glyph to the right. Store a raw factor (not radians) to
  avoid a per-glyph `tan`. Seeded to `0`; animatable like scale/rotation.
- **Pivot = the baseline, on the CPU.** The baseline Y is known at layout time
  (`rich-text-provenance.md` stores `baselineY` per glyph). Shearing about the
  baseline (not the glyph's bottom) makes ascenders and descenders share one
  consistent slant across a line. No shader needed — `BatchMSDFChar` already
  transforms the four corners with an arbitrary matrix.
- **Math.** A baseline shear is affine: `x' = x − k·y + k·Yb`, `y' = y`. In
  Phaser's `TransformMatrix` (`a,b,c,d,e,f` with `x' = a·x + c·y + e`,
  `y' = b·x + d·y + f`):

  ```
  shear = (a=1, b=0, c=-k, d=1, e=k·Yb, f=0)
  glyphMatrix = calcMatrix · shear     // compose, then transform text-space corners
  ```

- **Render integration.** Route skewed glyphs through the matrix path in
  `submitOneGlyph` (like scale/rotation): when `skew !== 0`, build
  `glyphMatrix = calcMatrix.multiply(shear)` and transform the glyph's
  **absolute** text-space corners (`charX, charY, w, h`) — do *not* recentre, the
  shear needs the real `baselineY`. When skew combines with per-glyph
  scale/rotation (currently a centre-pivot matrix), compose glyph-local
  scale/rotation (about centre) *then* the baseline shear *then* `calcMatrix`.
  Extend the `submitOneGlyph` fast-path condition (`scaleX!==1 || scaleY!==1 ||
  rotation!==0`) to include `skew !== 0`.
- **Skew + per-glyph scale.** Centre-pivot scaling moves a glyph's visual
  baseline off the layout `baselineY`, so the shear pivot is *not* the scaled
  glyph's own baseline. Intentional: keeping the pivot on the layout baseline
  is what keeps a mixed-scale line slanting as one line — don't "fix" it.
- **Future:** a bottom-pivot variant is the same formula with `Yb = charY + h`,
  and a shader-based skew stays possible if we ever want it decoupled from
  geometry. Default is baseline. Keep the door open but don't build both now.

## Tree-shaking

Dropped for now — the whole surface is a few hundred bytes and Phaser's `Class`
puts prototype methods in the bundle regardless. Not worth fragmenting the API.
Revisit only if a real measurement says otherwise.

## Files / methods touched (done — kept as a map of where this lives)

- `src/MSDFGlyphState.ts` — add `skew` (and it already gains
  `srcIndex/line/srcLine` from provenance); seed `skew = 0`.
- `src/MSDFText.ts` — `setRichText`, `setTextStyle`, `addStyleRange`,
  `clearStyles`; the three stores + `_hasStyles` / `_hasAppearance` /
  `_stylesDirty`; `applyStyleRuns`; `refreshStyleState` (the single place that
  decides re-seed vs rebuild); rule re-matching + segment/range clearing on text
  change; fold into `prepareGlyphStates`; store `baselineY` per char (shared with
  provenance).
- `src/MSDFTextStyle.ts` — the pure, `this`-free half: `resolveStyle`,
  `matchRuns`, `applyStyleToGlyph`, `styleHasAppearanceKeys`.
- `src/MSDFTextTypes.ts` — `StyleSpec` / `RuleStyleSpec` / `SegmentSpec` /
  `StyleHandle` and the rest of the public type surface.
- `src/MSDFTextWebGLRenderer.ts` — `perGlyph` includes `_hasAppearance`; keep the
  seed → segments → rules → ranges → callback order; read `g.skew` and route
  through the matrix path.
- `src/MSDFTextWebGLRenderer.ts` / `src/BatchMSDFChar.ts` — apply the baseline
  shear (compose `calcMatrix · shear`; transform absolute corners for skewed
  glyphs).
- `index.ts` — export new public types.
- `README.md` — rich-text section (three entry points + lifecycle table); skew
  on the glyph state.
- `examples/` — a rich-text demo page (the verification artifact).

## Verification (now a regression checklist — all of these hold today)

- `setRichText(['Deal ', {text:'50', color:0xff3333}, ' damage'])` colours only
  the `50`; the `text` getter returns `'Deal 50 damage'`; wrapping still works.
- `setTextStyle('the', {color:...})` colours every `the`; `nth:1` colours the
  second; `wholeWord:true` skips `theory`.
- **Rule persistence:** `setTextStyle('DMG', {color:red})`, then
  `setText('Take 99 DMG')` — the new `DMG` occurrence is red. `clearStyles()`
  reverts it.
- **Range transience:** `addStyleRange` + `setText` — styling gone; the
  handle's `update`/`remove` no-op (with a one-time dev warning).
- `handle.update({color:...})` recolours with no layout rebuild;
  `handle.remove()` reverts. Two updates in one tick re-seed once (in manual
  mode, `'glyphsreset'` fires once).
- **Paint order:** a segment colour + an overlapping rule that sets only
  `outline` — the glyph keeps the segment colour and gains the rule outline;
  if the rule also sets `color`, the rule wins (layer order).
- Composition: a colour segment plus a `displayCallback` that animates alpha —
  the keyword keeps its colour while alpha animates (callback runs after runs).
- Text change: `setRichText` with different-length segments re-maps correctly;
  calling `setRichText` again with the same concatenated text but different
  styles skips relayout (only re-seeds).
- Skew: a full line at `skew = 0.25` shows a consistent slant; a word with a
  descender (`g`, `y`) leans consistently with its ascenders (baseline pivot,
  not per-glyph bottom). Skew animates smoothly per-frame via a callback.
- **Per-run font:** a segment with `font: 'Anton'` renders in Anton and wraps at
  Anton's advances; a line mixing faces shares one baseline and grows to the
  tallest ascender. `setTextStyle('fire', { font })` re-matches after `setText`.
  `addStyleRange(.., { font })` is ignored with a one-time warning. An unknown key
  falls back to the object's font and warns once. A character absent from its
  run's font is skipped, not borrowed. `setFont` on an object with font runs
  reflows against the new base font (slot 0 of `_runFonts`).

## Phase 2 — variable line-metrics

> **Status: 2a (per-run size) and 2b (per-run font) both implemented.** 2a shipped
> as `fontScale` on `SegmentSpec` and `RuleStyleSpec`, painted into a
> source-indexed `_sizeScales` map. 2b shipped as `font` (a cache key) on the same
> two layers, painted into a parallel `_fontMap: Uint8Array` indexing `_runFonts`
> (slot 0 = the object's own font). Both feed `wrapLines` → `measureLines` (which
> returns per-line `baselines[]`) → `rebuildText`. Kerning is skipped across a size
> *or* font boundary.
>
> **Faux weight, underline/strikethrough and the `params` byte4 moved to
> [`vertex-params.md`](./vertex-params.md)** — appearance-lane work with no layout
> component. Landing them *before* 2b is what reduced 2b to texture binding.

Per-run **`font`** is structural: it changes wrap, advance, and per-line
height/baseline (a line's metrics become the max over the runs on it). It rides
the variable-line-metrics machinery 2a already built, gated behind a "does any
run override the font?" check so the single-font fast path stays untouched.

This turns the multi-instance merged-atlas workaround into first-class mixed-font
runs in one object, and is the natural home for a real italic atlas (alongside
faux-italic skew).

### What actually landed, vs. the predictions below

The 2b insight list was right on every load-bearing call. Four notes worth adding:

- **Line metrics take each maximum independently.** The doc said "a line's metrics
  become the max over the runs on it", which is under-specified: with mixed fonts
  the tallest *ascender* and the tallest *line box* can belong to different runs.
  `lineMetrics` maximises them separately. With one font both maxima land on the
  same character, so single-font layout is unchanged — that equivalence is what
  made this safe.
- **`measureSpan`/`measureLines` became free functions over `LayoutRuns`**, in the
  new `src/MSDFMeasure.ts`. `MSDFFont` keeps thin single-font wrappers, so the
  public `measureText`/`measureLines` signatures survive. `maxScaleIn` generalised
  into `lineMetrics` exactly as predicted.
- **`configureFont` gained a per-glyph call, not a per-glyph cost.** The renderer
  resolves one `FontBinding` per font up front (texture, `uUnitRange`,
  `1/distanceRange`, `isMtsdf`), and only calls the gate inside the loops when
  `_runFonts.length > 1`. A single-font text configures once, outside the passes —
  the pre-2b code path, byte for byte.
- **Decoration rects grew a `fontIdx`.** Underline position/thickness are
  font-relative, so rects split at a font boundary; and giving each rect its run's
  texture keeps a `solid` quad from forcing an extra flush.

### 2b insights (frozen before starting — all held)

- **The 2a/2b split held for a sharper reason than "size is cheaper."** The
  shared variable-line-metrics refactor turned out to be *all* of 2a and *none*
  of the hard part of 2b. 2b's cost is in the renderer and the loader, not the
  metrics — none of it got cheaper by riding along with 2a.
- **Per-run size is a *multiplier*, not absolute px.** (Shipped.) Absolute px
  goes stale — `setFontSize(32)` on an object holding a 48px run would keep the
  run at 48 — and `fitInside`'s binary search loses monotonicity. The same
  reasoning does *not* apply to `font`, which has no scalar to go stale.
- **The indices-first `computeWrap` (provenance) is the enabler.** Run-aware
  wrap measurement is "look up the active run for this source index" — trivial
  because the wrap loop already walks source indices.
- **Kerning: only between glyphs in the same font at the same size.** Kern pairs
  across fonts don't exist and across sizes are ambiguous. The gate at
  `MSDFText.ts:1441` becomes `scale === prevScale && fontIdx === prevFontIdx`,
  and `MSDFFont.measureSpan` must make the identical call or wrapped lines
  mismeasure. Document it.
- **The font map has the same shape as `_sizeScales`.** A source-indexed
  `Uint8Array` of indices into a small `_runFonts: MSDFFont[]`, `null` on the
  uniform fast path, re-indexed onto the wrapped string by the same
  `wrappedScales` walk. Do **not** invent a per-character object array.
- **Measurement stops being a method on one `MSDFFont`.** This is the single
  architectural move 2b forces: `measureSpan` / `measureLines` become functions
  over a run-aware font source. `maxScaleIn` generalises from "max multiplier on
  this line" to "max line metric on this line", since `lineHeight` / `ascender`
  now vary per run too.
- **`uPxRange` / `uAtlasSize` do *not* become per-glyph.** (This corrects an
  earlier claim in this doc and in `README.md`.) Once `outlineWidth` and
  `shadowSoftness` are normalised as fractions of `distanceRange` — which
  `vertex-params.md` does — `uPxRange` cancels out of every shader branch and
  survives only as the per-texture ratio `distanceRange / atlasSize`. Glyphs
  sharing a texture always share that ratio, since a merged atlas carries one
  `distanceRange` by construction. **Per-run font is a texture-binding problem
  and nothing else.**
- **After `vertex-params.md`, the texture is the renderer's *only* flush gate —
  and the gate already exists.** Vertex-params step A builds
  `configureFont(texture, unitRange)` in `configurePass`'s place, because
  setting `uUnitRange` per object without a check-and-flush would perpetuate a
  live multi-font uniform-ordering bug the renderer has today (see finding 3
  there). 2b's renderer work is extending that gate to switch textures.
  **Gotcha:** it must set the new binding *after* the flush, never before —
  `MSDFBatchHandler.run()` reads the uniforms at draw time, so setting them
  early would render the previous font's queued glyphs with the new font's
  range.
- **No cross-font glyph fallback.** A character missing from its run's font is
  skipped (no advance), exactly as a missing character is today — do not fall
  back to the object's base font or any other run's font. Consistency over
  cleverness; revisit only with real demand.
- **2b single-texture batching is an optimisation, not a prerequisite.** First
  draft: a run whose font uses a different texture just flushes the batch — fine
  at text scale. The native single-batch path comes later: msdf-atlas-gen packs
  multiple fonts into one atlas (`-and`-separated inputs → one PNG + one JSON
  with per-font variants); teach `MSDFFontParser` to yield N `MSDFFont`s from
  such a JSON and `MSDFFontFile` to upload the texture once and register all of
  them. Pure optimisation, no renderer change.
- **The MTSDF guard becomes per-glyph.** `fieldType` varies per font, so the
  `isMtsdf` check at `MSDFTextWebGLRenderer.ts:194` cannot stay object-level.
  `vertex-params.md` already moves it to a pack-time clamp — another 2b cost
  paid early.
- **Stay one über-shader; don't split basic/dynamic variants.** Dynamic shader
  composition (which Phaser 4 uses elsewhere) means different programs for
  differently-featured texts — and different programs can't share a batch,
  defeating the point of batched text. Revisit only on a real measurement (same
  bar as tree-shaking).
