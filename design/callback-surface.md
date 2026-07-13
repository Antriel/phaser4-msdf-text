# The callback surface — a pass over `displayCallback`, and decorations

> **Status: built.** All four items in "Suggested order" below landed, in that
> order, as described — `text.lines` + a cached `getTextBounds()`,
> `GlyphState.visible`, the decoration callback, and `GlyphState.setGlyph`. The
> optional sugar in 1d (`pivotX`/`pivotY`, `shadow.scale`) was **not** built.
> What the build settled beyond the design is recorded at the end.

Two questions, one doc, because the second is only answerable once the first has
established what the per-frame callback lane *is*.

1. **Is `GlyphState` complete?** What can the renderer express per quad that the
   display callback cannot reach?
2. **Decorations** — the last open item in `future-ideas.md`. Can a callback see
   and animate underlines, strikethroughs and highlight pills, and if so, through
   what?

---

## Part 1 — is the glyph callback complete?

The question has an unusually crisp form here, because the vertex format is small
and closed. A quad can carry exactly:

| slot | per corner? | what reaches it today |
| --- | --- | --- |
| `inPosition` | yes | `x`/`y`, `scaleX`/`scaleY`, `rotation`, `skew`/`skewPivot`, `offsetX`/`offsetY` |
| `inTexCoord` | (per quad — `u0..v1`) | **nothing** |
| `inColor` | yes | `fill.color`/`.alpha`; `shadow.innerColor` / `outline.innerColor` on the no-fill quads |
| `inOutline` | yes | `outline.color`/`.alpha`, `shadow.color`/`.alpha` |
| `inParams` | yes | `weight`, `outline.width`/`.rounded`/`.softness`, `shadow.spread`/`.rounded`/`.softness` |

Plus the per-texture uniforms (`uUnitRange`, the sampler), which are properties of
the *font*, not of a glyph, and correctly out of reach.

So the audit reduces to three questions, not twenty: **what about the texcoords**,
**what about the things that are not vertex data at all** (visibility, order,
blend state), and **what about the ergonomics of the array itself**. Everything
else is already covered, and covered per-corner.

### 1a. The one hole in the format: texcoords — `setGlyph()`

`GlyphState.charCode` is readonly and the quad's UVs are taken straight from
`_characters[i]`. A glyph is therefore the letter the string said it was, for ever.
The effects this forecloses are a real family and not an exotic one: the
Matrix-style **scramble/decode reveal**, slot-machine letters, a censor bar that
churns, a glitch that swaps one letter for a wrong one for three frames.

The only route today is `setText()` per frame, which is wrong twice over. It is a
full rebuild — wrap, measure, relayout, re-seed, decoration rebuild — and it
**reflows**: the substitute's advance differs, so the line breathes as the letters
churn, which is precisely the artifact a scramble must not have.

**The proposal.** `GlyphState.setGlyph(charCode)` (and a `glyph` field, `0` =
"draw the character you were laid out as"). It is a *render-time substitution*: the
layout keeps the original's pen position and advance, and the renderer draws a
different letterform in that slot.

The renderer resolves it, not the glyph state, so no font reference has to be
stashed on the state object:

```ts
// once per glyph, above the passes
const char = characters[i];
const draw = (perGlyph && glyphs[i].glyph !== 0)
    ? swapQuad(char, glyphs[i].glyph, runFonts[char.fontIdx])
    : char;
```

`swapQuad` rebuilds a shared temp quad from the substitute's own metrics at the
original's pen position — the same four lines `rebuildText` already runs
(`x = penX + sub.xOffset * em`, `y = baselineY + sub.yOffset * em`,
`w = sub.normalizedWidth * em`, `h`, and the four UVs, **with the `v0`/`v1` swap**
the char build does). One temp object serves every pass, because each pass submits
immediately.

**Cost: one new field on the char quad.** `_characters[i]` stores `x` (the quad's
left edge = `cursorX + xOffset * size`) but not `cursorX`, and a substitute needs
the pen, not the quad. So `rebuildText` must also store `penX`. That is the entire
structural cost; the rest is ~15 lines in the renderer and a `getChar` that may miss
(a substitute absent from the run's font falls back to the original — never to
another font, per the no-cross-font-fallback rule).

**What stays honest about it:** the layout does not move. A wide substitute
overhangs its slot, a narrow one leaves a gap. That is the *correct* behaviour for
every effect in the family above — the churn happens in place — and it is also why
this is a glyph-array feature and not a `StyleSpec` key. Specs are layout inputs;
this is layout output.

