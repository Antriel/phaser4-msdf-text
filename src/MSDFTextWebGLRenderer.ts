/**
 * MSDF Text WebGL Renderer
 *
 * Iterates each character of an MSDFText and submits it to the MSDF batch
 * handler. Passes run back-to-front: drop shadow first, then the text itself.
 * An outline is drawn either in a single combined pass (`uMode` 1) or, when
 * `outlineLayered` is set, as two passes — every glyph's outline silhouette
 * first, then every glyph's fill on top — so a thick outline can't overlap a
 * neighbouring glyph. Each pass sets `uMode` (and the width/rounded uniforms)
 * via `configurePass`, which flushes the pending batch whenever they change.
 * Outline *colour* is now a per-vertex attribute, so differently-coloured
 * outlines batch together without a flush.
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
import { MSDFMode, type MSDFBatchHandlerInstance } from './MSDFBatchHandler';
import { packBatchTint, multiplyTint, type Corners, type PackedCorners } from './MSDFTint';
import type { GlyphState } from './MSDFGlyphState';

const GetCalcMatrix = (Phaser as any).GameObjects.GetCalcMatrix;
const TransformMatrix = (Phaser as any).GameObjects.Components.TransformMatrix;

// Per-glyph mode flags — mirror the constants in MSDFText.
const GLYPH_MODE_STATIC = 0;
const GLYPH_MODE_CALLBACK = 1;

// Reusable packed-corner buffers. A pass uses at most two at once (fill + outline),
// and passes run sequentially, so three plus a constant zero cover every case.
const fillBuf: PackedCorners = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };
const outlineBuf: PackedCorners = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };
const shadowBuf: PackedCorners = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };
// Outline attribute for passes that ignore it (plain fill, shadow): all-zero, harmless.
const zeroOutline: PackedCorners = { tintTopLeft: 0, tintTopRight: 0, tintBottomLeft: 0, tintBottomRight: 0 };

const tempCharData = { x: 0, y: 0, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
const tempCharMatrix = new TransformMatrix();

/** Pack a per-corner colour + alpha pair into a batch buffer. */
function packAspect(buf: PackedCorners, tint: Corners, alpha: Corners): void {
    buf.tintTopLeft = packBatchTint(tint.topLeft, alpha.topLeft);
    buf.tintTopRight = packBatchTint(tint.topRight, alpha.topRight);
    buf.tintBottomLeft = packBatchTint(tint.bottomLeft, alpha.bottomLeft);
    buf.tintBottomRight = packBatchTint(tint.bottomRight, alpha.bottomRight);
}

/**
 * Select the shader mode (and its uniforms) for the next pass, flushing any
 * pending batch first if anything changed — uniforms are applied per draw, so
 * already-queued quads must render with the old values before we switch.
 */
function configurePass(
    batchHandler: MSDFBatchHandlerInstance,
    drawingContext: any,
    mode: number,
    outlineWidth: number,
    rounded: number,
    shadowSoftness: number
): void {
    if (batchHandler.hasModeChanged(mode) ||
        batchHandler.hasOutlineChanged(outlineWidth, rounded) ||
        batchHandler.hasShadowSoftnessChanged(shadowSoftness)) {
        batchHandler.run(drawingContext);
    }
    batchHandler.setMode(mode);
    batchHandler.setOutline(outlineWidth, rounded);
    batchHandler.setShadowSoftness(shadowSoftness);
}

/**
 * Submit one glyph quad at an absolute text-space position. Uses the fast path
 * (the shared camera matrix + a position offset) unless the glyph is scaled or
 * rotated, in which case it builds a per-glyph matrix about the glyph centre.
 */
