# MSDF Font Rendering Implementation Plan for Phaser 4

## Overview

This document outlines the plan to implement MSDF (Multi-channel Signed Distance Field) font rendering in Phaser 4. MSDF fonts provide high-quality text rendering at any scale without pixelation, making them ideal for UI text, scalable interfaces, and responsive designs.

### What is MSDF?

MSDF fonts store distance-to-edge information across RGB channels in a texture atlas, rather than direct pixel values. This enables:
- **Sharp text at any scale** - No pixelation when scaling up or down
- **Memory efficient** - Single texture works for all font sizes
- **Smooth rendering** - Superior quality compared to traditional bitmap fonts
- **Preserves fine details** - Sharp corners and serifs maintained at all scales

### Reference Implementation

This implementation is inspired by the [Ceramic engine's MSDF implementation](https://github.com/ceramic-engine/ceramic), which is MIT licensed and provides a proven approach to MSDF rendering.

---

## 📊 Current Progress

**Last Updated:** October 21, 2024

### Completed ✅

#### Phase 1: Shader Implementation (Core Complete)
- ✅ MSDF Fragment Shader (`shaders/msdf/MSDFFont.frag`)
- ✅ MSDF Vertex Shader (`shaders/msdf/MSDFFont.vert`)
- ✅ TypeScript Helper Module (`src/MSDFShader.ts`)
  - `loadMSDFShaders()` - Preload helper
  - `createMSDFShaderConfig()` - Config factory
  - `MSDFShaderHelper` - State management class
- ✅ Basic Example (`examples/basic-msdf-shader-test.ts`)

#### Development Environment Setup
- ✅ Phaser 4 Beta installed (`npm i phaser@beta`)
- ✅ TypeScript configuration (`tsconfig.json`)
- ✅ Vite build tooling (`vite.config.ts`)
- ✅ Development server setup
- ✅ Project structure organized
- ✅ Documentation created:
  - `README.md` - Project overview
  - `DEVELOPMENT.md` - Setup & workflow guide
  - `CLAUDE.md` - Architecture notes

### Ready for Testing 🧪

#### Phase 1: Shader Testing (Ready to Run)
- ⏳ Test shader compilation and uniform binding
- ⏳ Verify GL_OES_standard_derivatives support

**What's Needed:**
- Generate MSDF font texture using `msdf-atlas-gen`
- Run `npm run dev` to test in browser

### Next Steps 📋

1. ✅ ~~Set up Phaser 4 test environment~~ - **DONE**
2. **Generate sample MSDF font** using msdf-atlas-gen tools
3. **Test shaders in browser** - Run `npm run dev`
4. **Phase 2: Data Structures** - Start implementing font parser and types
5. **Phase 3: Font & Text GameObjects** - Build MSDF text rendering

---

## Architecture Overview

### Core Components

1. **MSDFShader** - Custom shader for MSDF rendering
2. **MSDFFont** - Font data loader and manager
3. **MSDFText** - Text GameObject using MSDF fonts
4. **MSDFLoader** - Asset loader for .fnt and .png files
5. **Tool Integration** - Font generation tooling

### Data Flow

```
.ttf font → msdf-atlas-gen → .fnt + .png → Phaser Loader → MSDFFont → MSDFText → Rendered
```

---

## Phase 1: Shader Implementation

### 1.1 MSDF Fragment Shader

**File**: `src/renderer/webgl/shaders/msdf/MSDFFont.frag`

Key features based on Ceramic implementation:
```glsl
#extension GL_OES_standard_derivatives : enable
precision mediump float;

uniform sampler2D uTexture;
uniform vec2 uTexSize;      // Texture dimensions in pixels
uniform float uPxRange;     // Distance field range (typically 2-4)

varying vec2 vTexCoord;
varying vec4 vColor;

// Median function - the heart of MSDF
float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

void main() {
    vec2 msdfUnit = uPxRange / uTexSize;
    vec3 textureSample = texture2D(uTexture, vTexCoord).rgb;

    // Get signed distance from the three channels
    float sigDist = median(textureSample.r, textureSample.g, textureSample.b) - 0.5;

    // Scale by screen-space derivatives for proper anti-aliasing
    sigDist *= dot(msdfUnit, 0.5 / fwidth(vTexCoord));

    // Calculate opacity with smooth edges
    float opacity = clamp(sigDist + 0.5, 0.0, 1.0);

    // Blend with background (transparent)
    vec4 bgColor = vec4(0.0, 0.0, 0.0, 0.0);
    gl_FragColor = mix(bgColor, vColor, opacity);
}
```

**Implementation Notes:**
- Uses `fwidth()` for screen-space derivatives (requires GL_OES_standard_derivatives)
- The `median()` function extracts the signed distance from RGB channels
- `uPxRange` must match the value used during font generation
- `uTexSize` needed for proper scaling calculations

### 1.2 MSDF Vertex Shader

**File**: `src/renderer/webgl/shaders/msdf/MSDFFont.vert`

Standard vertex shader (can reuse Phaser's quad shader or create minimal version):
```glsl
attribute vec3 aPosition;
attribute vec2 aTexCoord;
attribute vec4 aColor;

varying vec2 vTexCoord;
varying vec4 vColor;

uniform mat4 uProjectionMatrix;
uniform mat4 uModelViewMatrix;

void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
    vTexCoord = aTexCoord;
    vColor = aColor;
}
```

### 1.3 Shader Integration

**File**: `src/renderer/webgl/shaders/MSDFShader.ts`

Create a Phaser 4 shader class:
```typescript
export class MSDFShader extends BaseShader {
    constructor() {
        super({
            name: 'MSDFShader',
            fragmentKey: 'MSDFFont.frag',
            vertexKey: 'MSDFFont.vert',
            setupUniforms: (setUniform, drawingContext, gameObject) => {
                const font = gameObject.font;
                setUniform('uPxRange', font.distanceRange);
                setUniform('uTexSize', [font.texture.width, font.texture.height]);
                setUniform('uTexture', 0);
            }
        });
    }
}
```

---

## Phase 2: Font Data Structures

### 2.1 MSDF Font Data Interface

**File**: `src/gameobjects/bitmaptext/MSDFTypes.ts`

```typescript
/**
 * Configuration data for distance field fonts
 */
export interface MSDFDistanceFieldData {
    /** Type of distance field: 'msdf' or 'sdf' */
    fieldType: 'msdf' | 'sdf';

    /** Distance range in pixels used during generation (typically 2-4) */
    distanceRange: number;
}

/**
 * Character definition in a bitmap font
 */
export interface MSDFCharacter {
    /** Unicode code point */
    id: number;

    /** Texture coordinates */
    x: number;
    y: number;
    width: number;
    height: number;

    /** Rendering offsets */
    xoffset: number;
    yoffset: number;

    /** Horizontal advance after rendering this character */
    xadvance: number;

    /** Texture page this character is on */
    page: number;
}

/**
 * Texture page in a multi-page font
 */
export interface MSDFPage {
    /** Page ID */
    id: number;

    /** Texture file path */
    file: string;
}

/**
 * Complete bitmap font data
 */
export interface MSDFBitmapFontData {
    /** Font face name */
    face: string;

    /** Font size at generation */
    pointSize: number;
    baseSize: number;

    /** Line height recommendation */
    lineHeight: number;

    /** Character map (codePoint -> character data) */
    chars: Map<number, MSDFCharacter>;

    /** Texture pages */
    pages: MSDFPage[];

    /** Kerning pairs: first char -> second char -> adjustment */
    kernings: Map<number, Map<number, number>>;

    /** Distance field configuration (null for regular bitmap fonts) */
    distanceField: MSDFDistanceFieldData | null;

    /** Whether to use smooth filtering */
    smooth: boolean;
}
```

### 2.2 MSDF Font Parser

**File**: `src/gameobjects/bitmaptext/MSDFFontParser.ts`

Parse BMFont format (.fnt files):
```typescript
export class MSDFFontParser {
    /**
     * Parses .fnt file content into structured data
     * Supports both plain text and XML formats
     */
    static parse(content: string): MSDFBitmapFontData {
        // Detect XML vs text format
        const isXML = content.trim().startsWith('<');

        if (isXML) {
            return this.parseXML(content);
        } else {
            return this.parseText(content);
        }
    }

    private static parseText(content: string): MSDFBitmapFontData {
        const lines = content.split('\n');
        const data: Partial<MSDFBitmapFontData> = {
            chars: new Map(),
            pages: [],
            kernings: new Map(),
            smooth: true
        };

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('info')) {
                // Parse: info face="RobotoMedium" size=42 ...
                data.face = this.extractValue(trimmed, 'face');
                data.pointSize = parseFloat(this.extractValue(trimmed, 'size'));
            }
            else if (trimmed.startsWith('common')) {
                // Parse: common lineHeight=44 base=32 ...
                data.lineHeight = parseFloat(this.extractValue(trimmed, 'lineHeight'));
                data.baseSize = parseFloat(this.extractValue(trimmed, 'base'));
            }
            else if (trimmed.startsWith('distanceField')) {
                // Parse: distanceField fieldType=msdf distanceRange=4
                data.distanceField = {
                    fieldType: this.extractValue(trimmed, 'fieldType') as 'msdf',
                    distanceRange: parseFloat(this.extractValue(trimmed, 'distanceRange'))
                };
            }
            else if (trimmed.startsWith('page ')) {
                // Parse: page id=0 file="RobotoMedium.png"
                data.pages.push({
                    id: parseInt(this.extractValue(trimmed, 'id')),
                    file: this.extractValue(trimmed, 'file')
                });
            }
            else if (trimmed.startsWith('char ')) {
                // Parse character data
                const char = this.parseCharacter(trimmed);
                data.chars.set(char.id, char);
            }
            else if (trimmed.startsWith('kerning ')) {
                // Parse: kerning first=65 second=86 amount=-2
                this.parseKerning(trimmed, data.kernings);
            }
        }

        return data as MSDFBitmapFontData;
    }

    private static extractValue(line: string, key: string): string {
        // Handle both quoted and unquoted values
        const regex = new RegExp(`${key}=(?:"([^"]*)"|([^\\s]+))`);
        const match = line.match(regex);
        return match ? (match[1] || match[2]) : '';
    }

    // Additional helper methods...
}
```

---

## Phase 3: MSDF Font GameObject

### 3.1 MSDFFont Class

**File**: `src/gameobjects/bitmaptext/MSDFFont.ts`

```typescript
export class MSDFFont {
    public data: MSDFBitmapFontData;
    public textures: Map<number, Texture>;
    public shader: MSDFShader | null;