`readonly width`/`height` keep describing the **layout box**, not the drawn quad,
and should say so: a deform written as a field over text space is anchored to the
slot, which is what keeps it coherent while the letters churn.

### 1b. Not in the format at all

**`visible: boolean` — add it.** Today the only ways to hide a glyph are a zero
alpha or a zero scale, and *both still submit the quad* — the render loops gate on
`char.w === 0 || char.h === 0` (the layout box), never on the glyph state. A
typewriter reveal on a 500-glyph text with a shadow and a layered outline therefore
pushes ~1500 quads of nothing through the batch every frame until the last letter
lands. A `visible` check is one compare per glyph per pass and it deletes all of
that. It is also the honest word: "not typed yet" is a statement about existence,
not about opacity.

**Per-glyph blend mode — rejected.** An additive glyph is a blend-state change, and
a state change is a draw-call break. It would trade the library's one structural
promise (a shadowed, outlined, highlighted, decorated text is *one draw call*) for
an effect that a second text object on top can already produce.

**Per-glyph draw order / `z` — rejected.** Submission order *is* z (no depth
buffer), and the glyph array cannot be reordered: `applyRun` binary-searches it on
`srcIndex` and depends on that array being strictly increasing. An order would need
a parallel index array sorted per frame, and it buys only the case where two glyphs
overlap — which needs scale or deform large enough to be a special effect already.

### 1c. The ergonomics gap, and it is the sharpest finding here

**`getTextBounds()` re-wraps and re-measures the entire text on every call.** It
calls `computeWrap` (a full word-wrap) and then `measureLines` (a full pass over
every character, with kerning) — from scratch, ignoring the fact that `rebuildText`
computed *exactly this* moments earlier and threw it away.

That would be a footnote, except that calling it from a display callback is the
**natural thing to do**, and the natural thing to do every frame. `CLAUDE.md` sells
"a deform written as a field over text space" as *the* deform idiom — and a field
needs a domain: the text's width, the line's extent, the distance from the centre.
So the documented idiom quietly re-lays-out the whole text once per frame.

**The fix is to keep what the rebuild already computed.** `rebuildText` holds a
`lineData` with `baselines[]`, `widths[]`, `totalWidth`/`totalHeight`, and drops all
but the baselines. Retain it as `_lines` and expose a readonly view:

```ts
readonly lines: ReadonlyArray<{
    index: number;      // visual line
    x: number;          // left edge after alignment
    width: number;
    baselineY: number;
    top: number;        // highest ascender on the line
    bottom: number;     // deepest descender
}>;
```

Then `getTextBounds()` returns the cached values when the text is not `_dirty`
(re-measuring only when it is), and a callback normalizing a wave against its line
costs an array read. This is the one item in Part 1 that fixes something that is
*wrong* rather than merely absent.

### 1d. Cheap sugar, if wanted

- **`pivotX` / `pivotY`** (em, from the quad centre; `0,0` = today). Scale and
  rotation pivot the glyph's centre, hardcoded. "Letters tip over onto their feet"
  wants the baseline. It is *reachable* today — an affine map about any pivot is a
  parallelogram, so the deform expresses it — but only by writing the trig
  yourself, which is exactly the argument that made `skewPivot` sugar worth having.
  Note the convention clash and resolve it in the docs, not with a third
  convention: `skewPivot` is measured **from the baseline** because a *line* must
  shear coherently about a shared anchor; a rotation pivot has no such constraint,
  so it is measured from the centre and `(baselineOffset - height / 2) / em` is the
  one-liner that lands it on the baseline. Both numbers are already readonly on the
  state.
- **`shadow.scale`** (a scalar multiplying the glyph's own scale, about the same
  centre). The shadow quad already takes an independent `x`/`y`/`softness`/`spread`/
  `rounded`, but inherits the glyph's transform exactly — so the classic "letter
  lifts off the page" (glyph rises, shadow *grows*, blurs and fades) is missing
  precisely one factor. The shadow pass already calls `submitOneGlyph` with a scale
  argument; this is a multiply at the call site.

### 1e. Two doc lines that are missing, not features

- The callback **does not run while the object is culled or invisible** — it is
  driven by the render function. Effects that integrate state inside the callback
  (rather than recomputing it from a clock) will freeze off-camera. The callback is
  transient by design, so this is a doc note, not a bug.
- Callback mode **re-seeds and re-applies every style run every frame**
  (`prepareGlyphStates` → `seedGlyph` × n → `applyStyleRuns`). That is the price of
  the transient contract and it is worth stating next to `editGlyphs`, which is the
  escape hatch from it.

