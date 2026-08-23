/**
 * MSDF Text WebGL Renderer
 *
 * Iterates each character of an MSDFText and submits it to the MSDF batch
 * handler. Passes run back-to-front: highlight pills, drop shadow, then (for a
 * layered outline) every glyph's outline silhouette, then underlines, then the
 * text fill, then strikethroughs. They are **submission-order** loops, not
 * separate draws — the shader is a single branch driven by the per-vertex
 * `params` attribute, so all of it lands in one draw call and composites in
 * submission order under alpha blending.
 *
 * Two consequences worth stating plainly, because they shaped the code:
 *
 *   - A **shadow quad is an outline-only quad**: fill alpha zero, shadow colour
 *     in the outline attribute. It has to be, because softness and rounding live
 *     on the outline layer, and the fill layer must keep `median(rgb)` or a
 *     rounded outline would round its own glyph's face. That identity is what
 *     makes a shadow's **spread** free: the layer's edge is `fillEdge - width`,
 *     so the channel an outline calls its width is, on a shadow quad, a dilation
 *     of the silhouette.
 *   - An outline with **no width and no softness contributes nothing**. At zero
 *     width the layer's edge is the glyph silhouette itself, so we zero its alpha
 *     at pack time rather than branch in the shader — but a blurred zero-width
 *     outline has a visible body of its own (a glow hugging the letterform) and
 *     survives that gate.
 *   - Those two quad kinds therefore leave the **fill colour attribute idle**,
 *     which is where the **two-tone inner colour** rides. A zero fill alpha is
 *     both the "no fill" signal and the "this rgb is an inner colour" signal, so
 *     a glow can shift hue outward and a layered outline can ramp across its
 *     band — no new attribute, no new draw call. A combined fill+outline quad
 *     has no spare slot, which is why a two-tone outline forces layering.
 *
 * The only flush gate is `configureFont`, on the per-texture `uUnitRange` (the
 * texture itself is the batch handler's own gate, inside `batch()`). Uniforms are
 * applied per draw, so it must flush *before* it sets the new value, or the
 * previous font's queued quads render with the new font's range.
 *
 * With rich-text **per-run fonts** that gate goes per glyph: each character
 * carries a `fontIdx` into the text's `_runFonts`, and every font contributes its
 * own texture, `uUnitRange`, `distanceRange` normaliser and `fieldType`. Those
 * are resolved once per render into `bindings`; a text with one font (the
 * overwhelmingly common case) has one binding and configures it once, outside the
 * loops. A run whose font uses a different texture ends the draw call — a merged
 * atlas is the way to avoid that, not a renderer change.
 *
 * Per-glyph state is resolved once, before any pass, into one of three sources:
 *   - static : no per-glyph array; every glyph uses the object-level colour,
 *     alpha, outline and shadow (the cheap default path).
 *   - callback : the glyph-state array is re-seeded from the object each frame
 *     and handed to `displayCallback(glyphs, parent)` for transient animation.
 *   - manual : the user owns the glyph-state array (via `editGlyphs()`); it is
 *     seeded once and persists until the text rebuilds.
 * The passes read whatever that resolution produced, so the callback no longer
 * runs once per pass and can address fill / shadow / outline independently.
 */

import * as Phaser from "phaser";
import BatchMSDFChar from './BatchMSDFChar';
import type { MSDFBatchHandlerInstance } from './MSDFBatchHandler';
import {
    packColor,
    packParams,
    packSolidParams,
    packDashParams,
    SOLID_PARAMS,
    type Corners,
    type PackedCorners
} from './MSDFColor';
import type { GlyphState } from './MSDFGlyphState';
import type { DecorationState } from './MSDFDecorState';

const GetCalcMatrix = (Phaser as any).GameObjects.GetCalcMatrix;
const TransformMatrix = (Phaser as any).GameObjects.Components.TransformMatrix;

// Per-glyph mode flags — mirror the constants in MSDFText.
const GLYPH_MODE_STATIC = 0;
const GLYPH_MODE_CALLBACK = 1;

// Per-rect mode flag — mirrors MSDFText. There is no manual mode for rects.
const DECOR_MODE_CALLBACK = 1;

// Reusable packed-corner buffers. A pass uses at most three at once (fill +
// outline + params), and passes run sequentially, so one set plus a constant
// zero covers every case.
const fillBuf: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
const outlineBuf: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
const shadowBuf: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
// Params for the fill / outline passes, and for the shadow pass (which rounds
// and softens instead of outlining).
const glyphParams: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
const shadowParams: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
// Colour attribute for layers a pass doesn't use (a plain fill's outline):
// all-zero, so that layer contributes nothing.
const zeroColor: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
// The two-tone inner colours, riding the fill attribute of the two quad kinds
// that have no fill: the shadow and the layered outline silhouette. Their alpha
// is zero, which is both what disables the fill layer and what tells the shader
// the rgb is an inner colour rather than a face colour.
const outlineToneBuf: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
const shadowToneBuf: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
const zeroCorners: Corners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };

/**
 * The object's own per-corner alpha (Phaser's `Alpha` component). It is a
 * **modulation**, so it is applied *here*, where every colour attribute is packed
 * — never seeded into a `GlyphState` or a `DecorationState`.
 *
 * That is the whole reason it lives at pack time: a style run *overwrites* what
 * the seed wrote (that is what a run is), so an object alpha folded into the seed
 * would be silently discarded by any run naming an `alpha` of its own — and by
 * any display / decoration callback setting one. Multiplied in at the pack, it
 * survives both, a highlight pill fades like everything else, and changing
 * `text.alpha` costs no re-seed at all.
 */
const objAlpha: Corners = { topLeft: 1, topRight: 1, bottomLeft: 1, bottomRight: 1 };

// A solid underline / strikethrough rect: a hard-edged box, no radius, no border,
// no blur. A highlight pill and a dashed rule carry their own packed params.
const rectParams: PackedCorners = { topLeft: SOLID_PARAMS, topRight: SOLID_PARAMS, bottomLeft: SOLID_PARAMS, bottomRight: SOLID_PARAMS };
const rectColor: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
// A pill's border ring, packed every frame — by both rect paths, since its alpha
// takes the object's live alpha and no rebuild is triggered by an alpha change.
// A rect *state* also packs its own shape each frame (the built rect packed that
// once, at rebuild, and it carries no alpha to modulate).
const borderBuf: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
const stateParams: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
// A rect spans the full 0..1 of its own UV box. Originally just so
// `fwidth(texCoord)` stayed nonzero, but the shader now reads those derivatives
// as the rect's screen size in pixels — which is the whole of the box SDF's
// input, and why a pill needs no attribute a decoration didn't already have.
//
// A *dashed* rule stretches that U span to one unit per dash (see below), which
// is why `u0`/`u1` are written per rect rather than left at their defaults.
const rectQuad = { x: 0, y: 0, w: 0, h: 0, u0: 0, v0: 0, u1: 1, v1: 1 };

