# `fitInside(rect, options?)` — reflowing fit-to-box

**Status:** designed, not implemented. **Dependencies:** none (needs a small
parameterisation of `wrapText`, described below). Fully independent of the rich
text work.

## Motivation

A naive fit — `scale = min(boxW/width, boxH/height)` — adds nothing over what
already ships: MSDF scales crisply, and `setDisplaySize` / `displayWidth` /
`displayHeight` already set `scaleX/scaleY` for you. The *only* reason to touch
`fontSize` instead of `scale` is **reflow**: a larger font wraps to fewer words
per line, changing the shape of the block. That reflow is the entire value of
`fitInside`. So `fitInside` owns `maxWidth` + `fontSize` and finds the largest
font size whose *wrapped* layout fits the box.

## Public API

```ts
interface RectLike {
    x?: number;       // absent ⇒ size only (don't move the object)
    y?: number;
    width: number;
    height: number;
}

interface FitOptions {
    /** Upper bound on font size. Default: the current fontSize (shrink-only). */
    maxFontSize?: number;
    /** Lower bound; only a non-degenerate floor. Default: 1 (see note). */
    minFontSize?: number;
    /** Horizontal placement of the block within the box. Default 'left'. */
    hAlign?: 'left' | 'center' | 'right';
    /** Vertical placement of the block within the box. Default 'top'. */
    vAlign?: 'top' | 'middle' | 'bottom';
    /** Binary-search stop tolerance in px. Default ~0.25. */
    precision?: number;
}

fitInside(rect: RectLike, options?: FitOptions): this;   // chainable
```

- **Single argument, our own `RectLike`.** Not an overload, not `x/y` scattered
  into `options`. A box is one cohesive thing (`x, y, w, h`); how to fit into it
  is the second thing. `RectLike` is structurally compatible with
  `Phaser.Geom.Rectangle`, so callers holding a real Phaser rect can pass it
  directly, but we don't depend on the Phaser type.
- `{ width, height }` alone ⇒ resize only. Add `x/y` ⇒ also place, using
  `hAlign`/`vAlign` (which are ignored when `x/y` are absent). **`x` and `y`
  must be provided together** — placement needs a full anchor point, so a rect
  with only one of them is treated as size-only (dev-warn to catch the
  mistake).
- **Shrink-only by default.** `maxFontSize` defaults to the current `fontSize`,
  so the common case ("this label must not overflow its box") never enlarges.
  Pass a larger `maxFontSize` to allow growth-to-fill.

### `minFontSize` note

There is no principled reason for `1` — it is only a non-degenerate floor. The
one hard constraint is `> 0`: size `0` collapses width to `0` and breaks
`displayWidth`/alignment (divide-by-zero) and produces a zero-area block. The
search only approaches the floor when *nothing* fits, so the floor is just the
"give up" size. `1` is a fine "too small to read anyway" default; expose
`minFontSize` for callers who disagree. Per the design discussion we do **not**
special-case the can't-fit overflow beyond clamping to this floor.

## Algorithm

The predicate `fits(size)` = "the text, wrapped at `boxW`, measures within
`(boxW, boxH)`" is **monotone** in `size`: increasing font size strictly grows
line height and never decreases the line count (words only wrap *more*), so
total height is non-decreasing. Therefore binary-search the largest size that
fits.

```
maxFontSize = options.maxFontSize ?? this._fontSize
minFontSize = options.minFontSize ?? 1
precision   = options.precision   ?? 0.25
boxW, boxH  = rect.width, rect.height     // guard: both > 0, else no-op/return this

// Free hard upper bound: any layout is at least one line tall, so
// size * lineHeight <= boxH  ⇒  size <= boxH / data.lineHeight.
hi = min(maxFontSize, boxH / this.fontData.data.lineHeight)
lo = minFontSize

fits(size):
    wrapped = computeWrap(this._text, boxW, size).text   // see note below
    m = this.fontData.measureLines(wrapped, size, this._lineSpacing, this._letterSpacing)
    return m.totalWidth <= boxW && m.totalHeight <= boxH

if hi <= lo:
    chosen = lo                         // box shorter than one line even at the
                                        // floor — give up at the floor (the
                                        // same clamp as the can't-fit case)
elif fits(hi):
    chosen = hi                         // current size already fits ⇒ no shrink
else:
    while hi - lo > precision:
        mid = (lo + hi) / 2
        if fits(mid): lo = mid
        else:         hi = mid
    chosen = lo                         // largest tested size that still fits

this.fontSize = chosen                  // setter flips _dirty
this.maxWidth = boxW                    // setter flips _dirty; keeps it wrapped
if this._dirty: this.rebuildText()      // so width/height/displayOrigin are current
placeInBox(rect, options)               // only if rect.x/rect.y provided
return this
```

