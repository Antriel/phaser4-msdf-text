# Phaser 4 MSDF Font Rendering

High-quality scalable text rendering for Phaser 4 using Multi-channel Signed Distance Fields (MSDF).

## 🎯 Project Status

**Phase 1: Shader Implementation** - ✅ Core Implementation Complete

- ✅ MSDF Fragment Shader
- ✅ MSDF Vertex Shader
- ✅ TypeScript Helper Module
- ⏳ Testing (requires Phaser 4 runtime)

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
- **Screen-Space Derivatives**: Uses `fwidth()` for resolution-independent anti-aliasing
- **Smooth Edges**: Calculates opacity based on signed distance for crisp rendering

**Key Uniforms:**
- `iChannel0` - MSDF texture sampler
- `uTexSize` - Texture dimensions (vec2)
- `uPxRange` - Distance field range (float, typically 4)

### Vertex Shader (`MSDFFont.vert`)

Standard vertex shader that passes through:
- Position (transformed to clip space)
- Texture coordinates
- Vertex color

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
- WebGL with `GL_OES_standard_derivatives` extension support

### Font Generation
- `msdf-atlas-gen` binaries (included in `ceramic/git/msdf-atlas-gen-binary/`)
- Supported platforms: Windows, macOS, Linux (x86_64, ARM64)

## 📖 Documentation

- **[CLAUDE.md](CLAUDE.md)** - High-level project context and architecture
- **[MSDF-Font-Implementation-Plan.md](MSDF-Font-Implementation-Plan.md)** - Detailed implementation guide
- **[Phaser 4 Shader Guide.md](Phaser%204%20Shader%20Guide.md)** - Phaser 4 shader system documentation

## 🗺️ Roadmap

### Phase 1: Shaders ✅ (Core Complete)
- [x] Fragment and vertex shaders
- [x] TypeScript helpers
- [ ] Testing and validation

### Phase 2: Data Structures (Next)
- [ ] TypeScript interfaces for font data
- [ ] BMFont format parser (.fnt files)
- [ ] Character and kerning data structures

### Phase 3: Font & Text GameObjects
- [ ] MSDFFont class
- [ ] MSDFText GameObject
- [ ] Glyph rendering and layout

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

**Status:** Phase 1 Core Implementation Complete ✅
**Next:** Testing with Phaser 4 runtime + Phase 2 Data Structures
