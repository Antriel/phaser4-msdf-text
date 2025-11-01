# Phaser 4 MSDF Font Rendering

High-quality scalable text rendering for Phaser 4 using Multi-channel Signed Distance Fields (MSDF).

## 🎯 Project Status

**Phase 1: Shader Implementation** - ✅ **COMPLETE!**

- ✅ MSDF Fragment Shader with premultiplied alpha
- ✅ Simplified approach (no derivatives required)
- ✅ TypeScript Helper Module
- ✅ Working test rendering full MSDF atlas
- ✅ Character-specific UV mapping

**Phase 2: MSDFText GameObject** - ✅ **COMPLETE!**

- ✅ JSON parser for msdf-atlas-gen format
- ✅ MSDFFont class (data management)
- ✅ MSDFText GameObject (text renderer)
- ✅ Character-by-character rendering with MSDF shaders
- ✅ Text layout with advance, kerning, and alignment
- ✅ Multiple font sizes and colors
- ✅ V-coordinate flipping for Phaser's texture system

**Phase 3: Loader Integration** - ✅ **COMPLETE!**

- ✅ Simplified loader API (`loadMSDFFont()` and `getMSDFFont()`)
- ✅ Automatic JSON + PNG loading
- ✅ Font caching and parsing
- ✅ Built-in error handling

**Phase 4: Batching Optimization** - ✅ **COMPLETE!**

- ✅ Custom MSDFBatchHandler (RenderNode system)
- ✅ Batched character rendering (1-2 draw calls per text)
- ✅ 5-10x performance improvement
- ✅ 100% API compatibility with Phase 3
- ✅ MSDFTextBatched GameObject

**Phase 5: Advanced Features** - 🚧 **IN PROGRESS**

- ✅ **Phase 5.1: Word Wrapping** - COMPLETE!
  - Automatic word wrapping with `setMaxWidth()`
  - Configurable wrap character
  - Detailed text bounds with line information
- ✅ **Phase 5.2: Per-Letter Callbacks** - COMPLETE!
  - Display callbacks for per-character effects
  - Dynamic position, scale, rotation, and tint
  - Wave, rainbow, breathing, jiggle, and spin effects
- ✅ **Phase 5.4: Text Effects** - COMPLETE!
  - Shader-based outline (single-pass, no extra draw calls)
  - Shadow effects (two-pass rendering, callback-aware)
  - Dynamic width, offset, color, and alpha control
  - Background fade prevention for clean rendering
- 🚧 **Phase 5.3: Multi-Color Text** - Planned
  - Per-character color arrays
  - Integration with callback system
- 🚧 **Phase 5.5: Character Queries** - Planned
  - Hit testing and character position queries

## 📁 Project Structure

```
phaser4-msdf-font/
├── README.md                          # This file
├── CLAUDE.md                          # Project context and architecture notes
├── DEVELOPMENT.md                     # Development workflow
├── FONTS.md                           # Font generation guide
├── PHASE-4-MIGRATION-GUIDE.md         # Migration guide for batched rendering
├── Phaser 4 Shader Guide.md           # Phaser 4 shader reference
├── docs/
│   └── archive/                       # Archived working documents
├── ceramic/                           # Git submodule - Ceramic engine reference
│   └── git/msdf-atlas-gen-binary/    # Font generation tools
├── shaders/
│   └── msdf/
│       ├── MSDFFont.frag             # MSDF fragment shader (GLSL)
│       └── MSDFFont.vert             # MSDF vertex shader (GLSL)
├── src/
│   ├── MSDFShader.ts                 # TypeScript helpers for MSDF shaders
│   ├── MSDFFontParser.ts             # JSON parser for msdf-atlas-gen format
│   ├── MSDFFont.ts                   # Font data management class
│   ├── MSDFText.ts                   # Text rendering GameObject (Phase 3)
│   ├── MSDFTextBatched.ts            # Batched text rendering (Phase 4)
│   └── MSDFLoader.ts                 # Simplified loader API
└── examples/
    ├── batched-test.ts               # Batched rendering example
    ├── loader-test.ts                # Loader API example
    └── msdf-text-test.ts             # Full text rendering example
```

## 🚀 Quick Start

### Installation & Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The dev server will open at http://localhost:3000 with the MSDF shader test scene.

