/**
 * MSDF Batch Handler
 *
 * Custom BatchHandler for rendering MSDF (Multi-channel Signed Distance Field) fonts.
 * Batches character quads into a single draw call with proper texture sampling and
 * derivative-based anti-aliasing.
 *
 * Registered automatically by `MSDFPlugin` (and `installMSDFPlugin`) as the
 * `BatchHandlerMSDF` render node.
 *
 * There is one über-shader and one branch. Every effect that used to be a
 * per-pass uniform (outline width, rounded, shadow softness, the pass mode) now
 * rides the per-vertex `inParams` attribute, so a shadowed, outlined text is a
 * single draw call and two texts with different outline widths batch together.
 * The only remaining uniforms are the sampler, the projection matrix and
 * `uUnitRange` — both of which are per *texture*, never per glyph.
 */

import * as Phaser from "phaser";

const SimpleVertexShader = [
    'precision mediump float;',
    '',
    'uniform mat4 uProjectionMatrix;',
    'attribute vec2 inPosition;',
    'attribute vec2 inTexCoord;',
    'attribute vec4 inColor;',    // Fill colour — or, on a quad with no fill, the two-tone inner colour.
    'attribute vec4 inOutline;',  // Outline colour — also the shadow colour, which rides this layer.
    'attribute vec4 inParams;',   // weight, rounded, outlineWidth, shadowSoftness — or, on a solid quad, weight=255, radius, border, blur. See MSDFColor.
    '',
    'varying vec2 outTexCoord;',
    'varying vec4 outColor;',
    'varying vec4 outOutline;',
    'varying vec4 outParams;',
    '',
    'void main()',
    '{',
    '    gl_Position = uProjectionMatrix * vec4(inPosition, 0.0, 1.0);',
    '    outTexCoord = inTexCoord;',
    '    outColor = inColor;',
    '    outOutline = inOutline;',
    '    outParams = inParams;',
    '}'
].join('\n');

