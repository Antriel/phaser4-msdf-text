# Phaser 4 MSDF Font Rendering

High-quality scalable text rendering for Phaser 4 using Multi-channel Signed Distance Fields (MSDF).

## 🎯 Project Status

**Phase 1: Shader Implementation** - ✅ **COMPLETE!**

- ✅ MSDF Fragment Shader with premultiplied alpha
- ✅ Simplified approach (no derivatives required)
- ✅ TypeScript Helper Module
- ✅ Working test rendering full MSDF atlas

**Phase 2: MSDFText GameObject** - 🚧 Next

- Parse BMFont .fnt files
- Render individual characters (not whole atlas)
- Text layout and batching

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

**Note:** To see actual MSDF text rendering, you need to generate an MSDF font texture first. See the font generation instructions in [DEVELOPMENT.md](DEVELOPMENT.md#generating-test-font).

### Loading MSDF Shaders

```typescript
import { loadMSDFShaders, createMSDFShaderConfig } from './src/MSDFShader';

class MyScene extends Phaser.Scene {
    preload() {
        // Load MSDF shaders
        loadMSDFShaders(this);

        // Load MSDF font texture
        this.load.image('font-atlas', 'assets/fonts/RobotoMedium.png');
    }

    create() {
        // Create shader configuration
        const config = createMSDFShaderConfig({
            textureWidth: 512,
            textureHeight: 512,
            distanceRange: 4  // Must match font generation
        });

        // Create shader object
        const shader = this.add.shader(
            config,
            400, 300,           // position
            400, 300,           // size
            ['font-atlas']      // textures
        );
    }
}
```

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

### Phase 2: MSDFText GameObject 🚧 (Next)
- [ ] Study Phaser's BitmapText architecture
- [ ] TypeScript interfaces for font data
- [ ] BMFont format parser (.fnt files)
- [ ] Character and kerning data structures

### Phase 3: Character Rendering
- [ ] MSDFFont class (data management)
- [ ] MSDFText GameObject (like BitmapText)
- [ ] Individual character quads
- [ ] Batching with RenderNodes

### Phase 4: Loader Integration
- [ ] Asset loader for .fnt + .png
- [ ] Cache integration
- [ ] Multi-page font support

### Phase 5: Tooling
- [ ] Font generation scripts
- [ ] CLI tools for font creation
- [ ] Sample fonts

### Phase 6: Testing & Examples
- [ ] Scaling tests
- [ ] Performance benchmarks
- [ ] Comparison demos

## 📝 License

This project is inspired by the MIT-licensed [Ceramic Engine](https://github.com/ceramic-engine/ceramic).

## 🔗 References

- [Ceramic Engine](https://github.com/ceramic-engine/ceramic) - Reference implementation
- [msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen) - Font generation tool
- [MSDF Technique](https://github.com/Chlumsky/msdfgen) - Original MSDF research
- [Phaser 4](https://github.com/phaserjs/phaser) - Game framework

---

**Status:** Phase 1 ✅ COMPLETE - Shaders working perfectly!
**Next:** Phase 2 - MSDFText GameObject (BitmapText architecture)

## 🎉 Key Achievements

- **Premultiplied alpha discovery**: Critical for Phaser 4 compatibility
- **Simplified approach**: No derivatives needed, works on all WebGL 1.0+ devices
- **Clean implementation**: Simple, maintainable shader code
- **Proven rendering**: Successfully renders MSDF atlas with smooth anti-aliasing
