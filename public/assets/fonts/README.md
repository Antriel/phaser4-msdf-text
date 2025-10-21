# MSDF Font Assets

This directory should contain MSDF font textures and descriptors.

## Required Files

To test the MSDF shader, you need to generate MSDF font files using `msdf-atlas-gen`:

### Example: RobotoMedium

1. **RobotoMedium.png** - MSDF texture atlas
2. **RobotoMedium.fnt** - BMFont descriptor (for Phase 2+)

## Generating MSDF Fonts

You can use the `msdf-atlas-gen` binary from the ceramic submodule:

```bash
# Windows
ceramic/git/msdf-atlas-gen-binary/windows/msdf-atlas-gen.exe -font path/to/font.ttf -charset "[32,126]" -pxrange 4 -size 42 -format png -imageout public/assets/fonts/RobotoMedium.png

# macOS
ceramic/git/msdf-atlas-gen-binary/mac/msdf-atlas-gen -font path/to/font.ttf -charset "[32,126]" -pxrange 4 -size 42 -format png -imageout public/assets/fonts/RobotoMedium.png

# Linux
ceramic/git/msdf-atlas-gen-binary/linux-x86_64/msdf-atlas-gen -font path/to/font.ttf -charset "[32,126]" -pxrange 4 -size 42 -format png -imageout public/assets/fonts/RobotoMedium.png
```

## Temporary Testing

For initial shader testing, you can use any texture file. The shader will render it, but it won't look like proper text until you use an actual MSDF-generated texture.

## Parameters

When generating fonts, remember these values as you'll need them in the shader config:

- **pxrange**: Distance field range (typically 4)
- **size**: Font size (typically 42)
- Output texture dimensions (will be power-of-two)