const SimpleFragmentShader = [
    '#extension GL_OES_standard_derivatives : enable',
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    '',
    'uniform sampler2D uMainSampler;',
    'uniform vec2 uUnitRange;',  // distanceRange / atlasSize — per texture, never per glyph.
    '',
    'varying vec2 outTexCoord;',
    'varying vec4 outColor;',    // Fill colour + alpha; a zero alpha frees .rgb as the two-tone inner colour.
    'varying vec4 outOutline;',  // Outline (or shadow) colour + alpha — the two-tone outer colour.
    'varying vec4 outParams;',
    '',
    'float median(float r, float g, float b)',
    '{',
    '    return max(min(r, g), min(max(r, g), b));',
    '}',
    '',
    '// The exact signed distance to a rounded box centred on the origin, negative',
    '// inside. `extent` is the box half-extent and `r` the corner radius, both in the',
    '// same units as `p`. (`half` would read better and is a reserved word in GLSL',
    '// ES 1.00.) An interpolated, per-corner `r` is legitimate here: it is a',
    '// continuous geometric parameter, not a selector, and near any one corner the',
    '// interpolant is dominated by that corner\'s value. Mid-edge, where interpolation',
    '// is least faithful, the fragment is already deep inside and coverage saturates.',
    'float roundedBox(vec2 p, vec2 extent, float r)',
    '{',
    '    vec2 q = abs(p) - (extent - r);',
    '    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;',
    '}',
    '',
    'void main()',
    '{',
    '    vec4 texel = texture2D(uMainSampler, outTexCoord);',
    '    float msdf = median(texel.r, texel.g, texel.b);',
    '    float tsdf = texel.a;',  // True SDF — meaningful only on MTSDF atlases.
    '',
    '    // The screen size, in pixels, of this quad\'s UV box. Serves both lanes:',
    '    //   glyph — the canonical msdfgen AA width is the distance range expressed',
    '    //     in screen pixels, derived from the derivative of the *texture*',
    '    //     coordinates, which interpolate linearly across the quad, so the width',
    '    //     stays uniform instead of wobbling with the sampled field.',
    '    //   solid — a rect\'s UVs span its own 0..1 box, so this *is* the rect\'s',
    '    //     width and height in pixels, which is all a box SDF needs. No extra',
    '    //     attribute, no uniform.',
    '    //',
    '    // The true screen-space gradient magnitude of each coordinate, not fwidth\'s',
    '    // |dFdx| + |dFdy|. That sum overestimates by |cos| + |sin| of the rotation —',
    '    // up to sqrt(2) at 45 degrees — which scales this whole space down uniformly.',
    '    // The *shape* survives (both axes take the same factor) but the antialiasing',
    '    // width, a constant 1.0 in that space, does not: a rotated edge softens to',
    '    // 1.41px. The derivative fetches are paid either way; this costs two sqrt',
    '    // over fwidth, and buys an exact 1px edge on glyphs and pills alike.',
    '    vec2 duvdx = dFdx(outTexCoord);',
    '    vec2 duvdy = dFdy(outTexCoord);',
    '    vec2 texGrad = vec2(length(vec2(duvdx.x, duvdy.x)), length(vec2(duvdx.y, duvdy.y)));',
    '    vec2 screenTexSize = vec2(1.0) / texGrad;',
    '    float px = max(0.5 * dot(uUnitRange, screenTexSize), 1.0);',
    '',
    '    // A weight byte of 255 is the "solid quad" sentinel, which a real glyph',
    '    // cannot reach: packParams clips it to 253. Both sides of the 254 threshold',
    '    // keep a byte of guard band, so interpolation cannot cross it — and a rect',
    '    // writes the same sentinel to all four corners anyway.',
    '    float solid = step(254.0 / 255.0, outParams.r);',
    '',
    '    // "This quad is soft." Per-corner and interpolated, like every other',
    '    // channel, so it may only ever weight a blend between two behaviours that',
    '    // agree at its ends — never select how another channel is decoded. (`solid`',
    '    // may, because it is uniform across its quad by construction.)',
    '    float softNorm = outParams.a;',
    '    float softStep = step(0.5 / 255.0, softNorm);',
    '    float halfSoft = 0.5 * softNorm;',
    '',
    '    // ── Glyph lane: distance field ─────────────────────────────────────────',
    '    float weight = outParams.r - (128.0 / 255.0);',  // Signed fraction of the range; 128 is neutral.
    '    float rounded = outParams.g;',                   // Byte spans the full [0, 1]; per-corner.
    '    float widthNorm = outParams.b * 0.5;',           // Byte spans the useful [0, 0.5].
    '',
    '    // The fill keeps median(rgb) so corners stay sharp; only the outline /',
    '    // shadow layer may round itself off the true SDF. Faux bold moves both',
    '    // edges together, so an outline tracks the weight it surrounds.',
    '    float fillEdge = 0.5 - weight;',
    '    float outlineEdge = fillEdge - widthNorm;',
    '    float outlineDist = mix(msdf, tsdf, rounded);',
    '',
    '    // Depth into the outline / shadow layer, positive inside it.',
    '    float gDepth = outlineDist - outlineEdge;',
    '    float gAA = 1.0 / px;',
    '',
    '    // One coverage expression serves fill, outline and shadow: softNorm = 0',
    '    // reproduces the plain 1-screen-pixel AA ramp exactly.',
    '    float gFill = clamp((msdf - fillEdge) * px + 0.5, 0.0, 1.0);',
    '    float gOutline = clamp(gDepth / max(softNorm, gAA) + 0.5, 0.0, 1.0);',
    '    float gTone = clamp((gDepth + halfSoft) / max(max(widthNorm, halfSoft), gAA), 0.0, 1.0);',
    '',
    '    // ── Solid lane: rounded box ────────────────────────────────────────────',
    '    // The same three shapes, read off the rect\'s own UV box instead of the',
    '    // atlas. Each channel is a fraction of the half-thickness, the one length a',
    '    // quad knows about itself, so a radius of 1 is a stadium at any size.',
    '    vec2 halfSize = 0.5 * screenTexSize;',
    '    float unit = min(halfSize.x, halfSize.y);',
    '    float boxDist = roundedBox((outTexCoord - 0.5) * screenTexSize, halfSize, outParams.g * unit);',
    '    float borderPx = outParams.b * unit;',
    '    float softPx = outParams.a * unit;',
    '',
    '    // Depth into the pill, positive inside it — the analogue of gDepth, which is',
    '    // why the expressions below mirror the glyph lane\'s, with the 1-pixel AA',
    '    // floor in place of gAA.',
    '    //',
    '    // Unlike a glyph\'s shadow, the blur is *not* centred on the edge: it fades',
    '    // inward, over [0, softPx]. A rect has no bleed room — its quad ends exactly',
    '    // at the box — so a centred blur would lose its outer half to a hard clip,',
    '    // taking the outer end of the two-tone ramp with it. Shifting the ramp in by',
    '    // half its width makes the pill\'s box the outer bound of everything it draws.',
    '    // Callers give a glow its room with `padding`, which is theirs to spend.',
    '    float sDepth = -boxDist;',
    '    float sHalfSoft = 0.5 * softPx;',
    '    float sSoft = max(softPx, 1.0);',
    '    float sFill = clamp((sDepth - borderPx - sHalfSoft) / sSoft + 0.5, 0.0, 1.0);',
    '    float sOutline = clamp((sDepth - sHalfSoft) / sSoft + 0.5, 0.0, 1.0);',
    '',
    '    // The ring\'s visible body now runs from the box edge inward, so the ramp',
    '    // spans the deeper of the ring and the blur — no half, and no offset.',
    '    float sTone = clamp(sDepth / max(max(borderPx, softPx), 1.0), 0.0, 1.0);',
    '',
    '    // ── One composite ──────────────────────────────────────────────────────',
    '    // A glyph\'s outline layer is a pill\'s border ring; a glyph\'s fill is the',
    '    // pill\'s face, inset by that ring. A rect with all three bytes zero is a',
    '    // hard-edged box with an antialiased boundary — an underline.',
    '    float fillCoverage = mix(gFill, sFill, solid);',
    '    float outlineCoverage = mix(gOutline, sOutline, solid);',
    '    float tone = mix(gTone, sTone, solid);',
    '',
    '    // Guard against haze in the deep background at extreme minification. A soft',
    '    // glow has real alpha down in that region, so any nonzero softness byte',
    '    // suppresses the fade; hard edges keep it. A solid quad samples no field, so',
    '    // `outlineDist` is a stray texel there and must not be allowed to speak.',
    '    float fade = max(max(smoothstep(0.0, 0.2, outlineDist), softStep), solid);',
    '',
    '    // Two-tone. A quad whose fill layer is switched off — alpha byte exactly',
    '    // zero, which is every shadow quad, every layered outline silhouette, and a',
    '    // pill whose face is transparent — has no use for inColor, so it carries a',
    '    // second colour there instead. The outline / shadow / border layer then ramps',
    '    // from outOutline.rgb at its outer edge to that inner colour where it meets',
    '    // the glyph: a white-hot glow core inside a coloured halo, a neon-tube',
    '    // outline. A live fill owns inColor, so the gate switches the ramp off and',
    '    // the composite below is unchanged.',
    '    //',
    '    // `tone` is depth into the layer\'s own visible body, 0 at the outer end and',
    '    // 1 where it meets the glyph (or the pill\'s face). The renderer never gives',
    '    // one quad both a width and a softness, so the band picks whichever is live:',
    '    //   outline — the band spans [outlineEdge, fillEdge], exactly widthNorm.',
    '    //   shadow  — outlineEdge *is* fillEdge, and the blur is centred there, so',
    '    //             only its outer half (softNorm/2) shows beyond the glyph.',
    '    //             Using the full blur would strand the ramp at tone 0.5.',
    '    // With neither (a hard shadow) it collapses onto the 1-pixel AA edge, which',
    '    // is all the body such a silhouette has.',
    '    //',
    '    // An outline keeps that ramp linear: its alpha is a flat 1 across the band,',
    '    // so the two colours get equal screen area. A shadow\'s alpha falls off over',
    '    // the very same interval, which would leave the outer colour stranded where',
    '    // the shadow has already faded to nothing. Squaring holds the outer hue',
    '    // through the opaque middle of the halo and keeps the inner colour to the',
    '    // hot core against the glyph. Both curves are monotonic and agree at 0 and',
    '    // 1, so blending them on an interpolated softStep stays a valid ramp.',
    '    tone = mix(tone, tone * tone, softStep);',
    '',
    '    float twoTone = 1.0 - step(0.5 / 255.0, outColor.a);',
    '    vec3 outlineRgb = mix(outOutline.rgb, outColor.rgb, tone * twoTone);',
    '',
    '    // Honest fill-over-outline composite. Degenerate cases are exact: a zero',
    '    // outline alpha leaves the plain fill, a zero fill alpha leaves the bare',
    '    // outline silhouette (which is how the layered and shadow passes work).',
    '    float af = fillCoverage * outColor.a;',
    '    float ao = outlineCoverage * outOutline.a * fade;',
    '',
    '    float a = af + ao * (1.0 - af);',
    '    vec3 rgb = outColor.rgb * af + outlineRgb * (ao * (1.0 - af));',
    '',
    '    gl_FragColor = vec4(rgb, a);',  // Already premultiplied.
    '}'
].join('\n');

