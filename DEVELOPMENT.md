# Development Guide

## Setup

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies (already done if you see node_modules/)
npm install

# Start development server
npm run dev
```

The dev server will start at http://localhost:3000 and automatically open in your browser.

## Project Structure

```
phaser4-msdf-font/
├── public/                    # Static assets (served as-is)
│   ├── assets/
│   │   └── fonts/            # MSDF font textures (.png) and descriptors (.fnt)
│   └── shaders/              # GLSL shader files
│       ├── MSDFFont.frag     # MSDF fragment shader
│       └── MSDFFont.vert     # MSDF vertex shader
├── src/
│   ├── main.ts               # Entry point
│   └── MSDFShader.ts         # MSDF shader helpers
├── examples/
│   └── basic-msdf-shader-test.ts  # Test scene
├── shaders/                   # Source shaders (copied to public/)
│   └── msdf/
├── index.html                # HTML entry point
├── vite.config.ts            # Vite configuration
└── tsconfig.json             # TypeScript configuration
```

## Development Workflow

### 1. Start Dev Server

```bash
npm run dev
```

This starts Vite dev server with:
- Hot module replacement (HMR)
- TypeScript compilation
- Automatic browser refresh
- Source maps for debugging

### 2. Making Changes

**Code Changes:**
- Edit files in `src/` or `examples/`
- Browser automatically reloads

**Shader Changes:**
- Edit `.frag` or `.vert` files in `shaders/msdf/`
- Copy to `public/shaders/` (TODO: automate this)
- Refresh browser

**Asset Changes:**
- Add files to `public/assets/`
- They're immediately available

### 3. Building for Production

```bash
npm run build
```

Outputs to `dist/` directory.

### 4. Preview Production Build

```bash
npm run preview
```

## Testing MSDF Shaders

### Current Status

✅ **Phase 1 COMPLETE:**
- Phaser 4 setup and configuration
- MSDF shaders implemented and working
- Premultiplied alpha rendering
- Basic test scene rendering full atlas
- Dev environment fully configured

✅ **Phase 2 COMPLETE:**
- JSON parser for msdf-atlas-gen format
- MSDFFont class (data container)
- MSDFText GameObject (text renderer)
- Character-by-character rendering with MSDF shaders
- Text layout with advance, kerning, and alignment
- Multiple font sizes and colors
- Working test scenes

🎯 **Next Phase:**
- Phaser loader integration
- Batching optimization (RenderNodes)
- Advanced text features (wrapping, effects)

### Generating Test Font

You need an MSDF font texture to test. Use `msdf-atlas-gen` from the ceramic submodule:

#### Windows

```bash
ceramic\git\msdf-atlas-gen-binary\windows\msdf-atlas-gen.exe ^
  -font "C:\Windows\Fonts\arial.ttf" ^
  -charset "[32,126]" ^
  -type msdf ^
  -pxrange 4 ^
  -size 42 ^
  -potr ^
  -yorigin top ^
  -format png ^
  -imageout "public\assets\fonts\RobotoMedium.png"
```

#### macOS/Linux

```bash
# macOS
ceramic/git/msdf-atlas-gen-binary/mac/msdf-atlas-gen \
  -font "/System/Library/Fonts/Helvetica.ttc" \
  -charset "[32,126]" \
  -type msdf \
  -pxrange 4 \
  -size 42 \
  -potr \
  -yorigin top \
  -format png \
  -imageout "public/assets/fonts/RobotoMedium.png"

# Linux
ceramic/git/msdf-atlas-gen-binary/linux-x86_64/msdf-atlas-gen \
  -font "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf" \
  -charset "[32,126]" \
  -type msdf \
  -pxrange 4 \
  -size 42 \
  -potr \
  -yorigin top \
  -format png \
  -imageout "public/assets/fonts/RobotoMedium.png"
```

### Understanding the Parameters

- `-font`: Path to TTF/OTF font file
- `-charset "[32,126]"`: ASCII printable characters (space to tilde)
- `-type msdf`: Multi-channel SDF (best quality)
- `-pxrange 4`: Distance field range (MUST match shader uniform)
- `-size 42`: Base font size
- `-potr`: Power-of-two texture with padding
- `-yorigin top`: Top-down coordinates (Phaser convention)
- `-format png`: Output format
- `-imageout`: Output file path

## Debugging

### Browser Console

The game instance is available globally:

```javascript
// In browser console
window.game              // Phaser game instance
window.game.renderer     // WebGL renderer
window.game.scene        // Scene manager
```

### Phaser Debug

Check the browser console for:
- Shader compilation errors
- Texture loading status
- WebGL errors
- Uniform binding issues

### Common Issues

**Shader not loading:**
- Check browser console for 404 errors
- Verify paths in `MSDF_SHADER_PATHS`
- Shaders must be in `public/shaders/`

**Black/blank quad:**
- Font texture not loaded
- Wrong texture size in config
- Shader compilation failed (check console)

**White rectangle (no characters visible):**
- **Alpha blending issue!** Phaser requires premultiplied alpha
- Shader must output: `vec4(color.rgb * alpha, alpha)`
- NOT: `vec4(color.rgb, alpha)` (this won't work)

**Key Discoveries:**
- GL_OES_standard_derivatives not needed (simplified approach works)
- Phaser's default vertex shader is sufficient
- Texture filtering: Must be LINEAR (not NEAREST)
- **V-coordinates must be flipped**: Phaser uses OpenGL's bottom-up texture coordinates
- **Per-character shader configs**: Each character needs its own config with baked-in UVs

## Using MSDF Text (Phase 2 Complete!)

### Basic Usage

```typescript
import { parseMSDFFont, MSDFFontJSON } from './src/MSDFFontParser';
import { MSDFFont } from './src/MSDFFont';
import { MSDFText } from './src/MSDFText';
import { loadMSDFShaders } from './src/MSDFShader';

class MyScene extends Phaser.Scene {
    private font?: MSDFFont;

    preload() {
        // Load MSDF shaders
        loadMSDFShaders(this);

        // Load font assets
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

        // Text is automatically added to scene via Container
    }
}
```

### MSDFText Features

- **Font sizes**: `setText()`, `setFontSize()`
- **Colors**: `setColor(r, g, b, a)`, `setColorHex('#ffffff')`
- **Alignment**: `setAlign('left' | 'center' | 'right')`
- **Line spacing**: `setLineSpacing(pixels)`
- **Measurements**: `getTextWidth()`, `getTextHeight()`, `getTextBounds()`
- **Automatic kerning**: Built into layout engine
- **Scalable**: Sharp rendering at any font size

## Next Steps

Potential improvements for Phase 3:

1. **Phaser Loader Integration**
   - Custom loader: `this.load.msdfFont('arial', ...)`
   - Automatic JSON + PNG loading
   - Cache integration

2. **Batching Optimization**
   - RenderNodes (Submitter, Texturer, Transformer)
   - Single draw call for all characters
   - Improved performance for large text blocks

3. **Advanced Features**
   - Word wrapping
   - Multi-color text (inline color tags)
   - Text effects (shadow, outline, gradient)
   - Rich text formatting

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Resources

- [Phaser 4 Shader Guide](./Phaser%204%20Shader%20Guide.md)
- [Phase 4 Migration Guide](./PHASE-4-MIGRATION-GUIDE.md)
- [Archived Working Documents](./docs/archive/)
- [Ceramic Reference](https://github.com/ceramic-engine/ceramic)