    constructor(data: MSDFBitmapFontData, textures: Map<number, Texture>) {
        this.data = data;
        this.textures = textures;

        // Create MSDF shader if this is a distance field font
        if (this.isMSDF) {
            this.shader = new MSDFShader();
        }

        // Set proper texture filtering
        this.configureTextures();
    }

    get isMSDF(): boolean {
        return this.data.distanceField?.fieldType === 'msdf';
    }

    get distanceRange(): number {
        return this.data.distanceField?.distanceRange ?? 4;
    }

    private configureTextures(): void {
        // MSDF fonts MUST use LINEAR filtering
        const filter = (this.data.smooth || this.isMSDF)
            ? FilterMode.LINEAR
            : FilterMode.NEAREST;

        for (const texture of this.textures.values()) {
            texture.setFilter(filter);
        }
    }

    getCharacter(charCode: number): MSDFCharacter | undefined {
        return this.data.chars.get(charCode);
    }

    getKerning(first: number, second: number): number {
        return this.data.kernings.get(first)?.get(second) ?? 0;
    }
}
```

### 3.2 MSDFText GameObject

**File**: `src/gameobjects/bitmaptext/MSDFText.ts`

```typescript
export class MSDFText extends GameObject {
    private font: MSDFFont;
    private _text: string = '';
    private _fontSize: number = 32;
    private glyphQuads: Quad[] = [];

