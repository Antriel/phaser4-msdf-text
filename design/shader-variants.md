# Capability tiers — the basic/full shader split, revisited

**Status: exploration only.** Nothing here is built, decided, or scheduled. This
doc exists because the "revisit only on a real perf measurement" bar that
`future-ideas.md` and `rich-text-styling.md` set for this idea **has now been
met**, and because the original rejection argued against a different design than
the one now proposed. It collects: what Phaser 4's dynamic-shader machinery
actually is (read from `node_modules`), why the one-line rejection was right and
incomplete, the realistic design space, an API sketch, and a measurement plan
that decides between the options before any of them is committed to.

## 1. The measurement that reopens this

`examples/scenes/performance.ts` (600 moving `MSDFText` objects, ~2,600 glyph
quads, 24px, one shared batch) on the old-Android reference phone, maxed out:

| state | FPS | frame time | delta |
|---|---|---|---|
| pre-`vertex-params` (24-byte vertex, 4 attributes, per-mode uniforms) | 45 | 22.2 ms | — |
| after steps A–C (28-byte vertex, 5 attributes, über-shader) | 30 | 33.3 ms | **+11.1 ms** |
| after future-ideas (solid lane, two-tone, pills, true-gradient `sqrt`) | ~26 | 38.5 ms | **+5.2 ms** |

Where can that time have gone? Three axes, and they respond to different fixes:

- **Fragment ALU.** The plain-text fragment cost roughly tripled: the old mode-0
  path was a `median`, one AA ramp and a multiply; today every fragment also
  evaluates the outline lane, the solid lane (`roundedBox` with its `length()`),
  the two-tone mix, the fade guard and the over-composite, then mixes the lanes.
  At 24px a glyph field is on the order of a million fragments plus overdraw —
  exactly the resource an old mobile GPU has least of.
- **Vertex fetch + upload.** 24 → 28 bytes is +17% (and 4 → 5 attribute
  fetches). For the perf scene that is ~285 KB of buffer upload per frame versus
  ~245 KB before — real, but a 17% bandwidth bump cannot by itself explain a 50%
  frame-time bump unless upload was already the wall.
- **CPU submit.** For a *plain static* text the per-quad JS work barely changed
  (params are pre-packed per binding; `batch()` writes 7 u32-slots per vertex
  instead of 6). Not a suspect for this scene.

**Working hypothesis: the regression is dominated by fragment ALU, with vertex
traffic second.** That is a hypothesis, not a finding — the two changes landed
together, and the whole point of §7 is to split them apart with cheap probes
before choosing an architecture. Note the corollary either way: *plain text is
paying for effects it doesn't use*, which is precisely the situation the user-
facing tier idea addresses.

## 2. How Phaser 4 actually does dynamic shaders

Read from `node_modules/phaser/src/renderer/webgl/` (Phaser 4.x). Three layers:

**`ShaderProgramFactory.js`** — string-level program assembly. A *base* shader
carries `#pragma phaserTemplate(name)` insertion points. An *addition* is a named
bundle of GLSL snippets keyed by template point (e.g. `MakeApplyTint()` returns
`{ name: 'Tint', additions: { fragmentHeader: …, fragmentProcess: 'fragColor =
applyTint(fragColor);' } }`), each with a `disable` flag and tags. A *feature*
is just a `#define FEATURE_X` splice. `getKey()` derives a cache key from base
name + enabled addition names + sorted features; each distinct combination
compiles **once, ever**, and is cached (`createShaderProgram`). Parallel shader
compilation is supported, so a first-use compile need not hitch.

