/**
 * MSDF Batch Handler
 *
 * Custom BatchHandler for rendering MSDF (Multi-channel Signed Distance Field) fonts.
 * Efficiently batches multiple character quads into a single draw call with proper
 * texture sampling and anti-aliased rendering.
 *
 * Based on Phaser 4's BatchHandler architecture with MSDF-specific shaders.
 */

import Phaser from 'phaser';

/**
 * MSDF vertex shader - position + texture coordinates + tint
 */
const SimpleVertexShader = [
    'precision mediump float;',
    '',
    'uniform mat4 uProjectionMatrix;',
    'attribute vec2 inPosition;',
    'attribute vec2 inTexCoord;',
    'attribute vec4 inTint;',
    '',
    'varying vec2 outTexCoord;',
    'varying vec4 outTint;',
    '',
    'void main()',
    '{',
    '    gl_Position = uProjectionMatrix * vec4(inPosition, 0.0, 1.0);',
    '    outTexCoord = inTexCoord;',
    '    outTint = inTint;',
    '}'
].join('\n');

/**
 * MSDF fragment shader
 *
 * Uses median() to extract signed distance from RGB channels and smoothstep()
 * for anti-aliasing. Color comes from vertex tints (text color is pre-multiplied
 * into tints by the renderer).
 *
 * Supports outline rendering via uOutlineWidth and uOutlineColor uniforms.
 */
const SimpleFragmentShader = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    '',
    'uniform sampler2D uMainSampler;',
    'uniform float uPxRange;',
    'uniform float uOutlineWidth;',
    'uniform vec4 uOutlineColor;',
    '',
    'varying vec2 outTexCoord;',
    'varying vec4 outTint;',
    '',
    '// Median function - extracts signed distance from RGB channels',
    'float median(float r, float g, float b)',
    '{',
    '    return max(min(r, g), min(max(r, g), b));',
    '}',
    '',
    'void main()',
    '{',
    '    // Sample the MSDF texture',
    '    vec3 textureSample = texture2D(uMainSampler, outTexCoord).rgb;',
    '    ',
    '    // Get median distance',
    '    float dist = median(textureSample.r, textureSample.g, textureSample.b);',
    '    ',
    '    // Check if outline is enabled',
    '    if (uOutlineWidth > 0.0)',
    '    {',
    '        // Calculate edges',
    '        float outlineCalc = 0.5 - (uOutlineWidth / uPxRange);',
    '        float outlineEdge = outlineCalc;',
    '        float textEdge = 0.5;',
    '        ',
    '        // Smoothing based on pixel range for crisp edges',
    '        float smoothing = 0.05;',
    '        ',
    '        // Alpha for text (inside textEdge)',
    '        float textAlpha = smoothstep(textEdge - smoothing, textEdge + smoothing, dist);',
    '        ',
    '        // Outline alpha: only visible in the ring between outlineEdge and textEdge',
    '        // Use 1-smoothstep to create a mask that is 1 outside outlineEdge, 0 inside',
    '        float outsideOutline = smoothstep(outlineEdge - smoothing, outlineEdge + smoothing, dist);',
    '        // And 0 inside text, 1 outside (inverted textAlpha)',
    '        float outsideText = 1.0 - textAlpha;',
    '        ',
    '        // Fade out outline in far background (where dist approaches 0)',
    '        // This prevents the "black square" artifact',
    '        float backgroundFade = smoothstep(0.0, 0.2, dist);',
    '        ',
    '        // Outline is visible where: outside outline boundary AND outside text AND not far background',
    '        float outlineAlpha = outsideOutline * outsideText * backgroundFade;',
    '        ',
    '        // Apply colors',
    '        vec3 textRGB = outTint.rgb;',
    '        float textA = outTint.a * textAlpha;',
    '        ',
    '        vec3 outlineRGB = uOutlineColor.rgb;',
    '        float outlineA = uOutlineColor.a * outlineAlpha;',
    '        ',
    '        // Composite text over outline',
    '        float finalAlpha = textA + outlineA * (1.0 - textA);',
    '        vec3 finalRGB = vec3(0.0);',
    '        if (finalAlpha > 0.001)',
    '        {',
    '            finalRGB = (textRGB * textA + outlineRGB * outlineA * (1.0 - textA)) / finalAlpha;',
    '        }',
    '        ',
    '        // Output premultiplied alpha',
    '        gl_FragColor = vec4(finalRGB * finalAlpha, finalAlpha);',
    '    }',
    '    else',
    '    {',
    '        // No outline - standard MSDF rendering',
    '        float alpha = smoothstep(0.4, 0.6, dist);',
    '        vec4 color = outTint;',
    '        gl_FragColor = vec4(color.rgb * alpha, alpha * color.a);',
    '    }',
    '}'
].join('\n');

