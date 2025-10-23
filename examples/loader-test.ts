/**
 * MSDFLoader Test
 *
 * This example demonstrates the new MSDF loader API that simplifies
 * loading MSDF fonts with a single function call.
 *
 * Compare this to the old approach in msdf-text-test.ts!
 */

import Phaser from 'phaser';
import { loadMSDFFont, getMSDFFont } from '../src/MSDFLoader';
import { MSDFText } from '../src/MSDFText';

export class LoaderTest extends Phaser.Scene {
    constructor() {
        super({ key: 'LoaderTest' });
    }

    preload() {
        console.log('=== MSDF LOADER TEST - PRELOAD ===');

        // NEW API: Single function call loads everything!
        // - Loads Arial.png and Arial.json automatically
        // - Loads MSDF shaders automatically
        // - Sets up font cache for easy retrieval
        loadMSDFFont(this, 'arial', 'assets/fonts/Arial');

        console.log('Loading Arial MSDF font with new loader API...');
    }

    create() {
        console.log('=== MSDF LOADER TEST - CREATE ===');

        const width = this.scale.width;
        const height = this.scale.height;

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x1a1a2e);

        // NEW API: Get the parsed font with one line!
        const font = getMSDFFont(this, 'arial');

        if (!font) {
            console.error('Failed to load font!');
            return;
        }

        console.log('Font loaded successfully:', font.face);
        font.printDebugInfo();

        // Title (regular Phaser text for comparison)
        this.add.text(20, 20, 'MSDF Loader API Test', {
            fontSize: '32px',
            color: '#00ff00',
            fontStyle: 'bold'
        });

        this.add.text(20, 60, 'Simplified loading with loadMSDFFont() and getMSDFFont()', {
            fontSize: '16px',
            color: '#888888'
        });

        // Divider
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0x333333);
        graphics.lineBetween(20, 95, width - 20, 95);

        // =================================================================
        // Demo: MSDF text at various sizes
        // =================================================================

        let yPos = 130;

        // Large text
        const text1 = new MSDFText(this, 20, yPos, font, 'New Loader API!', 72);
        text1.setColorHex('#ffffff');

        yPos += 90;

        // Medium text
        const text2 = new MSDFText(this, 20, yPos, font, 'Super Simple Loading', 48);
        text2.setColorHex('#ffaa00');

        yPos += 65;

        // Regular text
        const text3 = new MSDFText(this, 20, yPos, font, 'Just two function calls:', 36);
        text3.setColorHex('#00aaff');

        yPos += 50;

        // Code example
        const code1 = new MSDFText(
            this,
            40,
            yPos,
            font,
            '1. loadMSDFFont(this, "arial", "path/to/Arial")',
            20
        );
        code1.setColorHex('#88ff88');

        yPos += 30;

        const code2 = new MSDFText(
            this,
            40,
            yPos,
            font,
            '2. const font = getMSDFFont(this, "arial")',
            20
        );
        code2.setColorHex('#88ff88');

        yPos += 50;

        // Benefits
        const benefit1 = new MSDFText(this, 20, yPos, font, '✓ No manual JSON parsing', 24);
        benefit1.setColorHex('#51cf66');

        yPos += 35;

        const benefit2 = new MSDFText(this, 20, yPos, font, '✓ Automatic caching', 24);
        benefit2.setColorHex('#51cf66');

        yPos += 35;

        const benefit3 = new MSDFText(this, 20, yPos, font, '✓ Shader loading included', 24);
        benefit3.setColorHex('#51cf66');

        yPos += 35;

        const benefit4 = new MSDFText(this, 20, yPos, font, '✓ Clean, readable code', 24);
        benefit4.setColorHex('#51cf66');

        // =================================================================
        // Info panel
        // =================================================================

        const infoY = height - 60;

        this.add.text(20, infoY, '✓ Font loaded with new API', {
            fontSize: '14px',
            color: '#00ff00'
        });

        this.add.text(
            20,
            infoY + 20,
            `${font.face} | ${font.charCount} chars | Distance Range: ${font.distanceField.distanceRange}`,
            {
                fontSize: '14px',
                color: '#888888'
            }
        );

        // Alignment demo
        const centerX = width / 2;
        const alignY = height - 120;

        const alignDemo1 = new MSDFText(this, centerX, alignY, font, 'Left', 20);
        alignDemo1.setAlign('left').setColorHex('#ff6b6b');

        const alignDemo2 = new MSDFText(this, centerX, alignY + 25, font, 'Center', 20);
        alignDemo2.setAlign('center').setColorHex('#ffd43b');

        const alignDemo3 = new MSDFText(this, centerX, alignY + 50, font, 'Right', 20);
        alignDemo3.setAlign('right').setColorHex('#339af0');

        console.log('=== MSDF LOADER TEST COMPLETE ===');
    }
}
