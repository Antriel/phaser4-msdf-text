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

✅ **Phase 3 COMPLETE:**
- Simplified loader API (`loadMSDFFont()` and `getMSDFFont()`)
- Automatic JSON + PNG loading
- Font caching and parsing

✅ **Phase 4 COMPLETE:**
- Custom MSDFBatchHandler for batched rendering
- 5-10x performance improvement (1-2 draw calls per text)
- MSDFTextBatched GameObject

✅ **Phase 5.1 COMPLETE: Word Wrapping**
- Automatic word wrapping with `setMaxWidth()`
- Detailed text bounds with line information
- Test: http://localhost:3000/word-wrap-test.html

✅ **Phase 5.2 COMPLETE: Display Callbacks**
- Per-character callbacks for dynamic effects
- Wave, rainbow, breathing, rotation, jiggle effects
- Test: http://localhost:3000/callback-effects-test.html

🎯 **Next Phase: Phase 5.3-5.5**
- Multi-color text (per-character color arrays)
- Text effects (shadow, shader-based outline)
- Character queries and hit testing

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

## Testing Phase 5 Features

### Phase 5.1: Word Wrapping

**Test Page:** http://localhost:3000/word-wrap-test.html

**Features to Test:**
1. **Basic Wrapping**: Long text automatically wraps at maxWidth boundary
2. **Dynamic maxWidth**: Use UP/DOWN arrow keys to adjust wrap width
3. **Alignment Support**: Wrapping works with left, center, and right alignment
4. **Existing Newlines**: Manual `\n` characters are preserved
5. **Bounds Information**: Check console for detailed line data

**API:**
```typescript
text.setMaxWidth(400);              // Enable wrapping at 400px
text.setWordWrapCharCode(32);       // Wrap on space (default)
const bounds = text.getTextBounds(); // Get line information
```

**Expected Behavior:**
- Text should reflow smoothly as maxWidth changes
- FPS should remain 60 (wrapping only recalculates when text/width changes)
- Bounds data should accurately reflect line counts and widths

### Phase 5.2: Display Callbacks

**Test Page:** http://localhost:3000/callback-effects-test.html

**Features to Test:**
1. **Wave Effect**: Characters move in vertical sine wave
2. **Rainbow Colors**: Gradient color animation across characters
3. **Breathing Effect**: Characters pulse in scale
4. **Jiggle Effect**: Smooth random position offsets
5. **Rotation Effect**: Characters spin around their centers
6. **Combined Effects**: Multiple effects working together

**API:**
```typescript
text.setDisplayCallback((data) => {
    // Modify per-character properties
    data.y += Math.sin(data.index * 0.5 + time * 0.003) * 15;
    data.scale = 1.2;
    data.rotation = Math.PI / 4;
    data.tint.topLeft = 0xFFFF00FF;  // ABGR format
    return data;
});

text.clearDisplayCallback();  // Remove callback
```

**Expected Behavior:**
- All effects should animate smoothly at 60 FPS
- Characters should rotate around their center points (not top-left)
- Position offsets should work independently and combined with rotation/scale
- Rainbow colors should cycle continuously
- Batched rendering should still work (1-2 draw calls per text object)

**Performance Testing:**
- Open browser DevTools Performance tab
- Record for 5 seconds while effects are running
- Check for:
  - Consistent 16.67ms frame time (60 FPS)
  - No memory leaks (memory should stabilize)
  - Minimal garbage collection (objects are reused)

**Debug Tips:**
```typescript
// Check callback is being invoked
text.setDisplayCallback((data) => {
    console.log(`Character ${data.index}: ${String.fromCharCode(data.charCode)}`);
    return data;
});

// Test transform matrix application
text.setDisplayCallback((data) => {
    if (data.index === 0) {
        console.log('First char position:', data.x, data.y);
        console.log('Rotation:', data.rotation);
    }
    data.rotation = 0.5;  // 45 degrees should rotate around center
    return data;
});
```

### Common Issues

**Word Wrapping:**
- **Issue**: Text doesn't wrap
  - Check: Is `maxWidth` set? (0 = no wrapping)
  - Check: Is text longer than maxWidth?
- **Issue**: Wrapping at wrong points
  - Check: `wordWrapCharCode` setting (32 = space)
  - Check: Text contains wrap characters

**Display Callbacks:**
- **Issue**: Position changes don't work
  - Fixed: Compare against original values (not callback data reference)
- **Issue**: Rotation around wrong pivot
  - Fixed: Matrix positioned at character center with quad offset
- **Issue**: Low FPS with callbacks
  - Check: Callback doing expensive operations?
  - Check: Creating new objects in callback? (should reuse)
