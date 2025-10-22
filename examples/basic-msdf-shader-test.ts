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

        // Load MSDF font texture (generated from Arial with msdf-atlas-gen)
        this.load.image('msdf-font-atlas', 'assets/fonts/Arial.png');
    }

    create() {
      const width = this.scale.width;
      const height = this.scale.height;

      console.log('=== MSDF SHADER TEST ===');
      console.log('Scene dimensions:', width, height);

      // Create MSDF shader configuration
      console.log('Creating MSDF shader config...');
      const shaderConfig = createMSDFShaderConfig({
          name: 'MSDFTest',
          textureWidth: 512,
          textureHeight: 256,
          distanceRange: 4,
          fragmentKey: MSDF_SHADER_KEYS.FRAGMENT,
      });
      delete shaderConfig.vertexKey;  // Use Phaser's default vertex shader
      console.log('Shader config:', shaderConfig);

      // Create MSDF shader quad - renders entire font atlas
      console.log('Creating MSDF shader quad...');
      const msdfShader = this.add.shader(
          shaderConfig,
          width / 2,      // center x
          height / 2,     // center y
          600,            // width
          400,            // height
          ['msdf-font-atlas']
      );
      console.log('MSDF shader created:', msdfShader);

      // Info text
      this.add.text(10, 10, 'MSDF SHADER TEST - SUCCESS!', {
          fontSize: '24px',
          color: '#00ff00'
      });

      this.add.text(10, 45, 'The quad should show the entire MSDF font atlas', {
          fontSize: '16px',
          color: '#ffffff'
      });

      this.add.text(10, 70, 'with white characters on transparent background', {
          fontSize: '16px',
          color: '#ffffff'
      });

      this.add.text(10, 100, 'Next step: Create MSDFText GameObject to render individual characters!', {
          fontSize: '14px',
          color: '#ffff00'
      });

      console.log('=== MSDF SHADER TEST COMPLETE ===');

      // Check if texture loaded
      const texture = this.textures.get('msdf-font-atlas');
      console.log('Font atlas texture:', texture);
      if (texture) {
          console.log('Texture exists, source:', texture.source);
      } else {
          console.error('ERROR: Font atlas texture not found!');
      }
    }
}
