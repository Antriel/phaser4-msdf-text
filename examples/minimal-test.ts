/**
 * Minimal Test - Just ONE character
 */

import Phaser from 'phaser';
import { loadMSDFShaders, createMSDFShaderConfig, MSDF_SHADER_KEYS } from '../src/MSDFShader';

export class MinimalTest extends Phaser.Scene {
    constructor() {
        super({ key: 'MinimalTest' });
    }

    preload() {
        loadMSDFShaders(this);
        this.load.glsl('debug-uv-frag', 'shaders/DebugUV.frag');
        this.load.image('arial-msdf', 'assets/fonts/Arial.png');
    }

    create() {
        const width = this.scale.width;
        const height = this.scale.height;

        console.log('=== MINIMAL TEST ===');

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x000000);

        // Title
        this.add.text(20, 20, 'Minimal Test - Letter A only', {
            fontSize: '24px',
            color: '#00ff00'
        });

        // Hardcoded values for letter 'A' from Arial.json
        // These are the exact values from the JSON file
        const charA = {
            u0: 0.9345703125,
            v0: 0.001953125,
            u1: 0.9990234375,
            v1: 0.138671875,
            // From planeBounds
            left: -0.059361049107142766,
            top: -0.77380952380952384,
            right: 0.7263532366071429,
            bottom: 0.059523809523809521
        };

        const normalizedWidth = charA.right - charA.left;
        const normalizedHeight = charA.bottom - charA.top;

        console.log('Hardcoded A normalizedWidth:', normalizedWidth);
        console.log('Hardcoded A normalizedHeight:', normalizedHeight);

        const fontSize = 200;
        const pixelWidth = normalizedWidth * fontSize;
        const pixelHeight = normalizedHeight * fontSize;

        console.log('At fontSize', fontSize);
        console.log('Pixel width:', pixelWidth);
        console.log('Pixel height:', pixelHeight);

        // Create shader for 'A' with DEBUG shader
        const config = createMSDFShaderConfig({
            name: 'TestA',
            textureWidth: 512,
            textureHeight: 256,
            distanceRange: 4,
            fragmentKey: 'debug-uv-frag', // Use debug shader
            textColor: [1, 0, 0, 1], // Red
            charUV: [charA.u0, charA.v0, charA.u1, charA.v1]
        });
        delete config.vertexKey;

        console.log('Creating shader with charUV:', [charA.u0, charA.v0, charA.u1, charA.v1]);
        console.log('Config:', config);

        const shader = this.add.shader(
            config,
            width / 2,
            height / 2,
            pixelWidth,
            pixelHeight,
            ['arial-msdf']
        );

        console.log('Shader created:', shader);
        console.log('Shader.shader:', shader.shader);
        console.log('Shader properties:', Object.keys(shader));

        // Wait a frame then check for errors
        this.time.delayedCall(100, () => {
            console.log('After 100ms - Shader:', shader);
            if (shader.shader) {
                console.log('Inner shader:', shader.shader);
            }

            // Try to access the WebGL program
            const renderer = this.game.renderer;
            console.log('Renderer:', renderer);
        });

        this.add.text(20, 50, `DEBUG SHADER: Top half = UV debug colors, Bottom half = Actual texture`, {
            fontSize: '16px',
            color: '#ffff00'
        });

        this.add.text(20, 75, `Top: Red=U coord (${charA.u0.toFixed(2)}-${charA.u1.toFixed(2)}), Green=V coord (${charA.v0.toFixed(2)}-${charA.v1.toFixed(2)})`, {
            fontSize: '14px',
            color: '#ffffff'
        });

        this.add.text(20, 100, `Bottom: Should show letter 'A' from texture atlas`, {
            fontSize: '14px',
            color: '#ffffff'
        });

        this.add.text(20, height - 40, `normalizedWidth: ${normalizedWidth.toFixed(4)}, pixelWidth @ ${fontSize}px: ${pixelWidth.toFixed(1)}`, {
            fontSize: '14px',
            color: '#888888'
        });
    }
}
