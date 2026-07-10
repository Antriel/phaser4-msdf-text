# Examples redesign — plan

A redesign of `examples/` from 14 feature-test pages into 10 showcase pages.
This doc is the spec: it says what to delete, what to merge, what to build, and
in what order. It is written to be executed by smaller sessions one phase — or
one scene — at a time. Read `CLAUDE.md` first for what the library actually
does; keep every caption technically accurate against it.

## Why (the problems being fixed)

1. **Tests, not examples.** Several scenes exist to *verify* a feature
   (`provenance.ts` is the worst offender), not to make anyone want the
   library.
2. **Coverage without spectacle.** Everything is demoed somewhere, but the
   coolest capabilities (two-tone glows, highlight pills, per-corner ramps,
   mixed fonts on one baseline) are buried behind dropdown "modes".
3. **Dead controls.** Mode-based scenes (`rich-text`, `vertex-params`,
   `highlight`, `per-run-font`) show sliders that silently do nothing unless
   the right mode is selected. This is the single worst UX problem.
4. **Top bar.** The "Controls" button is meant to be mobile-only
   (`#btn-pane { display: none }` outside the ≤760px media query) but has been
   seen on desktop doing nothing — the `.open` drawer styles only exist inside
   that media query. Mobile UX is explicitly *not* a focus; it just must not
   be broken, and the button must never appear where it does nothing.

## The one rule

**Every control that is visible must visibly do something, in every state of
its scene.** Three patterns achieve it; every scene below names which one it
uses:

- **Compose** — stop switching modes; show all the features on one subject at
  once, so every control is always wired. (Style Lab, Rich Text, Mixed Fonts.)
- **Gallery + playground** — the looks that used to be modes become static
  rows, always visible; the controls drive one dedicated playground row.
  (Highlights & Decorations.)
- **Per-mode controls** — where modes are genuinely different *content*
  (Animated Effects), rebuild the controls folder on mode change so only the
  knobs that apply exist. Never leave a disabled-looking-but-enabled binding.

Preference order: compose > gallery+playground > per-mode controls. Tweakpane
`binding.disabled = true` is the fallback of last resort, not the plan.

---

## Target lineup (14 → 10)

| # | key | Title | Source | Pattern |
|---|-----|-------|--------|---------|
| 1 | `crisp` | Crisp at Any Scale | keep + polish | compose |
| 2 | `stylelab` | Style Lab | **new** — merges `outline` + `glow` + weight mode of `vertex-params` | compose + presets |
| 3 | `effects` | Animated Effects | keep + absorb 2 modes from `vertex-params` | per-mode controls |
| 4 | `richtext` | Rich Text | restructure — modes removed | compose |
| 5 | `fonts` | Mixed Fonts & Sizes | **new** — merges `per-run-font` + size mode of `rich-text` | compose |
| 6 | `decor` | Highlights & Decorations | **new** — merges `highlight` + decorations mode of `vertex-params` | gallery + playground |
| 7 | `fitinside` | Fit Inside | keep + absorb `layout` | compose |
| 8 | `gameui` | Game UI Showcase | keep + polish | actions |
| 9 | `loot` | RPG Loot Cards | keep + polish | actions |
| 10 | `performance` | Performance | keep + polish | compose |

**Deleted files:** `provenance.ts`, `layout.ts`, `outline.ts`, `glow.ts`,
`vertex-params.ts`, `per-run-font.ts`, `highlight.ts`, `rich-text.ts` (replaced
by a rewritten `rich-text.ts` — see scene 4). Every capability they demoed has
a named new home in the coverage matrix at the bottom; nothing is dropped
silently.

**Hash keys:** kept scenes keep their keys (deep links survive). Add a small
alias map in `main.ts` so old links land somewhere sensible instead of
defaulting to index 0:

```ts
const HASH_ALIASES: Record<string, string> = {
  outline: "stylelab", glow: "stylelab", params: "stylelab",
  highlight: "decor", perrunfont: "fonts",
  provenance: "richtext", layout: "fitinside",
};
```
(Apply in `indexFromHash()` before the `findIndex`.)

---

## Phase 0 — harness & shell fixes (independent, do first)

### 0.1 Top bar / mobile drawer (`index.html`, `examples/main.ts`)

- The Controls button and the drawer styles are both inside
  `@media (max-width: 760px)` — keep them in the same query so the button can
  never be visible while the drawer CSS is inert. Verify by resizing across
  the breakpoint. (The desktop sighting is most likely browser zoom or a
  narrow window putting a desktop browser under 760px — in that state the
  button *should* work; test it.)
- Close the drawer when the canvas is tapped:
  `canvasContainer.addEventListener("pointerdown", () => paneContainer.classList.remove("open"))`.
- Raise the breakpoint to `900px` so half-snapped desktop windows get the
  drawer instead of a crushed canvas. (One number, two places — the media
  query. Nothing in JS reads it.)
- Rename the capture button label to `GL Capture` (shorter). Leave it in the
  bar; it self-guards when Spector isn't present.

### 0.2 Harness helpers (`examples/harness/modes.ts`, new file)

Two small utilities used by the scenes below:

```ts
/** Dropdown + per-mode controls: disposes and rebuilds a folder on change. */
export interface Mode {
  key: string;
  label: string;
  /** (Re)apply this mode to the scene. Called on select and on revisit. */
  activate(): void;
  /** Add only the controls this mode actually uses. May be empty. */
  controls?(folder: FolderApi): void;
}
export function addModeControls(pane: Pane, modes: Mode[], initial: string): void;
```

Implementation sketch: one `addBinding` dropdown at pane level; one
`pane.addFolder({ title: <mode label> })` whose contents are disposed
(`folder.dispose()`) and re-created from `mode.controls` each change, after
calling `mode.activate()`. This guarantees no orphaned bindings.

```ts
/** Copy a preset into the live params object and refresh every binding. */
export function applyPreset<T extends object>(params: T, preset: Partial<T>, pane: Pane): void;
// Object.assign(params, preset); pane.refresh();
```

`pane.refresh()` re-reads bound values, so presets work with plain mutation —
no per-binding bookkeeping.

### 0.3 Acceptance for Phase 0

- Desktop ≥900px: no Controls button, pane docked right, everything as today.
- <900px: button shows, opens/closes the drawer, canvas tap closes it.
- `npm run dev` clean, no TS errors.

---

## Phase 1 — the three new scenes

### Scene 2: `stylelab` — Style Lab (new file `scenes/stylelab.ts`)

The flagship replacement for `outline` + `glow`. One place where *every*
object-level appearance knob is live simultaneously — which is itself the
demo: all of it is still **one draw call** (two submission passes when
`layered`, same call).

**Layout** (design space 1280×720, dark bg `0x0f1118`):
- Row 1 (y≈280): the hero word, editable, default `"BLAZE"`, font `Anton`,
  size ~150.
- Row 2 (y≈450): `"crisp down to small sizes"` at 36px — inherits every
  setting, shows effects hold at small sizes (from old `outline.ts`).
- Row 3 (y≈560): `"SPILLOVER"` at 90px with `letterSpacing(-2)` — inherits
  every setting; exists so toggling `layered` visibly removes the
  outline-over-neighbour artifact (from old `outline.ts`).
- All three texts get the same `apply()` push, exactly like `outline.ts`'s
  `applyOutline()` does today.

**Presets** — a row of `pane.addButton`s at the top of the pane, each calling
`applyPreset(params, PRESETS[name], pane)` then `apply()`. Ship these six and
tune by eye (values are starting points):