**Test the complete system:**
- http://localhost:3000/batched-test.html - Phase 4 batched rendering (best performance)
- http://localhost:3000/word-wrap-test.html - **NEW!** Phase 5.1 word wrapping
- http://localhost:3000/callback-effects-test.html - **NEW!** Phase 5.2 display callbacks
- http://localhost:3000/loader-test.html - Phase 3 simplified loader API
- http://localhost:3000/test-msdf-text.html - Phase 2 full text rendering demo

### Using MSDFText (Batched Rendering - Phase 4)

**Recommended approach** - uses batched rendering for best performance:

```typescript
import { registerMSDFBatchHandler } from './src/registerMSDFBatchHandler';
import { loadMSDFFont, getMSDFFont } from './src/MSDFLoader';
import { MSDFText } from './src/MSDFTextBatched';  // Batched version

// Register batch handler once after game creation
const game = new Phaser.Game({ type: Phaser.WEBGL, /* config */ });
registerMSDFBatchHandler(game);

class MyScene extends Phaser.Scene {
    preload() {
        // Load MSDF font (same as Phase 3)
        loadMSDFFont(this, 'arial', 'assets/fonts/Arial');
    }

    create() {
        const font = getMSDFFont(this, 'arial');

        // Create text - now with batched rendering!
        const text = new MSDFText(this, 100, 100, font, 'Hello World!', 48);
        text.setColorHex('#ffffff');
        text.setAlign('center');

        // Performance: 1-2 draw calls instead of N draw calls!
    }
}
```

**See [PHASE-4-MIGRATION-GUIDE.md](PHASE-4-MIGRATION-GUIDE.md) for migration instructions.**

<details>
<summary><b>Phase 3: Container-based (Legacy)</b></summary>

**Old approach** - simpler but slower:

```typescript
import { loadMSDFFont, getMSDFFont } from './src/MSDFLoader';
import { MSDFText } from './src/MSDFText';  // Phase 3 version

class MyScene extends Phaser.Scene {
    preload() {
        loadMSDFFont(this, 'arial', 'assets/fonts/Arial');
    }

    create() {
        const font = getMSDFFont(this, 'arial');
        const text = new MSDFText(this, 100, 100, font, 'Hello World!', 48);
        text.setColorHex('#ffffff');
        text.setAlign('center');

        // Note: Phase 3 creates one Shader per character (slower)
    }
}
```
</details>

<details>
<summary><b>Alternative: Manual Loading (Advanced)</b></summary>

If you need more control, you can load assets manually:

```typescript
import { loadMSDFShaders } from './src/MSDFShader';
import { parseMSDFFont, MSDFFontJSON } from './src/MSDFFontParser';
import { MSDFFont } from './src/MSDFFont';
import { MSDFText } from './src/MSDFText';

class MyScene extends Phaser.Scene {
    private font?: MSDFFont;

    preload() {
        // Load MSDF shaders
        loadMSDFShaders(this);

        // Load MSDF font assets
        this.load.image('arial-msdf', 'assets/fonts/Arial.png');
        this.load.json('arial-data', 'assets/fonts/Arial.json');
    }

    create() {
        // Parse font data
        const fontJson = this.cache.json.get('arial-data') as MSDFFontJSON;
        const fontData = parseMSDFFont(fontJson, 'Arial');

        // Create font instance
        this.font = new MSDFFont(fontData, 'arial-msdf');

        // Create text
        const text = new MSDFText(this, 100, 100, this.font, 'Hello World!', 48);
        text.setColorHex('#ffffff');
        text.setAlign('center');
    }
}
```
</details>

