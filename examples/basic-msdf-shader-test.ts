/**
 * Basic MSDF Shader Test
 *
 * This example demonstrates how to use the MSDF shader in Phaser 4.
 * It renders a simple quad with MSDF font texture to verify the shader works correctly.
 *
 * Prerequisites:
 * - MSDF font texture (generated with msdf-atlas-gen)
 * - Font atlas (.png file)
 * - Font descriptor (.fnt file) - for later phases
 */

import Phaser from 'phaser';
import { loadMSDFShaders, createMSDFShaderConfig, MSDF_SHADER_KEYS } from '../src/MSDFShader';

export class BasicMSDFShaderTest extends Phaser.Scene {
    constructor() {
        super({ key: 'BasicMSDFShaderTest' });
    }

    preload() {
        // Load MSDF shader files
        loadMSDFShaders(this);

        // Load a sample MSDF font texture
        // TODO: Replace with actual MSDF font texture path
        this.load.image('msdf-font-atlas', 'assets/fonts/RobotoMedium.png');
    }

    create() {
        const width = this.scale.width;
        const height = this.scale.height;

        // Create MSDF shader configuration
        // These values should match your font generation parameters
        const shaderConfig = createMSDFShaderConfig({
            name: 'MSDFTest',
            textureWidth: 512,      // Match your atlas size
            textureHeight: 512,     // Match your atlas size
            distanceRange: 4,       // Match generation -pxrange parameter
            fragmentKey: MSDF_SHADER_KEYS.FRAGMENT,
            vertexKey: MSDF_SHADER_KEYS.VERTEX
        });

        // Create a shader quad using the MSDF shader
        const shader = this.add.shader(
            shaderConfig,
            width / 2,       // x position
            height / 2,      // y position
            400,             // width
            300,             // height
            ['msdf-font-atlas']  // texture to use
        );

        // Add some info text
        this.add.text(10, 10, 'MSDF Shader Test', {
            fontSize: '24px',
            color: '#ffffff'
        });

        this.add.text(10, 40, 'The quad above should render with MSDF shader', {
            fontSize: '16px',
            color: '#cccccc'
        });

        // Debug info
        console.log('MSDF Shader created:', shader);
        console.log('Shader config:', shaderConfig);
    }
}