---

## Part 2 — decorations

### The finding that decides the whole shape: rects have no identity

`future-ideas.md` proposes "a lightweight per-rect state object, seeded and read
back the same way glyphs are." The second half of that sentence is wrong, and the
reason is worth pinning down because it *simplifies* the feature rather than
complicating it.

A glyph has an identity: `srcIndex`. It survives a re-wrap, a font change, a style
edit; it is what `applyRun` binary-searches and what lets a user re-apply their
`editGlyphs` edits after a `'glyphsreset'` ("the glyph at source index 7").

**A rect has none.** A rect is a *merge artifact* — "consecutive characters, same
visual line, same resolved spec, same `fontScale`, same font, and (when the colour
is inherited) the same resolved fill colour." Change the wrap width and one rect
becomes two. Change a style and the boundaries move. There is no "the underline
under CRITICAL" for a user to hold onto across a rebuild.

Two consequences fall straight out:

- **No manual mode for rects.** Handing a user an array to own across rebuilds is
  only meaningful if they can find their elements again afterwards. They cannot. So
  there is no `editDecorations()`, no `resetDecorations()`, no
  `'decorationsreset'` event — and that asymmetry with the glyph lane is *justified*,
  not an omission.
- **The cost argument for manual mode evaporates anyway.** Manual mode exists for
  glyphs because re-seeding a thousand `GlyphState`s (each with ~20 `Corners`
  objects) every frame is real work you should be able to opt out of. A text has a
  *handful* of rects. Seeding all of them costs less than seeding one glyph.

**So: a transient, per-frame callback, and nothing else.** Which also passes the
test `future-ideas.md` itself set — "an input the renderer can resolve at submit
time needs no state object". Check it against the four things people actually want:

| want | reachable at submit time? |
| --- | --- |
| underline colour follows a tween | **yes, already** — an inherited colour resolves at submit |
| marching ants | **yes, already** — `dashPhase` slides the U origin |
| typewriter reveal of a rule | no — each rect needs its own progress |
| a rule that follows a skewed/rotated line | no — each rect needs its own transform |
| a pill that pops in per highlighted word | no — each rect needs its own scale |

The last three earn the array. The first two are the reason it does not need to be
big.

### A second callback, not a third argument

`displayCallback(glyphs, text, rects)` is tempting and wrong. **Decorations live in
every glyph mode** — `rebuildDecorations` runs regardless of `_glyphMode`, because
it reads `_characters`, not the glyph array. Folding rects into the glyph callback
would force a user who wants a wobbling underline on a 2000-glyph text into
`GLYPH_MODE_CALLBACK`, and with it a full per-frame re-seed of 2000 glyph states
plus every style run — to animate three rects. That is a hundredfold cost for an
effect that touches none of it.

```ts
type DecorationCallback = (rects: DecorationState[], parent: MSDFTextInstance) => void;

text.setDecorationCallback(cb);   // → _decorMode = CALLBACK
text.clearDecorationCallback();   // → _decorMode = STATIC
text.decorations;                 // readonly DecorationState[] | null (null in static mode)
```

Two modes, not three. Zero cost when unused: in static mode there is no state array,
no seed, and `submitDecorations` runs exactly the path it runs today.