    constructor(scene: Scene, x: number, y: number, font: MSDFFont, text: string = '') {
        super(scene, 'MSDFText');

        this.font = font;
        this.setPosition(x, y);
        this.setText(text);
    }

    setText(text: string): this {
        this._text = text;
        this.updateGlyphs();
        return this;
    }

    setFontSize(size: number): this {
        this._fontSize = size;
        this.updateGlyphs();
        return this;
    }

    private updateGlyphs(): void {
        // Clear existing quads
        this.glyphQuads.forEach(quad => quad.destroy());
        this.glyphQuads = [];

        const scale = this._fontSize / this.font.data.baseSize;
        let cursorX = 0;
        let cursorY = 0;
        let prevCharCode = 0;

        for (let i = 0; i < this._text.length; i++) {
            const charCode = this._text.charCodeAt(i);
            const char = this.font.getCharacter(charCode);

            if (!char) continue;

            // Apply kerning
            if (prevCharCode) {
                cursorX += this.font.getKerning(prevCharCode, charCode) * scale;
            }

            // Create quad for this character
            const quad = this.createGlyphQuad(char, cursorX, cursorY, scale);
            this.glyphQuads.push(quad);

            // Advance cursor
            cursorX += char.xadvance * scale;
            prevCharCode = charCode;
        }
    }

