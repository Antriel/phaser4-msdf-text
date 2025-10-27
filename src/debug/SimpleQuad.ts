/**
 * Simple Quad GameObject - Phase 1 Debug
 *
 * Minimal GameObject that renders a solid color quad using SimpleBatchHandler.
 * This is Phase 1 of the incremental MSDF debugging plan.
 */

import Phaser from 'phaser';

/**
 * SimpleQuadWebGLRenderer
 * Renders SimpleQuad GameObjects using SimpleBatchHandler
 */
function SimpleQuadWebGLRenderer(renderer: any, src: SimpleQuad, drawingContext: any, parentMatrix: any) {
    console.log('[SimpleQuadWebGLRenderer] Called, visible:', src.visible);

    if (!src.visible) {
        return;
    }

    const camera = drawingContext.camera;
    camera.addToRenderList(src);

    // Get batch handler
    const batchHandler = src.customRenderNodes.BatchHandler || src.defaultRenderNodes.BatchHandler;

    console.log('[SimpleQuadWebGLRenderer] Batch handler:', batchHandler);

    if (!batchHandler) {
        console.warn('SimpleQuad: No batch handler found');
        return;
    }

    // Get texture (optional)
    const texture = src.texture;
    console.log('[SimpleQuadWebGLRenderer] Texture:', texture);

    // Calculate quad corners in screen space
    const x = src.x;
    const y = src.y;
    const w = src.width;
    const h = src.height;

    // Bottom-left
    const x0 = x;
    const y0 = y + h;

    // Top-left
    const x1 = x;
    const y1 = y;

    // Top-right
    const x2 = x + w;
    const y2 = y;

    // Bottom-right
    const x3 = x + w;
    const y3 = y + h;

    // UV coordinates (full texture by default, or custom UVs)
    const u0 = src.u0;
    const v0 = src.v0;
    const u1 = src.u1;
    const v1 = src.v1;

    console.log('[SimpleQuadWebGLRenderer] Batching quad at', { x, y, w, h });
    console.log('[SimpleQuadWebGLRenderer] UVs:', { u0, v0, u1, v1 });

    // Batch the quad (DON'T flush - let Phaser handle it)
    batchHandler.batch(
        drawingContext,
        texture,
        x0, y0,  // Bottom-left
        x1, y1,  // Top-left
        x2, y2,  // Top-right
        x3, y3,  // Bottom-right
        u0, v0,  // UV top-left
        u1, v1   // UV bottom-right
    );

    // NOTE: We do NOT call batchHandler.run() here!
    // Phaser will automatically flush the batch at the end of the render pass.
    // Manual flushing defeats the purpose of batching!
}

/**
 * Simple Quad GameObject
 */
export class SimpleQuad extends Phaser.GameObjects.GameObject {
    // Position and size
    public x: number = 0;
    public y: number = 0;
    public width: number = 100;
    public height: number = 100;

    // Rendering properties
    public visible: boolean = true;
    public alpha: number = 1.0;

    // Texture and UV coordinates
    public texture: any = null;  // WebGLTextureWrapper
    public u0: number = 0;
    public v0: number = 0;
    public u1: number = 1;
    public v1: number = 1;

    // BlendMode component (required by Phaser's renderer)
    public _blendMode: number = 0;  // Phaser.BlendModes.NORMAL
    get blendMode(): number {
        return this._blendMode;
    }
    set blendMode(value: number) {
        this._blendMode = value;
    }

    // Render nodes
    public customRenderNodes: any;
    public defaultRenderNodes: any;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, textureKey?: string) {
        super(scene, 'SimpleQuad');

        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;

        // Load texture if provided
        if (textureKey) {
            const frame = scene.sys.textures.getFrame(textureKey);
            if (frame && frame.glTexture) {
                this.texture = frame.glTexture;
                console.log('[SimpleQuad] Texture loaded:', textureKey, this.texture);
            } else {
                console.warn('[SimpleQuad] Could not get texture wrapper for:', textureKey);
            }
        }

        // Configure render nodes for batching
        this.customRenderNodes = {};
        this.defaultRenderNodes = {};

        // Get SimpleBatchHandler from RenderNodeManager
        const renderer = scene.sys.renderer;
        console.log('[SimpleQuad] Renderer:', renderer);
        if (renderer && renderer.renderNodes) {
            const manager = renderer.renderNodes;
            console.log('[SimpleQuad] RenderNodes manager:', manager);
            this.defaultRenderNodes['BatchHandler'] = manager.getNode('SimpleBatchHandler');
            console.log('[SimpleQuad] SimpleBatchHandler:', this.defaultRenderNodes['BatchHandler']);
        } else {
            console.warn('[SimpleQuad] Renderer or renderNodes not available!');
        }

        // Add to scene
        scene.add.existing(this);
    }

    /**
     * Set position
     */
    setPosition(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }

    /**
     * Set size
     */
    setSize(width: number, height: number): this {
        this.width = width;
        this.height = height;
        return this;
    }

    /**
     * Set UV coordinates
     */
    setUV(u0: number, v0: number, u1: number, v1: number): this {
        this.u0 = u0;
        this.v0 = v0;
        this.u1 = u1;
        this.v1 = v1;
        return this;
    }

    /**
     * Set texture
     */
    setTexture(textureKey: string): this {
        const frame = this.scene.sys.textures.getFrame(textureKey);
        if (frame && frame.glTexture) {
            this.texture = frame.glTexture;
        }
        return this;
    }

    /**
     * WebGL rendering method
     */
    renderWebGL(renderer: any, src: this, drawingContext: any, parentMatrix: any): void {
        SimpleQuadWebGLRenderer(renderer, src, drawingContext, parentMatrix);
    }
}
