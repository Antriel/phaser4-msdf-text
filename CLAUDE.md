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
- Simple `smoothstep()` provides clean anti-aliasing without derivatives
- **Premultiplied alpha required** for Phaser 4 Shader GameObject
- LINEAR texture filtering is mandatory (not NEAREST)
- Critical parameter: `pxRange` (distance range) must match between generation and runtime

**Shader Requirements**:
- Fragment shader calculates opacity based on signed distance field
- Premultiplied alpha: `rgb = color.rgb * alpha`
- Uniforms: `iChannel0` (texture), `uTexSize`, `uPxRange`, `uTextColor`
- No derivatives needed - simplified approach works perfectly

**Font Data Structure**:
- BMFont format with custom `distanceField` metadata line
- Character metrics: position, size, offset, advance, kerning
- Multi-page texture support for large character sets

### Project Structure
```
phaser4-msdf-font/
├── CLAUDE.md                          # This file - general project info
├── MSDF-Font-Implementation-Plan.md   # Working memory - detailed plan & progress
├── ceramic/                           # Git submodule with reference code
│   └── git/msdf-atlas-gen-binary/    # Font generation binaries (Windows/Mac/Linux)
└── (Phaser 4 source will go here)
```

## Architecture Components

1. **MSDFShader** - Custom WebGL shader for MSDF rendering
2. **MSDFFont** - Font data loader and manager
3. **MSDFText** - Text GameObject using MSDF fonts
4. **MSDFLoader** - Asset loader for .fnt and .png files
5. **Font Generation Tools** - Scripts to generate MSDF fonts from TTF/OTF

## Development Approach

### Working Memory System
- **MSDF-Font-Implementation-Plan.md**: Detailed implementation plan, progress tracking, checklists
- **CLAUDE.md**: High-level project context, architecture notes, conventions (this file)

### Implementation Phases
1. Shader Implementation (fragment + vertex GLSL)
2. Font Data Structures (TypeScript interfaces, parser)
3. Font & Text GameObjects
4. Loader Integration
5. Font Generation Tooling
6. Testing & Examples
7. Documentation
8. Polish & Advanced Features

## Important Notes

### Critical Parameters
- **distanceRange**: Typically 4 (range: 2-8)
- **fontSize**: Base size during generation (typically 42)
- **pxRange**: Must match distanceRange from generation

### Texture Filtering
MSDF fonts **MUST** use LINEAR filtering. NEAREST filtering will break the distance field interpolation.

### Phaser 4 Shader Discoveries
- **Premultiplied alpha is mandatory**: Phaser's Shader GameObject expects `vec4(color.rgb * alpha, alpha)`
- **Derivatives not required**: Simple `smoothstep(0.4, 0.6, median)` works perfectly
- **Default vertex shader sufficient**: No custom vertex shader needed
- **Texture binding**: Use `iChannel0` for texture sampler (texture unit 0)

## References
- Ceramic Engine: https://github.com/ceramic-engine/ceramic
- msdf-atlas-gen: https://github.com/Chlumsky/msdf-atlas-gen
- MSDF Technique: https://github.com/Chlumsky/msdfgen
- Phaser 4 Shader Guide: Available in this repository

## Current Status

### Phase 1: Shader Implementation ✅ COMPLETE
- ✅ Fragment shader with median() and smoothstep()
- ✅ Premultiplied alpha implementation
- ✅ TypeScript helper (MSDFShader.ts)
- ✅ Working test rendering entire MSDF atlas
- ✅ Clean, simplified approach (no derivatives needed)
- ✅ Character-specific UV mapping with `uCharUV` uniform

### Phase 2: MSDFText GameObject ✅ COMPLETE
- ✅ JSON Parser (msdf-atlas-gen format)
- ✅ MSDFFont class (data management, kerning, measurements)
- ✅ MSDFText GameObject (renders individual characters)
- ✅ Text layout engine (positioning, advance, kerning)
- ✅ Multiple font sizes (scalable rendering)
- ✅ Text colors (per-text color support)
- ✅ Text alignment (left, center, right)
- ✅ V-coordinate flipping for Phaser's OpenGL texture coordinates
- ✅ Working test scenes with multiple examples

### Phase 3: Optimization & Polish (NEXT)
Potential improvements:
- Phaser Loader integration (`this.load.msdfFont()`)
- Batching optimization (single draw call for all characters)
- Advanced text features (word wrapping, multi-color, effects)
- Documentation and usage examples

See MSDF-Font-Implementation-Plan.md for detailed progress tracking.

## Key Discoveries

### V-Coordinate Flipping
**Critical Finding**: Phaser uses OpenGL's bottom-up texture coordinates, regardless of the `yOrigin` setting in the font JSON. All V-coordinates must be flipped:
```typescript
const v0 = 1 - (atlasBounds.bottom / atlasHeight);
const v1 = 1 - (atlasBounds.top / atlasHeight);
```

### Per-Character Shader Configs
Each character requires its own shader config with character-specific `uCharUV` values. The `setupUniforms` function is called every frame, so per-character UVs must be baked into each config.
