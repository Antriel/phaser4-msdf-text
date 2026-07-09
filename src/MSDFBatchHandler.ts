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
    'attribute vec4 inColor;',    // Fill colour.
    'attribute vec4 inOutline;',  // Outline colour — also the shadow colour, which rides this layer.
    'attribute vec4 inParams;',   // weight, flags, outlineWidth, shadowSoftness. See MSDFColor.packParams.
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
    'varying vec4 outColor;',    // Fill colour + alpha.
    'varying vec4 outOutline;',  // Outline (or shadow) colour + alpha.
    'varying vec4 outParams;',
    '',
    'float median(float r, float g, float b)',
    '{',
    '    return max(min(r, g), min(max(r, g), b));',
    '}',
    '',
    '// Canonical msdfgen anti-aliasing width: the distance range expressed in',
    '// screen pixels. Derived from the derivative of the texture coordinates,',
    '// which interpolate linearly across the quad, so the width stays uniform',
    '// across the whole glyph instead of wobbling with the sampled field.',
    'float screenPxRange()',
    '{',
    '    vec2 screenTexSize = vec2(1.0) / fwidth(outTexCoord);',
    '    return max(0.5 * dot(uUnitRange, screenTexSize), 1.0);',
    '}',
    '',
    'void main()',
    '{',
    '    vec4 texel = texture2D(uMainSampler, outTexCoord);',
    '    float msdf = median(texel.r, texel.g, texel.b);',
    '    float tsdf = texel.a;',  // True SDF — meaningful only on MTSDF atlases.
    '    float px = screenPxRange();',
    '',
    '    // Unpack params. `flags` is written identically to all four vertices',
    '    // (GLSL ES 1.00 has no `flat`), so it survives interpolation exactly.',
    '    float flags = floor(outParams.g * 255.0 + 0.5);',
    '    float rounded = mod(flags, 2.0);',
    '    float solid = mod(floor(flags * 0.5), 2.0);',
    '',
    '    float weight = outParams.r - (128.0 / 255.0);',  // Signed fraction of the range; 128 is neutral.
    '    float widthNorm = outParams.b * 0.5;',           // Byte spans the useful [0, 0.5].
    '    float softNorm = outParams.a;',                  // Byte spans the full [0, 1].
    '',
    '    // The fill keeps median(rgb) so corners stay sharp; only the outline /',
    '    // shadow layer may round itself off the true SDF. Faux bold moves both',
    '    // edges together, so an outline tracks the weight it surrounds.',
    '    float fillEdge = 0.5 - weight;',
    '    float outlineEdge = fillEdge - widthNorm;',
    '    float outlineDist = mix(msdf, tsdf, rounded);',
    '',
    '    // One coverage expression serves fill, outline and shadow: softNorm = 0',
    '    // reproduces the plain 1-screen-pixel AA ramp exactly.',
    '    float fillCoverage = clamp((msdf - fillEdge) * px + 0.5, 0.0, 1.0);',
    '    float outlineCoverage = clamp((outlineDist - outlineEdge) / max(softNorm, 1.0 / px) + 0.5, 0.0, 1.0);',
    '',
    '    // Guard against haze in the deep background at extreme minification. A',
    '    // soft glow has real alpha down in that region, so any nonzero softness',
    '    // byte suppresses the fade; hard edges keep it.',
    '    float fade = max(smoothstep(0.0, 0.2, outlineDist), step(0.5 / 255.0, softNorm));',
    '',
    '    // Underline / strikethrough rects: full coverage, no distance field. They',
    '    // still carry real 0..1 UVs, so fwidth() (and therefore px) stays finite.',
    '    fillCoverage = mix(fillCoverage, 1.0, solid);',
    '    outlineCoverage = mix(outlineCoverage, 0.0, solid);',
    '',
    '    // Honest fill-over-outline composite. Degenerate cases are exact: a zero',
    '    // outline alpha leaves the plain fill, a zero fill alpha leaves the bare',
    '    // outline silhouette (which is how the layered and shadow passes work).',
    '    float af = fillCoverage * outColor.a;',
    '    float ao = outlineCoverage * outOutline.a * fade;',
    '',
    '    float a = af + ao * (1.0 - af);',
    '    vec3 rgb = outColor.rgb * af + outOutline.rgb * (ao * (1.0 - af));',
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