    private createGlyphQuad(char: MSDFCharacter, x: number, y: number, scale: number): Quad {
        const texture = this.font.textures.get(char.page);
        const quad = new Quad();

        quad.texture = texture;
        quad.shader = this.font.shader;

        // Set position and size
        quad.x = x + (char.xoffset * scale);
        quad.y = y + (char.yoffset * scale);
        quad.width = char.width * scale;
        quad.height = char.height * scale;

        // Set texture coordinates
        quad.setFrame(char.x, char.y, char.width, char.height);

        return quad;
    }
}
```

---

## Phase 4: Loader Integration

### 4.1 MSDF Font Loader

**File**: `src/loader/filetypes/MSDFFile.ts`

```typescript
export class MSDFFile extends MultiFile {
    constructor(loader: Loader, key: string, fntURL: string, textureURL: string | string[]) {
        const files = [
            new TextFile(loader, {
                key: key,
                url: fntURL
            })
        ];

        // Support multiple texture pages
        const urls = Array.isArray(textureURL) ? textureURL : [textureURL];
        urls.forEach((url, index) => {
            files.push(new ImageFile(loader, {
                key: `${key}_page${index}`,
                url: url
            }));
        });

        super(loader, 'msdf', key, files);
    }

    onProcess(): void {
        this.state = FILE_PROCESSING;

        // Get the .fnt file content
        const fntFile = this.files[0] as TextFile;
        const fontData = MSDFFontParser.parse(fntFile.data);

        // Get texture pages
        const textures = new Map<number, Texture>();
        for (let i = 1; i < this.files.length; i++) {
            const imgFile = this.files[i] as ImageFile;
            textures.set(i - 1, imgFile.data);
        }

        // Create MSDFFont instance
        this.data = new MSDFFont(fontData, textures);

        this.onProcessComplete();
    }
}

// Loader plugin method
export function msdf(
    this: LoaderPlugin,
    key: string,
    fntURL: string,
    textureURL: string | string[]
): LoaderPlugin {
    this.addFile(new MSDFFile(this, key, fntURL, textureURL));
    return this;
}
```

### 4.2 Scene Integration

Usage in game code:
```typescript
class MyScene extends Scene {
    preload() {
        this.load.msdf('roboto', 'assets/fonts/RobotoMedium.fnt', 'assets/fonts/RobotoMedium.png');
    }

    create() {
        const font = this.cache.msdf.get('roboto');
        const text = new MSDFText(this, 400, 300, font, 'Hello MSDF!');
        text.setFontSize(64);
        this.add.existing(text);
    }
}
```

---

## Phase 5: Font Generation Tooling

### 5.1 msdf-atlas-gen Integration

**Tool**: `msdf-atlas-gen` (already available in ceramic/git/msdf-atlas-gen-binary)

Binary locations:
- Windows: `ceramic/git/msdf-atlas-gen-binary/windows/msdf-atlas-gen.exe`
- macOS: `ceramic/git/msdf-atlas-gen-binary/mac/msdf-atlas-gen`
- Linux x86_64: `ceramic/git/msdf-atlas-gen-binary/linux-x86_64/msdf-atlas-gen`
- Linux ARM64: `ceramic/git/msdf-atlas-gen-binary/linux-arm64/msdf-atlas-gen`

### 5.2 Font Generation Script

**File**: `tools/generate-msdf-font.js`

```javascript
const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

function getMSDFGenBinary() {
    const platform = os.platform();
    const arch = os.arch();

    if (platform === 'win32') {
        return 'ceramic/git/msdf-atlas-gen-binary/windows/msdf-atlas-gen.exe';
    } else if (platform === 'darwin') {
        return 'ceramic/git/msdf-atlas-gen-binary/mac/msdf-atlas-gen';
    } else if (platform === 'linux') {
        return arch === 'arm64'
            ? 'ceramic/git/msdf-atlas-gen-binary/linux-arm64/msdf-atlas-gen'
            : 'ceramic/git/msdf-atlas-gen-binary/linux-x86_64/msdf-atlas-gen';
    }

    throw new Error(`Unsupported platform: ${platform}`);
}

