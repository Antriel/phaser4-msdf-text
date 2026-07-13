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
    SOLID_PARAMS,
    type Corners,
    type PackedCorners
} from './MSDFColor';
import type { GlyphState } from './MSDFGlyphState';

const GetCalcMatrix = (Phaser as any).GameObjects.GetCalcMatrix;
const TransformMatrix = (Phaser as any).GameObjects.Components.TransformMatrix;

// Per-glyph mode flags — mirror the constants in MSDFText.
const GLYPH_MODE_STATIC = 0;
const GLYPH_MODE_CALLBACK = 1;

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
// The object's effective per-corner alpha, for decorations that inherit it.
const baseAlpha: Corners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };

// A solid underline / strikethrough rect: a hard-edged box, no radius, no border,
// no blur. A highlight pill and a dashed rule carry their own packed params.
const rectParams: PackedCorners = { topLeft: SOLID_PARAMS, topRight: SOLID_PARAMS, bottomLeft: SOLID_PARAMS, bottomRight: SOLID_PARAMS };
const rectColor: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
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

/**
 * Everything the passes need from one font, hoisted out of the per-glyph loops.
 * `unitX`/`unitY` are the `uUnitRange` this font's atlas wants; `invRange`
 * normalises distance-field quantities (outline width, weight, softness) into
 * fractions of *this* font's `distanceRange`, which is what makes those params
 * font-independent; `isMtsdf` gates the effects that read the true-SDF alpha.
 */
interface FontBinding {
    texture: any;
    unitX: number;
    unitY: number;
    invRange: number;
    isMtsdf: boolean;
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
            texture: null, unitX: 0, unitY: 0, invRange: 0, isMtsdf: false,
            staticParams: 0, staticShadowParams: 0
        });
    }

    for (let i = 0; i < count; i++) {
        const data = runFonts[i].data;
        const range = data.distanceField.distanceRange;
        const frame = runFrames[i];
        const b = bindings[i];

        b.texture = i === 0 ? baseTexture : (frame ? frame.glTexture : baseTexture);
        b.unitX = range / data.atlasWidth;
        b.unitY = range / data.atlasHeight;
        b.invRange = 1 / range;
        b.isMtsdf = data.distanceField.fieldType === 'mtsdf';
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
        const inv = b.invRange;
        const outSoft = b.isMtsdf ? src.outlineSoftness : 0;
        const shSoft = b.isMtsdf ? src.shadowSoftness : 0;
        const outRound = (b.isMtsdf && src.outlineRounded) ? 1 : 0;
        const shRound = (b.isMtsdf && src.shadowRounded) ? 1 : 0;
        b.staticParams = packParams(weight * inv, outRound, outlineWidth * inv, outSoft * inv);
        b.staticShadowParams = packParams(weight * inv, shRound, shadowSpread * inv, shSoft * inv);
    }
}

/** The smallest alpha that survives `packColor`'s truncation to a byte. */
const MIN_ALPHA = 1 / 255;

