# Future ideas — unbuilt follow-ups from the vertex-params / rich-text work

Everything in `fit-inside.md`, `rich-text-provenance.md`, `rich-text-styling.md`
and `vertex-params.md` is implemented. While building that work, several cheap
follow-ups surfaced as consequences of the new layout — deliberately **not**
built, either because they were out of scope for the doc they were found in, or
explicitly deferred pending real demand. This doc collects them in one place so
a future session can pick one up without re-reading four design docs to
re-derive it.

None of this is scheduled. Treat each entry as a napkin sketch, not a spec —
verify the referenced code still looks the way it's described before starting.

## From `vertex-params.md` — free byte, and unused attribute slots

### ~~The `rounded` sentinel trick~~ — **built**

`params.g` is now the raw continuous `rounded` byte, per-corner, and `solid` is
a sentinel (`weight` byte `255`) rather than a bit. `PARAM_ROUNDED` /
`PARAM_SOLID` are gone; `SOLID_PARAMS` replaces them.

The doc's open problem — that `packParams` saturates, so byte `255` in `weight`
was not an impossible input — was settled by **clipping a real glyph's weight to
byte `253`** and having the shader split at `254`. That leaves a full byte of
guard band on each side of the threshold (~4× a `mediump` varying's ULP near
`1.0`, so interpolation can't cross it), at the cost of the top `2/255` of the
faux-bold range — an extreme where the fill edge has already collapsed onto the
distance field's own clamp and letters overlap.

`GlyphState.outline.rounded` went `boolean` → `Corners` (`0..1` per corner);
`setOutline(..., rounded)` still seeds its ends. Shadow quads now derive
`rounded` from `shadow.softness` corner for corner instead of one per-glyph flag
from `maxCorner(softness)`.

### ~~Two-tone shadows / glows~~ and ~~two-tone outlines~~ — **built**

Both landed together, since they are one shader change. A quad with **no fill**
— every shadow quad, and every layered-outline silhouette — leaves `inColor`
idle, so it carries the inner end of a colour ramp there instead. The shader
mixes `outOutline.rgb` → `outColor.rgb` over `tone`, gated on the fill alpha byte
being exactly zero (which is both "no fill" and "this rgb is an inner colour").
No new attribute, no new draw call, per-corner on both colours.

The design questions the sketch left open were settled thus:

- **A second colour field, not a reuse of `fill.color`.** `GlyphShadow` and
  `GlyphOutline` each gained an `innerColor: Corners`, seeded from the new
  object-level `shadowInnerColor` / `outlineInnerColor` (sentinel `-1` = "inherit
  the outer colour", i.e. no ramp — so an untouched glyph packs an identity mix).
  `fill.color` keeps meaning "the glyph's own face" everywhere.
- **`tone` is not `coverage`.** Coverage is a 1-pixel step on a hard outline, so
  it would have collapsed the outline ramp. `tone` is instead depth into the
  layer's own *visible* body, normalized: `widthNorm` for an outline (the band
  spans `[outlineEdge, fillEdge]` exactly), and **half** of `softNorm` for a
  shadow, because the blur is centred on the glyph edge and only its outer half
  shows. Normalizing by the full blur would strand the ramp at `tone = 0.5`.
- **The outline's ramp is linear; the shadow's is squared.** An outline's alpha is
  a flat `1` across its band, so a linear ramp gives both colours equal screen
  area. A shadow's alpha falls off across the *same* interval that `tone` spans,
  so a linear ramp puts the outer hue exactly where the shadow has already faded
  to nothing — the effect reads as a faint wash. Squaring holds the outer hue
  through the opaque middle of the halo and keeps the inner colour to the hot core
  against the glyph, which is the "white-hot core, coloured halo" this doc asked
  for. `softStep` (which `fade` already computes) blends the two curves.
- **A two-tone outline forces `outlineLayered`.** A combined fill+outline quad
  has already spent `inColor` on the fill, so there is nowhere to put a second
  colour; the renderer's `layered` gate now also opens on
  `outlineInnerColor >= 0`. Shadows need no such thing.
- **The one leak, plugged.** A *combined* quad with a zero fill alpha trips the
  shader's gate, and would have tinted the outline it leaves behind with the
  (invisible) face colour. `packFillAspect` substitutes the outline's own colour
  into those corners at pack time, making the mix an identity — the same trick as
  `packOutlineAspect` zeroing alpha at zero width.
- **Per-run `outline.color` seeds the run's `innerColor`.** Otherwise a run that
  only recoloured the outline would ramp into whatever inner colour the *object*
  had. `applyStyleToGlyph` mirrors the object-level "inner defaults to color".

#### The `shadowToneBias` byte — considered, rejected

A knob controlling where the shadow's colour ramp crosses over, instead of the
fixed square. It looked free: a shadow quad never has an outline width, so
`params.b` is idle on exactly the quads that could use it, and the shader could
mask it out of `widthNorm` with `isShadow = step(0.5/255, softNorm)`.

**It is not sound.** `softness` is per-corner, so `isShadow` is a per-corner
interpolated value, and a soft-on-one-side shadow (a supported effect) crosses its
threshold *inside the quad*. `widthNorm` would then fade the bias byte in as a
phantom outline width and the shadow would grow a spurious band across the middle
of the glyph. This is the garbage-bitfield failure the whole `params` design
avoids: GLSL ES 1.00 has no `flat` qualifier.

The general rule this settles, worth stating once: **an interpolated channel may
weight a blend between two behaviours that agree at its endpoints, but it may
never select how another channel is decoded.** `tone = mix(tone, tone*tone,
softStep)` is safe — both curves are monotonic and agree at `0` and `1`, so any
intermediate `softStep` yields a valid ramp. `widthNorm *= 1.0 - isShadow` is not.
The one selector in the format (`solid`) is safe only because it is uniform across
its quad by construction and carries a byte of guard band on each side.

Rescuing it would mean zeroing the bias whenever *any* corner's softness is zero —
a per-quad scan that also kills per-corner bias, which was the only reason to put
it in a vertex attribute. And the effect it buys is narrow: `tone` is a monotonic
remap of a two-colour lerp, so almost everything an animated bias expresses is
already reachable by animating `innerColor` / `color`, which take any hue path
rather than sliding one boundary. Its inward end is degenerate (it pushes the hot
core under the opaque fill), and it cannot make a ring — that needs a
non-monotonic function, not a remap.

**Both arguments survive; the conclusion does not.** They are arguments about a
*chromatic* remap, and the byte's best use turns out not to be chromatic at all.
See **Shadow spread** below, which claims the same byte, keeps its existing
meaning, and needs no selector. `shadowToneBias` stays rejected — but as the
loser of a contest, not for want of a candidate.

### ~~Shadow spread — and two effects the shader already has~~ — **built**

All three landed together, as the sketch insisted they had to. `shadow.spread`,
`shadow.rounded` and `outline.softness` are per-corner `Corners` on `GlyphState`,
`shadowSpread` / `shadowRounded` / `outlineSoftness` at the object level, and
`shadow.spread` / `shadow.rounded` / `outline.softness` on every style spec.

Every claim below verified against the code as written. The shader change was the
predicted one token — `tone`'s band went from `max(max(widthNorm, halfSoft), gAA)`
to `max(widthNorm + halfSoft, gAA)`, which is bit-identical on every quad the old
renderer could produce (one of the two was always zero) and one op cheaper. The
rest was wiring.

What the build settled beyond the sketch:

- **`shadowRounded` defaults to `true`**, where `outlineRounded` defaults to
  `false`. The sketch called promoting it "pure wiring" and left the default
  unstated, but the default is the whole question: `false` would have regressed
  every existing soft shadow to mitre spikes, and a tri-state "auto" sentinel
  would have re-introduced the derivation it was removing. `true` is neither —
  rounding is a **no-op until the layer's edge leaves the glyph contour** (`rounded`
  only picks *which field* `outlineDist` reads, and `msdf` and `tsdf` agree on the
  contour itself), which needs a spread or a softness. So `true` reproduces the old
  derived rule (`soft ⇒ round`) exactly, is what a spread wants, and costs a hard
  unspread shadow nothing. `false` is now opt-in spikes. It never warns on a plain
  MSDF atlas either — a default is not a request.