// Phaser's BatchHandler doesn't ship type definitions; alias it locally.
const PhaserBatchHandler: any = (Phaser as any).Renderer.WebGL.RenderNodes.BatchHandler;

type WebGLTextureWrapper = any;
type DrawingContext = any;

interface MSDFBatchHandlerInstance {
    _currentTexture: WebGLTextureWrapper | null;
    _unitRange: [number, number];

    instanceCount: number;
    instancesPerBatch: number;
    bytesPerInstance: number;
    floatsPerInstance: number;
    indicesPerInstance: number;
    vertexBufferLayout: any;
    programManager: any;
    manager: any;

    setUnitRange(x: number, y: number): void;
    hasUnitRangeChanged(x: number, y: number): boolean;
    setupUniforms(drawingContext: DrawingContext): void;
    run(drawingContext: DrawingContext): void;
    batch(
        drawingContext: DrawingContext,
        glTexture: WebGLTextureWrapper,
        x0: number, y0: number,
        x1: number, y1: number,
        x2: number, y2: number,
        x3: number, y3: number,
        u0: number, v0: number,
        u1: number, v1: number,
        colorBL: number, colorTL: number, colorTR: number, colorBR: number,
        outBL: number, outTL: number, outTR: number, outBR: number,
        parBL: number, parTL: number, parTR: number, parBR: number
    ): void;