function generateMSDFFont(options) {
    const {
        fontPath,        // Input TTF/OTF file
        outputName,      // Output name (without extension)
        fontSize = 42,   // Font size
        distanceRange = 4, // MSDF distance range (2-8, typically 4)
        charset = '[32,126]', // ASCII printable characters
        type = 'msdf'    // 'msdf' or 'sdf'
    } = options;

    const binary = getMSDFGenBinary();
    const pngOutput = `${outputName}.png`;
    const fntOutput = `${outputName}.fnt`;

    const cmd = [
        binary,
        `-font "${fontPath}"`,
        `-size ${fontSize}`,
        `-pxrange ${distanceRange}`,
        `-type ${type}`,
        `-chars '${charset}'`,
        `-potr`, // Power-of-two texture size with padding
        `-yorigin top`, // Top-down Y axis (Phaser convention)
        `-format png`,
        `-imageout "${pngOutput}"`,
        `-format fnt`, // BMFont text format
        `-fontout "${fntOutput}"`
    ].join(' ');

    console.log(`Generating MSDF font: ${outputName}`);
    console.log(`Command: ${cmd}`);

    execSync(cmd, { stdio: 'inherit' });

    console.log(`✓ Generated: ${pngOutput}`);
    console.log(`✓ Generated: ${fntOutput}`);
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log('Usage: node generate-msdf-font.js <font.ttf> <output-name> [options]');
        console.log('Options:');
        console.log('  --size <num>    Font size (default: 42)');
        console.log('  --range <num>   Distance range (default: 4)');
        console.log('  --chars <range> Character range (default: [32,126])');
        process.exit(1);
    }

    generateMSDFFont({
        fontPath: args[0],
        outputName: args[1],
        fontSize: parseInt(args.find(a => a.startsWith('--size'))?.split('=')[1]) || 42,
        distanceRange: parseInt(args.find(a => a.startsWith('--range'))?.split('=')[1]) || 4,
        charset: args.find(a => a.startsWith('--chars'))?.split('=')[1] || '[32,126]'
    });
}

module.exports = { generateMSDFFont };
```

### 5.3 Example Usage

```bash
# Generate MSDF font from TTF
node tools/generate-msdf-font.js fonts/Roboto-Regular.ttf assets/fonts/RobotoMSDf --size=42 --range=4

# This creates:
# - assets/fonts/RobotoMSDF.png (texture atlas)
# - assets/fonts/RobotoMSDF.fnt (font descriptor)
```

---

## Phase 6: Testing & Examples

### 6.1 Basic Test Scene

**File**: `examples/msdf/basic-text.ts`

```typescript
class BasicMSDFTest extends Scene {
    preload() {
        this.load.msdf('roboto', 'assets/fonts/RobotoMedium.fnt', 'assets/fonts/RobotoMedium.png');
    }

    create() {
        const font = this.cache.msdf.get('roboto');

        // Test 1: Small text
        const small = new MSDFText(this, 100, 100, font, 'Small Text (16px)');
        small.setFontSize(16);
        this.add.existing(small);

        // Test 2: Medium text
        const medium = new MSDFText(this, 100, 200, font, 'Medium Text (32px)');
        medium.setFontSize(32);
        this.add.existing(medium);

        // Test 3: Large text
        const large = new MSDFText(this, 100, 300, font, 'Large Text (64px)');
        large.setFontSize(64);
        this.add.existing(large);

        // Test 4: Very large text
        const huge = new MSDFText(this, 100, 450, font, 'Huge! (128px)');
        huge.setFontSize(128);
        this.add.existing(huge);
    }
}
```

### 6.2 Scaling Test

**File**: `examples/msdf/scaling-test.ts`

```typescript
class ScalingTest extends Scene {
    private text: MSDFText;
    private scale: number = 1;
    private scaleDirection: number = 1;

    create() {
        const font = this.cache.msdf.get('roboto');
        this.text = new MSDFText(this, 400, 300, font, 'Watch me scale!');
        this.text.setFontSize(32);
        this.add.existing(this.text);
    }