function submitOneGlyph(
    drawingContext: any,
    batchHandler: MSDFBatchHandlerInstance,
    texture: any,
    char: any,
    x: number,
    y: number,
    scale: number,
    rotation: number,
    calcMatrix: any,
    originOffsetX: number,
    originOffsetY: number,
    tintData: PackedCorners,
    outlineData: PackedCorners
): void {
    if (scale !== 1 || rotation !== 0) {
        const centerX = char.w / 2;
        const centerY = char.h / 2;

        tempCharMatrix.copyFrom(calcMatrix);
        tempCharMatrix.translate(x + centerX + originOffsetX, y + centerY + originOffsetY);
        if (rotation !== 0) tempCharMatrix.rotate(rotation);
        if (scale !== 1) tempCharMatrix.scale(scale, scale);

        tempCharData.x = -centerX;
        tempCharData.y = -centerY;
        tempCharData.w = char.w;
        tempCharData.h = char.h;
        tempCharData.u0 = char.u0;
        tempCharData.v0 = char.v0;
        tempCharData.u1 = char.u1;
        tempCharData.v1 = char.v1;
        BatchMSDFChar(drawingContext, batchHandler, texture, tempCharData, 0, 0, tempCharMatrix, tintData, outlineData);
    } else {
        // Reuse the char's geometry directly; fold the position delta into the offset.
        const offX = x - char.x + originOffsetX;
        const offY = y - char.y + originOffsetY;
        BatchMSDFChar(drawingContext, batchHandler, texture, char, offX, offY, calcMatrix, tintData, outlineData);
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

    batchHandler.setPxRange(src.fontData.distanceField.distanceRange);
    batchHandler.setAtlasSize(src.fontData.atlasSize.width, src.fontData.atlasSize.height);

    // Rounded outlines and soft shadows read the true-SDF alpha channel, which
    // only carries usable data on MTSDF atlases. On a plain MSDF font they are
    // forced off here so the effects degrade to the standard look.
    const isMtsdf = src.fontData.distanceField.fieldType === 'mtsdf';
    const shadowSoftness = (isMtsdf && src.dropShadowSoftness > 0) ? src.dropShadowSoftness : 0;

    const hasOutline = src.hasOutline();
    const outlineWidth = src.outlineWidth;
    const outlineRounded = (isMtsdf && src.outlineRounded) ? 1 : 0;
    const layered = hasOutline && src.outlineLayered;
    const hasShadow = src.hasDropShadow();

    // ── Resolve per-glyph state ─────────────────────────────────────────────
    // Static mode keeps the object-level colours in shared buffers and never
    // touches a per-glyph array. Callback mode re-seeds the array and runs the
    // user callback once for the whole text; manual mode reads the user-owned,
    // already-seeded array as-is.
    const glyphMode = src._glyphMode;
    let glyphs: GlyphState[] | null = null;

    if (glyphMode === GLYPH_MODE_STATIC) {
        // Effective per-corner fill = Tint-component corner × base colour `_color`;
        // alpha = colour alpha × per-corner object alpha. Outline and shadow reuse
        // the object's single colour across all corners.
        const c = src._color;
        const cR = c.r, cG = c.g, cB = c.b, cA = c.a;
        const aTL = cA * src._alphaTL, aTR = cA * src._alphaTR, aBL = cA * src._alphaBL, aBR = cA * src._alphaBR;

        fillBuf.tintTopLeft = packBatchTint(multiplyTint(src.tintTopLeft, cR, cG, cB), aTL);
        fillBuf.tintTopRight = packBatchTint(multiplyTint(src.tintTopRight, cR, cG, cB), aTR);
        fillBuf.tintBottomLeft = packBatchTint(multiplyTint(src.tintBottomLeft, cR, cG, cB), aBL);
        fillBuf.tintBottomRight = packBatchTint(multiplyTint(src.tintBottomRight, cR, cG, cB), aBR);

        const oc = src.outlineColor, oA = src.outlineAlpha;
        outlineBuf.tintTopLeft = packBatchTint(oc, oA * src._alphaTL);
        outlineBuf.tintTopRight = packBatchTint(oc, oA * src._alphaTR);
        outlineBuf.tintBottomLeft = packBatchTint(oc, oA * src._alphaBL);
        outlineBuf.tintBottomRight = packBatchTint(oc, oA * src._alphaBR);

        const sc = src.dropShadowColor, sA = src.dropShadowAlpha;
        shadowBuf.tintTopLeft = packBatchTint(sc, sA * src._alphaTL);
        shadowBuf.tintTopRight = packBatchTint(sc, sA * src._alphaTR);
        shadowBuf.tintBottomLeft = packBatchTint(sc, sA * src._alphaBL);
        shadowBuf.tintBottomRight = packBatchTint(sc, sA * src._alphaBR);
    } else {
        if (glyphMode === GLYPH_MODE_CALLBACK) {
            glyphs = src.prepareGlyphStates();
            if (src.displayCallback) {
                src.displayCallback(glyphs, src);
            }
        } else {
            glyphs = src._glyphStates;
        }
    }
    const perGlyph = glyphs !== null;

    // ── Shadow pass — render shadow behind the text. ────────────────────────
    if (hasShadow) {
        const shadowMode = shadowSoftness > 0 ? MSDFMode.SOFT_SHADOW : MSDFMode.PLAIN;
        configurePass(batchHandler, drawingContext, shadowMode, 0, 0, shadowSoftness);

        const dsx = src.dropShadowX;
        const dsy = src.dropShadowY;

        for (let i = 0; i < characterCount; i++) {
            const char = characters[i];
            if (!char || char.w === 0 || char.h === 0) continue;

            if (perGlyph) {
                const g = glyphs![i];
                packAspect(shadowBuf, g.shadow.tint, g.shadow.alpha);
                submitOneGlyph(drawingContext, batchHandler, texture, char,
                    g.x + g.shadow.x, g.y + g.shadow.y, g.scale, g.rotation,
                    calcMatrix, originOffsetX, originOffsetY, shadowBuf, zeroOutline);
            } else {
                submitOneGlyph(drawingContext, batchHandler, texture, char,
                    char.x + dsx, char.y + dsy, 1, 0,
                    calcMatrix, originOffsetX, originOffsetY, shadowBuf, zeroOutline);
            }
        }
    }

    // ── Outline silhouette pass (layered only) — every glyph's outline blob, ─
    // drawn before any fill so neighbouring outlines can't cover a glyph's fill.
    if (layered) {
        configurePass(batchHandler, drawingContext, MSDFMode.OUTLINE_SILHOUETTE, outlineWidth, outlineRounded, 0);

        for (let i = 0; i < characterCount; i++) {
            const char = characters[i];
            if (!char || char.w === 0 || char.h === 0) continue;

            if (perGlyph) {
                const g = glyphs![i];
                packAspect(outlineBuf, g.outline.tint, g.outline.alpha);
                submitOneGlyph(drawingContext, batchHandler, texture, char,
                    g.x, g.y, g.scale, g.rotation,
                    calcMatrix, originOffsetX, originOffsetY, zeroOutline, outlineBuf);
            } else {
                submitOneGlyph(drawingContext, batchHandler, texture, char,
                    char.x, char.y, 1, 0,
                    calcMatrix, originOffsetX, originOffsetY, zeroOutline, outlineBuf);
            }
        }
    }

    // ── Text pass — combined outline+fill, or the plain fill of a layered ────
    // outline / a font with no outline.
    const combined = hasOutline && !layered;
    const textMode = combined ? MSDFMode.OUTLINE_COMBINED : MSDFMode.PLAIN;
    const passOutlineWidth = combined ? outlineWidth : 0;
    configurePass(batchHandler, drawingContext, textMode, passOutlineWidth, outlineRounded, 0);

    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];
        if (!char || char.w === 0 || char.h === 0) continue;

        if (perGlyph) {
            const g = glyphs![i];
            packAspect(fillBuf, g.fill.tint, g.fill.alpha);
            let outlineData = zeroOutline;
            if (combined) {
                packAspect(outlineBuf, g.outline.tint, g.outline.alpha);
                outlineData = outlineBuf;
            }
            submitOneGlyph(drawingContext, batchHandler, texture, char,
                g.x, g.y, g.scale, g.rotation,
                calcMatrix, originOffsetX, originOffsetY, fillBuf, outlineData);
        } else {
            submitOneGlyph(drawingContext, batchHandler, texture, char,
                char.x, char.y, 1, 0,
                calcMatrix, originOffsetX, originOffsetY, fillBuf, combined ? outlineBuf : zeroOutline);
        }
    }
}

export default MSDFTextWebGLRenderer;
export { MSDFTextWebGLRenderer };