The internal shape mirrors the glyph lane exactly, which is the whole argument for
it being easy to review: **`_decorRects` is to `_characters` as `_decorStates` is to
`_glyphStates`** — a pristine built array, and a per-frame mutable copy seeded from
it. `seedRect` is `seedGlyph`'s sibling, and it resolves the same kinds of sentinel:
where `seedGlyph` turns `innerColor: -1` into the outer colour so no glyph ever sees
the sentinel, `seedRect` turns an *absent* `rgb`/`alpha` (which means "inherit the
object's") into the resolved live value, so no callback ever sees an `undefined`.

### The state object

```ts
interface DecorationState {
    // provenance — readonly
    readonly pass: number;        // PASS_HIGHLIGHT | PASS_UNDERLINE | PASS_STRIKE (already exported)
    readonly line: number;        // visual line
    readonly srcStart: number;    // source-string range this rect covers
    readonly srcEnd: number;
    readonly glyphStart: number;  // window into the glyph array — free: buildDecorRects
    readonly glyphEnd: number;    //   already walks `chars` with exactly these indices
    readonly fontIdx: number;     // the run's texture binding

    visible: boolean;

    // geometry, text-space px, seeded from the built rect
    x: number; y: number; w: number; h: number;
    scaleX: number; scaleY: number; rotation: number;   // about the rect's centre
    offsetX: Corners; offsetY: Corners;                 // per-corner deform, in **pixels**

    // appearance — every one already per-corner in the spec, so per-corner here
    color: Corners; alpha: Corners; innerColor: Corners;
    borderColor: Corners; borderAlpha: Corners; borderWidth: Corners;
    radius: Corners; softness: Corners;

    // dash
    dashCount: number;   // 0 = solid; > 0 folds U into that many cells
    dashDuty: Corners;
    dashPhase: number;   // seeded from the object's; per-rect marching ants come free
}
```

`glyphStart` / `glyphEnd` are the field that makes "follow your glyphs" a loop
rather than a search: `buildDecorRects` already walks the character array with `i`
and `j` bracketing exactly this window, so the two numbers cost a store and save
every callback a binary search.

**The pack rule at submit:** `dashCount > 0` selects `packDashParams(radius, duty,
softness)`, otherwise `packSolidParams(radius, borderWidth, softness)` — the same
`.b`-means-two-things fork the format already has, surfaced as a field instead of a
sentinel byte the caller never sees. It also means `dashCount` is *mutable and
meaningful*: setting it on a solid rule dashes it at runtime. (Seed `dashDuty` to
`0.5` on a rule that has no dash spec, so that switch does something sane rather
than emitting hairlines.) The border ring keeps `packBorder`'s zero-width alpha
gate, unchanged.

**Em vs pixels for the deform.** A glyph's deform is em-relative so that one value
moves a narrow `i` and a wide `W` by the same distance — the property that lets a
deform be written as a field over text space. A rect has no letterform and no such
problem, and its own coordinates *are* text space, so its deform is in **pixels**.
`BatchMSDFChar` already takes `deformX`/`deformY` plus an `em` scale; rects pass
`em = 1`.

### Ordering

The renderer resolves all state before it submits anything, so:

```
resolve glyphs  (seed → applyStyleRuns → displayCallback)
resolve rects   (seed → decorationCallback)          ← new, right here
submit: highlight → shadow → silhouette → underline → fill → strike
```

The rect callback therefore sees the **finished** glyph array (via `parent.glyphs`,
which is `null` in static glyph mode — a callback that wants to follow glyphs needs
a glyph mode, and that is a fair thing to require of it). Both resolutions already
sit above the first pass in the render function, so this is an insertion, not a
reshuffle.

`pass` stays **readonly**. Making it writable would let a callback re-order a rect
between the back-to-front slots, but what makes a rule an underline rather than a
strikethrough is its *position*, not its slot — so the only thing a mutable `pass`
buys is z-fighting with the fill, and it is a degree of freedom nobody asked for.

### What it still cannot do, stated plainly

**A rect is one quad, so a callback gets a parallelogram — never a curve.** An
underline can be tilted, tapered, translated, scaled, skewed. It cannot *wave*. So
the "deformable decorations" item in `future-ideas.md` is closed only in its common
case: a line of glyphs sheared or rotated *as a line* has a linearly-shifting
baseline, which is exactly a parallelogram, and the rule follows it exactly. A rule
under a per-glyph `Ribbon wave` still cannot follow the wave.

**The escape hatch, if that case ever gets real, is not in the callback.** It is a
build-side knob — a `DecorationSpec` that emits one rect **per character** instead
of merging the run — after which each rect owns one glyph, follows it exactly, and
the callback needs no new power at all. It costs a quad per character and refits the
dash grid per glyph (the known split cost), which is why it is opt-in and why it is
*not* proposed here: it should be built when someone wants the wave, not before.

**The deform warps the box SDF's units, and only on a non-parallelogram.** Worth
being exact, because it is the same class of reasoning the `params` format is built
on:

- **Translate, scale, rotate** are exact. The shader recovers `screenTexSize` from
  the true per-axis gradient magnitude, `length(vec2(dFdx(u), dFdy(u)))` — which is
  rotation-invariant and scales correctly — and `radius`/`borderWidth`/`softness` are
  fractions of the half-thickness, so they *should* scale with the pill. A scaled
  pill keeps `radius: 1` a stadium, which is the correct answer.
- **A sheared rect** (affine, so the derivatives are still constant across the quad)
  measures its half-extent *through* the shear, so the three fractions mis-scale
  slightly. Uniformly, with no drift. Cosmetic.
- **A non-parallelogram deform** makes the derivatives vary across the quad, so
  `screenTexSize` — which the solid lane reads as *the rect's pixel size* — becomes
  position-dependent, and `radius`/`border`/`softness` drift along the taper. A
  dashed rule keeps its cells evenly spaced in UV (the `fract` fold is untouched) but
  its caps warp with the local width. On a plain hard rule (all three payload bytes
  zero) the only casualty is the AA width, which is invisible.

None of this needs a fix. It needs the sentence: *a deformed pill is drawn in UV
space and warped with the quad; its radius follows the local thickness.* Which is,
for a tapering underline, what you would have asked for anyway.

### Deliberately not built

- **Pushing new rects from the callback.** The array is, in the end, a list of
  arbitrary solid quads that batch into the text's draw call — a caret, a progress
  bar, a sweep. Allowing `rects.push(...)` is one bounds-check on `fontIdx` away, and
  the transient contract even makes it safe (the seed truncates to the built count
  each frame, so a pushed rect must be re-pushed, which is the honest semantics).
  Left closed because pooling (a per-frame `push` allocates) and provenance (what are
  `srcStart` / `glyphStart` on a rect that covers no text?) both want an answer first,
  and neither has a use case pushing on it yet.
- **Manual mode** — see the identity argument above.
- **Rect shadows / outlines.** A rect already has a border ring and the two-tone
  ramp; it has no shadow pass, and giving it one means submitting it twice. No.

---

## Suggested order

1. **`text.lines` + a cached `getTextBounds()`** — fixes a real cost on the
   documented idiom, and every demo of the rest wants it. (Part 1c.)
2. **`GlyphState.visible`** — trivial, and it is the difference between a typewriter
   reveal being free and being 3× the quads. (Part 1b.)
3. **The decoration callback** — the whole of Part 2. Self-contained: a mode flag, a
   `seedRect`, a state array, an insertion in the renderer, and a `submitDecorations`
   that reads the state when there is one.
4. **`setGlyph`** — the texcoord hole. One field on the char quad, ~15 lines in the
   renderer, and a family of effects that currently cannot be done at all. (Part 1a.)
5. *Optional sugar:* `pivotX`/`pivotY`, `shadow.scale`. (Part 1d.)

Demos worth having, in the effects scene: a **decode/scramble** reveal (4), a
**typewriter** whose underline draws itself in behind the words (2 + 3), and a
**pop-in highlight** on a keyword (3).

---

## What the build settled

All three demos landed as `Decode (glyph swap)`, `Typewriter + rule` and
`Stamp (pill pop-in)` in the effects scene, which now carries both callbacks on
one text object — which is itself the clearest statement of why there are two.

- **The glyph swap needed one field, and it was not the obvious one.** The design
  said "store `penX`", and that was right, but it missed that **`applyAlignment`
  must shift the pen too** — it only ever moved `char.x`, and a centred or
  right-aligned text would have placed every substitute against the *unaligned*
  layout. The bearing delta also has to leave `resolveGlyphQuad` out of band
  (`swapDX`/`swapDY`) rather than being folded into the quad, or `g.x` would stop
  meaning "where the slot is" and a user moving a glyph would fight the
  substitution.
- **The alignment refactor was free.** A line's alignment inset *is* its
  `LineInfo.x`, so `applyAlignment` reads it from `buildLineInfo` instead of
  recomputing the formula — one source of truth, and the old duplicate is gone.
- **`getTextBounds()` on empty text changed**, and this is the one behavioural
  break in the whole batch: it used to report **one** line (it measured `''`, which
  `split('\n')` makes one empty line) with a height of one `lineHeight`. It now
  reports **zero** lines and a height of `0` — which is what `text.width` and
  `text.height` already reported for an empty text, so the object is now
  self-consistent where it previously contradicted itself. Called out here rather
  than hidden: code measuring an empty text to reserve a line's height will now get
  `0`.
- **`ResolvedDash` had to keep its unpacked values.** It stored only `period` plus
  the *packed* params, which a state cannot be seeded from. It now carries `radius`
  / `duty` / `softness` alongside; `params` stays for the static path, which never
  unpacks anything.
- **The static decoration path was left untouched.** `submitDecorations` is
  unchanged and `submitDecorationStates` sits beside it, rather than one function
  branching. The common case therefore carries no regression risk at all, and the
  duplication is the same shape the three glyph passes already have.
- **Verified in Node, not in a browser** (no automation available here): the line
  metrics' self-consistency, the alignment refactor being bit-identical to the old
  per-char formula at all three alignments, and — the risky arithmetic — that a
  substituted glyph lands exactly where the layout would have put that character
  given the same pen, that moving `g.x` still moves it 1:1, that the slot's advance
  is untouched, and that a code the font lacks falls back to the original.