/**
 * Which back-to-front slot a rect belongs in. Highlights sit behind everything,
 * including the text's own drop shadow, so a shadow falls *on* its pill.
 * `MSDFText.buildDecorRects` stamps these onto the rects it emits.
 */
export const PASS_HIGHLIGHT = 0;
export const PASS_UNDERLINE = 1;
export const PASS_STRIKE = 2;

const tempCharData = { x: 0, y: 0, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
const tempCharMatrix = new TransformMatrix();

// A substituted glyph's quad (`GlyphState.glyph`). Reused: every pass submits
// immediately, so one buffer serves them all. Carries `em` and `baselineY` too,
// because `submitOneGlyph` reads both for the deform and the skew pivot.
const swapChar = { x: 0, y: 0, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0, em: 0, baselineY: 0 };
// How far the substitute's quad sits from the original's, i.e. the difference in
// their left/top bearings. Written by `resolveGlyphQuad`, added to the glyph's
// position by its caller so that `g.x`/`g.y` keep meaning "where the *slot* is".
let swapDX = 0;
let swapDY = 0;

/**
 * The quad to draw for one glyph: its own, or a substitute's if the glyph state
 * asked for one (`GlyphState.glyph`).
 *
 * The substitution is render-time only. The slot — its pen position, and therefore
 * every advance after it — belongs to the character the text was laid out with, so
 * the letterform can churn (a scramble, a slot machine, a glitch) without the line
 * reflowing. What changes is only the quad: the substitute's own bearings, size and
 * UVs, taken from *this glyph's run font*, never from another's.
 *
 * The bearing difference comes back in `swapDX`/`swapDY` rather than being folded
 * in here, because the caller adds it to the glyph state's (user-movable) position
 * rather than to the layout's.
 */
function resolveGlyphQuad(char: any, code: number, font: any): any {
    swapDX = 0;
    swapDY = 0;
    if (code === 0 || code === char.charCode) return char;

    const sub = font.getChar(code);
    // Absent from this run's font: draw what the text actually says, rather than
    // borrowing a letterform from a font this glyph is not set in.
    if (!sub) return char;

    const em = char.em;
    swapChar.x = char.penX + sub.xOffset * em;
    swapChar.y = char.baselineY + sub.yOffset * em;
    swapChar.w = sub.normalizedWidth * em;
    swapChar.h = sub.normalizedHeight * em;
    // Same v-swap the character build applies — the parser's UVs are pre-flipped
    // for Phaser's Shader GameObject, and the batched quad wants them back.
    swapChar.u0 = sub.u0;
    swapChar.v0 = sub.v1;
    swapChar.u1 = sub.u1;
    swapChar.v1 = sub.v0;
    swapChar.em = em;
    swapChar.baselineY = char.baselineY;

    swapDX = swapChar.x - char.x;
    swapDY = swapChar.y - char.y;
    return swapChar;
}

/**
 * Everything the passes need from one font, hoisted out of the per-glyph loops.
 * `unitX`/`unitY` are the `uUnitRange` this font's atlas wants; `invRange`
 * normalises distance-field quantities (outline width, weight, softness) into
 * fractions of *this* font's `distanceRange`, which is what makes those params
 * font-independent; `isMtsdf` gates the effects that read the true-SDF alpha.
 */
interface FontBinding {
    texture: any;
    /** The font itself — only `GlyphState.glyph` needs it, to look a substitute up. */
    font: any;
    unitX: number;
    unitY: number;
    invRange: number;
    isMtsdf: boolean;
    /** 1 = pixel-art mode (bitmap glyph lane), 0 = SDF. Global, read per render. */
    pixelArt: number;
    /** Object-level params, pre-packed for this font. Static mode only. */
    staticParams: number;
    staticShadowParams: number;
}

/** Reused across render calls; grown to the widest `_runFonts` seen so far. */
const bindings: FontBinding[] = [];

/**
 * Fill `bindings[0 .. runFonts.length)` from the text's font list. Slot 0 is the
 * object's own font, whose texture is the object's own frame — the other slots
 * resolve theirs from the frames `MSDFText.buildFontMap` cached alongside them.
 */
function resolveBindings(src: any, baseTexture: any): number {
    const runFonts: any[] = src._runFonts;
    const runFrames: any[] = src._runFrames;
    const count = runFonts.length;

    while (bindings.length < count) {
        bindings.push({
            texture: null, font: null, unitX: 0, unitY: 0, invRange: 0, isMtsdf: false,
            pixelArt: 0,
            staticParams: 0, staticShadowParams: 0
        });
    }

    const pixelArt = src.scene.game.config.pixelArt === true ? 1 : 0;

    for (let i = 0; i < count; i++) {
        const data = runFonts[i].data;
        const range = data.distanceField.distanceRange;
        const frame = runFrames[i];
        const b = bindings[i];

        b.texture = i === 0 ? baseTexture : (frame ? frame.glTexture : baseTexture);
        b.font = runFonts[i];
        b.unitX = range / data.atlasWidth;
        b.unitY = range / data.atlasHeight;
        b.invRange = 1 / range;
        b.isMtsdf = data.distanceField.fieldType === 'mtsdf';
        b.pixelArt = pixelArt;
    }

    return count;
}

/**
 * Pre-pack the object-level params once per font, for static mode. Rounding and
 * softness are clamped away on a plain `msdf` atlas here, at pack time, because
 * `fieldType` is a property of the *run's* font, not of the text object. Spread
 * is not: it dilates `median(rgb)` exactly as a thick outline does, so it needs
 * no true SDF.
 *
 * `staticParams` serves both the fill and the layered-silhouette pass. The
 * silhouette pass is the only one that draws the outline layer — on a layered
 * *fill* quad the outline alpha is zero, so its width and softness are inert
 * there and one packed value covers both.
 */
function packStaticParams(src: any, count: number): void {
    const weight = src.weight;
    const outlineWidth = src.outlineWidth;
    const shadowSpread = src.shadowSpread;

    for (let i = 0; i < count; i++) {
        const b = bindings[i];
        if (b.pixelArt) {
            b.staticParams = packParams(0, 0, 0, 0);
            b.staticShadowParams = packParams(0, 0, 0, 0);
            continue;
        }
        const inv = b.invRange;
        const outSoft = b.isMtsdf ? src.outlineSoftness : 0;
        const shSoft = b.isMtsdf ? src.shadowSoftness : 0;
        const outRound = b.isMtsdf ? src.outlineRounded : 0;
        const shRound = b.isMtsdf ? src.shadowRounded : 0;
        b.staticParams = packParams(weight * inv, outRound, outlineWidth * inv, outSoft * inv);
        b.staticShadowParams = packParams(weight * inv, shRound, shadowSpread * inv, shSoft * inv);
    }
}

/** The smallest alpha that survives `packColor`'s truncation to a byte. */
const MIN_ALPHA = 1 / 255;

/** Pack a per-corner colour + alpha pair into a batch buffer, under `objAlpha`. */
function packAspect(buf: PackedCorners, color: Corners, alpha: Corners): void {
    buf.topLeft = packColor(color.topLeft, alpha.topLeft * objAlpha.topLeft);
    buf.topRight = packColor(color.topRight, alpha.topRight * objAlpha.topRight);
    buf.bottomLeft = packColor(color.bottomLeft, alpha.bottomLeft * objAlpha.bottomLeft);
    buf.bottomRight = packColor(color.bottomRight, alpha.bottomRight * objAlpha.bottomRight);
}

/**
 * Pack a two-tone inner colour: the colour attribute of a quad that has no fill.
 * A zero alpha is the signal — it disables the fill layer *and* tells the shader
 * to read `.rgb` as the inner end of the outline / shadow colour ramp. Passing
 * the outer colour here makes the ramp an identity, which is what an untouched
 * `innerColor` seeds to.
 */
function packToneAspect(buf: PackedCorners, color: Corners): void {
    buf.topLeft = packColor(color.topLeft, 0);
    buf.topRight = packColor(color.topRight, 0);
    buf.bottomLeft = packColor(color.bottomLeft, 0);
    buf.bottomRight = packColor(color.bottomRight, 0);
}

/**
 * Pack the fill colour of a *combined* fill+outline quad, substituting `fallback`
 * (the outline colour) wherever the fill alpha rounds to a zero byte. Such a
 * corner has no face to paint, so the shader reads its `.rgb` as a two-tone inner
 * colour — and a fully transparent fill must not silently tint the outline it
 * leaves behind. Feeding it the outline's own colour makes the ramp an identity.
 *
 * Only the combined pass needs this: a layered fill quad carries no outline, and
 * a shadow or silhouette quad has no fill colour to confuse in the first place.
 *
 * The handover is decided on the alpha the shader will actually see — i.e. after
 * `objAlpha` — because that is the byte it reads the sentinel off.
 */
function packFillAspect(buf: PackedCorners, color: Corners, alpha: Corners, fallback: Corners): void {
    const aTL = alpha.topLeft * objAlpha.topLeft;
    const aTR = alpha.topRight * objAlpha.topRight;
    const aBL = alpha.bottomLeft * objAlpha.bottomLeft;
    const aBR = alpha.bottomRight * objAlpha.bottomRight;
    buf.topLeft = packColor(aTL >= MIN_ALPHA ? color.topLeft : fallback.topLeft, aTL);
    buf.topRight = packColor(aTR >= MIN_ALPHA ? color.topRight : fallback.topRight, aTR);
    buf.bottomLeft = packColor(aBL >= MIN_ALPHA ? color.bottomLeft : fallback.bottomLeft, aBL);
    buf.bottomRight = packColor(aBR >= MIN_ALPHA ? color.bottomRight : fallback.bottomRight, aBR);
}

/**
 * Pack the outline colour, zeroing the alpha wherever the outline has no body of
 * its own — neither a width nor a softness. At zero width the outline edge
 * coincides with the fill edge, so without this the outline colour would fringe
 * every glyph's antialiased edge; but a *blurred* zero-width outline is a glow
 * hugging the letterform, which has a body and must survive.
 */
function packOutlineAspect(buf: PackedCorners, color: Corners, alpha: Corners, width: Corners, softness: Corners): void {
    buf.topLeft = packColor(color.topLeft, (width.topLeft > 0 || softness.topLeft > 0) ? alpha.topLeft * objAlpha.topLeft : 0);
    buf.topRight = packColor(color.topRight, (width.topRight > 0 || softness.topRight > 0) ? alpha.topRight * objAlpha.topRight : 0);
    buf.bottomLeft = packColor(color.bottomLeft, (width.bottomLeft > 0 || softness.bottomLeft > 0) ? alpha.bottomLeft * objAlpha.bottomLeft : 0);
    buf.bottomRight = packColor(color.bottomRight, (width.bottomRight > 0 || softness.bottomRight > 0) ? alpha.bottomRight * objAlpha.bottomRight : 0);
}

/**
 * Pack the four `params` corners. Every channel is continuous, so every channel
 * is genuinely per-corner — `rounded` included, since it stopped being a bit in
 * a bitfield. The distance-field quantities are normalized by the font's
 * `distanceRange` here, on the CPU, which is what makes them font-independent
 * and lets the range cancel out of the shader.
 *
 * `width` and `softness` describe the *outline / shadow layer*, so each serves
 * both quad kinds: on a fill or silhouette quad `width` is the outline's width,
 * on a shadow quad it is the shadow's spread (the same dilation of the same
 * edge), and `softness` blurs that edge either way.
 */
function packParamsAspect(
    buf: PackedCorners,
    weight: Corners,
    rounded: Corners,
    width: Corners,
    softness: Corners,
    invRange: number
): void {
    buf.topLeft = packParams(weight.topLeft * invRange, rounded.topLeft, width.topLeft * invRange, softness.topLeft * invRange);
    buf.topRight = packParams(weight.topRight * invRange, rounded.topRight, width.topRight * invRange, softness.topRight * invRange);
    buf.bottomLeft = packParams(weight.bottomLeft * invRange, rounded.bottomLeft, width.bottomLeft * invRange, softness.bottomLeft * invRange);
    buf.bottomRight = packParams(weight.bottomRight * invRange, rounded.bottomRight, width.bottomRight * invRange, softness.bottomRight * invRange);
}

/** Fill all four corners of a buffer with one packed value. */
function fillCorners(buf: PackedCorners, value: number): void {
    buf.topLeft = buf.topRight = buf.bottomLeft = buf.bottomRight = value;
}

/**
 * Bind the font for the quads about to be submitted, flushing first if its
 * `uUnitRange` differs from the pending batch's. Uniforms are read at draw time,
 * so the new value must be set *after* the flush — setting it before would
 * render the previous font's queued glyphs with this font's range (wrong AA
 * width, wrong outline thickness).
 *
 * The texture is the batch handler's own flush gate (inside `batch()`), so it is
 * not checked here — a font switch that changes both lands one flush, not two:
 * this one runs first and empties the batch, so `batch()` then takes its
 * `instanceCount === 0` path and simply adopts the new texture.
 *
 * Called once per object for a single-font text, once per glyph for a mixed-font
 * one (two float compares when nothing changed).
 */
function configureFont(
    batchHandler: MSDFBatchHandlerInstance,
    drawingContext: any,
    unitRangeX: number,
    unitRangeY: number,
    pixelArt: number
): void {
    if (batchHandler.hasUnitRangeChanged(unitRangeX, unitRangeY) ||
        batchHandler.hasPixelArtChanged(pixelArt)) {
        batchHandler.run(drawingContext);
    }
    batchHandler.setUnitRange(unitRangeX, unitRangeY);
    batchHandler.setPixelArt(pixelArt);
}

/**
 * Pre-multiply a baseline shear into a matrix in place: `m := m · shear`, where
 * `shear` maps `x' = x − k·y + k·Yb`, `y' = y` (a horizontal shear pivoting on
 * the line `y = Yb`). Because it is pre-multiplied onto `calcMatrix` before the
 * glyph's own translate/rotate/scale, the shear acts in absolute text space —
 * so `Yb` must be an absolute text-space Y (origin offset already folded in).
 */
function applyBaselineShear(m: any, k: number, yb: number): void {
    const { a, b, c, d, e, f } = m;
    m.c = c - k * a;
    m.d = d - k * b;
    m.e = e + k * yb * a;
    m.f = f + k * yb * b;
}

/**
 * Submit one glyph quad at an absolute text-space position. Uses the fast path
 * (the shared camera matrix + a position offset) unless the glyph is scaled,
 * rotated or sheared, in which case it builds a per-glyph matrix. Scale/rotation
 * pivot the glyph centre; skew is a baseline shear composed onto `calcMatrix`
 * first (so a mixed-scale line still slants as one line).
 *
 * A per-corner deform (`deformX`/`deformY`, em-relative, `null` when unset) needs
 * **no** matrix and so does not force the slow path — it displaces the quad's
 * corners in whichever local space the chosen path already works in, which is why
 * it composes with the glyph transform for free.
 */
function submitOneGlyph(
    drawingContext: any,
    batchHandler: MSDFBatchHandlerInstance,
    texture: any,
    char: any,
    x: number,
    y: number,
    scaleX: number,
    scaleY: number,
    rotation: number,
    skew: number,
    skewPivot: number,
    deformX: Corners | null,
    deformY: Corners | null,
    calcMatrix: any,
    originOffsetX: number,
    originOffsetY: number,
    colorData: PackedCorners,
    outlineData: PackedCorners,
    params: PackedCorners
): void {
    if (scaleX !== 1 || scaleY !== 1 || rotation !== 0 || skew !== 0) {
        const centerX = char.w / 2;
        const centerY = char.h / 2;

        tempCharMatrix.copyFrom(calcMatrix);
        if (skew !== 0) {
            // Pivot on this glyph's absolute layout baseline, shifted down by
            // `skewPivot` em. `char.baselineY - char.y` is the glyph top →
            // baseline offset (constant per glyph), added to the glyph's current
            // top `y` so a moved glyph shears about its own baseline. Per-glyph
            // scale (centre pivot below) deliberately does not move this pivot —
            // that keeps a mixed-scale line coherent, and so does measuring the
            // pivot from the line's shared baseline rather than the glyph's box.
            const pivotY = y + (char.baselineY - char.y) + skewPivot * char.em + originOffsetY;
            applyBaselineShear(tempCharMatrix, skew, pivotY);
        }
        tempCharMatrix.translate(x + centerX + originOffsetX, y + centerY + originOffsetY);
        if (rotation !== 0) tempCharMatrix.rotate(rotation);
        if (scaleX !== 1 || scaleY !== 1) tempCharMatrix.scale(scaleX, scaleY);

        tempCharData.x = -centerX;
        tempCharData.y = -centerY;
        tempCharData.w = char.w;
        tempCharData.h = char.h;
        tempCharData.u0 = char.u0;
        tempCharData.v0 = char.v0;
        tempCharData.u1 = char.u1;
        tempCharData.v1 = char.v1;
        BatchMSDFChar(drawingContext, batchHandler, texture, tempCharData, 0, 0, tempCharMatrix,
            colorData, outlineData, params, deformX, deformY, char.em);
    } else {
        // Reuse the char's geometry directly; fold the position delta into the offset.
        const offX = x - char.x + originOffsetX;
        const offY = y - char.y + originOffsetY;
        BatchMSDFChar(drawingContext, batchHandler, texture, char, offX, offY, calcMatrix,
            colorData, outlineData, params, deformX, deformY, char.em);
    }
}

/**
 * Pack one corner of a rect's face colour. `rgb`/`alpha` absent means "inherit
 * the object's", resolved here rather than baked at build time, so tweening the
 * text's colour or alpha drags an inherited underline along with it.
 *
 * Where the face alpha rounds to a zero byte the shader reads `.rgb` as the inner
 * end of the border's two-tone ramp, so a transparent face must hand over its
 * `inner` colour rather than a face colour nobody can see. Same trick, same
 * reason, as `packFillAspect` on a combined glyph quad.
 */
function packRectCorner(rgb: number, alpha: number, inner: number): number {
    return packColor(alpha >= MIN_ALPHA ? rgb : inner, alpha);
}

/**
 * A pill's border ring, zeroing its alpha wherever the width is zero — at zero
 * width the ring's outer edge coincides with the face's, so it would only fringe
 * the pill's antialiased edge. The same rule, for the same reason, that
 * `packOutlineAspect` applies to a glyph's outline.
 *
 * The ring's alpha is `borderAlpha × alpha × objAlpha`: its own layer's, the whole
 * pill's, and the whole object's, three modulations of the same kind stacked. The
 * pill's `alpha` is here (and on the face, below) rather than in a vertex byte or a
 * seed for exactly the reason the object's is — see the `objAlpha` note.
 *
 * One function for both rect paths: a `ResolvedHighlight` and a `DecorationState`
 * name the ring identically, and neither may bake it, since two of the three
 * factors are live.
 */
interface BorderRing {
    alpha: Corners;
    borderColor: Corners;
    borderAlpha: Corners;
    borderWidth: Corners;
}

function packBorderRing(buf: PackedCorners, r: BorderRing): void {
    const c = r.borderColor, a = r.borderAlpha, w = r.borderWidth, o = r.alpha;
    buf.topLeft = packColor(c.topLeft, w.topLeft > 0 ? a.topLeft * o.topLeft * objAlpha.topLeft : 0);
    buf.topRight = packColor(c.topRight, w.topRight > 0 ? a.topRight * o.topRight * objAlpha.topRight : 0);
    buf.bottomLeft = packColor(c.bottomLeft, w.bottomLeft > 0 ? a.bottomLeft * o.bottomLeft * objAlpha.bottomLeft : 0);
    buf.bottomRight = packColor(c.bottomRight, w.bottomRight > 0 ? a.bottomRight * o.bottomRight * objAlpha.bottomRight : 0);
}

/**
 * Submit the decoration rects belonging to one pass, back to front. They follow
 * the layout, never the per-glyph transform: a scaled or rotated glyph moves, its
 * underline (or the pill behind it) does not.
 *
 * A rect is `solid` — it samples no atlas — but it still rides its own run's
 * texture, so a decoration under a per-run font costs no extra draw call. A plain
 * underline leaves `params` and the border colour at their constant defaults; a
 * highlight pill carries its own, packed once at rebuild.
 *
 * `dashPhase` is the one decoration input resolved *here* rather than at rebuild,
 * for the same reason an inherited colour is: it changes nothing about the rects
 * and everything about how they are submitted, so tweening it is free.
 */
function submitDecorations(
    drawingContext: any,
    batchHandler: MSDFBatchHandlerInstance,
    rects: any[],
    pass: number,
    multiFont: boolean,
    calcMatrix: any,
    originOffsetX: number,
    originOffsetY: number,
    baseRgb: number,
    baseAlpha: number,
    dashPhase: number
): void {
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.pass !== pass) continue;

        const b = bindings[r.fontIdx];
        if (multiFont) configureFont(batchHandler, drawingContext, b.unitX, b.unitY, b.pixelArt);

        rectQuad.x = r.x;
        rectQuad.y = r.y;
        rectQuad.w = r.w;
        rectQuad.h = r.h;

        // A dashed rule spans one unit of U per dash, so the shader's fold
        // (`fract`) cuts the rect into that many cells and the derivative it
        // already computes comes out as one period in pixels — the dash count
        // needs no vertex byte, and the phase is a slide of the U origin. Negated,
        // so a rising phase marches the dashes forward; pre-wrapped by the caller,
        // so U stays small however long the tween has run.
        const dashCount: number = r.dashCount;
        rectQuad.u0 = dashCount > 0 ? -dashPhase : 0;
        rectQuad.u1 = dashCount > 0 ? dashCount - dashPhase : 1;

        const rgb: Corners | undefined = r.rgb;
        const alpha: Corners | undefined = r.alpha;
        const face: Corners | undefined = r.faceAlpha;
        const inner: Corners | undefined = r.inner;
        const rTL = rgb ? rgb.topLeft : baseRgb;
        const rTR = rgb ? rgb.topRight : baseRgb;
        const rBL = rgb ? rgb.bottomLeft : baseRgb;
        const rBR = rgb ? rgb.bottomRight : baseRgb;
        // An absent rect alpha inherits the object's fill alpha (a rule's; a pill
        // never inherits). Under it, the face's own alpha — a pill's second layer,
        // and the lane whose zero is the two-tone gate; a rule has none, so it packs
        // as 1. Over it, the object's own alpha, so a pill fades with the text it
        // sits behind.
        const fTL = face ? face.topLeft : 1;
        const fTR = face ? face.topRight : 1;
        const fBL = face ? face.bottomLeft : 1;
        const fBR = face ? face.bottomRight : 1;
        const aTL = fTL * (alpha ? alpha.topLeft : baseAlpha) * objAlpha.topLeft;
        const aTR = fTR * (alpha ? alpha.topRight : baseAlpha) * objAlpha.topRight;
        const aBL = fBL * (alpha ? alpha.bottomLeft : baseAlpha) * objAlpha.bottomLeft;
        const aBR = fBR * (alpha ? alpha.bottomRight : baseAlpha) * objAlpha.bottomRight;
        rectColor.topLeft = packRectCorner(rTL, aTL, inner ? inner.topLeft : rTL);
        rectColor.topRight = packRectCorner(rTR, aTR, inner ? inner.topRight : rTR);
        rectColor.bottomLeft = packRectCorner(rBL, aBL, inner ? inner.bottomLeft : rBL);
        rectColor.bottomRight = packRectCorner(rBR, aBR, inner ? inner.bottomRight : rBR);

        // A pill's ring, packed per frame off the resolved highlight it kept. A
        // rule has none, and takes the constant zero.
        const ring: BorderRing | undefined = r.highlight;
        let borderData = zeroColor;
        if (ring) {
            packBorderRing(borderBuf, ring);
            borderData = borderBuf;
        }

        // Rects take no deform: they live outside `_characters`, so no `GlyphState`
        // owns one (see the decorations note in CLAUDE.md).
        BatchMSDFChar(drawingContext, batchHandler, b.texture, rectQuad,
            originOffsetX, originOffsetY, calcMatrix, rectColor,
            borderData, r.params || rectParams, null, null, 0);
    }
}