| Preset | fill | weight | outline | shadow/glow |
|---|---|---|---|---|
| Plain | `#ffffff` | 0 | off | off |
| Sticker | `#ffd23f` | 1.2 | w 3.5 `#ffffff`, rounded, layered | 0/6 `#000000` a0.4 soft 2 |
| Neon | `#ffffff` | 0 | off | 0/0 `#ff2d95` a1 soft 12, inner `#ffd6ef` |
| Ember | `#ffd23f` | 0.6 | w 2 `#3a0d00` | 0/0 `#ff5a1e` a0.9 soft 8, inner `#ffe69c` |
| Ice | `#eaf6ff` | 0 | w 3 `#0b2a4a`, rounded, layered, inner `#7fd4ff` | 0/4 `#7fd4ff` a0.5 soft 6 |
| Comic | `#ffd23f` | 1.5 | w 4 `#1a1030`, rounded, layered | 5/5 `#1a1030` a1 soft 0 |

**Controls** (all always live — this scene has no modes):
- `word` text input (row 1 only), `font` dropdown (all rows).
- Fill: `color`.
- `weight` slider −2..8 (object-level `text.weight`).
- Outline folder: `width` 0..8, `color`, `alpha`, `rounded`, `layered`,
  `two-tone` toggle + `innerColor` → `setOutline(w, color, alpha, rounded,
  layered)` + `setOutlineInnerColor(twoTone ? inner : null)`.
- Glow/Shadow folder: `offsetX/Y` −30..30, `color`, `alpha`, `softness` 0..16,
  `two-tone` toggle + `innerColor` → `setShadow(...)` +
  `setShadowInnerColor(...)`, plus the `pulse` toggle from `glow.ts` (keep the
  modulate-around-slider-values trick from its `update()`).
- Do **not** push rows into `commonTargets` — the shared Text folder's
  color/font would fight the lab's own controls. Leave it empty here.

**Caption:** outline width / softness are distance-field units bounded by the
atlas `distanceRange`; a two-tone outline implies `layered`; everything on
screen is one draw call.

