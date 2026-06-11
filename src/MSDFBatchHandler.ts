/**
 * MSDF Batch Handler
 *
 * Custom BatchHandler for rendering MSDF (Multi-channel Signed Distance Field) fonts.
 * Batches character quads into a single draw call with proper texture sampling and
 * derivative-based anti-aliasing.
 *
 * Registered automatically by `MSDFPlugin` (and `installMSDFPlugin`) as the
 * `BatchHandlerMSDF` render node.
 */

import * as Phaser from "phaser";

/**
 * Fragment shader render modes, selected per pass via the `uMode` uniform.
 * `OUTLINE_SILHOUETTE` + `PLAIN` are the two passes of a layered outline; the
 * silhouette (whole glyph in outline colour) is drawn for every glyph first,
 * then the fill on top, so a thick outline can't overlap a neighbouring glyph.
 */
export const MSDFMode = {
    /** Plain glyph fill. Also the fill pass of a layered outline and the hard drop shadow. */
    PLAIN: 0,
    /** Outline + fill in one pass (per-glyph; outlines may overlap neighbours). */
    OUTLINE_COMBINED: 1,
    /** Layered outline, pass 1: the whole glyph blob in outline colour. */
    OUTLINE_SILHOUETTE: 2,
    /** Soft shadow / glow (needs the true-SDF alpha channel of an MTSDF atlas). */
    SOFT_SHADOW: 3
} as const;

const SimpleVertexShader = [
    'precision mediump float;',
    '',
    'uniform mat4 uProjectionMatrix;',
    'attribute vec2 inPosition;',
    'attribute vec2 inTexCoord;',
    'attribute vec4 inTint;',
    'attribute vec4 inOutline;',  // Per-glyph outline colour (combined + silhouette passes).
    '',
    'varying vec2 outTexCoord;',
    'varying vec4 outTint;',
    'varying vec4 outOutline;',
    '',
    'void main()',
    '{',
    '    gl_Position = uProjectionMatrix * vec4(inPosition, 0.0, 1.0);',
    '    outTexCoord = inTexCoord;',
    '    outTint = inTint;',
    '    outOutline = inOutline;',
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
    'uniform vec2 uAtlasSize;',     // Atlas texture size in pixels.
    'uniform float uPxRange;',      // distanceRange from the font JSON.
    'uniform float uOutlineWidth;',
    'uniform float uOutlineRounded;',  // 0 = sharp outline, 1 = rounded (true SDF).
    'uniform float uShadowSoftness;',  // distance-field units of blur (soft shadow mode).
    'uniform float uMode;',            // 0 plain/fill, 1 combined outline, 2 outline silhouette, 3 soft shadow.
    '',
    'varying vec2 outTexCoord;',
    'varying vec4 outTint;',
    'varying vec4 outOutline;',  // Per-glyph outline colour (replaces the old uOutlineColor uniform).
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
    '    vec2 unitRange = vec2(uPxRange) / uAtlasSize;',
    '    vec2 screenTexSize = vec2(1.0) / fwidth(outTexCoord);',
    '    return max(0.5 * dot(unitRange, screenTexSize), 1.0);',
    '}',
    '',
    'void main()',
    '{',
    '    vec4 textureSample = texture2D(uMainSampler, outTexCoord);',
    '    float dist = median(textureSample.r, textureSample.g, textureSample.b);',
    '    float tsdf = textureSample.a;',  // True SDF — meaningful only on MTSDF atlases.
    '    float pxRange = screenPxRange();',
    '',
    '    if (uMode < 0.5)',
    '    {',
    '        // Plain text fill. Also the fill pass of a layered outline and the',
    '        // hard (non-soft) drop shadow — both are just a glyph in some colour.',
    '        float coverage = clamp(pxRange * (dist - 0.5) + 0.5, 0.0, 1.0);',
    '        float a = coverage * outTint.a;',
    '        gl_FragColor = vec4(outTint.rgb * a, a);',
    '    }',
    '    else if (uMode < 1.5)',
    '    {',
    '        // Combined outline + fill in a single pass (mode 1). The outline is',
    '        // per-glyph, so a thick outline can overlap a neighbouring glyph —',
    '        // use the layered mode (silhouette + fill passes) to avoid that.',
    '        float textEdge = 0.5;',
    '        float outlineEdge = 0.5 - (uOutlineWidth / uPxRange);',
    '',
    '        // Outline edge from the true SDF (rounded corners) or the MSDF (sharp).',
    '        float outlineDist = mix(dist, tsdf, uOutlineRounded);',
    '',
    '        float coverage = clamp(pxRange * (outlineDist - outlineEdge) + 0.5, 0.0, 1.0);',
    '        float textMix  = clamp(pxRange * (dist        - textEdge   ) + 0.5, 0.0, 1.0);',
    '',
    '        // Guard against haze in the deep background at extreme minification.',
    '        float backgroundFade = smoothstep(0.0, 0.2, outlineDist);',
    '',
    '        vec3 rgb = mix(outOutline.rgb, outTint.rgb, textMix);',
    '        float a  = coverage * mix(outOutline.a, outTint.a, textMix) * backgroundFade;',
    '',
    '        gl_FragColor = vec4(rgb * a, a);',
    '    }',
    '    else if (uMode < 2.5)',
    '    {',
    '        // Outline silhouette pass (mode 2, layered outline): the whole glyph',
    '        // blob in outline colour. All silhouettes are drawn before any fill,',
    '        // so a neighbouring glyph\'s outline can never cover this glyph\'s fill.',
    '        float outlineEdge = 0.5 - (uOutlineWidth / uPxRange);',
    '        float outlineDist = mix(dist, tsdf, uOutlineRounded);',
    '        float coverage = clamp(pxRange * (outlineDist - outlineEdge) + 0.5, 0.0, 1.0);',
    '        float backgroundFade = smoothstep(0.0, 0.2, outlineDist);',
    '        float a = coverage * outOutline.a * backgroundFade;',
    '        gl_FragColor = vec4(outOutline.rgb * a, a);',
    '    }',
    '    else',
    '    {',
    '        // Soft shadow / glow (mode 3): spread the true-SDF edge by',
    '        // uShadowSoftness distance-field units, so the blur scales with the',
    '        // text just like the outline does. The 1-screen-pixel floor keeps the',
    '        // edge anti-aliased when the text is very small.',
    '        float soft = max(uShadowSoftness, uPxRange / pxRange);',
    '        float alpha = clamp(uPxRange * (tsdf - 0.5) / soft + 0.5, 0.0, 1.0);',
    '        float a = alpha * outTint.a;',
    '        gl_FragColor = vec4(outTint.rgb * a, a);',
    '    }',
    '}'
].join('\n');

