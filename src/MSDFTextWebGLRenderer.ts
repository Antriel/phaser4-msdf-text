/**
 * MSDF Text WebGL Renderer
 *
 * Iterates each character of an MSDFText and submits it to the MSDF batch
 * handler. Passes run back-to-front: drop shadow, then (for a layered outline)
 * every glyph's outline silhouette, then underlines, then the text fill, then
 * strikethroughs. They are **submission-order** loops, not separate draws — the
 * shader is a single branch driven by the per-vertex `params` attribute, so all
 * of it lands in one draw call and composites in submission order under alpha
 * blending.
 *
 * Two consequences worth stating plainly, because they shaped the code:
 *
 *   - A **shadow quad is an outline-only quad**: fill alpha zero, shadow colour
 *     in the outline attribute. It has to be, because softness and rounding live
 *     on the outline layer, and the fill layer must keep `median(rgb)` or a
 *     rounded outline would round its own glyph's face.
 *   - An outline with **width 0 contributes nothing**. The outline layer's edge
 *     is `fillEdge - width`, so a zero width makes it the glyph silhouette; we
 *     zero its alpha at pack time instead of branching in the shader.
 *
 * The only remaining flush gate is `configureFont`, on the per-texture
 * `uUnitRange`. Uniforms are applied per draw, so it must flush *before* it sets
 * the new value, or the previous font's queued quads render with the new font's
 * range.
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
    PARAM_ROUNDED,
    PARAM_SOLID,
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
// Colour attribute for layers a pass doesn't use (a plain fill's outline, a
// shadow's or a silhouette's fill): all-zero, so that layer contributes nothing.
const zeroColor: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
const zeroCorners: Corners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
// The object's effective per-corner alpha, for decorations that inherit it.
const baseAlpha: Corners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };

// Decoration rects: full coverage, no distance field, no outline. Constant.
const RECT_PARAM = packParams(0, PARAM_SOLID, 0, 0);
const rectParams: PackedCorners = { topLeft: RECT_PARAM, topRight: RECT_PARAM, bottomLeft: RECT_PARAM, bottomRight: RECT_PARAM };
const rectColor: PackedCorners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
// A rect spans the full 0..1 of its own UV box. Not because it samples anything
// — `solid` short-circuits coverage — but so `fwidth(texCoord)` stays nonzero
// and `screenPxRange()` can't produce an Inf that leaks through the mix().
const rectQuad = { x: 0, y: 0, w: 0, h: 0, u0: 0, v0: 0, u1: 1, v1: 1 };

const tempCharData = { x: 0, y: 0, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
const tempCharMatrix = new TransformMatrix();

/** Pack a per-corner colour + alpha pair into a batch buffer. */
function packAspect(buf: PackedCorners, color: Corners, alpha: Corners): void {
    buf.topLeft = packColor(color.topLeft, alpha.topLeft);
    buf.topRight = packColor(color.topRight, alpha.topRight);
    buf.bottomLeft = packColor(color.bottomLeft, alpha.bottomLeft);
    buf.bottomRight = packColor(color.bottomRight, alpha.bottomRight);
}

/**
 * Pack the outline colour, zeroing the alpha wherever the width is zero. "No
 * outline" is a width of zero, and at zero width the outline edge coincides with
 * the fill edge — so without this the outline colour would fringe every glyph's
 * antialiased edge.
 */
function packOutlineAspect(buf: PackedCorners, color: Corners, alpha: Corners, width: Corners): void {
    buf.topLeft = packColor(color.topLeft, width.topLeft > 0 ? alpha.topLeft : 0);
    buf.topRight = packColor(color.topRight, width.topRight > 0 ? alpha.topRight : 0);
    buf.bottomLeft = packColor(color.bottomLeft, width.bottomLeft > 0 ? alpha.bottomLeft : 0);
    buf.bottomRight = packColor(color.bottomRight, width.bottomRight > 0 ? alpha.bottomRight : 0);
}