/**
 * Submit the decoration rects of one pass from their **per-rect state**, which a
 * decoration callback has just had its hands on.
 *
 * The static path above is left exactly as it was — it is the common case and it
 * resolves inheritance as it goes. This one never has to: `seedRect` resolved every
 * "absent means inherit" into the state before the callback ran, so everything here
 * is a straight read and a pack.
 *
 * Three things the built rects cannot do and a state can: a **transform** (scale
 * and rotation about the rect's centre, on a per-rect matrix, exactly as a glyph
 * gets one), a **per-corner deform** (in pixels — a rect has no em), and a
 * **per-rect dash phase**. The deform is what lets a rule follow a line of text
 * that was sheared or rotated as a line; it cannot bend, because a rect is one quad.
 */
function submitDecorationStates(
    drawingContext: any,
    batchHandler: MSDFBatchHandlerInstance,
    states: DecorationState[],
    pass: number,
    multiFont: boolean,
    calcMatrix: any,
    originOffsetX: number,
    originOffsetY: number
): void {
    for (let i = 0; i < states.length; i++) {
        const s = states[i];
        if (s.pass !== pass || !s.visible) continue;

        const b = bindings[s.fontIdx];
        if (multiFont) configureFont(batchHandler, drawingContext, b.unitX, b.unitY, b.pixelArt);

        // A dashed rect spans one unit of U per dash; the phase slides that origin.
        // Wrapped into [0, 1) — exact, since the pattern repeats every unit — so a
        // for-ever-accumulating tween keeps U small.
        const count = s.dashCount;
        const phase = s.dashPhase - Math.floor(s.dashPhase);
        const u0 = count > 0 ? -phase : 0;
        const u1 = count > 0 ? count - phase : 1;

        packRectStateColor(rectColor, s);
        packBorderRing(borderBuf, s);
        packRectStateParams(stateParams, s);

        if (s.scaleX !== 1 || s.scaleY !== 1 || s.rotation !== 0) {
            // Per-rect matrix, pivoting the rect's centre — the same shape
            // `submitOneGlyph` builds, and safe under the box SDF: the shader reads
            // the rect's pixel size off its UV derivatives, which a rotation leaves
            // invariant and a scale scales, so radius/border/softness (fractions of
            // the half-thickness) scale with the pill exactly as they should.
            const centerX = s.w / 2;
            const centerY = s.h / 2;

            tempCharMatrix.copyFrom(calcMatrix);
            tempCharMatrix.translate(s.x + centerX + originOffsetX, s.y + centerY + originOffsetY);
            if (s.rotation !== 0) tempCharMatrix.rotate(s.rotation);
            if (s.scaleX !== 1 || s.scaleY !== 1) tempCharMatrix.scale(s.scaleX, s.scaleY);

            tempCharData.x = -centerX;
            tempCharData.y = -centerY;
            tempCharData.w = s.w;
            tempCharData.h = s.h;
            tempCharData.u0 = u0;
            tempCharData.v0 = 0;
            tempCharData.u1 = u1;
            tempCharData.v1 = 1;
            BatchMSDFChar(drawingContext, batchHandler, b.texture, tempCharData, 0, 0, tempCharMatrix,
                rectColor, borderBuf, stateParams, s.offsetX, s.offsetY, 1);
        } else {
            rectQuad.x = s.x;
            rectQuad.y = s.y;
            rectQuad.w = s.w;
            rectQuad.h = s.h;
            rectQuad.u0 = u0;
            rectQuad.u1 = u1;
            // The deform is in pixels, not em — a rect has no letterform to
            // normalize against — so it rides the same corner offsets with a unit
            // scale.
            BatchMSDFChar(drawingContext, batchHandler, b.texture, rectQuad,
                originOffsetX, originOffsetY, calcMatrix, rectColor, borderBuf, stateParams,
                s.offsetX, s.offsetY, 1);
        }
    }
}

