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

✅ **Completed:**
- Phaser 4 setup
- MSDF shaders implemented
- Basic test scene created
- Dev environment configured

⏳ **Needs:**
- MSDF font texture (see below)
- Actual testing in browser

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

**GL errors:**
- Check if `GL_OES_standard_derivatives` is supported
- Try on desktop Chrome/Firefox first (best WebGL support)

## Next Steps

After verifying shaders work:

1. **Phase 2: Font Parser**
   - Parse .fnt BMFont files
   - Extract character metrics
   - Handle kerning data

2. **Phase 3: Text Rendering**
   - Create MSDFText GameObject
   - Implement glyph layout
   - Support font sizing

3. **Phase 4: Loader Integration**
   - Custom Phaser loader for .fnt + .png
   - Cache integration
   - Multi-page fonts

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Resources

- [Phaser 4 Shader Guide](./Phaser%204%20Shader%20Guide.md)
- [Implementation Plan](./MSDF-Font-Implementation-Plan.md)
- [Ceramic Reference](https://github.com/ceramic-engine/ceramic)
