# MSDF Font Generation Guide

## Generated Fonts

### Arial (512x256)

✅ **Status:** Generated and ready for testing

**Files:**
- `public/assets/fonts/Arial.png` - MSDF texture atlas (72KB)
- `public/assets/fonts/Arial.json` - Glyph layout and metrics (27KB)

**Generation Parameters:**
```bash
ceramic/git/msdf-atlas-gen-binary/windows/msdf-atlas-gen.exe \
  -font "C:\Windows\Fonts\arial.ttf" \
  -type msdf \
  -pxrange 4 \
  -size 42 \
  -potr \
  -yorigin top \
  -imageout "public/assets/fonts/Arial.png" \
  -json "public/assets/fonts/Arial.json"
```

**Atlas Details:**
- **Type:** msdf (Multi-channel Signed Distance Field)
- **Dimensions:** 512 x 256 pixels
- **Distance Range:** 4 pixels
- **Font Size:** 42 pixels per EM
- **Glyphs:** 95 characters (ASCII 32-126)
- **Y-Origin:** Top (Phaser convention)
- **Kerning Pairs:** Included (120+ pairs)

**Metrics:**
- **Line Height:** 1.14990234375 EM
- **Ascender:** -0.9052734375 EM
- **Descender:** 0.2119140625 EM

---

## How to Generate New Fonts

### Quick Command (Windows)

```bash
# Replace <FONT_NAME> with your desired output name
# Replace <FONT_PATH> with path to your .ttf/.otf file

ceramic\git\msdf-atlas-gen-binary\windows\msdf-atlas-gen.exe ^
  -font "<FONT_PATH>" ^
  -type msdf ^
  -pxrange 4 ^
  -size 42 ^
  -potr ^
  -yorigin top ^
  -imageout "public\assets\fonts\<FONT_NAME>.png" ^
  -json "public\assets\fonts\<FONT_NAME>.json"
```

### macOS

```bash
ceramic/git/msdf-atlas-gen-binary/mac/msdf-atlas-gen \
  -font "<FONT_PATH>" \
  -type msdf \
  -pxrange 4 \
  -size 42 \
  -potr \
  -yorigin top \
  -imageout "public/assets/fonts/<FONT_NAME>.png" \
  -json "public/assets/fonts/<FONT_NAME>.json"
```

### Linux

```bash
# x86_64
ceramic/git/msdf-atlas-gen-binary/linux-x86_64/msdf-atlas-gen \
  -font "<FONT_PATH>" \
  -type msdf \
  -pxrange 4 \
  -size 42 \
  -potr \
  -yorigin top \
  -imageout "public/assets/fonts/<FONT_NAME>.png" \
  -json "public/assets/fonts/<FONT_NAME>.json"

# ARM64
ceramic/git/msdf-atlas-gen-binary/linux-arm64/msdf-atlas-gen \
  -font "<FONT_PATH>" \
  -type msdf \
  -pxrange 4 \
  -size 42 \
  -potr \
  -yorigin top \
  -imageout "public/assets/fonts/<FONT_NAME>.png" \
  -json "public/assets/fonts/<FONT_NAME>.json"
```

---

## Parameter Reference

### Essential Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `-font` | Path to .ttf/.otf | Input font file |
| `-type msdf` | Fixed | Multi-channel SDF (best quality) |
| `-pxrange 4` | **CRITICAL** | Distance range - must match shader uniform! |
| `-size 42` | Recommended | Base font size in pixels per EM |
| `-potr` | Recommended | Power-of-two rectangle dimensions |
| `-yorigin top` | **REQUIRED** | Top-down Y-axis (Phaser convention) |

### Output Formats

| Parameter | Format | Description |
|-----------|--------|-------------|
| `-imageout <file>.png` | PNG image | Atlas texture (use in Phaser) |
| `-json <file>.json` | JSON | Glyph layout and metrics (Phase 2+) |
| `-arfont <file>.arfont` | Artery Font | Binary format (alternative) |
| `-csv <file>.csv` | CSV | Simple layout data |