    onRunBegin(drawingContext: DrawingContext): void;
    onRunEnd(drawingContext: DrawingContext): void;
}

const defaultConfig = {
    name: 'BatchHandlerMSDF',
    shaderName: 'MSDF',
    verticesPerInstance: 4,
    indicesPerInstance: 6,
    vertexSource: SimpleVertexShader,
    fragmentSource: SimpleFragmentShader,
    vertexBufferLayout: {
        usage: 'DYNAMIC_DRAW',
        layout: [
            { name: 'inPosition', size: 2 },
            { name: 'inTexCoord', size: 2 },
            { name: 'inColor', size: 4, type: 'UNSIGNED_BYTE', normalized: true },
            { name: 'inOutline', size: 4, type: 'UNSIGNED_BYTE', normalized: true },
            { name: 'inParams', size: 4, type: 'UNSIGNED_BYTE', normalized: true }
        ]
    }
};

class MSDFBatchHandler extends PhaserBatchHandler {
    static defaultConfig = defaultConfig;

    constructor(manager: any, config?: any) {
        super(manager, defaultConfig, config);

        const self = this as unknown as MSDFBatchHandlerInstance;
        self._currentTexture = null;
        self._unitRange = [4 / 512, 4 / 512];
    }

    setUnitRange(x: number, y: number): void {
        const self = this as unknown as MSDFBatchHandlerInstance;
        self._unitRange[0] = x;
        self._unitRange[1] = y;
    }

    hasUnitRangeChanged(x: number, y: number): boolean {
        const self = this as unknown as MSDFBatchHandlerInstance;
        return self._unitRange[0] !== x || self._unitRange[1] !== y;
    }

    _generateElementIndices(instances: number): ArrayBuffer {
        const buffer = new ArrayBuffer(instances * 6 * 2);
        const indices = new Uint16Array(buffer);
        let offset = 0;

        for (let i = 0; i < instances; i++) {
            const index = i * 4;
            indices[offset++] = index;
            indices[offset++] = index;
            indices[offset++] = index + 1;
            indices[offset++] = index + 2;
            indices[offset++] = index + 3;
            indices[offset++] = index + 3;
        }

        return buffer;
    }

    setupUniforms(drawingContext: DrawingContext): void {
        const self = this as unknown as MSDFBatchHandlerInstance;
        const programManager = self.programManager;

        programManager.setUniform('uMainSampler', 0);
        programManager.setUniform('uUnitRange', self._unitRange);

        drawingContext.renderer.setProjectionMatrixFromDrawingContext(drawingContext);
        programManager.setUniform('uProjectionMatrix', drawingContext.renderer.projectionMatrix.val);
    }

