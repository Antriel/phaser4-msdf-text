/**
 * Simple Batch Handler - Phase 1 Debug
 *
 * Minimal BatchHandler implementation that renders solid color quads.
 * No textures, no MSDF - just basic batched geometry rendering.
 *
 * This is Phase 1 of the incremental MSDF debugging plan.
 * Goal: Verify that basic batching works before adding complexity.
 */

import Phaser from 'phaser';

/**
 * Simple vertex shader - position + texture coordinates + tint
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
 * MSDF fragment shader - with median() and smoothstep + tint
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
    'uniform vec4 uTextColor;',
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
    '    // Apply smoothstep for anti-aliasing',
    '    float alpha = smoothstep(0.4, 0.6, dist);',
    '    ',
    '    // Apply text color AND tint (like MSDFBatchHandler)',
    '    vec4 color = uTextColor * outTint;',
    '    ',
    '    // Output premultiplied alpha',
    '    gl_FragColor = vec4(color.rgb * alpha, alpha * color.a);',
    '}'
].join('\n');

/**
 * @class SimpleBatchHandler
 * @extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler
 */
class SimpleBatchHandler extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    constructor(manager, config) {
        super(manager, SimpleBatchHandler.defaultConfig, config);

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
         * Text color [r, g, b, a] (0-1 range)
         * @type {number[]}
         * @default [1, 1, 1, 1]
         */
        this._textColor = [1, 1, 1, 1];
    }

    /**
     * Set the distance range parameter for MSDF rendering
     * @param {number} pxRange - Distance range (typically 2-8)
     */
    setPxRange(pxRange) {
        this._pxRange = pxRange;
    }

    /**
     * Set the text color for rendering
     * @param {number} r - Red (0-1)
     * @param {number} g - Green (0-1)
     * @param {number} b - Blue (0-1)
     * @param {number} a - Alpha (0-1)
     */
    setTextColor(r, g, b, a) {
        this._textColor = [r, g, b, a || 1];
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

        console.log('[SimpleBatchHandler] Generated indices for', instances, 'quads');
        return buffer;
    }

    /**
     * Setup uniforms before rendering
     *
     * @param {Phaser.Renderer.WebGL.DrawingContext} drawingContext
     */
    setupUniforms(drawingContext) {
        const programManager = this.programManager;

        console.log('[SimpleBatchHandler] setupUniforms - Resolution:', drawingContext.width, 'x', drawingContext.height);
        console.log('[SimpleBatchHandler] setupUniforms - pxRange:', this._pxRange);
        console.log('[SimpleBatchHandler] setupUniforms - textColor:', this._textColor);

        // Set texture sampler to texture unit 0
        programManager.setUniform('uMainSampler', 0);

        // Set MSDF-specific uniforms
        programManager.setUniform('uPxRange', this._pxRange);
        programManager.setUniform('uTextColor', this._textColor);

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

        console.log('[SimpleBatchHandler] run() called with', instanceCount, 'instances');

        if (instanceCount === 0) {
            console.log('[SimpleBatchHandler] No instances to render');
            return;
        }

        this.onRunBegin(drawingContext);

        const programManager = this.programManager;
        const programSuite = programManager.getCurrentProgramSuite();

        console.log('[SimpleBatchHandler] Program suite:', programSuite);

        if (programSuite) {
            const program = programSuite.program;
            const vao = programSuite.vao;

            console.log('[SimpleBatchHandler] Program:', program, 'VAO:', vao);

            // Check program compilation status
            const gl = this.manager.renderer.gl;
            const isLinked = gl.getProgramParameter(program.webGLProgram, gl.LINK_STATUS);
            console.log('[SimpleBatchHandler] Program linked:', isLinked);
            if (!isLinked) {
                const log = gl.getProgramInfoLog(program.webGLProgram);
                console.error('[SimpleBatchHandler] Program link error:', log);
            }

            // Setup uniforms
            console.log('[SimpleBatchHandler] Setting up uniforms...');
            this.setupUniforms(drawingContext);
            programManager.applyUniforms(program);

            // Update vertex buffer
            console.log('[SimpleBatchHandler] Updating vertex buffer:', this.instanceCount * this.bytesPerInstance, 'bytes');
            this.vertexBufferLayout.buffer.update(this.instanceCount * this.bytesPerInstance);

            // Check for WebGL errors before drawing
            let error = gl.getError();
            if (error !== gl.NO_ERROR) {
                console.error('[SimpleBatchHandler] WebGL error BEFORE draw:', error);
            }

            // Draw with texture
            console.log('[SimpleBatchHandler] Calling drawElements with texture:', this._currentTexture, 'indices:', instanceCount * this.indicesPerInstance);
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
                console.error('[SimpleBatchHandler] WebGL error AFTER draw:', error);
            }

            console.log('[SimpleBatchHandler] drawElements complete');
        } else {
            console.error('[SimpleBatchHandler] No program suite available!');
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
     */
    batch(drawingContext, glTexture, x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1) {
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

        // Default tint: white (0xFFFFFFFF)
        const tint = 0xFFFFFFFF;

        // Vertex order for degenerate triangle strip: BL, TL, BR, TR
        // Vertex 0: Bottom-left
        vertexViewF32[vertexOffset32 + 0] = x0;
        vertexViewF32[vertexOffset32 + 1] = y0;
        vertexViewF32[vertexOffset32 + 2] = u0;
        vertexViewF32[vertexOffset32 + 3] = v1;
        vertexViewU32[vertexOffset32 + 4] = tint;

        // Vertex 1: Top-left
        vertexViewF32[vertexOffset32 + 5] = x1;
        vertexViewF32[vertexOffset32 + 6] = y1;
        vertexViewF32[vertexOffset32 + 7] = u0;
        vertexViewF32[vertexOffset32 + 8] = v0;
        vertexViewU32[vertexOffset32 + 9] = tint;

        // Vertex 2: Bottom-right
        vertexViewF32[vertexOffset32 + 10] = x3;
        vertexViewF32[vertexOffset32 + 11] = y3;
        vertexViewF32[vertexOffset32 + 12] = u1;
        vertexViewF32[vertexOffset32 + 13] = v1;
        vertexViewU32[vertexOffset32 + 14] = tint;

        // Vertex 3: Top-right
        vertexViewF32[vertexOffset32 + 15] = x2;
        vertexViewF32[vertexOffset32 + 16] = y2;
        vertexViewF32[vertexOffset32 + 17] = u1;
        vertexViewF32[vertexOffset32 + 18] = v0;
        vertexViewU32[vertexOffset32 + 19] = tint;

        console.log('[SimpleBatchHandler] Batched quad:', {
            BL: [x0, y0, u0, v1],
            TL: [x1, y1, u0, v0],
            BR: [x3, y3, u1, v1],
            TR: [x2, y2, u1, v0]
        });

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
SimpleBatchHandler.defaultConfig = {
    name: 'SimpleBatchHandler',
    shaderName: 'SIMPLE',
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

export default SimpleBatchHandler;