### Optional Parameters

```bash
# Custom character set (default is ASCII 32-126)
-chars "[32,126]"              # ASCII printable
-chars "[0x20,0x7E],[0x100,0x17F]"  # ASCII + Latin Extended-A
-allglyphs                     # All glyphs in font

# Fixed dimensions (instead of -potr)
-dimensions 512 512

# Different constraint modes
-pots    # Power-of-two square
-square  # Any square
-square2 # Square with side divisible by 2
-square4 # Square with side divisible by 4

# Font naming
-fontname "My Font"  # Metadata in output files

# Disable kerning
-nokerning
```

---

## Common Font Locations

### Windows
```
C:\Windows\Fonts\
  - arial.ttf              (Arial)
  - times.ttf              (Times New Roman)
  - cour.ttf               (Courier New)
  - verdana.ttf            (Verdana)
  - georgia.ttf            (Georgia)
  - comic.ttf              (Comic Sans MS)
  - impact.ttf             (Impact)
  - consola.ttf            (Consolas)
```

### macOS
```
/System/Library/Fonts/
  - Helvetica.ttc          (Helvetica family)
  - Times.ttc              (Times family)
  - Courier.ttc            (Courier family)

/Library/Fonts/
  - Arial.ttf
  - Georgia.ttf
```

### Linux
```
/usr/share/fonts/truetype/
  - liberation/LiberationSans-Regular.ttf
  - dejavu/DejaVuSans.ttf
  - ubuntu/Ubuntu-R.ttf
```

---

## Best Practices

### Quality Settings

**For UI Text (recommended):**
- `-pxrange 4` - Good balance of sharpness and smoothness
- `-size 42` - Sufficient detail for most uses

**For Very Large Text:**
- `-pxrange 6` - Extra smooth at large scales
- `-size 48` - More detail

**For Small Text:**
- `-pxrange 2` - Sharper edges
- `-size 36` - Less texture memory

### Performance Considerations

- **Smaller atlases = better performance**
  - Use `-potr` to get minimal dimensions
  - Only include needed characters with `-chars`

- **Multiple fonts:**
  - Generate separate atlases for different fonts
  - Share atlas for font variants (bold/italic) if possible

- **Texture limits:**
  - Keep under 2048x2048 for broad compatibility
  - Mobile devices prefer smaller textures (512x512 or less)

---

## Troubleshooting

### "Failed to load character set specification"

❌ **Wrong:** `-charset "[32,126]"`
✅ **Correct:** `-chars "[32,126]"` or use default (no parameter)

### "Invalid image format"

Use these formats for `-imageout`:
- `.png` ✅ (recommended)
- `.bmp` ✅
- `.tiff` ✅

### Font looks blurry in Phaser

- ✅ Verify `distanceRange` in shader config matches `-pxrange`
- ✅ Check texture dimensions in shader config match actual atlas
- ✅ Ensure LINEAR texture filtering (not NEAREST)

### Text has wrong orientation

- ✅ Must use `-yorigin top` for Phaser 4
- ❌ Don't use `-yorigin bottom` (OpenGL default)

---

## Next Steps

After generating a font:

1. **Update Example Code:**
   ```typescript
   // In examples/basic-msdf-shader-test.ts
   this.load.image('msdf-font-atlas', 'assets/fonts/YourFont.png');

   const shaderConfig = createMSDFShaderConfig({
       textureWidth: 512,     // Match your atlas!
       textureHeight: 256,    // Match your atlas!
       distanceRange: 4       // Match your -pxrange!
   });
   ```

2. **Test in Browser:**
   ```bash
   npm run dev
   ```

3. **Phase 2:** Implement font parser to read .json/.fnt files

4. **Phase 3:** Create MSDFText GameObject for actual text rendering