    run(drawingContext: DrawingContext): void {
        const self = this as unknown as MSDFBatchHandlerInstance;
        const instanceCount = self.instanceCount;

        if (instanceCount === 0) {
            return;
        }

        self.onRunBegin(drawingContext);

        const programSuite = self.programManager.getCurrentProgramSuite();

        if (programSuite) {
            self.setupUniforms(drawingContext);
            self.programManager.applyUniforms(programSuite.program);

            self.vertexBufferLayout.buffer.update(self.instanceCount * self.bytesPerInstance);

            self.manager.renderer.drawElements(
                drawingContext,
                self._currentTexture ? [self._currentTexture] : [],
                programSuite.program,
                programSuite.vao,
                instanceCount * self.indicesPerInstance,
                0
            );
        }

        self.instanceCount = 0;
        self._currentTexture = null;

        self.onRunEnd(drawingContext);
    }

    batch(
        drawingContext: DrawingContext,
        glTexture: WebGLTextureWrapper,
        x0: number, y0: number,
        x1: number, y1: number,
        x2: number, y2: number,
        x3: number, y3: number,
        u0: number, v0: number,
        u1: number, v1: number,
        colorBL: number, colorTL: number, colorTR: number, colorBR: number,
        outBL: number, outTL: number, outTR: number, outBR: number,
        parBL: number, parTL: number, parTR: number, parBR: number
    ): void {
        const self = this as unknown as MSDFBatchHandlerInstance;

        if (self.instanceCount === 0) {
            self.manager.setCurrentBatchNode(self, drawingContext);
            self._currentTexture = glTexture;
        } else if (self._currentTexture !== glTexture) {
            self.run(drawingContext);
            self._currentTexture = glTexture;
        }

        const vertexOffset32 = self.instanceCount * self.floatsPerInstance;
        const vertexBuffer = self.vertexBufferLayout.buffer;
        const vertexViewF32 = vertexBuffer.viewF32 as Float32Array;
        const vertexViewU32 = vertexBuffer.viewU32 as Uint32Array;

        // Each vertex is 7 u32-slots: x, y, u, v (f32), color, outline, params (u32).
        // Vertex order for degenerate triangle strip: BL, TL, BR, TR
        vertexViewF32[vertexOffset32 + 0] = x0;
        vertexViewF32[vertexOffset32 + 1] = y0;
        vertexViewF32[vertexOffset32 + 2] = u0;
        vertexViewF32[vertexOffset32 + 3] = v1;
        vertexViewU32[vertexOffset32 + 4] = colorBL;
        vertexViewU32[vertexOffset32 + 5] = outBL;
        vertexViewU32[vertexOffset32 + 6] = parBL;

        vertexViewF32[vertexOffset32 + 7] = x1;
        vertexViewF32[vertexOffset32 + 8] = y1;
        vertexViewF32[vertexOffset32 + 9] = u0;
        vertexViewF32[vertexOffset32 + 10] = v0;
        vertexViewU32[vertexOffset32 + 11] = colorTL;
        vertexViewU32[vertexOffset32 + 12] = outTL;
        vertexViewU32[vertexOffset32 + 13] = parTL;

        vertexViewF32[vertexOffset32 + 14] = x3;
        vertexViewF32[vertexOffset32 + 15] = y3;
        vertexViewF32[vertexOffset32 + 16] = u1;
        vertexViewF32[vertexOffset32 + 17] = v1;
        vertexViewU32[vertexOffset32 + 18] = colorBR;
        vertexViewU32[vertexOffset32 + 19] = outBR;
        vertexViewU32[vertexOffset32 + 20] = parBR;

        vertexViewF32[vertexOffset32 + 21] = x2;
        vertexViewF32[vertexOffset32 + 22] = y2;
        vertexViewF32[vertexOffset32 + 23] = u1;
        vertexViewF32[vertexOffset32 + 24] = v0;
        vertexViewU32[vertexOffset32 + 25] = colorTR;
        vertexViewU32[vertexOffset32 + 26] = outTR;
        vertexViewU32[vertexOffset32 + 27] = parTR;

        self.instanceCount++;

        if (self.instanceCount === self.instancesPerBatch) {
            self.run(drawingContext);
        }
    }
}

export type { MSDFBatchHandlerInstance };
export default MSDFBatchHandler;
export { MSDFBatchHandler };
