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

**Phase 3: Optimization & Features** - 🚧 Next

- Phaser Loader integration
- Batching optimization (RenderNodes)
- Advanced text features (wrapping, effects)

See [MSDF-Font-Implementation-Plan.md](MSDF-Font-Implementation-Plan.md) for detailed progress.

## 📁 Project Structure

```
phaser4-msdf-font/
├── CLAUDE.md                          # Project context and architecture notes
├── MSDF-Font-Implementation-Plan.md   # Detailed implementation plan and progress
├── README.md                          # This file
├── ceramic/                           # Git submodule - Ceramic engine reference
│   └── git/msdf-atlas-gen-binary/    # Font generation tools
├── shaders/
│   └── msdf/
│       ├── MSDFFont.frag             # MSDF fragment shader (GLSL)
│       └── MSDFFont.vert             # MSDF vertex shader (GLSL)
├── src/
│   └── MSDFShader.ts                 # TypeScript helpers for MSDF shaders
└── examples/
    └── basic-msdf-shader-test.ts     # Basic usage example
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

**Test the complete system:** Open http://localhost:3000/test-msdf-text.html to see MSDFText rendering in action!

### Using MSDFText

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

        // Text features:
        // - Scalable to any size (sharp at all scales)
        // - Automatic kerning
        // - Color support
        // - Alignment (left, center, right)
    }
}
```

**Note:** To generate your own MSDF fonts, see [DEVELOPMENT.md](DEVELOPMENT.md#generating-test-font).

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

- **[CLAUDE.md](CLAUDE.md)** - High-level project context and architecture
- **[MSDF-Font-Implementation-Plan.md](MSDF-Font-Implementation-Plan.md)** - Detailed implementation guide
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

### Phase 3: Loader Integration 🚧 (Next)
- [ ] Custom Phaser loader: `this.load.msdfFont()`
- [ ] Automatic JSON + PNG loading
- [ ] Cache integration
- [ ] Multi-page font support

### Phase 4: Batching Optimization
- [ ] RenderNodes (Submitter, Texturer, Transformer)
- [ ] Single draw call for all characters
- [ ] Performance improvements for large text blocks

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

**Status:** Phase 2 ✅ COMPLETE - Full MSDF text rendering system working!
**Next:** Phase 3 - Phaser Loader Integration & Batching Optimization

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

### What's Working:
✅ JSON parser (msdf-atlas-gen format)
✅ MSDFFont class (data management, measurements, kerning)
✅ MSDFText GameObject (scalable text rendering)
✅ Multiple font sizes (sharp at any scale)
✅ Text colors and alignment
✅ Automatic kerning
✅ Test scenes demonstrating all features
