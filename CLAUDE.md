# Project: Phaser 4 MSDF Font Rendering

## Overview
MSDF (Multi-channel Signed Distance Field) font rendering plugin for the
Phaser 4 game engine. MSDF fonts stay crisp at any scale without pixelation,
from a single texture per font. Published as the npm package
`phaser4-msdf-font`.

## Technology stack
- **Engine**: Phaser 4 (TypeScript), WebGL renderer
- **Rendering**: custom `BatchHandler` render node with inline GLSL shaders
- **Font data**: JSON atlas produced by `msdf-atlas-gen` (`.json` + `.png`)
- **Build**: Vite (library mode) + `tsc` for declarations

## How it works

**MSDF rendering**
- The atlas PNG stores a distance field in its RGB channels.
- The fragment shader takes the `median()` of the three channels to recover
  the signed distance, then derives coverage from it.
- Anti-aliasing uses screen-space derivatives (`fwidth`), so edge quality is
  independent of the atlas distance range and stays crisp at any zoom.
- `pxRange` (the atlas `distanceRange`) is read from the font JSON at runtime
  and only feeds the outline path — plain AA does not use it.

**Shaders** — inline string arrays in `src/MSDFBatchHandler.ts`:
- Vertex: uniform `uProjectionMatrix`; attributes `inPosition`, `inTexCoord`,
  `inTint`.
- Fragment: uniforms `uMainSampler`, `uPxRange`, `uOutlineWidth`,
  `uOutlineColor`.
- Output is premultiplied alpha (`vec4(rgb * a, a)`) — required by Phaser 4's
  batched pipeline.
- Uses `#extension GL_OES_standard_derivatives : enable` for `fwidth`.
  Phaser 4 fetches this extension unconditionally in
  `WebGLRenderer.setExtensions`, so no game-config flag is needed.
  `installMSDFPlugin()` verifies it and throws a clear error if absent.

**Font data** — `msdf-atlas-gen` JSON, parsed by `src/MSDFFontParser.ts` into a
runtime `MSDFFont`. Contains `atlas` metadata (type, `distanceRange`, size,
dimensions, `yOrigin`), normalized `metrics`, per-glyph plane/atlas bounds, and
kerning pairs.

## Source layout
```
src/
  index.ts                 # Public entry point / exports
  MSDFPlugin.ts            # Global plugin; installMSDFPlugin, cache + extension check
  MSDFFontFile.ts          # Registers the `this.load.msdfFont` loader
  MSDFFontParser.ts        # Parses msdf-atlas-gen JSON
  MSDFFont.ts              # Parsed font: glyph metrics, kerning, measurement
  MSDFText.ts              # Text GameObject (layout, wrap, outline, shadow, callbacks)
  MSDFTextFactory.ts       # add.msdfText factory
  MSDFTextCreator.ts       # make.msdfText creator
  MSDFTextWebGLRenderer.ts # Per-object render function
  MSDFBatchHandler.ts      # Custom BatchHandler render node + GLSL
  BatchMSDFChar.ts         # Packs a character quad into the batch buffer
  phaser-augmentations.ts  # Phaser type augmentations

examples/                  # Vite dev app (`npm run dev`) with feature demos
public/assets/fonts/       # Sample fonts for the dev app only (not shipped to npm)
```

## Documentation
- **CLAUDE.md** — this file: project context and conventions
- **README.md** — installation, API reference, usage
- **FONTS.md** — generating MSDF font atlases

## Gotchas / invariants
- **Premultiplied alpha** — all shader output must be `vec4(rgb * a, a)`.
- **LINEAR filtering** — MSDF relies on linear interpolation of the distance
  field; NEAREST breaks it. Phaser's default LINEAR is correct.
- **V coordinates** — `MSDFFontParser` flips V based on the atlas `yOrigin`
  (`top` → `1 - y/H`, `bottom` → no flip) and normalizes to `v0 < v1`.
  `MSDFText` then swaps `v0`/`v1` again for the batched quad orientation — see
  the note in `MSDFText.ts` around the glyph build.
- **Generation params** — typical `distanceRange` 4 (range 2–8), generation
  `size` 42. `pxRange` is taken from the JSON automatically; there is no
  separate value to keep in sync.

## References
- msdf-atlas-gen — https://github.com/Chlumsky/msdf-atlas-gen
- msdfgen (original MSDF research) — https://github.com/Chlumsky/msdfgen
- Phaser 4 — https://github.com/phaserjs/phaser
- Shader approach inspired by the MIT-licensed Ceramic Engine —
  https://github.com/ceramic-engine/ceramic