/**
 * A rect state's face colour: the face's own alpha under the rect's and the
 * object's, with the same zero-alpha two-tone handover as a built rect. `seedRect`
 * resolved every inheritance, so unlike the static path there is no fallback here.
 */
function packRectStateColor(buf: PackedCorners, s: DecorationState): void {
    const c = s.color, a = s.alpha, f = s.faceAlpha, inner = s.innerColor;
    const aTL = f.topLeft * a.topLeft * objAlpha.topLeft;
    const aTR = f.topRight * a.topRight * objAlpha.topRight;
    const aBL = f.bottomLeft * a.bottomLeft * objAlpha.bottomLeft;
    const aBR = f.bottomRight * a.bottomRight * objAlpha.bottomRight;
    buf.topLeft = packRectCorner(c.topLeft, aTL, inner.topLeft);
    buf.topRight = packRectCorner(c.topRight, aTR, inner.topRight);
    buf.bottomLeft = packRectCorner(c.bottomLeft, aBL, inner.bottomLeft);
    buf.bottomRight = packRectCorner(c.bottomRight, aBR, inner.bottomRight);
}

/**
 * A rect state's shape bytes. `dashCount` is the fork the format already has: at
 * `> 0` the middle channel is the dash's duty cycle rather than a border width, and
 * the quad takes the `254` sentinel instead of `255`. It is a per-*quad* decision
 * written to all four corners, which is exactly what makes re-decoding that channel
 * legal here and nowhere else.
 */