- **Issue**: Tint not applying
  - Check: Using ABGR format? `(A << 24) | (B << 16) | (G << 8) | R`
  - Check: Setting all four corner values?

## Next Steps (Phase 5.3-5.5)

### Phase 5.3: Multi-Color Text (Next Session)

**Goal**: Per-character color arrays for static multi-color text.

**Implementation Plan:**
1. Add `_characterColors?: number[]` property to MSDFTextBatched
2. Add `setCharacterColors(colors: number[])` and `clearCharacterColors()` methods
3. Modify MSDFTextWebGLRenderer to check `_characterColors[i]` for each character
4. Priority: Callback tint > character colors > global tint
5. Create `multi-color-test.ts` example with rainbow text, alternating colors, etc.

**API Design:**
```typescript
// Static per-character colors
const colors = text.getText().split('').map((_, i) => {
    const hue = (i * 30) % 360;
    const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1);
    return (255 << 24) | (color.b << 16) | (color.g << 8) | color.r;
});
text.setCharacterColors(colors);

// Callbacks can override for dynamic effects
text.setDisplayCallback((data) => {
    // This takes precedence over characterColors
    data.tint.topLeft = 0xFFFFFFFF;
    return data;
});
```

### Phase 5.4: Text Effects (Shadow & Outline)

**Goal**: Shadow and shader-based outline effects.

**Shadow Implementation (Simple - Two Pass):**
1. Add shadow properties: `_shadowOffset: {x, y}`, `_shadowColor`, `_shadowAlpha`
2. Add `setShadow()` and `clearShadow()` methods
3. Modify MSDFTextWebGLRenderer to render twice when shadow enabled:
   - First pass: Shadow (offset + shadow color)
   - Second pass: Main text (normal rendering)
4. Cost: 2x draw calls (acceptable for shadow effect)

**Outline Implementation (Complex - Shader Based):**
1. Modify `shaders/msdf/MSDFFont.frag`:
   - Add uniforms: `uOutlineThickness` (float), `uOutlineColor` (vec4)
   - Dual-layer rendering: Inner text + outer outline in single pass
   - Sample distance at text edge, create outline band
2. Add outline properties to MSDFTextBatched
3. Update MSDFShader.ts to include outline uniforms
4. Modify MSDFTextWebGLRenderer to pass outline uniforms to batch handler
5. Update batch handler to set outline uniforms on shader

**Shader Outline Algorithm:**
```glsl
// In fragment shader
float dist = median(msdfSample.r, msdfSample.g, msdfSample.b);
float screenPxDistance = pxRange * (dist - 0.5);

// Text layer
float textAlpha = smoothstep(-0.5, 0.5, screenPxDistance);

// Outline layer
float outlineAlpha = 0.0;
if (uOutlineThickness > 0.0) {
    float outlineEdge = screenPxDistance + uOutlineThickness;
    outlineAlpha = smoothstep(-0.5, 0.5, outlineEdge);
}

// Composite: outline behind text
vec4 outlineColor = uOutlineColor * outlineAlpha;
vec4 textColor = uTextColor * textAlpha;
vec4 finalColor = mix(outlineColor, textColor, textAlpha);

// Premultiply alpha
gl_FragColor = vec4(finalColor.rgb * finalColor.a, finalColor.a);
```

### Phase 5.5: Character Queries & Hit Testing

**Goal**: Query character positions and implement hit testing.

**Implementation Plan:**
1. Add query methods to MSDFTextBatched:
   - `getCharacterAt(index: number): CharacterData | undefined`
   - `getCharacterBounds(index: number): {x, y, w, h} | undefined`
   - `getCharacterIndexAt(worldX: number, worldY: number): number`
2. Implement hit testing with inverse transform
3. Create `hit-testing-test.ts` example with:
   - Click on character to highlight it
   - Hover effects per character
   - Character selection

**Hit Testing Algorithm:**
```typescript
getCharacterIndexAt(worldX: number, worldY: number): number {
    // Convert world to local coordinates (inverse transform)
    const localX = worldX - this.x;
    const localY = worldY - this.y;

    // Check each character
    for (let i = 0; i < this._characters.length; i++) {
        const char = this._characters[i];
        if (localX >= char.x && localX <= char.x + char.w &&
            localY >= char.y && localY <= char.y + char.h) {
            return i;
        }
    }
    return -1;  // No character hit
}
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Resources

- [Phaser 4 Shader Guide](./Phaser%204%20Shader%20Guide.md)
- [Phase 4 Migration Guide](./PHASE-4-MIGRATION-GUIDE.md)
- [Archived Working Documents](./docs/archive/)
- [Ceramic Reference](https://github.com/ceramic-engine/ceramic)
