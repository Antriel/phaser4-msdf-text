/**
 * MSDFText GameObject Test
 *
 * This example demonstrates the MSDFText GameObject rendering text with:
 * - Multiple font sizes
 * - Different colors
 * - Text alignment
 * - Kerning
 */

import Phaser from 'phaser';
import { loadMSDFShaders } from '../src/MSDFShader';
import { parseMSDFFont, MSDFFontJSON } from '../src/MSDFFontParser';
import { MSDFFont } from '../src/MSDFFont';
import { MSDFText } from '../src/MSDFText';

export class MSDFTextTest extends Phaser.Scene {
    private arialFont?: MSDFFont;

    constructor() {
        super({ key: 'MSDFTextTest' });
    }

    preload() {
        console.log('=== MSDF TEXT TEST - PRELOAD ===');

        // Load MSDF shaders
        loadMSDFShaders(this);

        // Load Arial MSDF font assets
        this.load.image('arial-msdf', 'assets/fonts/Arial.png');
        this.load.json('arial-font-data', 'assets/fonts/Arial.json');

        console.log('Loading Arial MSDF font...');
    }

    create() {
        console.log('=== MSDF TEXT TEST - CREATE ===');

        const width = this.scale.width;
        const height = this.scale.height;

        console.log('Scene dimensions:', width, height);

        // Parse the font
        const fontJson = this.cache.json.get('arial-font-data') as MSDFFontJSON;
        const fontData = parseMSDFFont(fontJson, 'Arial');

        console.log('Font parsed:', fontData.face);
        console.log('Characters:', fontData.chars.size);
        console.log('Distance range:', fontData.distanceField.distanceRange);

        // Create MSDFFont instance
        this.arialFont = new MSDFFont(fontData, 'arial-msdf');
        this.arialFont.printDebugInfo();

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x1a1a2e);

        // Title
        this.add.text(20, 20, 'MSDF Text Rendering Test', {
            fontSize: '32px',
            color: '#00ff00',
            fontStyle: 'bold'
        });

        this.add.text(20, 60, 'High-quality scalable text with MSDF shaders', {
            fontSize: '16px',
            color: '#888888'
        });

        // Draw a divider
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0x333333);
        graphics.lineBetween(20, 95, width - 20, 95);

        // =================================================================
        // Test 1: Basic text at different sizes
        // =================================================================

        let yPos = 120;

        const text1 = new MSDFText(this, 20, yPos, this.arialFont, 'Hello World!', 64);
        text1.setColorHex('#ffffff');
        console.log('Text 1 created:', text1.getDebugInfo());

        yPos += 80;

        const text2 = new MSDFText(this, 20, yPos, this.arialFont, 'Scalable Vector Fonts', 48);
        text2.setColorHex('#ffaa00');

        yPos += 65;

        const text3 = new MSDFText(this, 20, yPos, this.arialFont, 'Sharp at any size!', 32);
        text3.setColorHex('#00aaff');

        yPos += 50;

        const text4 = new MSDFText(this, 20, yPos, this.arialFont, 'Even tiny text looks great', 18);
        text4.setColorHex('#ff00ff');

        // =================================================================
        // Test 2: Alignment
        // =================================================================

        yPos += 50;

        const centerX = width / 2;

        const alignLeft = new MSDFText(this, centerX, yPos, this.arialFont, 'Left Aligned', 24);
        alignLeft.setAlign('left').setColorHex('#ff6b6b');

        yPos += 35;

        const alignCenter = new MSDFText(this, centerX, yPos, this.arialFont, 'Center Aligned', 24);
        alignCenter.setAlign('center').setColorHex('#51cf66');

        yPos += 35;

        const alignRight = new MSDFText(this, centerX, yPos, this.arialFont, 'Right Aligned', 24);
        alignRight.setAlign('right').setColorHex('#339af0');

        // =================================================================
        // Test 3: Kerning test
        // =================================================================

        yPos += 55;

        const kernText = new MSDFText(
            this,
            20,
            yPos,
            this.arialFont,
            'AWAY Twelve VAT',
            28
        );
        kernText.setColorHex('#ffd43b');

        // =================================================================
        // Test 4: All characters test
        // =================================================================

        yPos += 50;

        const allChars = new MSDFText(
            this,
            20,
            yPos,
            this.arialFont,
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            20
        );
        allChars.setColorHex('#74c0fc');

        yPos += 30;

        const allCharsLower = new MSDFText(
            this,
            20,
            yPos,
            this.arialFont,
            'abcdefghijklmnopqrstuvwxyz',
            20
        );
        allCharsLower.setColorHex('#74c0fc');

        yPos += 30;

        const numbers = new MSDFText(
            this,
            20,
            yPos,
            this.arialFont,
            '0123456789 !@#$%^&*()',
            20
        );
        numbers.setColorHex('#74c0fc');

        // =================================================================
        // Info panel
        // =================================================================

        const infoY = height - 60;

        this.add.text(20, infoY, '✓ MSDF rendering active', {
            fontSize: '14px',
            color: '#00ff00'
        });

        this.add.text(20, infoY + 20, `Font: ${this.arialFont.face} | Characters: ${this.arialFont.charCount} | Distance Range: ${this.arialFont.distanceField.distanceRange}`, {
            fontSize: '14px',
            color: '#888888'
        });

        console.log('=== MSDF TEXT TEST COMPLETE ===');
    }
}