// Phaser's BatchHandler doesn't ship type definitions; alias it locally.
const PhaserBatchHandler: any = (Phaser as any).Renderer.WebGL.RenderNodes.BatchHandler;

type WebGLTextureWrapper = any;
type DrawingContext = any;

interface MSDFBatchHandlerInstance {
    _currentTexture: WebGLTextureWrapper | null;
    _pxRange: number;
    _atlasSize: [number, number];
    _outlineWidth: number;
    _outlineRounded: number;
    _shadowSoftness: number;
    _mode: number;

    instanceCount: number;
    instancesPerBatch: number;
    bytesPerInstance: number;
    floatsPerInstance: number;
    indicesPerInstance: number;
    vertexBufferLayout: any;
    programManager: any;
    manager: any;

    setPxRange(pxRange: number): void;
    setAtlasSize(width: number, height: number): void;
    setOutline(width: number, rounded: number): void;
    hasOutlineChanged(width: number, rounded: number): boolean;
    setShadowSoftness(softness: number): void;
    hasShadowSoftnessChanged(softness: number): boolean;
    setMode(mode: number): void;
    hasModeChanged(mode: number): boolean;
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
        tintBL: number, tintTL: number, tintTR: number, tintBR: number,
        outBL: number, outTL: number, outTR: number, outBR: number
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
            { name: 'inTint', size: 4, type: 'UNSIGNED_BYTE', normalized: true },
            { name: 'inOutline', size: 4, type: 'UNSIGNED_BYTE', normalized: true }
        ]
    }
};

class MSDFBatchHandler extends PhaserBatchHandler {
    static defaultConfig = defaultConfig;

