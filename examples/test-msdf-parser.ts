/**
 * Test MSDF Font Parser
 *
 * This example tests the MSDF JSON parser by loading Arial.json
 * and displaying the parsed font data.
 */

import { parseMSDFFont, MSDFFontJSON, MSDFFontData } from '../src/MSDFFontParser';

async function testParser() {
    console.log('='.repeat(60));
    console.log('MSDF Font Parser Test');
    console.log('='.repeat(60));

    try {
        // Load the Arial.json file
        const response = await fetch('/assets/fonts/Arial.json');
        const json: MSDFFontJSON = await response.json();

        console.log('\n📄 Loaded JSON:');
        console.log(`  - Type: ${json.atlas.type}`);
        console.log(`  - Distance Range: ${json.atlas.distanceRange}`);
        console.log(`  - Atlas Size: ${json.atlas.width}x${json.atlas.height}`);
        console.log(`  - Font Size: ${json.atlas.size}`);
        console.log(`  - Y Origin: ${json.atlas.yOrigin}`);
        console.log(`  - Glyphs: ${json.glyphs.length}`);
        console.log(`  - Kerning Pairs: ${json.kerning?.length || 0}`);

        // Parse the font
        const fontData: MSDFFontData = parseMSDFFont(json, 'Arial');

        console.log('\n✅ Parsed Font Data:');
        console.log(`  - Face: ${fontData.face}`);
        console.log(`  - Point Size: ${fontData.pointSize}`);
        console.log(`  - Line Height: ${fontData.lineHeight.toFixed(4)}`);
        console.log(`  - Ascender: ${fontData.ascender.toFixed(4)}`);
        console.log(`  - Descender: ${fontData.descender.toFixed(4)}`);
        console.log(`  - Characters: ${fontData.chars.size}`);
        console.log(`  - Distance Field Type: ${fontData.distanceField.fieldType}`);
        console.log(`  - Distance Range: ${fontData.distanceField.distanceRange}`);

        // Test specific characters
        console.log('\n🔤 Sample Characters:');

        const testChars = [
            { code: 65, char: 'A' },
            { code: 97, char: 'a' },
            { code: 32, char: 'space' },
            { code: 33, char: '!' }
        ];

        for (const { code, char } of testChars) {
            const charData = fontData.chars.get(code);
            if (charData) {
                console.log(`\n  ${char} (U+${code.toString(16).toUpperCase().padStart(4, '0')}):`);
                console.log(`    - Size: ${charData.width.toFixed(1)}x${charData.height.toFixed(1)}px`);
                console.log(`    - Offset: (${charData.xOffset.toFixed(3)}, ${charData.yOffset.toFixed(3)})`);
                console.log(`    - Advance: ${charData.xAdvance.toFixed(4)}`);
                console.log(`    - UVs: (${charData.u0.toFixed(3)}, ${charData.v0.toFixed(3)}) → (${charData.u1.toFixed(3)}, ${charData.v1.toFixed(3)})`);
                console.log(`    - Kerning pairs: ${charData.kerning.size}`);
            } else {
                console.log(`\n  ${char}: NOT FOUND`);
            }
        }

        // Test kerning
        console.log('\n🔗 Sample Kerning Pairs:');
        const charA = fontData.chars.get(65); // 'A'
        if (charA && charA.kerning.size > 0) {
            let count = 0;
            for (const [secondCode, amount] of charA.kerning) {
                const secondChar = String.fromCharCode(secondCode);
                console.log(`  A + ${secondChar}: ${amount.toFixed(4)}`);
                count++;
                if (count >= 5) break; // Show first 5
            }
        }

        // Memory usage estimate
        const estimatedBytes = fontData.chars.size * 100; // Rough estimate
        console.log(`\n💾 Estimated Memory: ~${(estimatedBytes / 1024).toFixed(2)} KB`);

        console.log('\n' + '='.repeat(60));
        console.log('✅ Parser test completed successfully!');
        console.log('='.repeat(60));

        // Store in window for debugging
        (window as any).fontData = fontData;
        console.log('\n💡 Font data available at: window.fontData');

    } catch (error) {
        console.error('\n❌ Parser test failed:');
        console.error(error);
    }
}

// Auto-run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', testParser);
} else {
    testParser();
}

export { testParser };