/** Pack a per-corner colour + alpha pair into a batch buffer. */
function packAspect(buf: PackedCorners, color: Corners, alpha: Corners): void {
    buf.topLeft = packColor(color.topLeft, alpha.topLeft);
    buf.topRight = packColor(color.topRight, alpha.topRight);
    buf.bottomLeft = packColor(color.bottomLeft, alpha.bottomLeft);
    buf.bottomRight = packColor(color.bottomRight, alpha.bottomRight);
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
 */
function packFillAspect(buf: PackedCorners, color: Corners, alpha: Corners, fallback: Corners): void {
    buf.topLeft = packColor(alpha.topLeft >= MIN_ALPHA ? color.topLeft : fallback.topLeft, alpha.topLeft);
    buf.topRight = packColor(alpha.topRight >= MIN_ALPHA ? color.topRight : fallback.topRight, alpha.topRight);
    buf.bottomLeft = packColor(alpha.bottomLeft >= MIN_ALPHA ? color.bottomLeft : fallback.bottomLeft, alpha.bottomLeft);
    buf.bottomRight = packColor(alpha.bottomRight >= MIN_ALPHA ? color.bottomRight : fallback.bottomRight, alpha.bottomRight);
}

/**
 * Pack the outline colour, zeroing the alpha wherever the outline has no body of
 * its own — neither a width nor a softness. At zero width the outline edge
 * coincides with the fill edge, so without this the outline colour would fringe
 * every glyph's antialiased edge; but a *blurred* zero-width outline is a glow
 * hugging the letterform, which has a body and must survive.
 */
function packOutlineAspect(buf: PackedCorners, color: Corners, alpha: Corners, width: Corners, softness: Corners): void {
    buf.topLeft = packColor(color.topLeft, (width.topLeft > 0 || softness.topLeft > 0) ? alpha.topLeft : 0);
    buf.topRight = packColor(color.topRight, (width.topRight > 0 || softness.topRight > 0) ? alpha.topRight : 0);
    buf.bottomLeft = packColor(color.bottomLeft, (width.bottomLeft > 0 || softness.bottomLeft > 0) ? alpha.bottomLeft : 0);
    buf.bottomRight = packColor(color.bottomRight, (width.bottomRight > 0 || softness.bottomRight > 0) ? alpha.bottomRight : 0);
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
    unitRangeY: number
): void {
    if (batchHandler.hasUnitRangeChanged(unitRangeX, unitRangeY)) {
        batchHandler.run(drawingContext);
    }
    batchHandler.setUnitRange(unitRangeX, unitRangeY);
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
    baseAlpha: Corners,
    dashPhase: number
): void {
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.pass !== pass) continue;

        const b = bindings[r.fontIdx];
        if (multiFont) configureFont(batchHandler, drawingContext, b.unitX, b.unitY);

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
        const inner: Corners | undefined = r.inner;
        const rTL = rgb ? rgb.topLeft : baseRgb;
        const rTR = rgb ? rgb.topRight : baseRgb;
        const rBL = rgb ? rgb.bottomLeft : baseRgb;
        const rBR = rgb ? rgb.bottomRight : baseRgb;
        rectColor.topLeft = packRectCorner(rTL, alpha ? alpha.topLeft : baseAlpha.topLeft, inner ? inner.topLeft : rTL);
        rectColor.topRight = packRectCorner(rTR, alpha ? alpha.topRight : baseAlpha.topRight, inner ? inner.topRight : rTR);
        rectColor.bottomLeft = packRectCorner(rBL, alpha ? alpha.bottomLeft : baseAlpha.bottomLeft, inner ? inner.bottomLeft : rBL);
        rectColor.bottomRight = packRectCorner(rBR, alpha ? alpha.bottomRight : baseAlpha.bottomRight, inner ? inner.bottomRight : rBR);

        // Rects take no deform: they live outside `_characters`, so no `GlyphState`
        // owns one (see the decorations note in CLAUDE.md).
        BatchMSDFChar(drawingContext, batchHandler, b.texture, rectQuad,
            originOffsetX, originOffsetY, calcMatrix, rectColor,
            r.border || zeroColor, r.params || rectParams, null, null, 0);
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
    if (!multiFont) {
        configureFont(batchHandler, drawingContext, bindings[0].unitX, bindings[0].unitY);
    }

    const hasOutline = src.hasOutline();
    const hasShadow = src.hasShadow();
    const decorations = src._decorRects;
    const hasDecorations = decorations.length > 0;
    // A dash pattern repeats every unit of phase, so wrapping it into [0, 1) is
    // exact — and it keeps a rect's U span small however long a marching-ants
    // tween has been accumulating.
    let dashPhase = 0;
    if (hasDecorations) {
        const cA = src._color.a;
        baseAlpha.topLeft = cA * src._alphaTL;
        baseAlpha.topRight = cA * src._alphaTR;
        baseAlpha.bottomLeft = cA * src._alphaBL;
        baseAlpha.bottomRight = cA * src._alphaBR;

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
        const aTL = cA * src._alphaTL, aTR = cA * src._alphaTR, aBL = cA * src._alphaBL, aBR = cA * src._alphaBR;

        const oc = src.outlineColor, oA = hasOutline ? src.outlineAlpha : 0;
        outlineBuf.topLeft = packColor(oc, oA * src._alphaTL);
        outlineBuf.topRight = packColor(oc, oA * src._alphaTR);
        outlineBuf.bottomLeft = packColor(oc, oA * src._alphaBL);
        outlineBuf.bottomRight = packColor(oc, oA * src._alphaBR);

        // A fully transparent fill frees its colour attribute for the two-tone
        // ramp, so it must carry the outline's colour rather than the (now
        // invisible) face colour — see `packFillAspect`.
        const fc = src.color;
        fillBuf.topLeft = packColor(aTL >= MIN_ALPHA ? fc : oc, aTL);
        fillBuf.topRight = packColor(aTR >= MIN_ALPHA ? fc : oc, aTR);
        fillBuf.bottomLeft = packColor(aBL >= MIN_ALPHA ? fc : oc, aBL);
        fillBuf.bottomRight = packColor(aBR >= MIN_ALPHA ? fc : oc, aBR);

        const sc = src.shadowColor, sA = src.shadowAlpha;
        shadowBuf.topLeft = packColor(sc, sA * src._alphaTL);
        shadowBuf.topRight = packColor(sc, sA * src._alphaTR);
        shadowBuf.bottomLeft = packColor(sc, sA * src._alphaBL);
        shadowBuf.bottomRight = packColor(sc, sA * src._alphaBR);

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

    // A layered outline needs its own silhouette loop. Per-glyph widths mean a
    // glyph can have an outline even when the object has none, so the gate opens
    // for any per-glyph text that asked for layering.
    //
    // A two-tone outline forces layering: the inner colour rides the fill
    // attribute, which a combined fill+outline quad has already spoken for.
    const layered = (src.outlineLayered || src.outlineInnerColor >= 0) && (hasOutline || perGlyph);

    // ── Highlight pass — pills behind everything, the shadow included. ───────
    if (hasDecorations) {
        submitDecorations(drawingContext, batchHandler, decorations, PASS_HIGHLIGHT, multiFont,
            calcMatrix, originOffsetX, originOffsetY, src.color, baseAlpha, dashPhase);
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

            const b = bindings[char.fontIdx];
            if (multiFont) configureFont(batchHandler, drawingContext, b.unitX, b.unitY);

            if (perGlyph) {
                const g = glyphs![i];
                // Blurring and rounding both read the true SDF. Spread does not —
                // it dilates the same median(rgb) edge a thick outline does — so
                // it rides `width`, the one channel a shadow quad leaves idle, and
                // needs no clamp.
                const softness = b.isMtsdf ? g.shadow.softness : zeroCorners;
                const rounded = b.isMtsdf ? g.shadow.rounded : zeroCorners;
                packAspect(shadowBuf, g.shadow.color, g.shadow.alpha);
                packToneAspect(shadowToneBuf, g.shadow.innerColor);
                packParamsAspect(shadowParams, g.weight, rounded, g.shadow.spread, softness, b.invRange);
                submitOneGlyph(drawingContext, batchHandler, b.texture, char,
                    g.x + g.shadow.x, g.y + g.shadow.y, g.scaleX, g.scaleY, g.rotation, g.skew,
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

            const b = bindings[char.fontIdx];
            if (multiFont) configureFont(batchHandler, drawingContext, b.unitX, b.unitY);

            if (perGlyph) {
                const g = glyphs![i];
                const rounded = b.isMtsdf ? g.outline.rounded : zeroCorners;
                const softness = b.isMtsdf ? g.outline.softness : zeroCorners;
                packOutlineAspect(outlineBuf, g.outline.color, g.outline.alpha, g.outline.width, softness);
                packToneAspect(outlineToneBuf, g.outline.innerColor);
                packParamsAspect(glyphParams, g.weight, rounded, g.outline.width, softness, b.invRange);
                submitOneGlyph(drawingContext, batchHandler, b.texture, char,
                    g.x, g.y, g.scaleX, g.scaleY, g.rotation, g.skew,
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
        submitDecorations(drawingContext, batchHandler, decorations, PASS_UNDERLINE, multiFont,
            calcMatrix, originOffsetX, originOffsetY, src.color, baseAlpha, dashPhase);
    }

    // ── Text pass — fill, with the outline composited under it in the same ───
    // quad unless the outline was already drawn as a layered silhouette.
    const combined = !layered;
    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];
        if (!char || char.w === 0 || char.h === 0) continue;

        const b = bindings[char.fontIdx];
        if (multiFont) configureFont(batchHandler, drawingContext, b.unitX, b.unitY);

        if (perGlyph) {
            const g = glyphs![i];
            const rounded = b.isMtsdf ? g.outline.rounded : zeroCorners;
            const softness = b.isMtsdf ? g.outline.softness : zeroCorners;
            let outlineData = zeroColor;
            if (combined) {
                packOutlineAspect(outlineBuf, g.outline.color, g.outline.alpha, g.outline.width, softness);
                packFillAspect(fillBuf, g.fill.color, g.fill.alpha, g.outline.color);
                outlineData = outlineBuf;
            } else {
                packAspect(fillBuf, g.fill.color, g.fill.alpha);
            }
            // In the layered case the outline layer is already drawn and this
            // quad's outline alpha is zero, so its width and softness are inert
            // here — passed anyway, so both branches share one pack.
            packParamsAspect(glyphParams, g.weight, rounded, g.outline.width, softness, b.invRange);
            submitOneGlyph(drawingContext, batchHandler, b.texture, char,
                g.x, g.y, g.scaleX, g.scaleY, g.rotation, g.skew,
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
        submitDecorations(drawingContext, batchHandler, decorations, PASS_STRIKE, multiFont,
            calcMatrix, originOffsetX, originOffsetY, src.color, baseAlpha, dashPhase);
    }
}

export default MSDFTextWebGLRenderer;
export { MSDFTextWebGLRenderer };
