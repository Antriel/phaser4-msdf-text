/**
 * Ultra Minimal - No helper functions, raw Phaser API
 */

import Phaser from 'phaser';

export class UltraMinimal extends Phaser.Scene {
    constructor() {
        super({ key: 'UltraMinimal' });
    }

    preload() {
        this.load.glsl('msdf-frag', 'shaders/MSDFFont.frag');
        this.load.glsl('debug-frag', 'shaders/DebugUV.frag');
        this.load.image('atlas', 'assets/fonts/Arial.png');
    }

    create() {
        const width = this.scale.width;
        const height = this.scale.height;

        console.log('=== ULTRA MINIMAL TEST ===');

        this.add.rectangle(width / 2, height / 2, width, height, 0x000000);

        this.add.text(20, 20, 'Ultra Minimal - Raw Phaser Shader API', {
            fontSize: '24px',
            color: '#00ff00'
        });

        // Test 1: Full atlas (should work)
        console.log('Creating full atlas shader...');

        const fullAtlasShader = this.add.shader({
            name: 'FullAtlas',
            fragmentKey: 'msdf-frag',

            setupUniforms: (setUniform: any) => {
                setUniform('iChannel0', 0);
                setUniform('uTexSize', [512, 256]);
                setUniform('uPxRange', 4);
                setUniform('uTextColor', [1, 1, 1, 1]);
                setUniform('uCharUV', [0, 0, 1, 1]); // Full texture
                console.log('Full atlas uniforms set');
            }
        }, 200, 200, 400, 200, ['atlas']);

        console.log('Full atlas shader:', fullAtlasShader);

        this.add.text(20, 50, 'Full Atlas (white, should show all characters)', {
            fontSize: '14px',
            color: '#ffffff'
        });

        // Test 2: Character 'A' with DEBUG shader (FLIPPED V)
        console.log('Creating character A DEBUG shader...');

        const v0_debug = 1 - 0.138671875;
        const v1_debug = 1 - 0.001953125;

        const charADebug = this.add.shader({
            name: 'CharADebug',
            fragmentKey: 'debug-frag',

            setupUniforms: (setUniform: any) => {
                setUniform('iChannel0', 0);
                setUniform('uTexSize', [512, 256]);
                setUniform('uPxRange', 4);
                setUniform('uTextColor', [1, 0, 0, 1]);
                setUniform('uCharUV', [0.9345703125, v0_debug, 0.9990234375, v1_debug]); // FLIPPED V
            }
        }, 650, 200, 150, 150, ['atlas']);

        this.add.text(580, 50, 'Letter A Debug (shows UVs + texture)', {
            fontSize: '14px',
            color: '#ffff00'
        });

        // Test 3: Character 'A' with FLIPPED V coords
        console.log('Creating character A with FLIPPED V...');

        const v0_flipped = 1 - 0.138671875;
        const v1_flipped = 1 - 0.001953125;

        const charAFlipped = this.add.shader({
            name: 'CharAFlipped',
            fragmentKey: 'msdf-frag',

            setupUniforms: (setUniform: any) => {
                setUniform('iChannel0', 0);
                setUniform('uTexSize', [512, 256]);
                setUniform('uPxRange', 4);
                setUniform('uTextColor', [0, 1, 0, 1]); // GREEN
                setUniform('uCharUV', [0.9345703125, v0_flipped, 0.9990234375, v1_flipped]); // Flipped V
                console.log('Char A FLIPPED uniforms set');
            }
        }, 850, 200, 150, 150, ['atlas']);

        console.log('Char A flipped shader:', charAFlipped);

        this.add.text(780, 50, 'Letter A Flipped V (green)', {
            fontSize: '14px',
            color: '#00ff00'
        });

        console.log('=== SCENE COMPLETE ===');
    }
}
