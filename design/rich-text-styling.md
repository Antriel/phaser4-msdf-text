# Rich text — per-run styling API (+ skew)

**Status:** designed, not implemented. **Dependencies:** `srcIndex` from
`rich-text-provenance.md` (for source→glyph mapping). The **skew** section at
the end is self-contained and has no dependency on the rest — it can land
independently.

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

Everything here is **appearance-lane** (Phase 1): it seeds `GlyphState`, never
changes layout, composes with `displayCallback`, and is animatable. Structural
per-run styling (`fontSize`, `font`) is Phase 2 — see the end.

## The appearance/structural split (why this is all seeding)

Locked decision from the design session:

| property | lane | applied | reflows? | per-frame animatable |
|---|---|---|---|---|
| colour, alpha, gradient | appearance | seed | no | yes |
| outline, shadow | appearance | seed | no | yes |
| scale, rotation, **skew** | appearance | seed | no | yes |
| **`fontSize`**, **`font`** | structural | rebuild | **yes** | no |

`displayCallback` stays appearance-only (its contract is "mutate resolved state,
we read it straight to the GPU" — there is no relayout hook in that path).
Structural size/font are set on segments and take effect on rebuild. Do **not**
put `fontSize` on `GlyphState`.

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

// Phase 2 structural keys (per-run size, font) go HERE — and, optionally, on a
// distinct RuleStyleSpec for setTextStyle (both resolve before layout). They must
// never reach StyleSpec, which is the range/override spec applied AFTER layout —
// see "Refinement: where structural keys may live" above. Ranges/callback stay
// appearance-only forever so handle.update() keeps its "cheap re-seed, never
// relayout" contract.
interface SegmentSpec extends StyleSpec { text: string; }
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

`outline` deliberately omits `width`/`rounded`, and `shadow` omits `softness` —
those are per-batch uniforms today, so per-run values would break batching. Do
**not** solve that with segment-level "breaks-batching" configs (an awkward
middle that builds a flush mechanism we'd later delete); the plan of record is
to promote them to per-glyph state via the Phase 2 `params` vertex attribute
(see Phase 2 insights), at which point they join the appearance lane like
everything else.

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

## Skew (self-contained; no dependency on the styling API)

A CPU baseline shear — faux italic. Can ship independently of everything above;
it's just a new `GlyphState` transform.

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

## Files / methods to touch

- `src/MSDFGlyphState.ts` — add `skew` (and it already gains
  `srcIndex/line/srcLine` from provenance); seed `skew = 0`.
- `src/MSDFText.ts` — `setRichText`, `setTextStyle`, `addStyleRange`,
  `clearStyles`; the three stores + `_hasStyles` + `_stylesDirty`;
  `applyStyleRuns`; rule re-matching + segment/range clearing on text change
  (`setText`/`setRichText`); fold into `prepareGlyphStates`; extend the rebuild
  re-seed path to fire on `_hasStyles`/`_stylesDirty`; `StyleSpec`/
  `SegmentSpec`/`StyleHandle` types; store `baselineY` per char (shared with
  provenance).
- `src/MSDFTextWebGLRenderer.ts` — `perGlyph` includes `_hasStyles`; keep the
  seed → segments → rules → ranges → callback order; read `g.skew` and route
  through the matrix path.
- `src/MSDFTextWebGLRenderer.ts` / `src/BatchMSDFChar.ts` — apply the baseline
  shear (compose `calcMatrix · shear`; transform absolute corners for skewed
  glyphs).
- `index.ts` — export new public types.
- `README.md` — rich-text section (three entry points + lifecycle table); skew
  on the glyph state.
- `examples/` — a rich-text demo page (the verification artifact).

## Verification

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

## Phase 2 — variable line-metrics (out of scope here)

Per-run **`fontSize`** and per-run **`font`** are structural: they change wrap,
advance, and per-line height/baseline (a line's metrics become the max over the
runs on it). Both ride the *same* refactor — variable line metrics in
`rebuildText` + the `MSDFFont` measurement functions — gated behind a "does any
run override size/font?" check so the single-font fast path is untouched when
unused.

- **`font`** batches only when runs share the atlas **texture** and
  **`distanceRange`** (the merged-atlas trick — same `uPxRange`/`uAtlasSize`, so
  one draw call; different glyphs just index different atlas regions). A
  different texture breaks the batch (flush/switch) — Phase 2+ or documented as
  a batch break. This turns the current multi-instance merged-atlas workaround
  into first-class mixed-font runs in one object, and is the natural home for a
  real italic atlas (alongside faux-italic skew).
- **Faux weight (bold)** needs a per-vertex attribute + a shader distance
  threshold (unlike skew, which is pure geometry) — do it when the shader is
  being touched anyway.
- **Underline / strikethrough** need run-span rectangle geometry + a
  solid-colour `uMode` (the atlas has no guaranteed solid texel). Lower value;
  defer.

### Phase 2 insights (freeze these before starting)

- **Split it: 2a = per-run size, 2b = per-run font.** Size is pure layout math
  — same atlas, same texture, `uPxRange`/`uAtlasSize` unchanged, batching
  untouched. Font drags in loader sharing, kerning tables, and batch breaks.
  2a first; it is most of the user value at a fraction of the cost.
- **Per-run size is a *multiplier* on the object `fontSize`, not absolute px**
  (structural key on `SegmentSpec`, e.g. `fontScale: 1.5`; name it distinctly
  from the appearance `scale`). Absolute px goes stale — `setFontSize(32)` on
  an object holding a 48px run would keep the run at 48, almost never wanted —
  and `fitInside`'s binary search loses proportionality/monotonicity. A
  multiplier keeps both correct for free.
- **The indices-first `computeWrap` (provenance) is the enabler.** Run-aware
  wrap measurement is "look up the active run for this source index" — trivial
  when the wrap loop already walks source indices, a refactor if it didn't.
  Layout becomes two scans per line: find the line's max ascent/descent over
  its runs, then place glyphs on the shared baseline (align baselines, not
  tops).
- **Kerning: only between glyphs in the same font at the same size.** Kern
  pairs across fonts don't exist and across sizes are ambiguous — skip at run
  boundaries that change either, and document it.
- **Touch the vertex layout once: add a `params` byte4 — and it's already
  fully spoken for:** `[weight, flags (solid | rounded), outlineWidth,
  shadowSoftness]`. Width/softness quantise to a byte as a fraction of the
  atlas `distanceRange` (256 steps — imperceptible). This promotes today's
  batch-breaking uniforms (`uOutlineWidth`, `uOutlineRounded`,
  `uShadowSoftness`) to per-glyph appearance state, so per-run outline width
  stops being a batching question at all, and the "solid" flag covers
  underline/strikethrough per-vertex — the rects batch with the glyphs, no
  per-rect `uMode` flush. `MSDFFontParser` already carries `underlineY` /
  `underlineThickness` from the atlas JSON, so the geometry data is free.
  Caveat to document: faux bold widens glyphs without changing advance
  (letters can touch), and the threshold shift is bounded by `pxRange` like
  outline width.
- **`params` is per-vertex, so its continuous channels can go *per-corner* for
  free** — exactly like `inColor`/`inOutline` already do. Stop replicating the
  four copies and the shader receives an interpolated value across the quad:
  per-corner `outlineWidth` → a directional/asymmetric outline (animate the
  corners → the wobble effect), per-corner `shadowSoftness` → a shadow that is
  soft on one edge and crisp on the other, per-corner `weight` → a faux-bold
  gradient. Zero extra shader cost beyond the promotion. Two honesty caveats:
  (1) the interpolation is **linear across the glyph's bounding box in texcoord
  space**, not along the letter contour — a directional ramp, not a
  contour-following pulse; (2) this is a natural extension of the per-corner
  colour model, so if surfaced it should mirror it (`PerCorner<number>` on the
  relevant `GlyphState`/`StyleSpec` fields).
- **`rounded` is the exception — it can't interpolate as packed.** This shader is
  GLSL ES 1.00 (WebGL1: `attribute`/`varying`, `GL_OES_standard_derivatives`),
  which has **no `flat` qualifier** — every attribute interpolates. A packed
  bitfield can't survive interpolation, so the `flags` byte (`solid | rounded`)
  must stay **constant across a quad's 4 vertices**, i.e. per-glyph only.
  Ironic, because `uOutlineRounded` is *already continuous* in the shader
  (`mix(dist, tsdf, rounded)`), so per-corner rounded would blend sharp-MSDF
  into rounded-SDF beautifully — it just needs its **own continuous byte**, not
  a bit in `flags`. Room exists later if wanted: `solid` (underline/strike
  rects) never uses `weight`/`outlineWidth`/`shadowSoftness`, so it can be a
  **sentinel value** in one of those channels instead of a dedicated bit (safe:
  all 4 corners of a rect share values, and a rect quad never shares
  interpolation with a glyph quad), freeing a real byte for continuous
  per-corner `rounded`. Day-one: `rounded` stays per-glyph.
- **Stay one über-shader; don't split basic/dynamic variants.** Dynamic shader
  composition (which Phaser 4 uses elsewhere) means different programs for
  differently-featured texts — and different programs can't share a batch,
  defeating the point of batched text. The added fragment cost (one threshold
  add; attribute reads instead of uniform reads) is negligible at text-scale
  glyph counts. Revisit only on a real measurement (same bar as tree-shaking).
- **2b single-texture batching is an optimisation, not a prerequisite.** First
  draft: a run whose font uses a different texture just flushes the batch —
  fine at text scale, provided the renderer code stays clean (a texture check
  alongside the existing `configurePass` flush points). The native
  single-batch path comes later: msdf-atlas-gen packs multiple fonts into one
  atlas (`-and`-separated inputs → one PNG + one JSON with per-font variants);
  teach `MSDFFontParser` to yield N `MSDFFont`s from such a JSON and
  `MSDFFontFile` to upload the texture once and register all of them.