    update() {
        // Animate scale from 0.5 to 3.0
        this.scale += this.scaleDirection * 0.01;

        if (this.scale >= 3) this.scaleDirection = -1;
        if (this.scale <= 0.5) this.scaleDirection = 1;

        this.text.setScale(this.scale);
    }
}
```

### 6.3 Comparison Test

Compare MSDF vs regular bitmap font:
```typescript
class ComparisonTest extends Scene {
    create() {
        const msdfFont = this.cache.msdf.get('roboto-msdf');
        const bitmapFont = this.cache.bitmapFont.get('roboto-bitmap');

        // MSDF version
        const msdfText = new MSDFText(this, 100, 100, msdfFont, 'MSDF Font');
        msdfText.setFontSize(64);
        this.add.existing(msdfText);

        // Regular bitmap version (same size)
        const bitmapText = this.add.bitmapText(100, 200, bitmapFont, 'Bitmap Font', 64);

        // Scale both to 2x - MSDF should remain sharp!
        this.tweens.add({
            targets: [msdfText, bitmapText],
            scale: 2,
            duration: 2000,
            yoyo: true,
            repeat: -1
        });
    }
}
```

### 6.4 Kerning & Layout Test

```typescript
class LayoutTest extends Scene {
    create() {
        const font = this.cache.msdf.get('roboto');

        // Test kerning pairs
        const kerningPairs = ['AV', 'To', 'We', 'Ya'];
        let y = 100;

        for (const pair of kerningPairs) {
            const text = new MSDFText(this, 100, y, font, pair);
            text.setFontSize(48);
            this.add.existing(text);
            y += 80;
        }

        // Test multiline (future feature)
        const multiline = new MSDFText(this, 400, 100, font,
            'Line 1\nLine 2\nLine 3');
        multiline.setFontSize(24);
        this.add.existing(multiline);
    }
}
```

---

## Implementation Checklist

### Phase 1: Shaders ✓
- [x] Create `MSDFFont.frag` fragment shader - **COMPLETED** (shaders/msdf/MSDFFont.frag)
- [x] Create `MSDFFont.vert` vertex shader - **COMPLETED** (shaders/msdf/MSDFFont.vert)
- [x] Implement `MSDFShader` TypeScript class - **COMPLETED** (src/MSDFShader.ts)
- [ ] Test shader compilation and uniform binding - **TODO**: Requires Phaser 4 setup
- [ ] Verify derivative support (GL_OES_standard_derivatives) - **TODO**: Requires WebGL testing

**Phase 1 Notes:**
- Shaders adapted from Ceramic reference to Phaser 4 conventions
- Fragment shader uses `outTexCoord` and `outColor` varyings (Phaser 4 style)
- Uniforms: `iChannel0` (texture), `uTexSize` (vec2), `uPxRange` (float)
- Helper functions created: `loadMSDFShaders()`, `createMSDFShaderConfig()`
- Example file created: examples/basic-msdf-shader-test.ts

### Phase 2: Data Structures ✓
- [ ] Define TypeScript interfaces (`MSDFTypes.ts`)
- [ ] Implement `MSDFFontParser` for .fnt files
  - [ ] Plain text format support
  - [ ] XML format support
  - [ ] distanceField line parsing
- [ ] Add character data parsing
- [ ] Add kerning data parsing
- [ ] Test parser with sample .fnt files

### Phase 3: Font & Text GameObjects ✓
- [ ] Implement `MSDFFont` class
  - [ ] Texture management
  - [ ] Shader instantiation
  - [ ] Texture filtering configuration
- [ ] Implement `MSDFText` GameObject
  - [ ] Text rendering
  - [ ] Glyph quad generation
  - [ ] Font size scaling
  - [ ] Kerning support
- [ ] Test basic rendering

### Phase 4: Loader Integration ✓
- [ ] Create `MSDFFile` multi-file loader
- [ ] Implement loader plugin (`load.msdf()`)
- [ ] Add cache integration
- [ ] Test asset loading pipeline
- [ ] Support multi-page fonts

### Phase 5: Tooling ✓
- [ ] Copy `msdf-atlas-gen` binaries
- [ ] Create font generation script
- [ ] Test font generation on all platforms
- [ ] Document generation workflow
- [ ] Create example fonts for testing

### Phase 6: Testing ✓
- [ ] Create basic text example
- [ ] Create scaling test
- [ ] Create comparison test (MSDF vs bitmap)
- [ ] Create kerning test
- [ ] Performance testing
- [ ] Multi-page font testing

### Phase 7: Documentation
- [ ] API documentation
- [ ] Usage guide
- [ ] Font generation guide
- [ ] Migration guide (from BitmapText)
- [ ] Performance best practices

### Phase 8: Polish
- [ ] Color tinting support
- [ ] Text alignment (left, center, right)
- [ ] Vertical alignment
- [ ] Word wrapping
- [ ] Line height adjustment
- [ ] Letter spacing
- [ ] Drop shadows / outlines (advanced)
- [ ] Batch rendering optimization

---

## File Structure

```
phaser4/
├── src/
│   ├── gameobjects/
│   │   └── bitmaptext/
│   │       ├── MSDFFont.ts
│   │       ├── MSDFText.ts
│   │       ├── MSDFFontParser.ts
│   │       └── MSDFTypes.ts
│   ├── loader/
│   │   └── filetypes/
│   │       └── MSDFFile.ts
│   └── renderer/
│       └── webgl/
│           └── shaders/
│               └── msdf/
│                   ├── MSDFFont.frag
│                   ├── MSDFFont.vert
│                   └── MSDFShader.ts
├── tools/
│   ├── generate-msdf-font.js
│   └── msdf-atlas-gen/  (binaries copied from Ceramic)
│       ├── windows/
│       ├── mac/
│       └── linux/
├── examples/
│   └── msdf/
│       ├── basic-text.ts
│       ├── scaling-test.ts
│       ├── comparison-test.ts
│       └── kerning-test.ts
└── assets/
    └── fonts/
        ├── RobotoMedium.fnt
        ├── RobotoMedium.png
        └── ... (test fonts)