**`ProgramManager.js`** — one per batch handler. Holds the *current* config
(base + additions + features), a **shared uniform pool** applied to whichever
program is current (so switching programs doesn't lose uniform state), and one
VAO per program. Crucially, it is constructed with **one fixed
`attributeBufferLayouts`**: every program variant reads the same interleaved
buffer with the same stride. *Variants prune shader code; they never shrink the
vertex.* Phaser's own `BatchHandlerQuad` vertex is 28 bytes whether lighting is
on or off.

**`BatchHandlerQuad.js`** — the per-object mechanics. Every `batch()` call
passes a `renderOptions` object (multi-texturing, lighting, self-shadow, smooth
pixel art). `updateRenderOptions()` diffs it against the active options; on any
change the handler **flushes the queued batch (`run()`) and then retoggles
additions/features** (`updateShaderConfig()`). One `run()` uses one program;
texture changes sub-batch *within* a run, but a program change always costs a
draw break. So Phaser accepts exactly the trade our docs rejected — and it works
for them because the toggled options are **layer-grained in practice**: a scene
tends to have long display-list runs sharing the same lighting/texturing state,
so transitions (and therefore flushes) are rare.

One more mechanism matters to us: **cross-handler transitions flush too.**
`RenderNodeManager.setCurrentBatchNode()` runs the outgoing handler's batch
whenever a different handler starts batching. So *two handlers interleaved in
the display list cost one flush per transition* — the identical cost class as
one handler switching programs. Mixing MSDF text with sprites already pays this
today; a second MSDF handler adds no new kind of cost.

And the per-object binding side: the `RenderNodes` game-object component
(`initRenderNodes(map)`, `setRenderNodeRole('BatchHandler', name)`) is exactly
"this object uses that handler", resolved by name, switchable at runtime.
`MSDFText` already uses it (`DefaultMSDFNodes` → `BatchHandlerMSDF`), and the
renderer already reads `customRenderNodes.BatchHandler ||
defaultRenderNodes.BatchHandler`. The plumbing for a per-object tier is
first-class Phaser, not an invention of ours.

## 3. Why the rejection was right — and what it missed

The locked decision ("different programs can't share a batch, defeating the
point of batched text") is correct **against the design it was aimed at**:
deriving the program *implicitly from the features each text happens to use*.
Under that design, batching becomes an emergent property of feature usage — one
outlined word in a field of plain words silently splits the field into three
draws, per-frame feature animation re-splits it unpredictably, and per-glyph
callback mode (which can add an outline to any glyph at any time) has no honest
tier at all. That is a real defeat of batched text, and the rejection stands for
it.

What it did not consider is the reframe this doc is about: **the tier is a
user-declared property of the text object, not an inference** — two tiers,
chosen at creation, stable for the object's lifetime, default "everything on".
That changes the cost model completely:

- A scene that opts nothing down behaves byte-for-byte as today. Zero risk.
- A scene that opts its bulk text down (damage numbers, score popups, the perf
  scene) gets one basic batch — flushes appear only where tiers *interleave* in
  the display list, which the developer controls with the same tool they already
  use for sprite/text interleaving: depth grouping.
- Worst case (alternating tiers, one object each) is a flush per object — the
  same pathology as alternating sprites and text, documented the same way, and
  entirely opt-in.

The "point of batched text" survives because the tier count is two and tiers
are stable. What is genuinely given up is *cross-tier* batching — a basic text
and a full text can never share a draw. That is the price tag to print on the
option.

## 4. The design space

Three options, not mutually exclusive. A is already on the books
(`implementation-review.md`, candidate A); B and C are the two honest shapes of
"variants".

### Option A — branch the über-shader on `solid` (no tiers, no API)

Already specified in `implementation-review.md`. `solid` is uniform per quad by
construction, so `if (outParams.r >= 254.0/255.0)` is a dynamically-uniform
branch: glyph fragments skip the `roundedBox`/`length()` work, rect fragments
skip the field decode. Recovers a slice of the future-ideas delta (30 → 26) for
every user with no API and no batching change; does nothing about the
vertex-params delta (45 → 30), because glyph fragments still pay the outline
lane, two-tone and composite, and the vertex stays 28 bytes. Also removes the
mediump-overflow hazard noted there. **This should land and be measured first
regardless of what happens with tiers** — its win overlaps and composes with
everything below.

### Option B — program variants inside the one handler (Phaser's pattern)

Our handler already owns a `ProgramManager`. The minimal implementation is
Phaser's own idiom:

- Add `#pragma phaserTemplate(features)` to our vertex/fragment sources and wrap
  the effect lanes in `#ifdef FEATURE_EFFECTS … #else <plain fill path> #endif`.
  One source, two cached programs (`MSDF`, `MSDF__EFFECTS`), compiled on first
  use.
- Give the handler a `setTier(tier)` check-and-flush exactly like
  `setUnitRange`'s — or fold the tier into `configureFont`'s gate, since it has
  the same "flush before set" discipline. The renderer calls it once per object
  from the text's tier flag.

What it buys: the **full fragment-ALU win** for basic texts — the basic program
is compile-time pruned to `median` + AA ramp + fill multiply (strictly cheaper
than option A's runtime branch, which old GPUs don't love). ~40 lines of code,
~0.3 KB of bundle.

What it cannot buy: **the stride is pinned at 28 bytes** — the ProgramManager's
buffer layout is fixed (§2), so upload bandwidth and (probably) attribute fetch
stay at full-tier cost. Two nuances worth verifying if B is ever prototyped
beyond a probe: (1) if the basic *vertex* shader also drops the `inOutline`/
`inParams` attribute declarations, does Phaser's VAO wrapper skip the missing
locations cleanly? If yes, the fetch cost drops too (upload doesn't), and the
renderer may skip *writing* those slots (stale bytes that no program reads are
harmless). (2) Unused varyings must be pruned consistently or ES 1.00 linkers
complain — keeping vertex and fragment `#ifdef`s symmetric handles it.

### Option C — a second batch handler with a 20-byte vertex

The full-strength version. A `BatchHandlerMSDFBasic` render node registered by
the plugin beside the existing one:

- **Layout:** `inPosition` (2×f32), `inTexCoord` (2×f32), `inColor` (u8×4) —
  20 bytes/vertex, 80 bytes/quad (vs 112). Three attribute fetches instead of
  five.
- **Shaders:** ~25 lines total. Vertex: project + pass through. Fragment:
  `median`, `screenPxRange` (the same texcoord-derivative AA — `uUnitRange` and
  its flush gate are kept unchanged, so merged atlases and per-run fonts work
  identically), one clamp, premultiplied output. Consider `mediump` outright —
  every value is small; the one intermediate to check at extreme zoom is
  `screenTexSize` (≈6.5e4 near mediump's ceiling).
- **Handler:** subclass (or config-parameterize) `MSDFBatchHandler`. The clean
  trick: **keep the same 26-argument `batch()` signature and simply ignore the
  outline/params arguments**, writing 5 u32-slots per vertex instead of 7. Then
  `BatchMSDFChar` and `submitOneGlyph` are shared unmodified — the renderer's
  basic path passes the existing `zeroColor`/`rectParams` constants, which cost
  nothing to pass and nothing to pack. No parallel submit pipeline.
- **Renderer:** a short branch at the top of `MSDFTextWebGLRenderer` — the basic
  path is *only the fill loop* (per-glyph or static), plus the usual
  `configureFont` gating. No shadow pass, no silhouette pass, no decoration
  passes; ~60 lines mostly shared with today's fill loop.
- **Costs:** a second vertex+index buffer (at the default `batchSize` 16384:
  ~1.25 MB GPU + the CPU-side mirror, ~0.2 MB indices — trivial next to one
  font atlas, and `instancesPerBatch` is config-overridable if it ever matters);
  ~2–3 KB minified bundle; one more shader compile at first use.

### Comparison

| | A: `solid` branch | B: feature variant, one handler | C: second handler |
|---|---|---|---|
| fragment ALU, plain text | partial (solid lane only) | full | full |
| vertex upload | — | — | −29% (112→80 B/quad) |
| attribute fetch | — | maybe (VAO question) | −2 attributes |
| CPU submit | — | ~0 | ~0 (const args, fewer writes) |
| batching | unchanged | flush per tier transition | flush per tier transition |
| API | none | tier flag | tier flag |
| code | ~20 shader lines | ~40 lines | ~150–250 lines |
| bundle | ~0 | ~0.3 KB | ~2–3 KB |
| GPU memory | — | — | +~1.5 MB |

B is dominated by C on every performance axis while paying the same API and
batching costs; its real value is as a **half-day measurement probe** (§7), not
as a shipped feature. If tiers ship at all, ship C.

### Non-options, recorded so they aren't re-derived

- **Three or more tiers** (e.g. a middle "outline but no solid lane/two-tone").
  Each tier is a batching boundary and an API concept; the measured delta for
  the second-order effects (+5.2 ms) is the smaller number, and option A already
  claws back part of it inside the full tier. Two tiers or none.
- **A capability bitset** (`{ outline: true, shadow: false, … }`). 2ⁿ program
  variants, each a batching boundary — this is the implicit-variance design the
  original rejection correctly killed, wearing explicit clothes. The vertex has
  exactly two natural strata (with/without the effect attributes); the API
  should have the same two.
- **Per-quad tiering inside one buffer.** Mixed strides break the
  `instanceCount × floatsPerInstance` indexing and the single `buffer.update`;
  a quad's tier is its handler's, full stop.

## 5. API sketch

**One boolean capability, fixed at creation, default on.**

```ts
// Factory / constructor — one new optional trailing argument:
add.msdfText(x, y, font, text, fontSize?, align?, options?: { effects?: boolean });
// make.msdfText config gains the same key:
make.msdfText({ ..., effects: false });
```

- `effects: true` (default, and the value when omitted) — today's object,
  byte-for-byte. Nobody's scene changes.
- `effects: false` — the text binds `BatchHandlerMSDFBasic` at
  `initRenderNodes` time (a different `DefaultNodes` map; alternatively
  `setRenderNodeRole`) and the renderer takes the fill-only path.

**What basic keeps** — everything CPU-side, which is more than it first sounds:
layout, wrap, align, `letterSpacing`/`lineSpacing`, `fitInside`, kerning,
per-corner fill colour and alpha (gradients included), rich text in full for
*structural* keys (`fontScale`, per-run `font`, merged atlases — the
`uUnitRange`/texture gates are unchanged) and for fill-colour/alpha appearance
styling, per-glyph transforms (scale/rotation/**skew** are CPU matrix work),
`displayCallback`/`editGlyphs` for fill and transform fields. This is
approximately the BitmapText feature surface — the drop-in-parity core — at
close to BitmapText cost.

**What basic drops** — everything that rides `inOutline`/`inParams`: weight
(faux bold), outline (width/rounded/layered/two-tone), shadow (hard and soft),
and **all decorations** — underline, strikethrough, highlight pills — because a
solid rect *is* the params sentinel; there is no solid lane in the basic
program and no guaranteed solid texel to fake one with (the reason `solid`
exists at all, per `vertex-params.md`).

**Policy for excluded features on a basic object** — mirror the MTSDF-clamp
precedent exactly, since it is the same shape of problem ("this object's
pipeline can't express that"):

- Object-level setters (`setOutline`, `setShadow`, `setUnderline`,
  `setStrikethrough`, `setHighlight`, `weight`) → **dev-warn once, ignore**.
- Style-layer keys and `GlyphState` effect fields → **silently inert** (the
  renderer's basic path never reads them). One sentence in the docs; per-run
  styles already clamp silently on plain-MSDF fonts today.

**Runtime re-tiering** — mechanically trivial (`setRenderNodeRole` plus a flag
flip; Phaser supports it), but **keep v1 creation-only**. The tempting
alternative — *auto-upgrade*: default everything to basic and transparently
rebind to full on the first `setShadow`/`setOutline`/callback/decoration — was
considered and set aside for v1: it changes default batching behaviour (a
default text and an effect text no longer share a draw), it turns a mid-game
tween into a program-compile + rebind at an unpredictable moment, and callback
mode forces a pessimistic upgrade the instant a callback exists, since a
callback may touch `outline.width` on any frame. All solvable; none worth
solving before the explicit knob has demonstrated demand. The explicit default
(`effects: true`) leaves the door open — flipping the default later is the same
API.

## 6. What it does to the four axes the question asked about

- **API:** one optional boolean at creation, one warn-once rule, one
  documentation section ("performance tiers"). No existing signature changes;
  `StyleSpec`/`GlyphState`/handles untouched. The complexity lives in
  *explaining* the split (a feature matrix in README), not in the surface.
- **Code complexity:** option C is ~150–250 lines — a slim handler subclass,
  two small shaders, a fill-only renderer branch, the warn-once gates — and,
  critically, **no new invariants**: `configureFont` discipline, packers,
  measurement, style lanes all untouched. The main ongoing tax is that every
  future shader/vertex change asks "and what does basic do?" — the answer is
  almost always "nothing", which is cheap but must be *said* each time. Option
  B is ~40 lines but buys strictly less.
- **Bundle size:** noise. ~2–3 KB minified for C, ~0.3 KB for B, against a
  Phaser game measured in megabytes. The tree-shaking analysis from
  `rich-text-styling.md` transfers unchanged: this is not a bundle-size play,
  and should not be sold as one.
- **Performance:** for basic-tier texts, C removes ~⅔ of the per-fragment ALU
  (compile-time, not branch-time), 29% of vertex upload, two attribute fetches,
  and two u32 writes per vertex — plausibly most of the 45 → 26 regression for
  scenes like the perf example, since that scene is 100% plain text. For
  full-tier texts it changes nothing (option A is their relief). For mixed
  scenes it adds a flush per tier boundary in the display list. These are
  expectations, not measurements — hence §7.

## 7. Measurement plan — cheap probes first, architecture second

All on the old-Android device, `performance.ts` maxed (and at 2,000/5,000
counts for the CPU-vs-GPU cross-check), FPS + frame capture for draw-call
sanity. In order:

1. **Land option A** (independently justified) and re-measure. This isolates
   the recoverable slice of the future-ideas delta (30 → 26) and needs no API.
2. **Probe the fragment ceiling** (~30 minutes, throwaway): hack the fragment
   shader down to the basic path — keep the 28-byte vertex, keep everything
   else. The FPS gap between this and step 1 is the *pure fragment* component
   of the vertex-params regression.
3. **Probe the vertex floor** (~2 hours, throwaway): on top of step 2, cut the
   layout to 20 bytes (hack the handler's config + `batch()` writes; ignore
   correctness of effects, the scene uses none). The remaining gap to 45 FPS is
   the *vertex traffic* component (plus any CPU noise; the 5,000-count run
   separates that).
4. **Decide.** If step 2 recovers nearly everything, fragment ALU was the whole
   story — and it becomes worth asking whether option A plus a second
   uniform-style branch could get close enough *without* tiers, though a
   dynamic branch on old GPUs will never match compile-time pruning, and no
   branch can un-widen the vertex. If step 3's increment is material, only
   option C captures it, and the probes have already built most of C's
   throwaway version. If both increments together are small (i.e. the phone is
   CPU-bound after all), **build nothing** — this doc then stands as the record
   of why, with numbers.

The decision threshold belongs to the project owner, but a suggested bar: tiers
are worth their permanent API surface if the basic tier recovers **≥ half** of
the total 45 → 26 regression on the reference device. Below that, option A
alone plus `implementation-review.md`'s candidates B/C (wrap and applyRun) are
the better spend.

## 8. If it ships — the follow-through list

- `future-ideas.md` — move the "Splitting the shader into basic/dynamic
  variants" entry out of *Not on this list*, pointing here; note the
  measurement bar was met.
- `rich-text-styling.md` / `vertex-params.md` locked decisions — append a
  pointer: "superseded in the explicit-tier form by `shader-variants.md`; the
  rejection of *implicit* variance stands."
- `CLAUDE.md` — shader section gains the second lane's existence, the tier
  flag, and the one new invariant: **a tier is a batching boundary; tiers are
  per-object and immutable**.
- `README.md` — a "performance tiers" section with the feature matrix and the
  depth-grouping guidance for mixed scenes.
- `examples/` — per repo convention, a demo page: the perf scene with a tier
  toggle, so the win is reproducible by anyone with the device in hand.
- Types: `MSDFTextConfig`/factory overloads gain `effects?: boolean`;
  `MSDFTextInstance` unchanged.

## 9. Open questions

- **VAO behaviour with dropped attributes** (option B probe): does Phaser's VAO
  wrapper skip attributes absent from the program cleanly? Determines whether a
  B-style variant can shed fetch cost, and whether C's handler could ever share
  a buffer with the full handler (probably not worth it even if yes).
- **`mediump` for the basic fragment program** — likely fine and another win on
  exactly the target hardware; verify `screenTexSize` at pathological zoom.
- **Naming** — `effects: false` reads well at the call site but "effects" is
  vague; `tier: 'basic'` is more searchable. Bikeshed at review.
- **Should the basic tier exist in the docs as "BitmapText mode"?** It is
  nearly exactly BitmapText's surface at near-BitmapText cost, which is a
  simpler story to tell than "capability tiers" — but it under-sells skew,
  gradients and rich-text colour runs, which basic keeps.