    constructor(manager: any, config?: any) {
        super(manager, defaultConfig, config);

        const self = this as unknown as MSDFBatchHandlerInstance;
        self._currentTexture = null;
        self._pxRange = 4;
        self._atlasSize = [512, 512];
        self._outlineWidth = 0;
        self._outlineRounded = 0;
        self._shadowSoftness = 0;
        self._mode = MSDFMode.PLAIN;
    }

    setPxRange(pxRange: number): void {
        (this as unknown as MSDFBatchHandlerInstance)._pxRange = pxRange;
    }

    setAtlasSize(width: number, height: number): void {
        const self = this as unknown as MSDFBatchHandlerInstance;
        self._atlasSize[0] = width;
        self._atlasSize[1] = height;
    }

    setOutline(width: number, rounded: number): void {
        const self = this as unknown as MSDFBatchHandlerInstance;
        self._outlineWidth = width;
        self._outlineRounded = rounded;
    }

    hasOutlineChanged(width: number, rounded: number): boolean {
        const self = this as unknown as MSDFBatchHandlerInstance;
        return self._outlineWidth !== width ||
            self._outlineRounded !== rounded;
    }

    setShadowSoftness(softness: number): void {
        (this as unknown as MSDFBatchHandlerInstance)._shadowSoftness = softness;
    }

    hasShadowSoftnessChanged(softness: number): boolean {
        return (this as unknown as MSDFBatchHandlerInstance)._shadowSoftness !== softness;
    }

    setMode(mode: number): void {
        (this as unknown as MSDFBatchHandlerInstance)._mode = mode;
    }

    hasModeChanged(mode: number): boolean {
        return (this as unknown as MSDFBatchHandlerInstance)._mode !== mode;
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
        programManager.setUniform('uPxRange', self._pxRange);
        programManager.setUniform('uAtlasSize', self._atlasSize);
        programManager.setUniform('uOutlineWidth', self._outlineWidth);
        programManager.setUniform('uOutlineRounded', self._outlineRounded);
        programManager.setUniform('uShadowSoftness', self._shadowSoftness);
        programManager.setUniform('uMode', self._mode);

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
        tintBL: number, tintTL: number, tintTR: number, tintBR: number,
        outBL: number, outTL: number, outTR: number, outBR: number
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

        // Each vertex is 6 u32-slots: x, y, u, v (f32), tint (u32), outline (u32).
        // Vertex order for degenerate triangle strip: BL, TL, BR, TR
        vertexViewF32[vertexOffset32 + 0] = x0;
        vertexViewF32[vertexOffset32 + 1] = y0;
        vertexViewF32[vertexOffset32 + 2] = u0;
        vertexViewF32[vertexOffset32 + 3] = v1;
        vertexViewU32[vertexOffset32 + 4] = tintBL;
        vertexViewU32[vertexOffset32 + 5] = outBL;

        vertexViewF32[vertexOffset32 + 6] = x1;
        vertexViewF32[vertexOffset32 + 7] = y1;
        vertexViewF32[vertexOffset32 + 8] = u0;
        vertexViewF32[vertexOffset32 + 9] = v0;
        vertexViewU32[vertexOffset32 + 10] = tintTL;
        vertexViewU32[vertexOffset32 + 11] = outTL;

        vertexViewF32[vertexOffset32 + 12] = x3;
        vertexViewF32[vertexOffset32 + 13] = y3;
        vertexViewF32[vertexOffset32 + 14] = u1;
        vertexViewF32[vertexOffset32 + 15] = v1;
        vertexViewU32[vertexOffset32 + 16] = tintBR;
        vertexViewU32[vertexOffset32 + 17] = outBR;

        vertexViewF32[vertexOffset32 + 18] = x2;
        vertexViewF32[vertexOffset32 + 19] = y2;
        vertexViewF32[vertexOffset32 + 20] = u1;
        vertexViewF32[vertexOffset32 + 21] = v0;
        vertexViewU32[vertexOffset32 + 22] = tintTR;
        vertexViewU32[vertexOffset32 + 23] = outTR;

        self.instanceCount++;

        if (self.instanceCount === self.instancesPerBatch) {
            self.run(drawingContext);
        }
    }
}

export type { MSDFBatchHandlerInstance };
export default MSDFBatchHandler;
export { MSDFBatchHandler };