**Acceptance:** every slider/toggle changes pixels immediately from any
preset; toggling `layered` visibly fixes row 3; two-tone outline forces the
layered look even with the toggle off (that's library behaviour — caption it).

### Scene 5: `fonts` — Mixed Fonts & Sizes (new file `scenes/fonts.ts`)

Merges `per-run-font.ts` with `rich-text.ts`'s size mode. Everything visible
at once, no modes:

- **Block A (top, y≈150):** the BASELINE segments from `per-run-font.ts`
  (five faces, one line) — and **draw the shared baseline** as a 1px
  `Graphics` line under the glyphs so the point is visible, not stated.
  Position it from the text's y + its ascent (compute once after
  `setRichText`; eyeball is fine, it's a guide).
- **Block B (middle, y≈300):** the loot-card CONTENT segments from
  `per-run-font.ts` (Anton title, Bangers numbers, mono underlined
  `readySec()` — the underline metrics splitting at the font boundary is the
  hidden gem; caption it).
- **Block C (bottom, y≈520):** a paragraph with `fontScale` runs — reuse the
  SIZED segments from `rich-text.ts` (`Blade of Embers` heading run, small
  flavour run) to show a line's box growing to its tallest run while sharing
  one baseline.
- **Persistent rule on block B:** `setTextStyle("fire", { font: accent,
  fontScale, color: 0xff8c42 })` exactly as `per-run-font.ts` does.

**Controls (all always live):**
- `accent font` dropdown + `fontScale` slider → `ruleHandle.update(...)` (a
  structural update: the text visibly reflows — that *is* the demo).
- `change text (setText)` toggle from `per-run-font.ts` — rules survive,
  segments drop; restoring re-applies content.
- Optional readout: `drawCalls`-style caption is not available; instead the
  caption states the merged atlas keeps all five faces in **one draw call**
  and points at the GL Capture button.

**Acceptance:** dropdown + slider always reflow block B; blocks A and C never
change (they're content, not policy); baseline guide stays under every face.

### Scene 6: `decor` — Highlights & Decorations (new file `scenes/decor.ts`)

Gallery + playground. Replaces `highlight.ts` (5 modes) and the decorations
mode of `vertex-params.ts`.

**Gallery — static rows, built once, never touched by controls.** Reuse the
exact specs already written in `highlight.ts` / `vertex-params.ts`:

| Row | Content | From |
|---|---|---|
| Damage pill | `CRITICAL  2 4 8`, red stadium, gold border, drop shadow *on* the pill | `highlight.ts` "pill" |
| Marker | `drawn on with a marker`, soft yellow, low alpha | `highlight.ts` "marker" |
| Glow blob | `W A R P   C O R E`, alpha 0 + borderWidth 1 + inner ramp | `highlight.ts` "glow" |
| Tab | `a tab, not a pill`, per-corner radius/softness | `highlight.ts` "corners" |
| Rich runs | the MARKER segments (pill spans mixed sizes and fonts as one shape) | `highlight.ts` "runs" |
| Underline/strike | the DECOR segments (inherited colour splits, `strikethrough`, `underline: false` run) | `vertex-params.ts` "decorations" |

Lay them out in two columns (rows are short); sizes ~34–44px so six rows +
playground fit 720 design height. Exact y positions are the implementer's
call — optically even spacing beats arithmetic.

**Playground — one row at the bottom (y≈620), e.g. `PLAYGROUND`, and the only
thing the controls touch.** Controls (all always live):
- Highlight folder: `radius`, `softness`, `borderWidth` (0..1 sliders — they
  are fractions of the pill's half-thickness; caption that), `borderColor`,
  `face alpha` 0..1, `two-tone inner` color + enable, `padX`/`padY`
  (−0.2..1, em-relative, negative legal).
- Underline folder: `enabled`, `thickness` 0.25..4, `offset (em)` −0.3..0.3 →
  `setUnderline({ thickness, offset })`.
- `strikethrough` toggle.

Rebuild the playground's spec object and re-call `setHighlight` /
`setUnderline` / `setStrikethrough` on every change (cheap; these are
decoration-lane, no reflow).

**Caption:** pills draw behind everything including the text's own shadow;
underlines split where an inherited colour changes; all of it batches with
the glyphs.

**Do not demo:** dashed/dotted underline — it is **unbuilt** (see
`future-ideas.md`, sentinel byte 254). When it lands, it gets a row here and
a `dash` control in the underline folder. Same for animated decorations via
`displayCallback` (decorations are invisible to it, by design — worth one
caption line, since it's the question every user asks).

**Acceptance:** every gallery row renders its look on load with no
interaction; every control changes the playground row only, immediately.

---

## Phase 2 — restructures

### Scene 4: `richtext` — Rich Text (rewrite `scenes/rich-text.ts`)

Kill the six modes. One composed state that has **all four layers live at
once**, plus interactions that prove the lifetimes:

- **Content:** the existing CONTENT segments (gradient name + per-run shadow,
  scaled `50`, red `Burn`) — but *remove* `skew` from the `dragonflame`
  segment (it moves to a rule so a slider can own it).
- **Rules (persistent):** `setTextStyle("dragonflame", { color: NAME_GRADIENT,
  skew: params.skew })` and `setTextStyle("fire", { color: 0xff8c42 })`.
- **Callback (composition):** keep the pulsing-`Burn` display callback from
  the old composition mode — it layers alpha over the rule's colour and is
  also the living demo of `srcIndex` (which is all that survives of
  `provenance.ts`; say so in a comment).
- **Ranges (transient), interactive:** a `find` text input. On change:
  re-apply content + rules from scratch (deterministic — same reset the old
  `applyMode` did), then `addStyleRange` a yellow highlight-style recolour
  over every match of the typed string (`indexOf` loop). Typing `fire` or
  `Embers` lights them up.
- **`change text (setText)` toggle** (as today): rules re-match on the new
  string, the find-ranges vanish — the three lifetimes demonstrated in one
  click. Restoring re-applies everything.

**Controls (all always live):** `find` input, `skew` slider (drives
`ruleHandle.update`), `change text` toggle. Keep `commonTargets` for the
shared Text folder.

**Acceptance:** with no interaction the text already shows gradient, shadow,
scale, skew and the Burn pulse; `find` works in both text states; skew works
in both text states.

### Scene 3: `effects` — Animated Effects (edit `scenes/effects.ts`)

Keep the scene; modes are legitimate here (each is different *content*). Two
changes:

1. **Absorb from `vertex-params.ts`:** add `Corner ramp` (its "corners" mode:
   animated per-corner `weight`, directional `outline.width`, melting
   `outline.rounded`) and `Glow beat` (its "glow" mode: `perGlyphShadow` +
   per-glyph softness pulse). Copy the callbacks nearly verbatim; they are
   the best demos of continuous-per-corner params in the repo.
2. **Per-mode controls via `addModeControls`** (Phase 0.2). Knob table:

| Effect | Knobs |
|---|---|
| Wave | speed, amplitude |
| Gradient | top color, bottom color (new — two pickers, live) |
| Rainbow | speed |
| Typewriter | speed |
| Jitter | amplitude |
| Pop-in | speed |
| Fade | speed |
| Jump | speed |
| Outline | speed |
| Corner ramp | speed |
| Glow beat | speed, softness |

`applyEffectSetup` keeps its role (per-mode object-level shadow/outline
setup); fold it into each `Mode.activate()`.

**Acceptance:** switching effects swaps the visible knobs; no knob without an
effect; `Corner ramp` and `Glow beat` look identical to their old
`vertex-params` versions.

### Scene 7: `fitinside` — Fit Inside (edit `scenes/fit-inside.ts`, delete `layout.ts`)

Already the best-behaved scene — all controls live. Changes:

- Absorb `layout.ts`'s one unique story: kerning. Add one caption line
  ("switch fonts — kerning and metrics follow; JetBrains Mono has none").
  Everything else `layout.ts` did (wrap guide, spacing, align) already
  exists here.
- **P2, optional:** make the box's bottom-right corner draggable (pointer
  hit-area on the guide corner; update `params.width/height`, `pane.refresh()`,
  re-fit). Direct manipulation sells the binary search better than sliders.

---

## Phase 3 — polish on kept scenes (each independent, all P1/P2)

### Scene 1: `crisp`
- Add an `animate size` toggle (default **off**): `update()` oscillates
  `fontSize` between 16 and 170 for all three rows. MSDF doesn't care;
  canvas `Text` re-rasterises every frame — the honest, visceral comparison.
  When toggled off, restore `params.fontSize` (same restore pattern as
  `glow.ts`'s pulse).

### Scene 8: `gameui`
- **Attract mode:** `auto demo` toggle, default **on** — a timer event every
  ~900ms randomly fires `spawnHit` (weight 6), `comboBurst` (1), `nextWave`
  (1, min 8s apart), `triggerLevelUp` (1, min 8s apart). The scene plays
  itself; buttons still work.
- Feature touches (one line each, big payoff):
  - Crit numbers: `setOutlineInnerColor` for a two-tone rim.
  - `LEVEL UP!`: `setShadowInnerColor("#fff6c8")` — white-hot core in the
    gold glow.
  - Combo meter: `setHighlight({ color: 0x000000, alpha: 0.35, radius: 1,
    padding: { x: 0.35, y: 0.1 } })` — a pill that hugs the combo text.
- **P2:** demo `editGlyphs()` (currently demoed nowhere): on crit, a one-shot
  per-corner gradient on the damage number via `editGlyphs` — persistent
  state, no per-frame callback. Comment that this is `manual` glyph mode.

### Scene 9: `loot`
- Affix-power line: put it on a subtle pill (`setHighlight({ color:
  rarity.color, alpha: 0.12, radius: 0.4, padding: { x: 0.25, y: 0.05 } })`).
- Mythic name: two-tone outline (`setOutline` dark + `setOutlineInnerColor`
  rarity colour) instead of / on top of the current effects.
- Both are additive; don't restructure the card. It is already the best
  "real composition" example.

### Scene 10: `performance`
- Add `styled` toggle (default off): when on, `spawn()` gives each word a
  random weight (0–2), ~50% a random-colour outline (width 1–3, non-layered),
  ~30% a soft shadow. Same draw-call count — that's the point; caption it and
  point at GL Capture.

---

## Feature coverage matrix (must survive the redesign)

Verify after Phase 2 that every row has a live home:

| Capability | Home |
|---|---|
| Crisp scaling vs BitmapText/canvas, DPR | crisp (+ Display folder) |
| Kerning, wrap, align, letter/line spacing | fitinside (+ shared Text folder everywhere) |
| fitInside (hAlign/vAlign/maxFontSize) | fitinside |
| weight (object / per-run / per-corner) | stylelab / richtext segments / effects Corner ramp |
| Outline (width/alpha/rounded/layered) | stylelab |
| Two-tone outline (`outlineInnerColor`) | stylelab, gameui crits, loot mythic |
| Shadow & glow (softness, offsets, pulse) | stylelab, gameui, loot |
| Two-tone shadow (`shadowInnerColor`) | stylelab, gameui LEVEL UP |
| Per-glyph shadow (`perGlyphShadow`) | effects Glow beat |
| Per-corner continuous params | effects Corner ramp |
| Underline / strikethrough (+ metrics splits) | decor, fonts block B |
| Highlight pills (radius/border/softness/two-tone/per-corner/padding) | decor, gameui combo, loot power line |
| setRichText segments (colour/gradient/shadow/scale) | richtext, fonts |
| setTextStyle rules (persistence, nth/wholeWord) | richtext, fonts |
| addStyleRange transience | richtext `find` |
| displayCallback + composition + `srcIndex` | effects, richtext Burn pulse |
| editGlyphs / manual mode | gameui (P2) |
| skew | richtext rule + slider |
| fontScale (structural, reflow, shared baseline) | fonts block C |
| Per-run font, baseline metrics, underline split | fonts blocks A+B |
| Merged atlas → one draw call | fonts caption, performance |
| Batching under mixed styles | stylelab caption, performance `styled` |

**Explicitly not demoed (unbuilt — from `future-ideas.md`):** dashed/dotted
underline, bottom-pivot skew, shader skew, decorations in `displayCallback`.
Do not fake them; the decor scene notes where the first one will slot.

---

## Execution order & guardrails

Order: **Phase 0 → stylelab → decor → fonts → richtext → effects → fitinside
(+ delete layout) → registry/aliases cleanup → Phase 3 items in any order.**
Each step ships independently; the registry in `main.ts` is only touched when
a step adds/removes a scene (update the `examples` array, the imports, and
delete the dead file in the same change).

Guardrails for implementing sessions:

- **No `src/` changes.** This is an examples-only project. If a scene seems
  to need a library change, stop and flag it instead.
- Keep the `ExampleScene` conventions: design-space layout, `heading()`,
  `caption()`, `commonTargets` (empty where it would fight scene controls —
  stylelab), scene key === registry key === hash.
- Captions state facts from `CLAUDE.md`, not marketing. If unsure a claim is
  true (e.g. draw-call counts), check `CLAUDE.md` or soften the caption.
- Reuse the segment/spec constants from the files being deleted — they are
  already tuned; copy them over rather than inventing new copy.
- Verify each scene by running `npm run dev`, opening its hash, and clicking
  **every** control in **every** state the scene can be in. That click-through
  is the acceptance test for the one rule at the top.
- `npm run build:examples` must stay green after every phase.