/**
 * Pack the four `params` corners. `flags` is per-glyph by construction (a packed
 * bitfield cannot survive interpolation); the numeric channels are normalized by
 * the font's `distanceRange` here, on the CPU, which is what makes them
 * font-independent and lets the range cancel out of the shader.
 */
function packParamsAspect(
    buf: PackedCorners,
    weight: Corners,
    flags: number,
    width: Corners,
    softness: Corners,
    invRange: number
): void {
    buf.topLeft = packParams(weight.topLeft * invRange, flags, width.topLeft * invRange, softness.topLeft * invRange);
    buf.topRight = packParams(weight.topRight * invRange, flags, width.topRight * invRange, softness.topRight * invRange);
    buf.bottomLeft = packParams(weight.bottomLeft * invRange, flags, width.bottomLeft * invRange, softness.bottomLeft * invRange);
    buf.bottomRight = packParams(weight.bottomRight * invRange, flags, width.bottomRight * invRange, softness.bottomRight * invRange);
}

/** Fill all four corners of a buffer with one packed value. */
function fillCorners(buf: PackedCorners, value: number): void {
    buf.topLeft = buf.topRight = buf.bottomLeft = buf.bottomRight = value;
}

/** The largest of a corner set — used to decide a per-glyph flag from per-corner data. */
function maxCorner(c: Corners): number {
    return Math.max(Math.max(c.topLeft, c.topRight), Math.max(c.bottomLeft, c.bottomRight));
}

/**
 * Bind the font for the quads about to be submitted, flushing first if its
 * `uUnitRange` differs from the pending batch's. Uniforms are read at draw time,
 * so the new value must be set *after* the flush — setting it before would
 * render the previous font's queued glyphs with this font's range (wrong AA
 * width, wrong outline thickness).
 *
 * The texture is the batch handler's own flush gate (inside `batch()`), so it is
 * not checked here. This is the single remaining gate, and the one per-run fonts
 * will extend to switch textures mid-object.
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
            // Pivot on this glyph's absolute layout baseline. `char.baselineY -
            // char.y` is the glyph top → baseline offset (constant per glyph),
            // added to the glyph's current top `y` so a moved glyph shears about
            // its own baseline. Per-glyph scale (centre pivot below) deliberately
            // does not move this pivot — that keeps a mixed-scale line coherent.
            applyBaselineShear(tempCharMatrix, skew, y + (char.baselineY - char.y) + originOffsetY);
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
        BatchMSDFChar(drawingContext, batchHandler, texture, tempCharData, 0, 0, tempCharMatrix, colorData, outlineData, params);
    } else {
        // Reuse the char's geometry directly; fold the position delta into the offset.
        const offX = x - char.x + originOffsetX;
        const offY = y - char.y + originOffsetY;
        BatchMSDFChar(drawingContext, batchHandler, texture, char, offX, offY, calcMatrix, colorData, outlineData, params);
    }
}

/**
 * Submit the underline / strikethrough rects whose `over` flag matches. They
 * follow the layout, never the per-glyph transform: a scaled or rotated glyph
 * moves, its decoration does not.
 *
 * A rect whose `rgb`/`alpha` is absent inherits the object's, resolved here
 * rather than baked at build time, so tweening the text's colour or alpha drags
 * an inherited underline along with it.
 */
