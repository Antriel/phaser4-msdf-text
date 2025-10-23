/**
 * MSDF Batch Handler
 *
 * Custom BatchHandler for rendering batched MSDF text characters.
 * Extends Phaser's BatchHandler to provide MSDF-specific shader and vertex layout.
 *
 * This handler accumulates character quads in a vertex buffer and renders them
 * in a single (or few) draw calls, significantly improving performance over
 * rendering each character as a separate Shader GameObject.
 *
 * Based on BatchHandlerPointLight pattern from Phaser 4.
 */

import Phaser from 'phaser';
import ShaderSourceVS from './shaders/MSDF-vert.js';
import ShaderSourceFS from './shaders/MSDF-frag.js';

/**
 * @class MSDFBatchHandler
 * @extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler
 */
class MSDFBatchHandler extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    /**
     * @param {Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager} manager
     * @param {object} config
     */
    constructor(manager, config) {
        super(manager, MSDFBatchHandler.defaultConfig, config);

        /**
         * MSDF distance range parameter (typically 2-8, commonly 4)
         * @type {number}
         * @default 4
         */
        this._pxRange = 4;

        /**
         * Text color uniform [r, g, b, a] (0-1 range)
         * @type {number[]}
         * @default [1, 1, 1, 1]
         */
        this._textColor = [1, 1, 1, 1];

        /**
         * Current MSDF texture being batched
         * @type {Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper|null}
         * @private
         */
        this._currentTexture = null;
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
     * Each quad = 4 vertices, drawn as 2 triangles
     *
     * Vertex layout (from batch() method):
     *   0: Bottom-left
     *   1: Top-left
     *   2: Bottom-right
     *   3: Top-right
     *
     * Counter-clockwise winding (WebGL default):
     *   Triangle 1: 0, 2, 1 (bottom-left, bottom-right, top-left)
     *   Triangle 2: 1, 2, 3 (top-left, bottom-right, top-right)
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
            // Triangle 1 (counter-clockwise: bottom-left, bottom-right, top-left)
            indices[offset++] = index;     // Vertex 0: Bottom-left
            indices[offset++] = index + 2; // Vertex 2: Bottom-right
            indices[offset++] = index + 1; // Vertex 1: Top-left
            // Triangle 2 (counter-clockwise: top-left, bottom-right, top-right)
            indices[offset++] = index + 1; // Vertex 1: Top-left
            indices[offset++] = index + 2; // Vertex 2: Bottom-right
            indices[offset++] = index + 3; // Vertex 3: Top-right
        }

        console.log('[MSDFBatchHandler] Generated indices for', instances, 'quads:', indices.slice(0, 12));
        return buffer;
    }

    /**
     * Setup MSDF-specific uniforms before rendering
     *
     * @param {Phaser.Renderer.WebGL.DrawingContext} drawingContext
     */
    setupUniforms(drawingContext) {
        const programManager = this.programManager;
        const width = drawingContext.width;
        const height = drawingContext.height;

        console.log('[MSDFBatchHandler] setupUniforms - Resolution:', width, 'x', height);
        console.log('[MSDFBatchHandler] setupUniforms - pxRange:', this._pxRange);
        console.log('[MSDFBatchHandler] setupUniforms - textColor:', this._textColor);

        // MSDF-specific uniforms
        programManager.setUniform('uPxRange', this._pxRange);
        programManager.setUniform('uTextColor', this._textColor);

        // Standard uniforms
        programManager.setUniform('uResolution', [width, height]);

        // Projection matrix
        drawingContext.renderer.setProjectionMatrixFromDrawingContext(drawingContext);
        programManager.setUniform('uProjectionMatrix', drawingContext.renderer.projectionMatrix.val);
    }

    /**
     * Batch a character quad into the vertex buffer
     *
     * @param {Phaser.Renderer.WebGL.DrawingContext} drawingContext
     * @param {Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper} glTexture
     * @param {number} x0 - Top-left X
     * @param {number} y0 - Top-left Y
     * @param {number} x1 - Bottom-left X
     * @param {number} y1 - Bottom-left Y
     * @param {number} x2 - Bottom-right X
     * @param {number} y2 - Bottom-right Y
     * @param {number} x3 - Top-right X
     * @param {number} y3 - Top-right Y
     * @param {number} u0 - Left UV coordinate
     * @param {number} v0 - Top UV coordinate
     * @param {number} u1 - Right UV coordinate
     * @param {number} v1 - Bottom UV coordinate
     * @param {number} tintTL - Top-left tint color (packed RGBA)
     * @param {number} tintBL - Bottom-left tint color (packed RGBA)
     * @param {number} tintTR - Top-right tint color (packed RGBA)
     * @param {number} tintBR - Bottom-right tint color (packed RGBA)
     */
    batch(
        drawingContext,
        glTexture,
        x0, y0,
        x1, y1,
        x2, y2,
        x3, y3,
        u0, v0,
        u1, v1,
        tintTL, tintBL, tintTR, tintBR
    ) {
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

        // Vertex 0: Bottom-left
        vertexViewF32[vertexOffset32 + 0] = x1;
        vertexViewF32[vertexOffset32 + 1] = y1;
        vertexViewF32[vertexOffset32 + 2] = u0;
        vertexViewF32[vertexOffset32 + 3] = v1;
        vertexViewU32[vertexOffset32 + 4] = tintBL;

        // Vertex 1: Top-left
        vertexViewF32[vertexOffset32 + 5] = x0;
        vertexViewF32[vertexOffset32 + 6] = y0;
        vertexViewF32[vertexOffset32 + 7] = u0;
        vertexViewF32[vertexOffset32 + 8] = v0;
        vertexViewU32[vertexOffset32 + 9] = tintTL;

        // Vertex 2: Bottom-right
        vertexViewF32[vertexOffset32 + 10] = x2;
        vertexViewF32[vertexOffset32 + 11] = y2;
        vertexViewF32[vertexOffset32 + 12] = u1;
        vertexViewF32[vertexOffset32 + 13] = v1;
        vertexViewU32[vertexOffset32 + 14] = tintBR;

        // Vertex 3: Top-right
        vertexViewF32[vertexOffset32 + 15] = x3;
        vertexViewF32[vertexOffset32 + 16] = y3;
        vertexViewF32[vertexOffset32 + 17] = u1;
        vertexViewF32[vertexOffset32 + 18] = v0;
        vertexViewU32[vertexOffset32 + 19] = tintTR;

        // Increment instance count
        this.instanceCount++;

        // Flush batch if full
        if (this.instanceCount === this.instancesPerBatch) {
            this.run(drawingContext);
        }
    }

    /**
     * Draw the current batch
     *
     * @param {Phaser.Renderer.WebGL.DrawingContext} drawingContext
     */
    run(drawingContext) {
        const instanceCount = this.instanceCount;

        console.log('[MSDFBatchHandler] run() called with', instanceCount, 'instances');

        if (instanceCount === 0) {
            console.log('[MSDFBatchHandler] No instances to render');
            return;
        }

        this.onRunBegin(drawingContext);

        const programManager = this.programManager;
        const programSuite = programManager.getCurrentProgramSuite();

        console.log('[MSDFBatchHandler] Program suite:', programSuite);

        if (programSuite) {
            const program = programSuite.program;
            const vao = programSuite.vao;

            console.log('[MSDFBatchHandler] Program:', program, 'VAO:', vao);

            // Check program compilation status
            const gl = this.manager.renderer.gl;
            const isLinked = gl.getProgramParameter(program.webGLProgram, gl.LINK_STATUS);
            console.log('[MSDFBatchHandler] Program linked:', isLinked);
            if (!isLinked) {
                const log = gl.getProgramInfoLog(program.webGLProgram);
                console.error('[MSDFBatchHandler] Program link error:', log);
            }

            // Setup uniforms
            console.log('[MSDFBatchHandler] Setting up uniforms...');
            this.setupUniforms(drawingContext);
            programManager.applyUniforms(program);

            // Update vertex buffer with actual instance count
            console.log('[MSDFBatchHandler] Updating vertex buffer with', this.instanceCount, 'instances,', this.instanceCount * this.bytesPerInstance, 'bytes');
            this.vertexBufferLayout.buffer.update(this.instanceCount * this.bytesPerInstance);

            // Draw
            // Note: Texture binding is handled automatically by drawElements
            console.log('[MSDFBatchHandler] Calling drawElements with texture:', this._currentTexture, 'indices:', instanceCount * this.indicesPerInstance);

            // Check for WebGL errors before drawing
            let error = gl.getError();
            if (error !== gl.NO_ERROR) {
                console.error('[MSDFBatchHandler] WebGL error BEFORE draw:', error);
            }

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

            console.log('[MSDFBatchHandler] drawElements complete');
        } else {
            console.error('[MSDFBatchHandler] No program suite available!');
        }

        // Reset batch
        this.instanceCount = 0;
        this._currentTexture = null;

        this.onRunEnd(drawingContext);
    }
}

/**
 * Default configuration for MSDFBatchHandler
 */
MSDFBatchHandler.defaultConfig = {
    name: 'BatchHandlerMSDF',
    shaderName: 'MSDF',
    verticesPerInstance: 4,  // Quad = 4 vertices
    indicesPerInstance: 6,   // Quad = 6 indices (for triangle strip with degenerates)
    vertexSource: ShaderSourceVS,
    fragmentSource: ShaderSourceFS,
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