- **The `.a` byte's second life needed no new gate, but the `.b` byte's did.**
  `outline.softness` on a *combined* quad is inert everywhere it could have leaked:
  `softStep` only reaches `tone` (gated off by a live fill alpha) and `fade` (which
  multiplies an outline alpha of zero on a layered fill quad). The one real change
  was `packOutlineAspect`, exactly as predicted — its zero-width gate now spares a
  corner with a softness. `hasOutline()` and the creator's `outline.width > 0` gate
  had to learn the same rule, or a zero-width glow would have been dropped before
  it reached a quad.
- **Spread needed no MTSDF clamp, and that is load-bearing, not incidental.** It
  rides `width`, whose meaning is identical in both lanes, so the renderer passes
  `g.shadow.spread` straight through `packParamsAspect` while `softness` and
  `rounded` are still clamped per binding on a plain `msdf` atlas. A spread on a
  plain MSDF font therefore works — with the mitre spikes, since `rounded` is
  clamped away with it.
- **`roundedFromSoftness` is gone**, and with it the last derived channel in the
  renderer. Every `params` channel now comes from a field the caller owns.

The bounds the sketch recorded both survive as stated: a **hard** spread past
`~0.3 × distanceRange` is eaten by the `fade` guard (any softness lifts it), and
there is still **no choke** — the byte is unsigned and `0` = "no outline" is
load-bearing, so erosion stays out of reach.

