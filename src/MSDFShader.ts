/**
 * MSDF Shader Helper for Phaser 4
 *
 * Provides utilities for creating and configuring MSDF (Multi-channel Signed Distance Field)
 * shaders for high-quality scalable text rendering.
 *
 * Based on the Ceramic engine implementation (MIT licensed).
 *
 * @see https://github.com/ceramic-engine/ceramic
 */

/**
 * Configuration options for MSDF shader
 */
export interface MSDFShaderConfig {
    /** Name for this shader instance */
    name?: string;

    /** Texture width in pixels */
    textureWidth: number;

    /** Texture height in pixels */
    textureHeight: number;

    /** Distance field range in pixels (typically 2-4, default 4) */
    distanceRange?: number;

    /** Key of the fragment shader in cache (if using loaded shader) */
    fragmentKey?: string;

    /** Key of the vertex shader in cache (if using loaded shader) */
    vertexKey?: string;

    /** Path to fragment shader file (if loading inline) */
    fragmentPath?: string;

    /** Path to vertex shader file (if loading inline) */
    vertexPath?: string;
}

/**
 * Creates a Phaser 4 Shader config for MSDF rendering
 *
 * @param options - Configuration options for the MSDF shader
 * @returns Phaser 4 ShaderQuadConfig object ready to use
 *
 * @example
 * ```typescript
 * // In your scene's preload:
 * this.load.glsl('MSDFFont-frag', 'shaders/msdf/MSDFFont.frag');
 * this.load.glsl('MSDFFont-vert', 'shaders/msdf/MSDFFont.vert');
 *
 * // In your scene's create:
 * const config = createMSDFShaderConfig({
 *     textureWidth: 512,
 *     textureHeight: 512,
 *     distanceRange: 4,
 *     fragmentKey: 'MSDFFont-frag',
 *     vertexKey: 'MSDFFont-vert'
 * });
 *
 * const shader = this.add.shader(config, x, y, width, height, [fontTexture]);
 * ```
 */
export function createMSDFShaderConfig(options: MSDFShaderConfig): any {
    const {
        name = 'MSDFShader',
        textureWidth,
        textureHeight,
        distanceRange = 4,
        fragmentKey = 'MSDFFont-frag',
        vertexKey = 'MSDFFont-vert'
    } = options;

    return {
        name: name,
        fragmentKey: fragmentKey,
        vertexKey: vertexKey,

        setupUniforms: (setUniform: (name: string, value: any) => void, drawingContext: any) => {
            // Set texture sampler to texture unit 0
            setUniform('iChannel0', 0);

            // Set MSDF-specific uniforms
            setUniform('uTexSize', [textureWidth, textureHeight]);
            setUniform('uPxRange', distanceRange);

            // Set text color (white by default)
            setUniform('uTextColor', [1.0, 1.0, 1.0, 1.0]);
        }
    };
}

/**
 * Helper class for managing MSDF shader state
 *
 * This class wraps a Phaser 4 Shader object and provides convenient
 * methods for updating MSDF-specific parameters.
 */
export class MSDFShaderHelper {
    private shader: any;  // Phaser.GameObjects.Shader
    private _textureWidth: number;
    private _textureHeight: number;
    private _distanceRange: number;

    /**
     * Creates a new MSDF shader helper
     *
     * @param shader - The Phaser 4 Shader object to manage
     * @param textureWidth - Initial texture width
     * @param textureHeight - Initial texture height
     * @param distanceRange - Initial distance range (default: 4)
     */
    constructor(
        shader: any,
        textureWidth: number,
        textureHeight: number,
        distanceRange: number = 4
    ) {
        this.shader = shader;
        this._textureWidth = textureWidth;
        this._textureHeight = textureHeight;
        this._distanceRange = distanceRange;
    }

    /**
     * Update texture size (call this if the atlas texture changes)
     */
    setTextureSize(width: number, height: number): this {
        this._textureWidth = width;
        this._textureHeight = height;
        return this;
    }

    /**
     * Update distance range (must match the value used during font generation)
     */
    setDistanceRange(range: number): this {
        this._distanceRange = range;
        return this;
    }

    /**
     * Get current texture width
     */
    get textureWidth(): number {
        return this._textureWidth;
    }

    /**
     * Get current texture height
     */
    get textureHeight(): number {
        return this._textureHeight;
    }

    /**
     * Get current distance range
     */
    get distanceRange(): number {
        return this._distanceRange;
    }

    /**
     * Access the underlying Phaser shader object
     */
    get phaserShader(): any {
        return this.shader;
    }
}

/**
 * Default paths for MSDF shader files (relative to public directory)
 */
export const MSDF_SHADER_PATHS = {
    FRAGMENT: 'shaders/MSDFFont.frag',
    VERTEX: 'shaders/MSDFFont.vert'
} as const;

/**
 * Default cache keys for loaded MSDF shaders
 */
export const MSDF_SHADER_KEYS = {
    FRAGMENT: 'MSDFFont-frag',
    VERTEX: 'MSDFFont-vert'
} as const;

/**
 * Loads MSDF shader files into the Phaser cache
 *
 * Call this in your scene's preload() method.
 *
 * @param scene - The Phaser scene
 * @param fragmentPath - Path to fragment shader (optional, uses default)
 * @param vertexPath - Path to vertex shader (optional, uses default)
 * @param fragmentKey - Cache key for fragment shader (optional, uses default)
 * @param vertexKey - Cache key for vertex shader (optional, uses default)
 *
 * @example
 * ```typescript
 * class MyScene extends Phaser.Scene {
 *     preload() {
 *         loadMSDFShaders(this);
 *     }
 * }
 * ```
 */
export function loadMSDFShaders(
    scene: any,
    fragmentPath: string = MSDF_SHADER_PATHS.FRAGMENT,
    vertexPath: string = MSDF_SHADER_PATHS.VERTEX,
    fragmentKey: string = MSDF_SHADER_KEYS.FRAGMENT,
    vertexKey: string = MSDF_SHADER_KEYS.VERTEX
): void {
    scene.load.glsl(fragmentKey, fragmentPath);
    scene.load.glsl(vertexKey, vertexPath);
}