function packRectStateParams(buf: PackedCorners, s: DecorationState): void {
    const r = s.radius, sf = s.softness;
    if (s.dashCount > 0) {
        const d = s.dashDuty;
        buf.topLeft = packDashParams(r.topLeft, d.topLeft, sf.topLeft);
        buf.topRight = packDashParams(r.topRight, d.topRight, sf.topRight);
        buf.bottomLeft = packDashParams(r.bottomLeft, d.bottomLeft, sf.bottomLeft);
        buf.bottomRight = packDashParams(r.bottomRight, d.bottomRight, sf.bottomRight);
    } else {
        const w = s.borderWidth;
        buf.topLeft = packSolidParams(r.topLeft, w.topLeft, sf.topLeft);
        buf.topRight = packSolidParams(r.topRight, w.topRight, sf.topRight);
        buf.bottomLeft = packSolidParams(r.bottomLeft, w.bottomLeft, sf.bottomLeft);
        buf.bottomRight = packSolidParams(r.bottomRight, w.bottomRight, sf.bottomRight);
    }
}

function MSDFTextWebGLRenderer(
    _renderer: any,
    src: any,
    drawingContext: any,
    parentMatrix: any
): void {
    const characters = src._characters;
    const characterCount = characters ? characters.length : 0;

    if (characterCount === 0) {
        return;
    }

    const camera = drawingContext.camera;
    camera.addToRenderList(src);

    const batchHandler: MSDFBatchHandlerInstance | undefined =
        src.customRenderNodes.BatchHandler || src.defaultRenderNodes.BatchHandler;

    if (!batchHandler) {
        return;
    }

    const baseTexture = src.frame ? src.frame.glTexture : null;
    if (!baseTexture) {
        return;
    }

    const matrixResult = GetCalcMatrix(src, camera, parentMatrix);
    const calcMatrix = matrixResult.calc;

    // The object's own alpha, published for every pack below. A modulation, not a
    // seeded value — see `objAlpha`.
    objAlpha.topLeft = src._alphaTL;
    objAlpha.topRight = src._alphaTR;
    objAlpha.bottomLeft = src._alphaBL;
    objAlpha.bottomRight = src._alphaBR;

    // Subtract displayOrigin so origin maps to the text's bounding box.
    const originOffsetX = -src.displayOriginX;
    const originOffsetY = -src.displayOriginY;

    // Every font this text uses. One binding is the fast path: configure it once
    // here and no pass below touches the gate again. Rounded outlines and soft
    // shadows read the true-SDF alpha channel, which only carries usable data on
    // MTSDF atlases; on a plain MSDF font they are clamped away at pack time, per
    // binding, so the effects degrade to the standard look per *run*.
    const fontCount = resolveBindings(src, baseTexture);
    const multiFont = fontCount > 1;
    const pixelArt = bindings[0].pixelArt === 1;
    if (!multiFont) {
        configureFont(batchHandler, drawingContext, bindings[0].unitX, bindings[0].unitY, bindings[0].pixelArt);
    }

    const hasOutline = src.hasOutline();
    const hasShadow = src.hasShadow();
    const decorations = src._decorRects;
    const hasDecorations = decorations.length > 0;
    // A dash pattern repeats every unit of phase, so wrapping it into [0, 1) is
    // exact — and it keeps a rect's U span small however long a marching-ants
    // tween has been accumulating.
    let dashPhase = 0;
    // The fill alpha a rule inherits when it named none of its own. The object's
    // `alpha` is *not* in it — that rides `objAlpha`, at the pack.
    let baseAlpha = 0;
    if (hasDecorations) {
        baseAlpha = src._color.a;
        const p = src.dashPhase;
        dashPhase = p - Math.floor(p);
    }

    // ── Resolve per-glyph state ─────────────────────────────────────────────
    // Static mode keeps the object-level colours in shared buffers and never
    // touches a per-glyph array. Callback mode re-seeds the array and runs the
    // user callback once for the whole text; manual mode reads the user-owned,
    // already-seeded array as-is. Rich-text *appearance* styles (`_hasAppearance`)
    // force a persistent array even without a callback — it is seeded + styled on
    // rebuild and whenever styles change (`_stylesDirty`, applied pre-render),
    // and the renderer reads it here without re-seeding. A structural-only run
    // (`fontScale`) is already baked into the character quads, so it needs none.
    const glyphMode = src._glyphMode;
    const hasStyles = src._hasAppearance;
    let glyphs: GlyphState[] | null = null;

    if (glyphMode === GLYPH_MODE_STATIC && !hasStyles) {
        // Single base fill colour on every corner; alpha = colour alpha ×
        // per-corner object alpha. Outline and shadow likewise use one colour.
        const c = src._color;
        const cA = c.a;
        const aTL = cA * objAlpha.topLeft, aTR = cA * objAlpha.topRight;
        const aBL = cA * objAlpha.bottomLeft, aBR = cA * objAlpha.bottomRight;

        const oc = src.outlineColor, oA = hasOutline && !pixelArt ? src.outlineAlpha : 0;
        outlineBuf.topLeft = packColor(oc, oA * objAlpha.topLeft);
        outlineBuf.topRight = packColor(oc, oA * objAlpha.topRight);
        outlineBuf.bottomLeft = packColor(oc, oA * objAlpha.bottomLeft);
        outlineBuf.bottomRight = packColor(oc, oA * objAlpha.bottomRight);

        // A fully transparent fill frees its colour attribute for the two-tone
        // ramp, so it must carry the outline's colour rather than the (now
        // invisible) face colour — see `packFillAspect`.
        const fc = src.color;
        fillBuf.topLeft = packColor(aTL >= MIN_ALPHA ? fc : oc, aTL);
        fillBuf.topRight = packColor(aTR >= MIN_ALPHA ? fc : oc, aTR);
        fillBuf.bottomLeft = packColor(aBL >= MIN_ALPHA ? fc : oc, aBL);
        fillBuf.bottomRight = packColor(aBR >= MIN_ALPHA ? fc : oc, aBR);

        const sc = src.shadowColor, sA = src.shadowAlpha;
        shadowBuf.topLeft = packColor(sc, sA * objAlpha.topLeft);
        shadowBuf.topRight = packColor(sc, sA * objAlpha.topRight);
        shadowBuf.bottomLeft = packColor(sc, sA * objAlpha.bottomLeft);
        shadowBuf.bottomRight = packColor(sc, sA * objAlpha.bottomRight);

        // Inner ends of the two colour ramps. `-1` means "inherit the outer
        // colour", which makes the shader's mix an identity.
        const oInner = src.outlineInnerColor, sInner = src.shadowInnerColor;
        fillCorners(outlineToneBuf, packColor(oInner >= 0 ? oInner : oc, 0));
        fillCorners(shadowToneBuf, packColor(sInner >= 0 ? sInner : sc, 0));

        // Colours are font-independent, but the params are normalized by each
        // font's `distanceRange`, so they are packed once per binding and copied
        // into the corner buffers as the loops cross a run boundary.
        packStaticParams(src, fontCount);
        fillCorners(glyphParams, bindings[0].staticParams);
        fillCorners(shadowParams, bindings[0].staticShadowParams);
    } else if (glyphMode === GLYPH_MODE_CALLBACK) {
        // Re-seed (and, if styled, re-apply style runs) every frame, then let the
        // callback layer on top of the resolved state.
        glyphs = src.prepareGlyphStates();
        if (src.displayCallback) {
            src.displayCallback(glyphs, src);
        }
    } else {
        // Manual mode, or static + styles: the array is already seeded (and
        // styled) by the rebuild / styles-dirty path — read it as-is.
        glyphs = src._glyphStates;
    }
    const perGlyph = glyphs !== null;

    // ── Resolve per-rect state ──────────────────────────────────────────────
    // After the glyphs, deliberately: the callback sees the *finished* glyph array
    // (`parent.glyphs`), so a rule can follow the glyphs it was merged from — its
    // `glyphStart`/`glyphEnd` index straight into it. Transient and re-seeded every
    // frame, with no manual mode, because a rect has no identity that survives a
    // rebuild (see `MSDFDecorState.ts`). Nothing to animate ⇒ nothing to seed.
    let decorStates: DecorationState[] | null = null;
    if (hasDecorations && src._decorMode === DECOR_MODE_CALLBACK) {
        decorStates = src.prepareDecorStates();
        if (src.decorationCallback) {
            src.decorationCallback(decorStates, src);
        }
    }

    // A layered outline needs its own silhouette loop. Per-glyph widths mean a
    // glyph can have an outline even when the object has none, so the gate opens
    // for any per-glyph text that asked for layering.
    //
    // A two-tone outline forces layering: the inner colour rides the fill
    // attribute, which a combined fill+outline quad has already spoken for.
    const layered = !pixelArt && (src.outlineLayered || src.outlineInnerColor >= 0) && (hasOutline || perGlyph);

    // ── Highlight pass — pills behind everything, the shadow included. ───────
    if (hasDecorations) {
        if (decorStates) {
            submitDecorationStates(drawingContext, batchHandler, decorStates, PASS_HIGHLIGHT, multiFont,
                calcMatrix, originOffsetX, originOffsetY);
        } else {
            submitDecorations(drawingContext, batchHandler, decorations, PASS_HIGHLIGHT, multiFont,
                calcMatrix, originOffsetX, originOffsetY, src.color, baseAlpha, dashPhase);
        }
    }

    // ── Shadow pass — render shadow behind the text. ────────────────────────
    // Object-level shadow always draws it. In per-glyph mode the pass also runs
    // when a styled run sets a shadow (`_stylesHaveShadow`, resolved during the
    // seed above) or the user opted in via `perGlyphShadow` — so per-glyph
    // shadows show even without a shadow on the whole object. Glyphs with no
    // shadow were seeded to zero alpha, so they draw nothing.
    const runShadow = hasShadow || (perGlyph && (src._stylesHaveShadow || src.perGlyphShadow));
    if (runShadow) {
        const dsx = src.shadowX;
        const dsy = src.shadowY;

        for (let i = 0; i < characterCount; i++) {
            const char = characters[i];
            if (!char || char.w === 0 || char.h === 0) continue;
            if (perGlyph && !glyphs![i].visible) continue;

            const b = bindings[char.fontIdx];
            if (multiFont) configureFont(batchHandler, drawingContext, b.unitX, b.unitY, b.pixelArt);

            if (perGlyph) {
                const g = glyphs![i];
                const quad = resolveGlyphQuad(char, g.glyph, b.font);
                // Blurring and rounding both read the true SDF. Spread does not —
                // it dilates the same median(rgb) edge a thick outline does — so
                // it rides `width`, the one channel a shadow quad leaves idle, and
                // needs no clamp.
                const softness = b.isMtsdf && !pixelArt ? g.shadow.softness : zeroCorners;
                const rounded = b.isMtsdf && !pixelArt ? g.shadow.rounded : zeroCorners;
                const weight = pixelArt ? zeroCorners : g.weight;
                const spread = pixelArt ? zeroCorners : g.shadow.spread;
                packAspect(shadowBuf, g.shadow.color, g.shadow.alpha);
                packToneAspect(shadowToneBuf, g.shadow.innerColor);
                packParamsAspect(shadowParams, weight, rounded, spread, softness, b.invRange);
                submitOneGlyph(drawingContext, batchHandler, b.texture, quad,
                    g.x + swapDX + g.shadow.x, g.y + swapDY + g.shadow.y,
                    g.scaleX, g.scaleY, g.rotation, g.skew,
                    g.skewPivot, g.offsetX, g.offsetY,
                    calcMatrix, originOffsetX, originOffsetY, shadowToneBuf, shadowBuf, shadowParams);
            } else {
                if (multiFont) fillCorners(shadowParams, b.staticShadowParams);
                submitOneGlyph(drawingContext, batchHandler, b.texture, char,
                    char.x + dsx, char.y + dsy, 1, 1, 0, 0, 0, null, null,
                    calcMatrix, originOffsetX, originOffsetY, shadowToneBuf, shadowBuf, shadowParams);
            }
        }
    }

    // ── Outline silhouette pass (layered only) — every glyph's outline blob, ─
    // drawn before any fill so neighbouring outlines can't cover a glyph's fill.
    if (layered) {
        for (let i = 0; i < characterCount; i++) {
            const char = characters[i];
            if (!char || char.w === 0 || char.h === 0) continue;
            if (perGlyph && !glyphs![i].visible) continue;

            const b = bindings[char.fontIdx];
            if (multiFont) configureFont(batchHandler, drawingContext, b.unitX, b.unitY, b.pixelArt);

            if (perGlyph) {
                const g = glyphs![i];
                const quad = resolveGlyphQuad(char, g.glyph, b.font);
                const rounded = b.isMtsdf && !pixelArt ? g.outline.rounded : zeroCorners;
                const softness = b.isMtsdf && !pixelArt ? g.outline.softness : zeroCorners;
                const outlineWidth = pixelArt ? zeroCorners : g.outline.width;
                const weight = pixelArt ? zeroCorners : g.weight;
                packOutlineAspect(outlineBuf, g.outline.color, g.outline.alpha, outlineWidth, softness);
                packToneAspect(outlineToneBuf, g.outline.innerColor);
                packParamsAspect(glyphParams, weight, rounded, outlineWidth, softness, b.invRange);
                submitOneGlyph(drawingContext, batchHandler, b.texture, quad,
                    g.x + swapDX, g.y + swapDY, g.scaleX, g.scaleY, g.rotation, g.skew,
                    g.skewPivot, g.offsetX, g.offsetY,
                    calcMatrix, originOffsetX, originOffsetY, outlineToneBuf, outlineBuf, glyphParams);
            } else {
                if (multiFont) fillCorners(glyphParams, b.staticParams);
                submitOneGlyph(drawingContext, batchHandler, b.texture, char,
                    char.x, char.y, 1, 1, 0, 0, 0, null, null,
                    calcMatrix, originOffsetX, originOffsetY, outlineToneBuf, outlineBuf, glyphParams);
            }
        }
    }

    // ── Underline pass — under the glyphs, over the shadows and silhouettes. ─
    if (hasDecorations) {
        if (decorStates) {
            submitDecorationStates(drawingContext, batchHandler, decorStates, PASS_UNDERLINE, multiFont,
                calcMatrix, originOffsetX, originOffsetY);
        } else {
            submitDecorations(drawingContext, batchHandler, decorations, PASS_UNDERLINE, multiFont,
                calcMatrix, originOffsetX, originOffsetY, src.color, baseAlpha, dashPhase);
        }
    }

    // ── Text pass — fill, with the outline composited under it in the same ───
    // quad unless the outline was already drawn as a layered silhouette.
    const combined = !layered;
    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];
        if (!char || char.w === 0 || char.h === 0) continue;
        if (perGlyph && !glyphs![i].visible) continue;

        const b = bindings[char.fontIdx];
        if (multiFont) configureFont(batchHandler, drawingContext, b.unitX, b.unitY, b.pixelArt);

        if (perGlyph) {
            const g = glyphs![i];
            const quad = resolveGlyphQuad(char, g.glyph, b.font);
            const rounded = b.isMtsdf && !pixelArt ? g.outline.rounded : zeroCorners;
            const softness = b.isMtsdf && !pixelArt ? g.outline.softness : zeroCorners;
            const outlineWidth = pixelArt ? zeroCorners : g.outline.width;
            const weight = pixelArt ? zeroCorners : g.weight;
            let outlineData = zeroColor;
            if (combined) {
                packOutlineAspect(outlineBuf, g.outline.color, g.outline.alpha, outlineWidth, softness);
                packFillAspect(fillBuf, g.fill.color, g.fill.alpha, g.outline.color);
                outlineData = outlineBuf;
            } else {
                packAspect(fillBuf, g.fill.color, g.fill.alpha);
            }
            // In the layered case the outline layer is already drawn and this
            // quad's outline alpha is zero, so its width and softness are inert
            // here — passed anyway, so both branches share one pack.
            packParamsAspect(glyphParams, weight, rounded, outlineWidth, softness, b.invRange);
            submitOneGlyph(drawingContext, batchHandler, b.texture, quad,
                g.x + swapDX, g.y + swapDY, g.scaleX, g.scaleY, g.rotation, g.skew,
                g.skewPivot, g.offsetX, g.offsetY,
                calcMatrix, originOffsetX, originOffsetY, fillBuf, outlineData, glyphParams);
        } else {
            if (multiFont) fillCorners(glyphParams, b.staticParams);
            submitOneGlyph(drawingContext, batchHandler, b.texture, char,
                char.x, char.y, 1, 1, 0, 0, 0, null, null,
                calcMatrix, originOffsetX, originOffsetY, fillBuf,
                combined && hasOutline ? outlineBuf : zeroColor, glyphParams);
        }
    }

    // ── Strikethrough pass — over the glyphs, matching browsers. ─────────────
    if (hasDecorations) {
        if (decorStates) {
            submitDecorationStates(drawingContext, batchHandler, decorStates, PASS_STRIKE, multiFont,
                calcMatrix, originOffsetX, originOffsetY);
        } else {
            submitDecorations(drawingContext, batchHandler, decorations, PASS_STRIKE, multiFont,
                calcMatrix, originOffsetX, originOffsetY, src.color, baseAlpha, dashPhase);
        }
    }
}

export default MSDFTextWebGLRenderer;
export { MSDFTextWebGLRenderer };