Demos: the Style Lab's `Sticker` preset (hard + spread + rounded — the slab a
blur cannot make) and `Halo` (width 0 + softness — a glow in the fill's own quad,
next to `Neon`'s shadow-pass glow for contrast), plus the `Sticker pump` mode in
the effects scene, which animates a **per-corner** spread.

---

*The original sketch follows, unedited.*

**The byte audit.** Of the vertex format, exactly one byte is idle and
unconstrained, and it is the one `shadowToneBias` wanted:

| quad kind | `.r` | `.g` | `.b` | `.a` | `inColor` |
| --- | --- | --- | --- | --- | --- |
| combined fill+outline | weight | rounded | width | *pinned `0`* | fill |
| layered silhouette | weight | rounded | width | *pinned `0`* | inner colour |
| shadow | weight | rounded — *derived* from `.a` | **idle** | softness | inner colour |
| solid | `255` | radius | border | blur | face |

`inColor.a` on a shadow is pinned to byte `0` — it *is* the two-tone gate — and
`inColor.rgb` and all of `inOutline` are spent. So `params.b` on a shadow quad is
the whole of the free space. Two things the original sketch missed: `params.g` on a
shadow is a pure function of `params.a` (`roundedFromSoftness` is `softness > 0 ? 1
: 0`), so it carries no independent information; and `params.a` on every non-shadow
quad is pinned to zero by the **renderer**, not by the format.

#### 1. `shadow.spread` — the free byte, used geometrically

**What:** dilate the shadow silhouette before blurring it — Photoshop's *spread*
next to its *size*. Today softness is the only knob, so fattening a glow can only
be bought by making it mushier, and a fat **hard** shadow is unreachable.

**Why it is sound where `shadowToneBias` was not:** `params.b` has one invariant
meaning across the whole glyph lane — *how far outside the fill edge the
outline/shadow layer's edge sits* (`outlineEdge = fillEdge - widthNorm`). On a
shadow quad, whose fill is off and whose blur is centred on `outlineEdge`, that
meaning **already is** spread. There is no re-decode, so no selector, so the
soft-on-one-side failure never arises. Per-corner for free, like every other
channel. It does not need MTSDF: a hard spread dilates `median(rgb)`, exactly as a
thick outline does.

**Shader cost: one token.** Coverage is already right; only `tone`'s band length is
wrong when width and softness are both live —

```glsl
tone = clamp((gDepth + halfSoft) / max(widthNorm + halfSoft, gAA), 0.0, 1.0);
```

The visible body runs from the outermost blur to the fill edge, which is exactly
`widthNorm + halfSoft`. The change is **bit-identical on every quad the renderer
produces today** (outline-only → `max(widthNorm, gAA)`; shadow-only →
`max(halfSoft, gAA)`; hard shadow → `gAA`) and one op cheaper than the nested
`max` it replaces.

**The cheap alternative, rejected.** Spread costs *zero* shader change if you pack
`weight + spread` into the shadow quad's weight byte: `fillEdge` moves and
`outlineEdge` follows it. But it steals weight's range and its coarser
quantization, it adds into a per-corner faux-bold gradient, and — the real killer —
the shader then believes the *dilated* edge is the glyph edge, so the two-tone ramp
is squeezed into the blur band and the whole dilated ring goes flat inner-colour.
The free byte does it properly.

#### 2. `outline.softness` — already in the shader, never exposed

`params.a` is `zeroCorners` on the fill and silhouette passes, but
`outlineCoverage = clamp(gDepth / max(softNorm, gAA) + 0.5, …)` does not care which
pass it is in. Set it and the outline blurs; the inner half of the blur hides under
the opaque fill, so only the outer edge softens, which is what a soft outline
should look like. On a **combined** quad that is a glow for one quad's fill rate,
with no shadow pass at all.

One gate must relax: `packOutlineAspect` zeroes the outline alpha wherever width is
`0`, which would make a zero-spread glow invisible. It wants `width > 0 || softness
> 0` — the original justification ("at zero width the outline edge coincides with
the fill edge, so it would fringe the AA edge") stops holding once the layer has a
blurred body of its own.

#### 3. `shadow.rounded` — currently derived, should be independent

Because `roundedFromSoftness` binds a shadow's rounding to whether it is blurred, a
**hard** shadow always dilates sharply, with the mitre spikes a thick `median(rgb)`
edge grows. Promoting `GlyphShadow.rounded` to a real per-corner `Corners` (as
`GlyphOutline.rounded` already is) is pure wiring — the byte is already there and
already `mix()`ed.

**These three are one feature, not three.** Spread + independent rounding + a hard
edge is the fat, round, offset "sticker" shadow behind cartoon game lettering,
which is currently unreachable; spread + softness is a glow you can fatten without
mushing. Land them together or the payoff is invisible.

#### Two bounds worth stating

- **The `fade` guard caps a hard spread.** `fade = max(smoothstep(0.0, 0.2,
  outlineDist), softStep)` reads the *raw* field, so once the layer's edge pushes
  below `outlineDist ≈ 0.2` the guard starts eating its outer band; a hard spread
  past `~0.3` of the range fades out. This is **not new** — a hard outline of width
  `0.4` has the identical problem today — and any nonzero softness bypasses it via
  `softStep`. Recorded as a bound, not fixed: the guard exists to kill deep-background
  haze at extreme minification and should not be re-cut without that case in hand.
- **No choke.** The byte is unsigned and `0` = "no outline" is load-bearing
  (`packOutlineAspect` depends on it), so a *negative* spread would need a re-centred
  encoding that breaks the outline's meaning. Erosion stays out of reach.

### ~~Highlight pills~~ — **built**

`setHighlight(spec)` at the object level, `highlight` on the decoration lane of
every style layer. A pill is a `solid` quad whose three idle `params` bytes carry
a corner radius, a border width and an edge blur, all read by a rounded-box SDF in
the fragment shader.

The sketch's guess — that `rectQuad`'s `0..1` UVs, added only to keep `fwidth()`
finite, were "exactly what a UV box-SDF needs" — held, and better than expected:
`1.0 / fwidth(outTexCoord)` *is* the rect's screen size in pixels, so the pill
needed no attribute, no uniform and no draw call the decorations didn't already
have. `screenPxRange()` was inlined because both lanes want that same vector.

What the build settled beyond the sketch:

- **The two lanes are one expression.** A glyph's outline layer is a pill's border
  ring, and a glyph's fill is the pill's face inset by that ring, so the solid lane
  computes the same `fill` / `outline` / `tone` triple against `-boxDist` that the
  glyph lane computes against `outlineDist - outlineEdge`, and the two `mix()` on
  `solid`. Two-tone therefore came along for free: a pill with `alpha: 0` and
  `borderWidth: 1` is a ring that fills its own body and ramps `borderColor` →
  `innerColor` across it — a glow blob, through the same gate a glowing shadow uses.
- **The three channels are fractions of the pill's half-thickness**, `min(w,h)/2`,
  which is the only length a quad knows about itself. That makes `radius: 1` a
  stadium at any size and lets the whole pill scale with the camera. They are
  continuous, so per-corner: a tab rounded only at the top, a pill blurred on one
  side.
- **The blur fades inward, not outward.** A glyph's shadow blurs symmetrically
  about its edge because a glyph quad has bleed room around the letterform; a rect's
  quad ends *exactly* at its box, so a centred blur loses its outer half to a hard
  clip — and takes the outer end of the two-tone ramp with it, which is why the
  first cut of the glow blob read as a single colour. Shifting the ramp inward by
  half its width makes the pill's box the outer bound of everything it draws.
  Inflating the quad instead was rejected: the inset would have to be a per-*quad*
  constant, and `softness` is per-corner, so the shader cannot recover it from an
  interpolated byte (this is the `shadowToneBias` failure again, one level up).
  `padding` — which the caller owns, and which may be negative — is the knob for
  giving a glow its room.
- **`solid` may select a decode; the other three bytes may not.** Re-reading `.g`
  as a radius rather than a rounding weight is exactly the thing the `params`
  format forbids — except that `weight = 255` is written to all four corners by
  construction, so it is uniform across the quad in the same way, and for the same
  reason, that the `solid` short-circuit itself is. This is the sole legitimate
  application of the rule stated under `shadowToneBias` below.
- **Merging is a union, not a split.** A highlight never inherits the fill colour
  (a slab of text-coloured paint behind the text would hide it), so unlike
  underline there is no colour-change split; and the vertical extent takes the
  highest ascender and deepest descender over the run, so a pill wraps mixed sizes
  and mixed fonts as one shape. Only a line break or a different spec starts a rect.
- **Underlines now antialias.** The solid lane's coverage is the box SDF's, which
  at a rect's boundary is `0.5` rather than the old flat `1.0`. Underlines and
  strikethroughs gained a half-pixel AA edge — a visible change to existing output,
  and an improvement at fractional positions and under rotation.
- **`fwidth` was replaced by the true gradient magnitude.** `|dFdx| + |dFdy|`
  overestimates by `|cos θ| + |sin θ|`, so `1/fwidth` *under*estimates the quad and
  scales the whole box space down. The shape survives — both axes take the same
  factor, so it is a uniform scale — but the antialiasing width, a constant `1.0`
  in that space, does not: a rotated edge softened to 1.41px, which reads as bad AA
  rather than as blur. `length(vec2(dFdx(u), dFdy(u)))` per axis is exact at every
  angle. The derivative fetches were already being paid, so the true cost is **two
  `sqrt` per fragment**; the glyph lane, which shares the vector, gets a sharper
  rotated edge out of it too.

### ~~Dashed / dotted underline~~ — **built**

`DecorationSpec.dash` (`{ length, gap, radius, softness }`, em-relative on the
first two), on both rules, on every style layer. Plus `dashPhase` at the object
level — the marching ants the note below asked about, and they cost nothing.

The sketch's escape route was taken and its guard-band argument holds, but its
**byte budget was wrong in the caller's favour**: it planned to spend all three
payload bytes on the dashed variant (count, duty, cap radius) and lose `softness`.
It does not have to. The dash **count needs no byte at all** — a dashed rect spans
one unit of U *per dash* instead of `0..1`, so `screenTexSize.x` (the derivative
the pill already reads as its width) comes out as one period in pixels, and the
shader folds U into a single cell with `fract`. Count and phase therefore ride the
vertex UVs at float precision.

What that buys, and what it settled:

- **Only one byte changes meaning.** `.b` becomes a duty cycle; `.g` and `.a` keep
  the pill's `radius` and `softness` exactly. So **dots are not a second feature**:
  a `radius` of `1` rounds a dash into a stadium, and a dash as long as the rule is
  thick makes that stadium a circle. A blurred dash comes free with them.
- **The shader zeroes the border on the dashed variant.** Not cosmetic: `.b` is a
  duty cycle there, and left alone it would inset the dash's face by a phantom
  ring. That is the only line the fold needs beyond rewriting the box's `x`.
- **The fold is seamless, and that is a property of `roundedBox`, not luck.** It is
  even in `x` about the cell centre, so `fract` 0 and `fract` 1 give the *same*
  distance (verified: max difference `0.0` across 40 cells). A dash may therefore be
  cut by the rect's own edge without a sliver where U wraps — which is what makes a
  phase slide legal at all. A *left-aligned* dash within its cell would not have this
  property and would fringe the right edge.
- **Phase is free, so marching ants are.** `dashPhase` negates and slides the U
  origin at *submit* time (`u0 = -phase`, `u1 = count - phase`) — no rebuild, no
  re-seed, no relayout, and it counts whole periods, so `+= dt` for ever accumulates
  no error (the renderer wraps into `[0, 1)`, exactly).
- **Whole-dash fitting, at a known cost.** `buildDecorRects` rounds the count so each
  rect fits whole dashes and every rule begins and ends the same way; the period
  stretches by up to half a dash to pay for it. The cost is that a *split* rule (an
  inherited colour changing mid-underline) refits per piece, so the grids do not line
  up across the seam. Visible, judged rare enough, **left alone** — free-running the
  grid instead would fix the seam and truncate every rule's last dash, which is the
  worse trade.
- **The vertex shader went `highp`.** A long rule's U runs to tens of units, where an
  fp16 varying's ULP would be a visible fraction of a dash. Vertex `highp` is
  mandatory in GLSL ES 1.00, so this costs nothing — and it incidentally fixes
  positions, which run to thousands of pixels and were riding `mediump`.
- **The guard band moved.** A real glyph now clips at byte `252` and the shader takes
  the solid lane at `253` (was `253`/`254`), keeping the full byte of guard against a
  bold glyph's interpolated weight. The two sentinels split at `254.5` with half a
  byte each side, which needs no guard: neither is interpolated. Faux bold loses the
  top `3/255` instead of `2/255` — still inside the range where the fill edge has
  collapsed onto the field's clamp.

Not built, and not obviously wanted: a per-*run* dash phase (the object-level one
covers marching; a static per-run stagger is a strange thing to want), a dashed pill
**border** (`.b` is the pill's border width — there is no byte, and the shape is a
ring, not a rule), and per-corner dash channels (a dash is one cell of a rect that
may hold a hundred, so there is no corner to anchor an interpolant to).

*The original sketch follows, unedited.*

**What:** `fract(u · n)` against the rect's own `0..1` U coordinate, thresholded
in the `solid` branch — same UV groundwork as the pill above. `n` (dash count)
needs to reach the shader per-rect.

**No longer free.** The sketch here assumed a `solid` quad's `rounded`,
`outlineWidth` and `shadowSoftness` bytes were all dead weight, so a dash count
could ride any one of them. Highlight pills spent all three (radius, border,
blur). Nothing is left.

**The escape is that `solid` is a sentinel *value*, not a bit,** and it currently
burns the whole range `[254, 255]` to mean one thing. Make weight byte `255` mean
"box/pill" and `254` mean "dashed", and the three payload bytes get reinterpreted
per variant — a dash count, a duty cycle, a cap radius. The guard-band question
that dominated the original sentinel design does not recur: the byte of guard
below `254` exists to stop a *glyph's* interpolated weight from crossing in, and a
real glyph still clips at `253`. Telling `254` from `255` is safe for exactly the
reason `solid` is safe — both are constant across their quad by construction, so
there is nothing to interpolate. (At `mediump` near `1.0` they are ~8 ULP apart
anyway.)

## From `rich-text-styling.md` — skew alternatives

**Bottom-pivot skew variant.** Today's skew always pivots on the layout
baseline (`Yb = baselineY`), which is the deliberate default (see
`rich-text-styling.md`'s "Skew + per-glyph scale" note — keeps a mixed-scale
line slanting as one line). The doc notes the same formula with `Yb = charY +
h` gives a bottom-pivot variant instead, which some callers may want (e.g.
skewing about a glyph's own visual base rather than the shared line baseline).
Not built; no API surface sketched (would need a mode flag or a second
`skewPivot` field on `GlyphState`).

**Shader-based skew.** Today's skew is a CPU-side matrix compose in
`submitOneGlyph`/`BatchMSDFChar`, chosen so no shader change was needed. A
shader-based version (skew factor riding a vertex attribute) stays possible if
we ever want skew decoupled from the CPU transform path — no concrete reason to
want that today.

## From `vertex-params.md` — decorations in the display callback

**What:** `displayCallback` and `GlyphState` cannot see or animate
underline/strikethrough — decorations resolve once (per source character,
through the style layers) into `_decorRects`, which live outside
`_characters`/`GlyphState` entirely. This was **frozen for day one, revisit
only with a real use case** (`vertex-params.md`, step C) — not a technical
wall, just scope discipline: `GlyphState` assumes one quad per renderable char,
and rects are a different shape. If a real use case shows up (animated
underline color following a tween, a "typewriter" strike-through reveal), the
rect array would need its own lightweight per-rect state object, seeded and
read back the same way glyphs are.

**Two of the three motivating cases turned out not to need it**, which is worth
recording before anyone builds the per-rect state object on their strength:

- *Colour following a tween* — already works, and always did. An **inherited**
  colour/alpha is resolved at submit time, so tweening the object's colour drags
  every rule that didn't name its own along with it.
- *Marching ants* — `dashPhase`, above. Same trick, one level further: the phase is
  read at submit and slides the rects' UV origin, so it animates with no per-rect
  state at all.

The pattern both share, and the thing to reach for first: **an input the renderer
can resolve at submit time needs no state object, because the rects never change.**
What is left over is the genuinely per-rect, genuinely stateful case — a typewriter
reveal, where each rect needs its *own* progress — and that one still wants the
array. Its cost has not changed.

## Not on this list (explicitly rejected, not deferred)

For completeness — these were considered and the docs give a reason to *not*
revisit them without new evidence:

- **Tree-shaking the rich-text/vertex-params surface** — a few hundred bytes,
  Phaser's `Class` bundles prototype methods regardless. Revisit only on a real
  bundle-size measurement.
- **Splitting the shader into basic/dynamic variants** — different programs
  can't share a batch, defeating the point of batched text. Revisit only on a
  real perf measurement.
- **Cross-font glyph fallback** — a character missing from its run's font is
  skipped, never borrowed from another run's font. Consistency over
  cleverness; revisit only with real demand.
- **An analytic seed for `fitInside`'s binary search** (estimate `lo`/`hi` from
  `currentSize · boxW / measuredWidth` instead of the free `boxH /
  lineHeight` bound) — `fitInside` is a one-shot call, ~15 iterations to
  sub-pixel is already cheap. Only worth it if a profile says otherwise.
- **An object-level `setStyle(spec)` — "layer 0"** (`style-api-unification.md`
  question 5). Superficially cohesive: the same `StyleSpec` that segments and
  `addStyle` overlays take, seeding the object's own defaults. It doesn't work,
  for a reason that survives any amount of polish: **on a run, an absent key
  means "inherit"; at the object level, an absent key means "the default."**
  Same shape, opposite semantics — `setStyle({ color })` would have to leave the
  outline alone (matching every other spec layer) while looking exactly like a
  call that resets the object to one colour. It also drags in keys no spec has
  (`outlineLayered`, `perGlyphShadow`, the `-1` sentinel on `outlineInnerColor` /
  `shadowInnerColor`), and every object-level field is already a plain,
  directly-tweenable field with a chainable `set*` wrapper. Revisit only if the
  object level stops being the seed for the spec layers.
