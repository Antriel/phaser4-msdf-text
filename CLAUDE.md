# Project: Phaser 4 MSDF Font Rendering

## Overview
Implementing MSDF (Multi-channel Signed Distance Field) font rendering for Phaser 4 game engine. MSDF fonts provide high-quality text rendering at any scale without pixelation.

## Project Context

### Technology Stack
- **Engine**: Phaser 4 (TypeScript-based game framework)
- **Rendering**: WebGL with custom GLSL shaders
- **Font Generation**: msdf-atlas-gen (binary tools available in ceramic submodule)
- **Font Format**: BMFont format (.fnt + .png)

### Reference Implementation
Based on [Ceramic Engine](https://github.com/ceramic-engine/ceramic) (MIT licensed) MSDF implementation, which provides proven shader code and architecture patterns.

### Key Technical Concepts

**MSDF Rendering**:
- Distance field data stored in RGB channels of texture atlas
- Fragment shader uses `median()` function to extract signed distance
- Anti-aliasing uses screen-space derivatives (`fwidth(dist)`) so AA quality is
  independent of the atlas's `pxRange` and stays crisp at any zoom level
- **Premultiplied alpha required** for Phaser 4 Shader GameObject
- LINEAR texture filtering is mandatory (not NEAREST)
- `pxRange` (distance range) is read from the font JSON and only matters for the
  outline shader path; AA itself no longer depends on it

**Shader Requirements**:
- Fragment shader calculates opacity based on signed distance field
- Premultiplied alpha: `rgb = color.rgb * alpha`
- Uniforms: `iChannel0` (texture), `uTexSize`, `uPxRange`, `uTextColor`
- Requires the `OES_standard_derivatives` WebGL extension. Phaser 4 only enables
  it when the game config sets `smoothPixelArt: true` (misleading flag name —
  it's the same extension used elsewhere by Phaser's SmoothPixelArt addition).
  Consumers of this plugin must set that flag in their Phaser game config.

**Font Data Structure**:
- BMFont format with custom `distanceField` metadata line
- Character metrics: position, size, offset, advance, kerning
- Multi-page texture support for large character sets

### Project Structure
```
phaser4-msdf-font/
├── CLAUDE.md                          # This file - general project info
├── README.md                          # Main documentation
├── DEVELOPMENT.md                     # Development workflow
├── FONTS.md                           # Font generation guide
├── PHASE-4-MIGRATION-GUIDE.md         # Migration guide for batched rendering
├── Phaser 4 Shader Guide.md           # Phaser 4 shader reference
├── docs/archive/                      # Archived working documents
├── ceramic/                           # Git submodule with reference code
│   └── git/msdf-atlas-gen-binary/    # Font generation binaries (Windows/Mac/Linux)
├── src/                               # Source code
└── examples/                          # Test examples
```

## Architecture Components

1. **MSDFShader** - Custom WebGL shader for MSDF rendering
2. **MSDFFont** - Font data loader and manager
3. **MSDFText** - Text GameObject using MSDF fonts
4. **MSDFLoader** - Asset loader for .fnt and .png files
5. **Font Generation Tools** - Scripts to generate MSDF fonts from TTF/OTF

## Development Approach

### Documentation
- **CLAUDE.md**: High-level project context, architecture notes, conventions (this file)
- **README.md**: Main documentation, API reference, usage examples
- **DEVELOPMENT.md**: Development workflow, testing procedures
- **PHASE-4-MIGRATION-GUIDE.md**: Guide for migrating from Phase 3 to Phase 4
- **docs/archive/**: Historical working documents and design notes

### Completed Phases
1. ✅ **Phase 1**: Shader Implementation (fragment + vertex GLSL)
2. ✅ **Phase 2**: Font Data Structures & MSDFText GameObject
3. ✅ **Phase 3**: Loader Integration
4. ✅ **Phase 4**: Batching Optimization (5-10x performance improvement)
5. 🚧 **Phase 5**: Advanced Features (word wrap, rich text, effects)

## Important Notes

### Critical Parameters
- **distanceRange**: Typically 4 (range: 2-8)
- **fontSize**: Base size during generation (typically 42)
- **pxRange**: Must match distanceRange from generation

### Texture Filtering
MSDF fonts **MUST** use LINEAR filtering. NEAREST filtering will break the distance field interpolation.

### Phaser 4 Shader Discoveries
- **Premultiplied alpha is mandatory**: Phaser's Shader GameObject expects `vec4(color.rgb * alpha, alpha)`
- **Derivatives are required**: AA uses `fwidth(dist)` so it scales correctly
  with `pxRange` and zoom. Game config must set `smoothPixelArt: true` to make
  Phaser enable the `OES_standard_derivatives` extension.
- **Default vertex shader sufficient**: No custom vertex shader needed
- **Texture binding**: Use `iChannel0` for texture sampler (texture unit 0)

## References
- Ceramic Engine: https://github.com/ceramic-engine/ceramic
- msdf-atlas-gen: https://github.com/Chlumsky/msdf-atlas-gen
- MSDF Technique: https://github.com/Chlumsky/msdfgen
- Phaser 4 Shader Guide: Available in this repository

## Current Status

**All core phases complete!** The MSDF font rendering system is fully functional with batched rendering.

### ✅ Phase 1: Shader Implementation - COMPLETE
- Fragment shader with median() and derivative-based AA
- Premultiplied alpha implementation
- TypeScript helper (MSDFShader.ts)

### ✅ Phase 2: MSDFText GameObject - COMPLETE
- JSON Parser (msdf-atlas-gen format)
- MSDFFont class (data management, kerning, measurements)
- MSDFText GameObject (renders individual characters)
- Text layout engine (positioning, advance, kerning, alignment)
- Multiple font sizes and colors

### ✅ Phase 3: Loader Integration - COMPLETE
- Simplified loader API (`loadMSDFFont()` and `getMSDFFont()`)
- Automatic JSON + PNG loading
- Font caching and parsing

### ✅ Phase 4: Batching Optimization - COMPLETE
- Custom MSDFBatchHandler (RenderNode system)
- Batched character rendering (1-2 draw calls per text)
- **5-10x performance improvement**
- 100% API compatibility with Phase 3
- MSDFTextBatched GameObject

### 🚧 Phase 5: Advanced Features - NEXT
- Word wrapping and text flow
- Rich text (inline colors/formatting)
- Text effects (shadow, outline, gradient)
- Additional optimizations

## Key Discoveries

### V-Coordinate Flipping
**Critical Finding**: Phaser uses OpenGL's bottom-up texture coordinates, regardless of the `yOrigin` setting in the font JSON. All V-coordinates must be flipped:
```typescript
const v0 = 1 - (atlasBounds.bottom / atlasHeight);
const v1 = 1 - (atlasBounds.top / atlasHeight);
```

### Per-Character Shader Configs
Each character requires its own shader config with character-specific `uCharUV` values. The `setupUniforms` function is called every frame, so per-character UVs must be baked into each config.
