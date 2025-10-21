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
- Screen-space derivatives (`fwidth()`) enable resolution-independent anti-aliasing
- LINEAR texture filtering is mandatory (not NEAREST)
- Critical parameter: `pxRange` (distance range) must match between generation and runtime

**Shader Requirements**:
- GL_OES_standard_derivatives extension (for `fwidth()`)
- Fragment shader calculates opacity based on signed distance field
- Uniforms: `uTexture`, `uTexSize`, `uPxRange`

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

### Shader Compatibility
- Desktop: GL_OES_standard_derivatives widely supported
- Mobile: Check for extension availability
- WebGL 2: Derivative support built-in

## References
- Ceramic Engine: https://github.com/ceramic-engine/ceramic
- msdf-atlas-gen: https://github.com/Chlumsky/msdf-atlas-gen
- MSDF Technique: https://github.com/Chlumsky/msdfgen
- Phaser 4 Shader Guide: Available in this repository

## Current Status
See MSDF-Font-Implementation-Plan.md for detailed progress tracking and task checklists.
