/**
 * Debug Scene - Single Character Test
 *
 * This tests rendering a single character step-by-step to debug UV issues
 */

import Phaser from 'phaser';
import { loadMSDFShaders, createMSDFShaderConfig, MSDF_SHADER_KEYS } from '../src/MSDFShader';
import { parseMSDFFont, MSDFFontJSON } from '../src/MSDFFontParser';
import { MSDFFont } from '../src/MSDFFont';

export class DebugSingleChar extends Phaser.Scene {
    constructor() {
        super({ key: 'DebugSingleChar' });
    }

    preload() {
        loadMSDFShaders(this);
        this.load.image('arial-msdf', 'assets/fonts/Arial.png');
        this.load.json('arial-font-data', 'assets/fonts/Arial.json');
    }

    create() {
        const width = this.scale.width;
        const height = this.scale.height;

        console.log('=== DEBUG SINGLE CHARACTER ===');

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x1a1a2e);

        // Parse font
        const fontJson = this.cache.json.get('arial-font-data') as MSDFFontJSON;
        const fontData = parseMSDFFont(fontJson, 'Arial');
        const font = new MSDFFont(fontData, 'arial-msdf');

        console.log('Font loaded:', font.face);
        console.log('Atlas size:', font.atlasSize);

        // Test 1: Render full atlas (should work like before)
        console.log('\n--- TEST 1: Full Atlas ---');
        const fullAtlasConfig = createMSDFShaderConfig({
            name: 'FullAtlas',
            textureWidth: font.data.atlasWidth,
            textureHeight: font.data.atlasHeight,
            distanceRange: font.distanceField.distanceRange,
            fragmentKey: MSDF_SHADER_KEYS.FRAGMENT,
            textColor: [1, 1, 1, 1],
            charUV: [0, 0, 1, 1] // Full texture
        });
        delete fullAtlasConfig.vertexKey;

        const fullAtlas = this.add.shader(
            fullAtlasConfig,
            150, 150,
            300, 150,
            ['arial-msdf']
        );

        this.add.text(10, 40, 'Full Atlas (should show all characters):', {
            fontSize: '16px',
            color: '#00ff00'
        });

        // Test 2: Render letter 'A' with explicit UVs
        console.log('\n--- TEST 2: Letter A ---');
        const charA = font.getChar(65); // 'A'
        const fontSize = 100; // Large size for visibility

        if (charA) {
            console.log('Character A data:', {
                id: charA.id,
                char: String.fromCharCode(charA.id),
                x: charA.x,
                y: charA.y,
                width: charA.width,
                height: charA.height,
                normalizedWidth: charA.normalizedWidth,
                normalizedHeight: charA.normalizedHeight,
                u0: charA.u0,
                v0: charA.v0,
                u1: charA.u1,
                v1: charA.v1,
                xOffset: charA.xOffset,
                yOffset: charA.yOffset,
                xAdvance: charA.xAdvance
            });
            console.log('normalizedWidth exists?', 'normalizedWidth' in charA);

            // Create shader for 'A'
            const charAConfig = createMSDFShaderConfig({
                name: 'CharA',
                textureWidth: font.data.atlasWidth,
                textureHeight: font.data.atlasHeight,
                distanceRange: font.distanceField.distanceRange,
                fragmentKey: MSDF_SHADER_KEYS.FRAGMENT,
                textColor: [1, 0, 0, 1], // Red
                charUV: [charA.u0, charA.v0, charA.u1, charA.v1]
            });
            delete charAConfig.vertexKey;

            const shaderA = this.add.shader(
                charAConfig,
                500, 200,
                charA.normalizedWidth * fontSize,
                charA.normalizedHeight * fontSize,
                ['arial-msdf']
            );

            this.add.text(400, 40, `Single Character "A" (red) - UVs: [${charA.u0.toFixed(3)}, ${charA.v0.toFixed(3)}, ${charA.u1.toFixed(3)}, ${charA.v1.toFixed(3)}]`, {
                fontSize: '14px',
                color: '#ff0000'
            });

            console.log('Created shader for A at (500, 200)');
            console.log('Shader A object:', shaderA);
        } else {
            console.error('Character A not found in font!');
        }

        // Test 3: Letter 'H'
        console.log('\n--- TEST 3: Letter H ---');
        const charH = font.getChar(72); // 'H'

        if (charH) {
            console.log('Character H data:', {
                id: charH.id,
                char: String.fromCharCode(charH.id),
                uvs: [charH.u0, charH.v0, charH.u1, charH.v1]
            });

            const charHConfig = createMSDFShaderConfig({
                name: 'CharH',
                textureWidth: font.data.atlasWidth,
                textureHeight: font.data.atlasHeight,
                distanceRange: font.distanceField.distanceRange,
                fragmentKey: MSDF_SHADER_KEYS.FRAGMENT,
                textColor: [0, 1, 0, 1], // Green
                charUV: [charH.u0, charH.v0, charH.u1, charH.v1]
            });
            delete charHConfig.vertexKey;

            const shaderH = this.add.shader(
                charHConfig,
                700, 200,
                charH.normalizedWidth * fontSize,
                charH.normalizedHeight * fontSize,
                ['arial-msdf']
            );

            this.add.text(650, 40, `"H" (green) - UVs: [${charH.u0.toFixed(3)}, ${charH.v0.toFixed(3)}, ${charH.u1.toFixed(3)}, ${charH.v1.toFixed(3)}]`, {
                fontSize: '14px',
                color: '#00ff00'
            });
        }

        // Test 4: Check texture filtering
        console.log('\n--- TEST 4: Texture Info ---');
        const texture = this.textures.get('arial-msdf');
        console.log('Texture:', texture);
        if (texture && texture.source && texture.source[0]) {
            console.log('Texture source:', texture.source[0]);
            console.log('GL Texture:', texture.source[0].glTexture);
        }

        // Info
        this.add.text(10, height - 100, 'Open browser console (F12) to see debug output', {
            fontSize: '14px',
            color: '#ffff00'
        });

        this.add.text(10, height - 80, 'Check:', {
            fontSize: '14px',
            color: '#ffffff'
        });

        this.add.text(10, height - 60, '1. Does full atlas show characters?', {
            fontSize: '12px',
            color: '#aaaaaa'
        });

        this.add.text(10, height - 45, '2. Do individual A and H render correctly?', {
            fontSize: '12px',
            color: '#aaaaaa'
        });

        this.add.text(10, height - 30, '3. Are UVs correct in console?', {
            fontSize: '12px',
            color: '#aaaaaa'
        });

        console.log('=== DEBUG SCENE READY ===');
    }
}