Notes:

- **Width constraint is still checked.** Height monotonicity is what makes the
  search valid, but a single unbreakable word can exceed `boxW` even when height
  fits, so `fits()` checks both. That folds into the same predicate — no
  special-casing.
- **`wrapText` must be parameterised by font size.** Today `wrapText(text,
  maxWidth)` reads `this._fontSize` internally (via `measureText(..,
  this._fontSize, ..)`), so it can't measure a candidate size. Introduce a
  private `computeWrap(text, maxWidth, fontSize)` (or add a `fontSize` param to
  `wrapText`) that takes the size explicitly. This is *also* the seam the
  provenance refactor needs (see `rich-text-provenance.md`), so coordinate:
  `computeWrap` should return the structured `{ text, srcIndex, ... }` there;
  here we only read `.text`.
- **`lineSpacing`/`letterSpacing` are constant pixels** — they do not scale
  with the candidate size. Monotonicity still holds (both are additive and
  non-negative), but at small chosen sizes the layout can be
  spacing-dominated. Both default to `0`, and a caller who wants proportional
  spacing can rescale them after the fit — document, don't auto-scale. The
  same applies to shadow offset `x/y`.
- **The chosen size is fractional** (e.g. `23.4062`) — intended: MSDF is crisp
  at any scale and rounding away box space buys nothing. Callers who want an
  integer can safely `Math.floor` the result themselves (shrinking preserves
  fit by monotonicity; rounding *up* can overflow). Document rather than
  adding an option.
- ~15 iterations to sub-pixel; each does one `computeWrap` + one `measureLines`
  (both O(n)). This is a one-shot call, not per-frame — cost is fine. An
  optional optimisation is to seed `lo`/`hi` from a single analytic estimate
  (`chosen ≈ currentSize · boxW / measuredWidth`) to cut iterations, but plain
  bisection is the spec.

## Placement (`placeInBox`) — origin-robust

Only runs when `rect.x`/`rect.y` are provided. Must **not** assume or modify the
origin; use the scaled display size and current origin so arbitrary origin and
any pre-existing user scale are respected. Phaser maps the origin point to
`this.x/this.y`, and the block occupies local `[0,width]×[0,height]`.

```
dw = this.displayWidth          // = width  * scaleX (respects user scale)
dh = this.displayHeight         // = height * scaleY
hf = { left: 0, center: 0.5, right: 1 }[hAlign ?? 'left']
vf = { top:  0, middle: 0.5, bottom: 1 }[vAlign ?? 'top']
this.x = rect.x + (rect.width  - dw) * hf + this.displayOriginX
this.y = rect.y + (rect.height - dh) * vf + this.displayOriginY
```

`displayOriginX/Y` are `originX/Y * width/height` (already what the renderer
subtracts). Placement **ignores rotation** — document that rather than solving
rotated-box fitting.

## Side effects & docs to write

- Permanently sets `fontSize` **and** `maxWidth` (to `boxW`). This is intended:
  the wrap width is what keeps the text fitted. `fitInside` is a one-shot
  operation — if the text later changes, it re-wraps at `boxW` but does not
  re-fit the size; call `fitInside` again. Document both mutations.
- The `rect` overload moves the object (`x/y`); the size-only form does not.
  Document that difference — it's the one surprise.
- Does **not** account for outline width / shadow offset (they already fall
  outside `width`/`height` everywhere else in the API). Document for
  consistency.
- Document the fractional result and the non-scaling of spacing / shadow
  offsets (see Algorithm notes).

## Files / methods to touch

- `src/MSDFText.ts`
  - New `fitInside` method on the Class prototype (near `setDisplaySize`).
  - Parameterise wrapping by font size: `computeWrap(text, maxWidth, fontSize)`
    (shared with the provenance refactor) or a `fontSize` arg on `wrapText`;
    update the two existing callers (`rebuildText`, `getTextBounds`).
  - New `RectLike` / `FitOptions` types; export `RectLike` from `index.ts`.
- `src/MSDFText.ts` interface `MSDFTextInstance` — add the `fitInside`
  signature.
- `README.md` — API section.

## Verification

- Wrapping box, long paragraph: shrinking the box height reduces the chosen font
  size; widening it (fixed height) *increases* it (fewer lines). Confirm the
  block never exceeds either dimension at the chosen size, and just exceeds at
  `chosen + precision`.
- Single unbreakable word wider than the box: size drops until the word fits
  `boxW` (width path, not height).
- `maxFontSize` default: text that already fits is left at its current size
  (no enlargement). With `maxFontSize` raised, it grows to fill.
- Placement: with a non-zero origin and a pre-set `scale`, all nine
  `hAlign`×`vAlign` combinations land the block inside the rect exactly.
