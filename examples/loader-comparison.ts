/**
 * Loader API Comparison
 *
 * This example demonstrates BOTH the old manual approach and the new
 * simplified loader API side-by-side for comparison.
 */

import Phaser from 'phaser';
import { loadMSDFShaders } from '../src/MSDFShader';
import { parseMSDFFont, MSDFFontJSON } from '../src/MSDFFontParser';
import { MSDFFont } from '../src/MSDFFont';
import { loadMSDFFont, getMSDFFont } from '../src/MSDFLoader';
import { MSDFText } from '../src/MSDFText';

export class LoaderComparison extends Phaser.Scene {
    private manualFont?: MSDFFont;

    constructor() {
        super({ key: 'LoaderComparison' });
    }

    preload() {
        console.log('=== LOADER COMPARISON - PRELOAD ===');

        // ============================================================
        // OLD APPROACH: Manual loading (verbose, error-prone)
        // ============================================================
        console.log('OLD APPROACH: Manual loading...');

        loadMSDFShaders(this);
        this.load.image('arial-texture', 'assets/fonts/Arial.png');
        this.load.json('arial-data', 'assets/fonts/Arial.json');

        // ============================================================
        // NEW APPROACH: Single function call (clean, simple)
        // ============================================================
        console.log('NEW APPROACH: Using loadMSDFFont()...');

        loadMSDFFont(this, 'arial-new', 'assets/fonts/Arial');

        console.log('Both approaches queued for loading');
    }

    create() {
        console.log('=== LOADER COMPARISON - CREATE ===');

        const width = this.scale.width;
        const height = this.scale.height;

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x1a1a2e);

        // Title
        this.add.text(20, 20, 'MSDF Loader - Old vs New API', {
            fontSize: '32px',
            color: '#00ff00',
            fontStyle: 'bold'
        });

        // ============================================================
        // OLD APPROACH: Manual font creation (lots of boilerplate)
        // ============================================================

        console.log('OLD APPROACH: Manual parsing and creation...');

        // Step 1: Get JSON from cache
        const fontJson = this.cache.json.get('arial-data') as MSDFFontJSON;

        // Step 2: Parse JSON into font data
        const fontData = parseMSDFFont(fontJson, 'Arial');

        // Step 3: Create MSDFFont instance
        this.manualFont = new MSDFFont(fontData, 'arial-texture');

        console.log('Old approach font created:', this.manualFont.face);

        // ============================================================
        // NEW APPROACH: Single function call (clean!)
        // ============================================================

        console.log('NEW APPROACH: Using getMSDFFont()...');

        const autoFont = getMSDFFont(this, 'arial-new');

        console.log('New approach font loaded:', autoFont?.face);

        // ============================================================
        // Side-by-side comparison UI
        // ============================================================

        let yPos = 80;

        // Left side: Old approach
        this.add.text(40, yPos, 'OLD APPROACH', {
            fontSize: '20px',
            color: '#ff6b6b',
            fontStyle: 'bold'
        });

        yPos += 35;

        const oldCode = [
            '// In preload():',
            'loadMSDFShaders(this);',
            'this.load.image("key-tex", "path.png");',
            'this.load.json("key-data", "path.json");',
            '',
            '// In create():',
            'const json = this.cache.json.get("key-data");',
            'const data = parseMSDFFont(json, "Font");',
            'this.font = new MSDFFont(data, "key-tex");'
        ];

        for (const line of oldCode) {
            const text = this.add.text(40, yPos, line, {
                fontSize: '13px',
                color: line.startsWith('//') ? '#888888' : '#ffaaaa',
                fontFamily: 'Courier New, monospace'
            });
            yPos += 20;
        }

        yPos = 80;

        // Right side: New approach
        this.add.text(width / 2 + 40, yPos, 'NEW APPROACH', {
            fontSize: '20px',
            color: '#51cf66',
            fontStyle: 'bold'
        });

        yPos += 35;

        const newCode = [
            '// In preload():',
            'loadMSDFFont(this, "key", "path");',
            '',
            '',
            '',
            '// In create():',
            'const font = getMSDFFont(this, "key");',
            '',
            ''
        ];

        for (const line of newCode) {
            const text = this.add.text(width / 2 + 40, yPos, line, {
                fontSize: '13px',
                color: line.startsWith('//') ? '#888888' : '#aaffaa',
                fontFamily: 'Courier New, monospace'
            });
            yPos += 20;
        }

        // Divider line
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0x333333);
        graphics.lineBetween(width / 2, 100, width / 2, height - 250);

        // ============================================================
        // Render text with both fonts to prove they work
        // ============================================================

        yPos = height - 220;

        this.add.text(width / 2, yPos, 'Both approaches produce identical results:', {
            fontSize: '16px',
            color: '#888888',
            align: 'center',
            origin: { x: 0.5, y: 0 }
        });

        yPos += 35;

        // Old approach text
        if (this.manualFont) {
            const oldText = new MSDFText(
                this,
                width / 4,
                yPos,
                this.manualFont,
                'Old API',
                42
            );
            oldText.setColorHex('#ff6b6b').setAlign('center');
        }

        // New approach text
        if (autoFont) {
            const newText = new MSDFText(this, (width / 4) * 3, yPos, autoFont, 'New API', 42);
            newText.setColorHex('#51cf66').setAlign('center');
        }

        yPos += 60;

        // ============================================================
        // Benefits list
        // ============================================================

        this.add.text(width / 2, yPos, 'Benefits of New API:', {
            fontSize: '18px',
            color: '#00aaff',
            fontStyle: 'bold',
            align: 'center',
            origin: { x: 0.5, y: 0 }
        });

        yPos += 35;

        const benefits = [
            '✓ 75% less code in preload()',
            '✓ 66% less code in create()',
            '✓ Automatic caching & parsing',
            '✓ Built-in error handling'
        ];

        for (const benefit of benefits) {
            if (autoFont) {
                const benefitText = new MSDFText(
                    this,
                    width / 2,
                    yPos,
                    autoFont,
                    benefit,
                    20
                );
                benefitText.setColorHex('#ffd43b').setAlign('center');
                yPos += 28;
            }
        }

        console.log('=== LOADER COMPARISON COMPLETE ===');
    }
}