```

---

## Technical Considerations

### Shader Compatibility
- **Desktop**: GL_OES_standard_derivatives widely supported
- **Mobile**: Check for extension support, fallback to simpler shader if needed
- **WebGL 2**: Built-in derivative support

### Performance
- MSDF fonts use stand-alone rendering (one draw call per text object)
- Consider implementing batch rendering for many small texts
- Pre-rendered size caching for common sizes (future optimization)

### Quality Settings
- `distanceRange`: Higher = smoother, lower = sharper (2-8 typical, 4 recommended)
- `pxRange` must match between generation and runtime
- LINEAR filtering is mandatory for MSDF

### Browser Compatibility
- Requires WebGL support (Phaser 4 baseline)
- `fwidth()` requires derivative support (nearly universal)
- Fallback: Regular bitmap font rendering

---

## References

- **Ceramic Engine**: https://github.com/ceramic-engine/ceramic (MIT License)
- **msdf-atlas-gen**: https://github.com/Chlumsky/msdf-atlas-gen
- **MSDF Technique**: https://github.com/Chlumsky/msdfgen
- **Phaser 4 Shader Guide**: See `Phaser 4 Shader Guide.md` in this repository

---

## Success Criteria

✓ **Functional Requirements**
- Load and parse .fnt files with distance field data
- Render MSDF fonts with custom shader
- Support scaling without quality loss
- Implement kerning
- Support multi-page fonts

✓ **Quality Requirements**
- Sharp rendering at all scales (0.5x to 4x+)
- Smooth anti-aliasing
- Proper color tinting
- Consistent metrics with BitmapText

✓ **Performance Requirements**
- Comparable or better than BitmapText
- Minimal draw calls
- Efficient glyph quad generation

✓ **Developer Experience**
- Simple API: `this.load.msdf()` and `new MSDFText()`
- Easy font generation workflow
- Good documentation and examples
- TypeScript type safety

---

## Future Enhancements

- **Effects**: Drop shadows, outlines, glows using shader variants
- **Multi-color fonts**: Support colored glyphs
- **Emoji support**: Fallback to bitmap for emoji characters
- **Dynamic text updates**: Optimize for changing text
- **Text metrics API**: getBounds(), hitTest(), etc.
- **Rich text**: Inline color/size changes
- **Localization**: Unicode support, RTL text
- **Accessibility**: Screen reader integration

---

*This plan provides a comprehensive roadmap for implementing MSDF font rendering in Phaser 4, based on the proven approach from the Ceramic engine.*
