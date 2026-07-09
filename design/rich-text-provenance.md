# Glyph provenance — `srcIndex` / `line` / `srcLine` (+ wrap bug fix)

**Status:** implemented. **Dependencies:** none. **Prerequisite
for:** `rich-text-styling.md` (source→glyph mapping). Independently valuable — it
fixed a real bug.

## Motivation

Two problems, one fix:

1. **The wrap bug.** `wrapText` inserts `'\n'` characters and trims spaces, then
   `rebuildText` lays out the *wrapped* string. A user who counts source
   characters in a `displayCallback` to target a word gets wrong positions,
   because there is no mapping from a rendered glyph back to its position in the
   original `text`. Inserted newlines and skipped spaces desync the counting.
2. **No line identity.** A glyph knows its visual line (`char.line`) but nothing
   about which *source paragraph* it came from. Users want both: "alternate
   colours per wrapped line" (visual) and "colour the 2nd line of my string"
   (source).

The fix is to carry origin metadata per glyph through wrap + layout. This is the
foundation the styling API maps onto, and it corrects the callback bug on its
own.

## New per-glyph fields

Add three read-only fields to every glyph (on the `_characters` layout entries
and mirrored onto `GlyphState`):

- **`srcIndex`** — index into the original `this._text` (the string the user
  set, *before* wrapping). The robust styling target and the fix for the
  counting bug.
- **`line`** — visual line index, **post-wrap** (already tracked as
  `char.line`; just expose it on `GlyphState`). For "alternate wrapped-line
  colours".
- **`srcLine`** — source paragraph index: how many *original* `'\n'` precede
  this glyph. For "colour the Nth line of my source".

## The wrap map — distinguishing soft vs hard breaks

The crux is telling **soft breaks** (inserted by wrap) from **hard breaks**
(original `'\n'`), so `srcLine` counts only the latter while `line` counts both.

Refactor the wrap step to return, alongside the wrapped string, a parallel
source-index array:

```ts
interface WrapResult {
    text: string;        // wrapped text, as today
    srcIndex: number[];  // srcIndex[i] = source index of wrapped char i,
                         //   or -1 for a wrap-inserted '\n'
}
computeWrap(text: string, maxWidth: number, fontSize: number): WrapResult
```

Key trick: an **inserted** `'\n'` gets `srcIndex = -1`; an **original** `'\n'`
keeps its real source index. That single sentinel distinguishes soft from hard
breaks with no extra structure — the layout loop reads it directly.

When `maxWidth <= 0` (no wrapping) the map is the identity (`srcIndex[i] = i`)
and every newline is hard. Build the map unconditionally (it's cheap) so the
layout path is uniform.

`computeWrap` supersedes today's `wrapText(text, maxWidth)`:

- It takes `fontSize` explicitly (today `wrapText` reads `this._fontSize`),
  which `fitInside` also needs — coordinate the two.
- **Rewrite the loop indices-first; don't patch the string code.** The current
  `wrapText` splits on `'\n'` up front (losing source offsets), builds lines by
  string concatenation, and `.trim()`s wrapped lines — retrofitting index
  bookkeeping onto that shape is where the bugs will live. Instead, walk the
  source string by index and emit `(charCode, srcIndex)` entries (or the
  parallel `srcIndex` array directly) as the **primary** output, deriving the
  wrapped string *from* those entries as a projection. Then trimming a space
  means "don't emit that entry" and a soft break means "emit `('\n', -1)`" —
  the bookkeeping falls out instead of being reconstructed. Same wrapping
  algorithm, inverted data flow.

## Layout changes (`rebuildText`)

Iterate the wrapped `text` as today, but consult `srcIndex[i]` per character:

- On `'\n'` (charCode 10): `lineIndex++` (visual) always; **`srcLineIndex++`
  only if `srcIndex[i] !== -1`** (an original newline). This is where the
  soft/hard distinction pays off.
- For each rendered glyph pushed into `_characters`, store `srcIndex:
  srcIndex[i]`, `line: lineIndex`, `srcLine: srcLineIndex` (alongside the
  existing `x, y, w, h, u*, v*, charCode`).
- Also store **`baselineY`** per glyph (= `cursorY + baselineOffset`) — not
  needed for provenance, but the skew feature (`rich-text-styling.md`) needs it
  and this is the natural place to record it. Adding it here avoids a second
  layout pass later.

## `GlyphState` changes

- `src/MSDFGlyphState.ts`: add `readonly srcIndex: number`, `readonly line:
  number`, `readonly srcLine: number` to the `GlyphState` interface and
  initialise them in `createGlyphState()` (to `0`) so the hidden class stays
  stable (all SMIs — consistent with the existing `index`/`charCode`).
- `src/MSDFText.ts` `seedGlyph(g, char, index)`: copy `g.srcIndex =
  char.srcIndex; g.line = char.line; g.srcLine = char.srcLine;` next to the
  existing `g.index` / `g.charCode` assignments.

## Callers to update

- `getTextBounds` currently calls `this.wrapText(this._text, this._maxWidth)`
  and feeds the string to `measureLines`. Switch to `computeWrap(...).text`.
- `rebuildText` currently calls `this.wrapText(...)`. Switch to `computeWrap`.
- `fitInside` (if landed) reads `computeWrap(...).text`.
- Keep a thin `wrapText(text, maxWidth)` returning `computeWrap(text, maxWidth,
  this._fontSize).text` if any public/back-compat use is expected; otherwise
  inline. (It isn't part of the public `MSDFTextInstance` type, so removal is
  safe.)

## Files / methods to touch

- `src/MSDFText.ts` — `computeWrap` (replaces/augments `wrapText`);
  `rebuildText` (soft/hard line tracking, store `srcIndex`/`srcLine`/`baselineY`
  per char); `seedGlyph` (copy the fields).
- `src/MSDFGlyphState.ts` — new fields on the interface + `createGlyphState`.
- `README.md` — document `srcIndex`/`line`/`srcLine` on the glyph state (this
  alone makes the existing `displayCallback` workaround far nicer, independent
  of the styling API).

## Verification

- Wrapped multi-line paragraph: for each rendered glyph, `text[srcIndex]`
  equals that glyph's character. Spaces/newlines in the source are skipped (no
  glyph), so `srcIndex` is monotonic but non-contiguous — assert monotonic.
- A source string with explicit `'\n'` that *also* wraps: `srcLine` increments
  only at the explicit newlines; `line` increments at both. Two glyphs on the
  same wrapped line share `line`; two glyphs in the same source paragraph share
  `srcLine` even across a soft break.
- Regression: a `displayCallback` targeting the Nth source character now hits
  the right glyph regardless of wrapping (the original bug).