function submitDecorations(
    drawingContext: any,
    batchHandler: MSDFBatchHandlerInstance,
    texture: any,
    rects: any[],
    over: boolean,
    calcMatrix: any,
    originOffsetX: number,
    originOffsetY: number,
    baseRgb: number,
    baseAlpha: Corners
): void {
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.over !== over) continue;

        rectQuad.x = r.x;
        rectQuad.y = r.y;
        rectQuad.w = r.w;
        rectQuad.h = r.h;

        const rgb: Corners | undefined = r.rgb;
        const alpha: Corners | undefined = r.alpha;
        rectColor.topLeft = packColor(rgb ? rgb.topLeft : baseRgb, alpha ? alpha.topLeft : baseAlpha.topLeft);
        rectColor.topRight = packColor(rgb ? rgb.topRight : baseRgb, alpha ? alpha.topRight : baseAlpha.topRight);
        rectColor.bottomLeft = packColor(rgb ? rgb.bottomLeft : baseRgb, alpha ? alpha.bottomLeft : baseAlpha.bottomLeft);
        rectColor.bottomRight = packColor(rgb ? rgb.bottomRight : baseRgb, alpha ? alpha.bottomRight : baseAlpha.bottomRight);

        BatchMSDFChar(drawingContext, batchHandler, texture, rectQuad,
            originOffsetX, originOffsetY, calcMatrix, rectColor, zeroColor, rectParams);
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

    const texture = src.frame ? src.frame.glTexture : null;
    if (!texture) {
        return;
    }

    const matrixResult = GetCalcMatrix(src, camera, parentMatrix);
    const calcMatrix = matrixResult.calc;

    // Subtract displayOrigin so origin maps to the text's bounding box.
    const originOffsetX = -src.displayOriginX;
    const originOffsetY = -src.displayOriginY;

    const distanceField = src.fontData.distanceField;
    const range = distanceField.distanceRange;
    const invRange = 1 / range;
    const atlas = src.fontData.atlasSize;
    configureFont(batchHandler, drawingContext, range / atlas.width, range / atlas.height);

    // Rounded outlines and soft shadows read the true-SDF alpha channel, which
    // only carries usable data on MTSDF atlases. On a plain MSDF font they are
    // clamped away here, at pack time, so the effects degrade to the standard look.
    const isMtsdf = distanceField.fieldType === 'mtsdf';

    const hasOutline = src.hasOutline();
    const hasShadow = src.hasShadow();
    const decorations = src._decorRects;
    const hasDecorations = decorations.length > 0;
    if (hasDecorations) {
        const cA = src._color.a;
        baseAlpha.topLeft = cA * src._alphaTL;
        baseAlpha.topRight = cA * src._alphaTR;
        baseAlpha.bottomLeft = cA * src._alphaBL;
        baseAlpha.bottomRight = cA * src._alphaBR;
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

        const fc = src.color;
        fillBuf.topLeft = packColor(fc, aTL);
        fillBuf.topRight = packColor(fc, aTR);
        fillBuf.bottomLeft = packColor(fc, aBL);
        fillBuf.bottomRight = packColor(fc, aBR);

        const oc = src.outlineColor, oA = hasOutline ? src.outlineAlpha : 0;
        outlineBuf.topLeft = packColor(oc, oA * src._alphaTL);
        outlineBuf.topRight = packColor(oc, oA * src._alphaTR);
        outlineBuf.bottomLeft = packColor(oc, oA * src._alphaBL);
        outlineBuf.bottomRight = packColor(oc, oA * src._alphaBR);

        const sc = src.shadowColor, sA = src.shadowAlpha;
        shadowBuf.topLeft = packColor(sc, sA * src._alphaTL);
        shadowBuf.topRight = packColor(sc, sA * src._alphaTR);
        shadowBuf.bottomLeft = packColor(sc, sA * src._alphaBL);
        shadowBuf.bottomRight = packColor(sc, sA * src._alphaBR);

        const softness = isMtsdf ? src.shadowSoftness : 0;
        const outlineFlags = (isMtsdf && src.outlineRounded) ? PARAM_ROUNDED : 0;
        fillCorners(glyphParams, packParams(src.weight * invRange, outlineFlags, src.outlineWidth * invRange, 0));
        fillCorners(shadowParams, packParams(
            src.weight * invRange, softness > 0 ? PARAM_ROUNDED : 0, 0, softness * invRange
        ));
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
    const layered = src.outlineLayered && (hasOutline || perGlyph);

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

            if (perGlyph) {
                const g = glyphs![i];
                // A soft shadow reads the true SDF; a hard one is just the glyph
                // silhouette in the shadow colour, so it keeps median(rgb).
                const softness = isMtsdf ? g.shadow.softness : zeroCorners;
                const flags = maxCorner(softness) > 0 ? PARAM_ROUNDED : 0;
                packAspect(shadowBuf, g.shadow.color, g.shadow.alpha);
                packParamsAspect(shadowParams, g.weight, flags, zeroCorners, softness, invRange);
                submitOneGlyph(drawingContext, batchHandler, texture, char,
                    g.x + g.shadow.x, g.y + g.shadow.y, g.scaleX, g.scaleY, g.rotation, g.skew,
                    calcMatrix, originOffsetX, originOffsetY, zeroColor, shadowBuf, shadowParams);
            } else {
                submitOneGlyph(drawingContext, batchHandler, texture, char,
                    char.x + dsx, char.y + dsy, 1, 1, 0, 0,
                    calcMatrix, originOffsetX, originOffsetY, zeroColor, shadowBuf, shadowParams);
            }
        }
    }

    // ── Outline silhouette pass (layered only) — every glyph's outline blob, ─
    // drawn before any fill so neighbouring outlines can't cover a glyph's fill.
    if (layered) {
        for (let i = 0; i < characterCount; i++) {
            const char = characters[i];
            if (!char || char.w === 0 || char.h === 0) continue;

            if (perGlyph) {
                const g = glyphs![i];
                const flags = (isMtsdf && g.outline.rounded) ? PARAM_ROUNDED : 0;
                packOutlineAspect(outlineBuf, g.outline.color, g.outline.alpha, g.outline.width);
                packParamsAspect(glyphParams, g.weight, flags, g.outline.width, zeroCorners, invRange);
                submitOneGlyph(drawingContext, batchHandler, texture, char,
                    g.x, g.y, g.scaleX, g.scaleY, g.rotation, g.skew,
                    calcMatrix, originOffsetX, originOffsetY, zeroColor, outlineBuf, glyphParams);
            } else {
                submitOneGlyph(drawingContext, batchHandler, texture, char,
                    char.x, char.y, 1, 1, 0, 0,
                    calcMatrix, originOffsetX, originOffsetY, zeroColor, outlineBuf, glyphParams);
            }
        }
    }

    // ── Underline pass — under the glyphs, over the shadows and silhouettes. ─
    if (hasDecorations) {
        submitDecorations(drawingContext, batchHandler, texture, decorations, false,
            calcMatrix, originOffsetX, originOffsetY, src.color, baseAlpha);
    }

    // ── Text pass — fill, with the outline composited under it in the same ───
    // quad unless the outline was already drawn as a layered silhouette.
    const combined = !layered;
    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];
        if (!char || char.w === 0 || char.h === 0) continue;

        if (perGlyph) {
            const g = glyphs![i];
            packAspect(fillBuf, g.fill.color, g.fill.alpha);
            let outlineData = zeroColor;
            if (combined) {
                packOutlineAspect(outlineBuf, g.outline.color, g.outline.alpha, g.outline.width);
                outlineData = outlineBuf;
            }
            const flags = (isMtsdf && g.outline.rounded) ? PARAM_ROUNDED : 0;
            packParamsAspect(glyphParams, g.weight, flags, g.outline.width, zeroCorners, invRange);
            submitOneGlyph(drawingContext, batchHandler, texture, char,
                g.x, g.y, g.scaleX, g.scaleY, g.rotation, g.skew,
                calcMatrix, originOffsetX, originOffsetY, fillBuf, outlineData, glyphParams);
        } else {
            submitOneGlyph(drawingContext, batchHandler, texture, char,
                char.x, char.y, 1, 1, 0, 0,
                calcMatrix, originOffsetX, originOffsetY, fillBuf,
                combined && hasOutline ? outlineBuf : zeroColor, glyphParams);
        }
    }

    // ── Strikethrough pass — over the glyphs, matching browsers. ─────────────
    if (hasDecorations) {
        submitDecorations(drawingContext, batchHandler, texture, decorations, true,
            calcMatrix, originOffsetX, originOffsetY, src.color, baseAlpha);
    }
}

export default MSDFTextWebGLRenderer;
export { MSDFTextWebGLRenderer };