/**
 * @class MSDFBatchHandler
 * @extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler
 */
class MSDFBatchHandler extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    constructor(manager, config) {
        super(manager, MSDFBatchHandler.defaultConfig, config);

        /**
         * Current texture being batched
         * @type {Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper|null}
         * @private
         */
        this._currentTexture = null;

        /**
         * MSDF distance range parameter
         * @type {number}
         * @default 4
         */
        this._pxRange = 4;

        /**
         * Outline width in distance field units
         * @type {number}
         * @default 0
         */
        this._outlineWidth = 0;

        /**
         * Outline color as RGBA array (0-1 range)
         * @type {number[]}
         * @default [0, 0, 0, 0]
         */
        this._outlineColor = [0, 0, 0, 0];
    }

    /**
     * Set the distance range parameter for MSDF rendering
     * @param {number} pxRange - Distance range (typically 2-8)
     */
    setPxRange(pxRange) {
        this._pxRange = pxRange;
    }

    /**
     * Set outline parameters for text rendering
     * @param {number} width - Outline width (0 = no outline)
     * @param {number} r - Red component (0-1)
     * @param {number} g - Green component (0-1)
     * @param {number} b - Blue component (0-1)
     * @param {number} a - Alpha component (0-1)
     */
    setOutline(width, r, g, b, a) {
        // Validate inputs
        if (isNaN(width) || isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
            console.error('[MSDFBatchHandler] Invalid outline parameters (NaN)', { width, r, g, b, a });
            this._outlineWidth = 0;
            this._outlineColor = [0, 0, 0, 0];
            return;
        }

        this._outlineWidth = width;
        this._outlineColor = [r, g, b, a];
    }

    /**
     * Check if outline settings have changed (for batch flushing)
     * @param {number} width
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     * @returns {boolean}
     */
    hasOutlineChanged(width, r, g, b, a) {
        return this._outlineWidth !== width ||
               this._outlineColor[0] !== r ||
               this._outlineColor[1] !== g ||
               this._outlineColor[2] !== b ||
               this._outlineColor[3] !== a;
    }

    /**
     * Generate element indices for quad instances
     * Same pattern as Phaser's BatchHandlerQuad/PointLight
     *
     * @param {number} instances - Number of quads
     * @returns {ArrayBuffer} Index buffer data
     * @private
     */
    _generateElementIndices(instances) {
        const buffer = new ArrayBuffer(instances * 6 * 2);
        const indices = new Uint16Array(buffer);
        let offset = 0;

        for (let i = 0; i < instances; i++) {
            const index = i * 4;
            // Degenerate triangle strip pattern: 0, 0, 1, 2, 3, 3
            indices[offset++] = index;     // Vertex 0
            indices[offset++] = index;     // Vertex 0 (degenerate)
            indices[offset++] = index + 1; // Vertex 1
            indices[offset++] = index + 2; // Vertex 2
            indices[offset++] = index + 3; // Vertex 3
            indices[offset++] = index + 3; // Vertex 3 (degenerate)
        }

        return buffer;
    }

    /**
     * Setup uniforms before rendering
     *
     * @param {Phaser.Renderer.WebGL.DrawingContext} drawingContext
     */
    setupUniforms(drawingContext) {
        const programManager = this.programManager;

        // Set texture sampler to texture unit 0
        programManager.setUniform('uMainSampler', 0);

        // Set MSDF-specific uniforms
        programManager.setUniform('uPxRange', this._pxRange);

        // Set outline uniforms
        programManager.setUniform('uOutlineWidth', this._outlineWidth);
        programManager.setUniform('uOutlineColor', this._outlineColor);

        // Set projection matrix
        drawingContext.renderer.setProjectionMatrixFromDrawingContext(drawingContext);
        programManager.setUniform('uProjectionMatrix', drawingContext.renderer.projectionMatrix.val);
    }

    /**
     * Draw the current batch
     *
     * @param {Phaser.Renderer.WebGL.DrawingContext} drawingContext
     */
    run(drawingContext) {
        const instanceCount = this.instanceCount;

        if (instanceCount === 0) {
            return;
        }

        this.onRunBegin(drawingContext);

        const programManager = this.programManager;
        const programSuite = programManager.getCurrentProgramSuite();

        if (programSuite) {
            const program = programSuite.program;
            const vao = programSuite.vao;

            // Check program compilation status
            const gl = this.manager.renderer.gl;
            const isLinked = gl.getProgramParameter(program.webGLProgram, gl.LINK_STATUS);
            if (!isLinked) {
                const log = gl.getProgramInfoLog(program.webGLProgram);
                console.error('[MSDFBatchHandler] Program link error:', log);
            }

            // Setup uniforms
            this.setupUniforms(drawingContext);
            programManager.applyUniforms(program);

            // Update vertex buffer
            this.vertexBufferLayout.buffer.update(this.instanceCount * this.bytesPerInstance);

            // Check for WebGL errors before drawing
            let error = gl.getError();
            if (error !== gl.NO_ERROR) {
                console.error('[MSDFBatchHandler] WebGL error BEFORE draw:', error);
            }

            // Draw with texture
            this.manager.renderer.drawElements(
                drawingContext,
                this._currentTexture ? [this._currentTexture] : [],
                program,
                vao,
                instanceCount * this.indicesPerInstance,
                0
            );

            // Check for WebGL errors after drawing
            error = gl.getError();
            if (error !== gl.NO_ERROR) {
                console.error('[MSDFBatchHandler] WebGL error AFTER draw:', error);
            }
        } else {
            console.error('[MSDFBatchHandler] No program suite available!');
        }

        // Reset batch
        this.instanceCount = 0;
        this._currentTexture = null;

        this.onRunEnd(drawingContext);
    }

    /**
     * Batch a quad
     *
     * @param {Phaser.Renderer.WebGL.DrawingContext} drawingContext
     * @param {Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper} glTexture - The texture to render
     * @param {number} x0 - Bottom-left X
     * @param {number} y0 - Bottom-left Y
     * @param {number} x1 - Top-left X
     * @param {number} y1 - Top-left Y
     * @param {number} x2 - Top-right X
     * @param {number} y2 - Top-right Y
     * @param {number} x3 - Bottom-right X
     * @param {number} y3 - Bottom-right Y
     * @param {number} u0 - Left UV
     * @param {number} v0 - Top UV
     * @param {number} u1 - Right UV
     * @param {number} v1 - Bottom UV
     * @param {number} tintBL - Bottom-left tint
     * @param {number} tintTL - Top-left tint
     * @param {number} tintTR - Top-right tint
     * @param {number} tintBR - Bottom-right tint
     */
    batch(drawingContext, glTexture, x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1, tintBL, tintTL, tintTR, tintBR) {
        // Initialize batch if this is the first instance
        if (this.instanceCount === 0) {
            this.manager.setCurrentBatchNode(this, drawingContext);
            this._currentTexture = glTexture;
        } else if (this._currentTexture !== glTexture) {
            // Texture changed - flush current batch and start new one
            this.run(drawingContext);
            this._currentTexture = glTexture;
        }

        // Get vertex buffer views
        const vertexOffset32 = this.instanceCount * this.floatsPerInstance;
        const vertexBuffer = this.vertexBufferLayout.buffer;
        const vertexViewF32 = vertexBuffer.viewF32;
        const vertexViewU32 = vertexBuffer.viewU32;

        // Default tint: white (0xFFFFFFFF) if not provided
        const tintBLValue = tintBL !== undefined ? tintBL : 0xFFFFFFFF;
        const tintTLValue = tintTL !== undefined ? tintTL : 0xFFFFFFFF;
        const tintBRValue = tintBR !== undefined ? tintBR : 0xFFFFFFFF;
        const tintTRValue = tintTR !== undefined ? tintTR : 0xFFFFFFFF;

        // Vertex order for degenerate triangle strip: BL, TL, BR, TR
        // Parameters arrive in correct order from BatchMSDFChar: x0=BL, x1=TL, x2=TR, x3=BR

        // Vertex 0: Bottom-left
        vertexViewF32[vertexOffset32 + 0] = x0;
        vertexViewF32[vertexOffset32 + 1] = y0;
        vertexViewF32[vertexOffset32 + 2] = u0;
        vertexViewF32[vertexOffset32 + 3] = v1;
        vertexViewU32[vertexOffset32 + 4] = tintBLValue;

        // Vertex 1: Top-left
        vertexViewF32[vertexOffset32 + 5] = x1;
        vertexViewF32[vertexOffset32 + 6] = y1;
        vertexViewF32[vertexOffset32 + 7] = u0;
        vertexViewF32[vertexOffset32 + 8] = v0;
        vertexViewU32[vertexOffset32 + 9] = tintTLValue;

        // Vertex 2: Bottom-right
        vertexViewF32[vertexOffset32 + 10] = x3;
        vertexViewF32[vertexOffset32 + 11] = y3;
        vertexViewF32[vertexOffset32 + 12] = u1;
        vertexViewF32[vertexOffset32 + 13] = v1;
        vertexViewU32[vertexOffset32 + 14] = tintBRValue;

        // Vertex 3: Top-right
        vertexViewF32[vertexOffset32 + 15] = x2;
        vertexViewF32[vertexOffset32 + 16] = y2;
        vertexViewF32[vertexOffset32 + 17] = u1;
        vertexViewF32[vertexOffset32 + 18] = v0;
        vertexViewU32[vertexOffset32 + 19] = tintTRValue;

        // Increment instance count
        this.instanceCount++;

        // Flush batch if full
        if (this.instanceCount === this.instancesPerBatch) {
            this.run(drawingContext);
        }
    }
}

/**
 * Default configuration
 */
MSDFBatchHandler.defaultConfig = {
    name: 'BatchHandlerMSDF',
    shaderName: 'MSDF',
    verticesPerInstance: 4,  // Quad = 4 vertices
    indicesPerInstance: 6,   // Quad = 6 indices (degenerate triangle strip)
    vertexSource: SimpleVertexShader,
    fragmentSource: SimpleFragmentShader,
    vertexBufferLayout: {
        usage: 'DYNAMIC_DRAW',
        layout: [
            {
                name: 'inPosition',
                size: 2  // x, y
            },
            {
                name: 'inTexCoord',
                size: 2  // u, v
            },
            {
                name: 'inTint',
                size: 4,  // r, g, b, a (packed as single U32, but specified as 4 bytes)
                type: 'UNSIGNED_BYTE',
                normalized: true
            }
        ]
    }
};

export default MSDFBatchHandler;