**Note:** To generate your own MSDF fonts, see [DEVELOPMENT.md](DEVELOPMENT.md#generating-test-font).

## 📦 Loader API Reference

The `MSDFLoader` module provides a simplified API for loading MSDF fonts in Phaser 4.

### Core Functions

#### `loadMSDFFont(scene, key, config)`

Load MSDF font assets during the preload phase.

**Parameters:**
- `scene: Phaser.Scene` - The current scene (usually `this`)
- `key: string` - Unique identifier for this font
- `config: string | MSDFLoadConfig` - Base path (string) or configuration object

**Simple usage:**
```typescript
preload() {
    loadMSDFFont(this, 'arial', 'assets/fonts/Arial');
    // Loads: Arial.png, Arial.json, and MSDF shaders
}
```

**Advanced usage:**
```typescript
preload() {
    loadMSDFFont(this, 'arial', {
        basePath: 'assets/fonts/Arial',
        fontName: 'Arial Bold',
        loadShaders: false  // Skip if already loaded
    });
}
```

#### `getMSDFFont(scene, key)`

Retrieve a loaded and parsed MSDFFont instance.

**Parameters:**
- `scene: Phaser.Scene` - The current scene
- `key: string` - Font key from `loadMSDFFont()`

**Returns:** `MSDFFont | undefined`

**Usage:**
```typescript
create() {
    const font = getMSDFFont(this, 'arial');
    if (font) {
        const text = new MSDFText(this, x, y, font, 'Hello!', 48);
    }
}
```

### Utility Functions

#### `hasMSDFFont(scene, key)`

Check if a font is loaded and ready.

**Returns:** `boolean`

```typescript
if (hasMSDFFont(this, 'arial')) {
    // Font is ready to use
}
```

#### `listMSDFFonts(scene)`

Get all loaded font keys.

**Returns:** `string[]`

```typescript
const fonts = listMSDFFonts(this);
console.log('Loaded fonts:', fonts); // ['arial', 'roboto', ...]
```

#### `removeMSDFFont(scene, key)`

Remove a font from the cache (doesn't unload assets).

```typescript
removeMSDFFont(this, 'arial');
```

#### `debugMSDFFonts(scene)`

Print debug information about all loaded fonts to console.

```typescript
debugMSDFFonts(this);
// === MSDF Fonts ===
// Total fonts: 2
//   arial: Font: Arial | Base Size: 42px | ...
//   roboto: Font: Roboto | Base Size: 48px | ...
```

## 🎨 Phase 5 API Reference

### Word Wrapping (Phase 5.1)

#### `setMaxWidth(width: number): this`

Enable automatic word wrapping at specified width.

```typescript
const text = new MSDFText(this, 100, 100, font, 'Long text here...', 24);
text.setMaxWidth(400); // Wrap at 400 pixels
```

#### `setWordWrapCharCode(charCode: number): this`

Set the character to wrap on (default: 32 for space).

```typescript
text.setWordWrapCharCode(32); // Space
text.setWordWrapCharCode(45); // Hyphen
```

#### `getTextBounds(): BoundsData`

Get detailed text bounds including line information.

```typescript
const bounds = text.getTextBounds();
console.log(bounds.width, bounds.height);
console.log(bounds.lines.count);        // Number of lines
console.log(bounds.lines.lengths);      // Width of each line
console.log(bounds.lines.shortest);     // Shortest line width
console.log(bounds.lines.longest);      // Longest line width
```

### Display Callbacks (Phase 5.2)

#### `setDisplayCallback(callback: DisplayCallback): this`

Set a per-character callback for dynamic effects.

**Callback Signature:**
```typescript
type DisplayCallback = (data: DisplayCallbackData) => DisplayCallbackData;

interface DisplayCallbackData {
    parent: MSDFText;    // Reference to text object
    index: number;       // Character index
    charCode: number;    // Character code
    x: number;           // Position (modifiable)
    y: number;
    scale: number;       // Scale (modifiable)
    rotation: number;    // Rotation in radians (modifiable)
    tint: {              // Per-corner tint (modifiable)
        topLeft: number;
        topRight: number;
        bottomLeft: number;
        bottomRight: number;
    };
    data: any;           // Custom user data
}
```

**Examples:**

**Wave Effect:**
```typescript
text.setDisplayCallback((data) => {
    data.y += Math.sin(data.index * 0.5 + time * 0.003) * 15;
    return data;
});
```

**Rainbow Colors:**
```typescript
text.setDisplayCallback((data) => {
    const hue = (data.index * 30 + time * 0.1) % 360;
    const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1);
    const tintValue = (255 << 24) | (color.b << 16) | (color.g << 8) | color.r;
    data.tint.topLeft = tintValue;
    data.tint.topRight = tintValue;
    data.tint.bottomLeft = tintValue;
    data.tint.bottomRight = tintValue;
    return data;
});
```

**Breathing/Pulsing:**
```typescript
text.setDisplayCallback((data) => {
    data.scale = 1 + Math.sin(data.index * 0.2 + time * 0.002) * 0.3;
    return data;
});
```

**Rotation:**
```typescript
text.setDisplayCallback((data) => {
    data.rotation = time * 0.002 + data.index * 0.2;
    return data;
});
```

**Combined Effects:**
```typescript
text.setDisplayCallback((data) => {
    // Wave + rainbow + scale
    data.y += Math.sin(data.index * 0.4 + time * 0.004) * 20;

    const hue = (data.index * 25 + time * 0.15) % 360;
    const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1);
    const tintValue = (255 << 24) | (color.b << 16) | (color.g << 8) | color.r;
    data.tint.topLeft = tintValue;
    data.tint.topRight = tintValue;
    data.tint.bottomLeft = tintValue;
    data.tint.bottomRight = tintValue;

    data.scale = 1 + Math.sin(data.index * 0.15 + time * 0.003) * 0.2;

    return data;
});
```

#### `clearDisplayCallback(): this`

Remove the display callback.

```typescript
text.clearDisplayCallback();
```

**Performance Notes:**
- Callbacks are invoked every frame during rendering
- Keep callbacks fast and efficient
- Still uses batched rendering (1-2 draw calls)
- Objects are reused to avoid allocations

### Text Effects (Phase 5.4)

#### Outline Effects

Shader-based outline rendering with no extra draw calls.

##### `setOutline(width: number, color: number, alpha: number = 1): this`

Add an outline around text characters.

**Parameters:**
- `width: number` - Outline width in distance field units (typically 0.5-3.0)
- `color: number` - Outline color as 0xRRGGBB hex value
- `alpha: number` - Outline opacity (0-1, default: 1)

**Examples:**

**Black outline:**
```typescript
const text = new MSDFText(this, 400, 300, font, 'OUTLINED', 64);
text.setColorHex('#ffffff');
text.setOutline(1.5, 0x000000, 1.0);
```

**Colored outline:**
```typescript
text.setColorHex('#ffff00');  // Yellow text
text.setOutline(2.0, 0xff0000, 0.8);  // Red semi-transparent outline
```

**Dynamic outline:**
```typescript
// Change outline width on the fly
text.setOutline(Math.sin(time * 0.001) * 2 + 1, 0x0000ff);
```

##### `clearOutline(): this`

Remove the outline effect.

```typescript
text.clearOutline();
```

##### `hasOutline(): boolean`

Check if outline is enabled.

```typescript
if (text.hasOutline()) {
    console.log('Text has outline');
}
```

**Technical Notes:**
- **Single-pass rendering** - Outline is rendered in the same pass as text
- **No extra draw calls** - Efficient shader-based implementation
- **Batch flushing** - Different outline settings trigger batch flush
- **Background fade** - Automatic fade prevents artifacts on far background
- **Width range** - Values beyond ~3.0 may cause visual artifacts

#### Shadow Effects

Two-pass shadow rendering with callback awareness.

##### `setShadow(offsetX: number, offsetY: number, color: number = 0x000000, alpha: number = 0.5): this`

Add a drop shadow to text.

**Parameters:**
- `offsetX: number` - Shadow horizontal offset in pixels
- `offsetY: number` - Shadow vertical offset in pixels
- `color: number` - Shadow color as 0xRRGGBB hex value (default: black)
- `alpha: number` - Shadow opacity (0-1, default: 0.5)

**Examples:**

**Classic drop shadow:**
```typescript
const text = new MSDFText(this, 400, 300, font, 'SHADOWED', 56);
text.setColorHex('#ffffff');
text.setShadow(4, 4, 0x000000, 0.7);
```

**Colored shadow:**
```typescript
text.setColorHex('#ffffff');
text.setShadow(3, 3, 0x0000ff, 0.5);  // Blue shadow
```

**Dynamic shadow:**
```typescript
// Animated shadow offset
const offset = Math.sin(time * 0.002) * 10;
text.setShadow(offset, offset, 0x000000, 0.6);
```

**Callback-aware shadow:**
```typescript
// Shadow follows wave animation
text.setShadow(3, 3, 0x000000, 0.5);
text.setDisplayCallback((data) => {
    data.y += Math.sin(data.index * 0.5 + time * 0.003) * 15;
    return data;
});
// Shadow automatically follows the wave motion!
```

##### `clearShadow(): this`

Remove the shadow effect.

```typescript
text.clearShadow();
```

##### `hasShadow(): boolean`

Check if shadow is enabled.

```typescript
if (text.hasShadow()) {
    console.log('Text has shadow');
}
```

**Technical Notes:**
- **Two-pass rendering** - Shadow pass renders first, text renders on top
- **2x draw calls** - Each text with shadow renders twice per frame
- **Callback-aware** - Shadows automatically follow display callback transforms
- **Batching preserved** - Characters still batch together within each pass
- **Transform support** - Shadows respect rotation, scale, and position changes

#### Combined Effects

Outline and shadow can be used together:

```typescript
const text = new MSDFText(this, 400, 300, font, 'STYLED TEXT', 72);
text.setColorHex('#ffff00');
text.setOutline(1.5, 0x000000, 1.0);  // Black outline
text.setShadow(4, 4, 0x000000, 0.6);   // Black shadow
text.setDisplayCallback((data) => {
    // Wave effect with outline and shadow
    data.y += Math.sin(data.index * 0.5 + time * 0.003) * 20;
    return data;
});
```

**Performance Impact:**
- Outline only: No extra draw calls
- Shadow only: 2x draw calls per text object
- Both together: 2x draw calls (outline is free in shader)
- With callbacks: Same performance, transforms apply to both

## 🛠️ Shader Details

### Fragment Shader (`MSDFFont.frag`)

The MSDF fragment shader implements the core distance field rendering algorithm:

- **Median Function**: Extracts signed distance from RGB channels
- **Smoothstep Anti-aliasing**: Simple `smoothstep(0.4, 0.6, dist)` for clean edges
- **Premultiplied Alpha**: Required by Phaser 4 - `vec4(color.rgb * alpha, alpha)`

**Key Uniforms:**
- `iChannel0` - MSDF texture sampler
- `uTexSize` - Texture dimensions (vec2)
- `uPxRange` - Distance field range (float, typically 4)
- `uTextColor` - Text color (vec4)

**Simplified Approach:**
- No derivatives (`fwidth()`) needed - works without GL_OES_standard_derivatives
- Direct smoothstep on median value provides excellent anti-aliasing
- Premultiplied alpha ensures proper transparency

### Vertex Shader

Uses Phaser's default vertex shader (no custom vertex shader needed):
- Position transformation to clip space
- Texture coordinates passed through
- Compatible with Shader GameObject

## 📚 Technical Background

### What is MSDF?

MSDF (Multi-channel Signed Distance Field) stores distance-to-edge information in the RGB channels of a texture atlas. This enables:

- **Sharp text at any scale** - No pixelation when zooming
- **Memory efficient** - One texture for all font sizes
- **Smooth anti-aliasing** - Superior to traditional bitmap fonts
- **Detail preservation** - Sharp corners and serifs at all scales

### Reference Implementation

Based on the [Ceramic Engine](https://github.com/ceramic-engine/ceramic) (MIT licensed), adapted for Phaser 4's rendering architecture.

## 🔧 Dependencies

### Runtime
- Phaser 4 (WebGL renderer with "Beam" architecture)
- WebGL 1.0+ (no extensions required)
- Premultiplied alpha support (standard in Phaser 4)

### Font Generation
- `msdf-atlas-gen` binaries (included in `ceramic/git/msdf-atlas-gen-binary/`)
- Supported platforms: Windows, macOS, Linux (x86_64, ARM64)

## 📖 Documentation

- **[README.md](README.md)** - This file - main documentation and API reference
- **[CLAUDE.md](CLAUDE.md)** - High-level project context and architecture
- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Development workflow and testing
- **[FONTS.md](FONTS.md)** - Font generation guide
- **[PHASE-4-MIGRATION-GUIDE.md](PHASE-4-MIGRATION-GUIDE.md)** - Migration guide from Phase 3 to Phase 4
- **[Phaser 4 Shader Guide.md](Phaser%204%20Shader%20Guide.md)** - Phaser 4 shader system documentation

## 🗺️ Roadmap

### Phase 1: Shaders ✅ **COMPLETE**
- [x] Fragment shader with median() and smoothstep()
- [x] Premultiplied alpha implementation
- [x] TypeScript helpers
- [x] Working test (renders full atlas)
- [x] Character-specific UV mapping

### Phase 2: MSDFText GameObject ✅ **COMPLETE**
- [x] JSON parser for msdf-atlas-gen format
- [x] TypeScript interfaces for font data
- [x] Character and kerning data structures
- [x] MSDFFont class (data management)
- [x] MSDFText GameObject (text renderer)
- [x] Individual character quads with shaders
- [x] Text layout engine (advance, kerning, alignment)
- [x] Multiple font sizes and colors
- [x] V-coordinate flipping for Phaser
- [x] Working test scenes

### Phase 3: Loader Integration ✅ **COMPLETE**
- [x] Simplified loader API: `loadMSDFFont()` and `getMSDFFont()`
- [x] Automatic JSON + PNG loading
- [x] Cache integration
- [x] Built-in shader loading
- [x] Error handling and debugging utilities
- [ ] Multi-page font support (future enhancement)

### Phase 4: Batching Optimization ✅ **COMPLETE**
- [x] Custom MSDFBatchHandler (extends BatchHandler)
- [x] Batched rendering (1-2 draw calls per text object)
- [x] MSDFTextBatched GameObject
- [x] BatchMSDFChar and MSDFTextWebGLRenderer
- [x] Registration helper (registerMSDFBatchHandler)
- [x] Performance testing and documentation
- [x] Migration guide

### Phase 5: Advanced Features
- [ ] Word wrapping
- [ ] Multi-color text (inline tags)
- [ ] Text effects (shadow, outline, gradient)
- [ ] Rich text formatting

### Phase 6: Tooling & Documentation
- [ ] Font generation scripts
- [ ] CLI tools for font creation
- [ ] Sample fonts
- [ ] API documentation
- [ ] Usage examples
- [ ] Performance benchmarks

## 📝 License

This project is inspired by the MIT-licensed [Ceramic Engine](https://github.com/ceramic-engine/ceramic).

## 🔗 References

- [Ceramic Engine](https://github.com/ceramic-engine/ceramic) - Reference implementation
- [msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen) - Font generation tool
- [MSDF Technique](https://github.com/Chlumsky/msdfgen) - Original MSDF research
- [Phaser 4](https://github.com/phaserjs/phaser) - Game framework

---

**Status:** Phase 4 ✅ COMPLETE - Batched rendering implemented!
**Next:** Phase 5 - Advanced Features (word wrap, rich text, effects)

## 🎉 Key Achievements

### Phase 1 Discoveries:
- **Premultiplied alpha**: Critical for Phaser 4 Shader GameObject compatibility
- **Simplified approach**: No derivatives needed, works on all WebGL 1.0+ devices
- **Clean shader code**: Maintainable MSDF fragment shader

### Phase 2 Discoveries:
- **V-coordinate flipping**: Phaser uses OpenGL's bottom-up texture coordinates regardless of font JSON `yOrigin`
- **Per-character shader configs**: Each character needs its own config with baked-in UV coordinates
- **Normalized dimensions**: Character dimensions must be scaled from planeBounds, not atlas pixel dimensions
- **Working text system**: Complete MSDFText GameObject with layout, kerning, colors, and alignment

### Phase 4 Discoveries:
- **Custom BatchHandler pattern**: Extending Phaser's BatchHandler provides full control over rendering
- **RenderNode integration**: MSDFText as GameObject works seamlessly with Phaser's rendering pipeline
- **Vertex buffer optimization**: Character quads accumulate efficiently with proper buffer layout
- **Texture management**: Single-texture batching is simple; multi-texture requires batch flushing
- **API preservation**: GameObject can maintain Container-like API through careful design

### Phase 3 Discoveries:
- **Helper functions vs plugins**: Helper function approach provides immediate value without game config changes
- **Scene data storage**: Phaser's `scene.data` is perfect for storing font cache across scene lifecycle
- **Automatic parsing**: Lazy parsing on first `getMSDFFont()` call reduces preload overhead
- **Clean API**: Two-function API (`loadMSDFFont` + `getMSDFFont`) covers 95% of use cases

### Phase 5 Discoveries:
- **Word wrapping algorithm**: Split by existing newlines, build words, measure with kerning, wrap when exceeding maxWidth
- **Callback-based effects**: Per-character callbacks enable unlimited creative effects without API bloat
- **Transform pivot handling**: Characters rotate/scale around their center by offsetting the quad and positioning the matrix at center
- **Matrix composition order**: Must `copyFrom(parent)` then apply character transforms to maintain proper hierarchy
- **Object reuse pattern**: Reusing `callbackData` and temp objects eliminates per-frame allocations for smooth 60 FPS
- **Reference comparison bug**: Callbacks modify and return same object - must store original values before invoking callback

### What's Working:
✅ JSON parser (msdf-atlas-gen format)
✅ MSDFFont class (data management, measurements, kerning)
✅ MSDFText GameObject (scalable text rendering)
✅ Multiple font sizes (sharp at any scale)
✅ Text colors and alignment
✅ Automatic kerning
✅ Simplified loader API (`loadMSDFFont` + `getMSDFFont`)
✅ Automatic caching and parsing
✅ **Batched rendering** (MSDFTextBatched with 5-10x performance boost)
✅ Custom BatchHandler and RenderNode integration
✅ **Word wrapping** (Phase 5.1: automatic text flow with detailed bounds)
✅ **Display callbacks** (Phase 5.2: wave, rainbow, breathing, rotation, jiggle effects)
✅ Test scenes demonstrating all features
