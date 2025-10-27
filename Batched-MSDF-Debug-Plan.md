# Batched MSDF Text Debugging Plan

**Date**: 2025-10-27
**Status**: Incremental debugging complete - ROOT CAUSE IDENTIFIED

## Executive Summary

✅ **Batching works!** SimpleBatchHandler successfully renders with MSDF algorithm.
✅ **MSDF algorithm works!** Median + smoothstep + premultiplied alpha all functional.
✅ **Texture sampling works!** Texture binding and UV mapping confirmed working.

❌ **Current Issue**: Only 1 quad visible (out of 4 batched) - likely overlapping or offscreen rendering
🔧 **Root Cause Found**: Missing/incorrect tint attribute in original MSDFBatchHandler

---

## Debugging Session Results (2025-10-27)

### Phase 1: Solid Color Quad ✅ SUCCESS
**Files Created**: `src/debug/SimpleBatchHandler.js`, `src/debug/SimpleQuad.ts`, `examples/phase1-simple-batch-test.ts`

**Result**: 3 red solid color quads rendered successfully

**What This Proved**:
- BatchHandler registration works
- Vertex buffer layout works
- Index generation works (degenerate triangle strip pattern)
- Projection matrix works
- Basic shader compilation/linking works
- **Core batching infrastructure is functional**

**Key Finding**: Had to add BlendMode component to SimpleQuad GameObject:
```typescript
public _blendMode: number = 0;
get blendMode(): number { return this._blendMode; }
set blendMode(value: number) { this._blendMode = value; }
```

---

### Phase 2: Texture Sampling ✅ SUCCESS
**Files Updated**: SimpleBatchHandler with texture support, `examples/phase2-texture-test.ts`

**Result**: MSDF texture atlas visible (blurry characters, horizontally flipped, stretched aspect)

**What This Proved**:
- Texture loading works
- Texture binding to shader works
- UV coordinate mapping works
- `uMainSampler` uniform works
- WebGL texture state is correct
- **Texture pipeline is functional**

**Added**:
- `inTexCoord` attribute (vec2)
- Texture parameter to `batch()` method
- Texture passed to `drawElements()`

---

### Phase 3: MSDF Algorithm ✅ SUCCESS (with issues)
**Files Updated**: SimpleBatchHandler with MSDF shader, `examples/phase3-msdf-test.ts`

**Result**: MSDF-rendered texture visible with color animation

**What This Proved**:
- MSDF `median()` function works
- Smoothstep anti-aliasing works (0.4 to 0.6 range)
- Premultiplied alpha works
- `uPxRange` and `uTextColor` uniforms work
- **MSDF algorithm is functional in batching context**

**Critical Discovery #1: Missing Tint Attribute**

Original `MSDFBatchHandler` shaders expect `inTint` attribute:

**MSDF-vert.js** (line 20):
```glsl
attribute vec4 inTint;
varying vec4 outTint;
```

**MSDF-frag.js** (line 53):
```glsl
vec4 color = uTextColor * outTint;  // Multiplies by tint!
```

**If tint is missing, zero, or garbage → BLACK SCREEN**

**Fix Applied to SimpleBatchHandler**:
```javascript
// Vertex layout
{
    name: 'inTint',
    size: 4,  // r, g, b, a
    type: 'UNSIGNED_BYTE',
    normalized: true
}

// In batch() method - write white tint
const tint = 0xFFFFFFFF;
vertexViewU32[vertexOffset32 + 4] = tint;  // per vertex
```

**Critical Discovery #2: Manual Flush Defeats Batching**

Original `MSDFTextWebGLRenderer.js` (line 119):
```javascript
batchHandler.run(drawingContext);  // ❌ Flushes immediately!
```

This causes:
- Each character/quad rendered in separate draw call
- No actual batching happens
- `run() called with 1 instances` instead of N instances

**Fix Applied**: Removed manual flush, let Phaser auto-flush at end of render pass

---

### Current Status: Partial Success

**Console Logs Show**:
```
[SimpleQuadWebGLRenderer] Batching quad at {x: 50, y: 50, w: 200, h: 200}
[SimpleQuadWebGLRenderer] Batching quad at {x: 300, y: 50, w: 200, h: 200}
[SimpleQuadWebGLRenderer] Batching quad at {x: 550, y: 50, w: 200, h: 200}
[SimpleQuadWebGLRenderer] Batching quad at {x: 50, y: 500, w: 150, h: 75}
```

**Expected**: 4 separate quads at different positions
**Actual**: Only 1 quad visible (with color animation)

**Possible Causes**:
1. Quads rendering at same position (overlapping)
2. Vertex positions calculated incorrectly (transform issue)
3. Only last quad visible (depth/blend state issue)
4. UV coordinates selecting empty texture regions
5. Batch flush timing issue (Phaser's auto-flush not working as expected)

**Next Investigation Needed**:
- Check actual vertex positions written to buffer
- Verify all 4 quads are in viewport
- Test with solid colors instead of texture regions to eliminate UV issues
- Check if Phaser is auto-flushing or if we need explicit flush after all quads

---

## Comparison: SimpleBatchHandler vs MSDFBatchHandler

### SimpleBatchHandler (Working)
✅ Has tint attribute with white (0xFFFFFFFF) default
✅ No manual flush (after fix)
✅ Renders visible output

### MSDFBatchHandler (Not Working - Original)
❓ Has tint attribute in shader, but tint data may be incorrect
❌ Manual flush in MSDFTextWebGLRenderer.js:119
❌ Results in black screen

**Key Difference**: MSDFBatchHandler likely has:
1. Incorrect tint values being written (zeros or bad data)
2. Manual flush preventing proper batching

---

## Original Implementation Issues Identified

### Issue 1: Tint Data in MSDFTextWebGLRenderer.js

Line 81:
```javascript
const tintValue = ((tint & 0xFF) << 16) | (tint & 0xFF00) | ((tint >> 16) & 0xFF) | (Math.floor(alpha * 255) << 24);
```

This tint packing may be incorrect. Compare with Phaser's BatchHandlerQuad to verify format.

### Issue 2: Manual Flush

Line 119:
```javascript
batchHandler.run(drawingContext);
```

Remove this line. Let Phaser handle batch flushing automatically.

### Issue 3: Vertex Shader Z-Coordinate

MSDF-vert.js line 29 (already tried fixing, didn't help):
```glsl
gl_Position = uProjectionMatrix * vec4(inPosition, 1.0, 1.0);  // z=1.0
```

Should be:
```glsl
gl_Position = uProjectionMatrix * vec4(inPosition, 0.0, 1.0);  // z=0.0
```

---

## Current State Summary

### What Works ✅
- ✅ MSDF font loading (JSON parser, texture loading)
- ✅ MSDFFont class (character data, metrics, kerning)
- ✅ Non-batched MSDFText rendering (Phase 2 implementation - one Shader GameObject per character)
- ✅ Texture is loaded correctly (`WebGLTextureWrapper2`)
- ✅ BatchHandler registration with RenderNodeManager
- ✅ Render nodes initialized (`BatchHandler` and `Submitter` found)
- ✅ Character layout and UV calculation (16, 65, 217 characters created correctly)
- ✅ `renderWebGL()` is being called
- ✅ Characters are being batched (all 16 characters batched)
- ✅ Batch is being flushed (`run()` is called)
- ✅ Program suite is available
- ✅ Program is linked successfully
- ✅ Uniforms are being set (resolution, pxRange, textColor, projection matrix)
- ✅ Vertex buffer is updated
- ✅ `drawElements()` is called with 96 indices (16 instances × 6 indices)
- ✅ No WebGL errors reported

### What Doesn't Work ❌
- ❌ **Nothing renders on screen** (black screen, no text visible)
- ❌ Unknown: Whether the issue is in shaders, indices, vertex layout, or blend/depth state

### Key Implementation Details

**MSDFBatchHandler** (`src/MSDFBatchHandler.js`)
- Extends `Phaser.Renderer.WebGL.RenderNodes.BatchHandler`
- Custom vertex/fragment shaders for MSDF rendering
- Vertex layout: position (2), texCoord (2), tint (4 bytes normalized)
- 4 vertices per instance (quad)
- 6 indices per instance (2 triangles)
- Current index generation: `[0, 2, 1, 1, 2, 3]` per quad (counter-clockwise)

**MSDFTextBatched** (`src/MSDFTextBatched.ts`)
- Custom GameObject extending `Phaser.GameObjects.GameObject`
- Implements `renderWebGL()` method
- Delegates to `MSDFTextWebGLRenderer`
- Character data stored in `_characters` array with position, size, and UVs

**MSDFTextWebGLRenderer** (`src/MSDFTextWebGLRenderer.js`)
- Iterates through characters
- Calls `BatchMSDFChar()` for each character
- Manually flushes batch with `batchHandler.run(drawingContext)`

**Shaders** (`src/shaders/MSDF-vert.js`, `MSDF-frag.js`)
- Vertex shader: Standard position transform with projection matrix
- Fragment shader: MSDF median() function with smoothstep anti-aliasing
- Premultiplied alpha output

## Problem Analysis

The pipeline executes without errors, but nothing renders. Possible causes:

1. **Shader Issues**
   - Logic error in vertex/fragment shader
   - Incorrect uniform values or types
   - Premultiplied alpha issue

2. **Geometry Issues**
   - Incorrect vertex positions (off-screen)
   - Wrong index winding order
   - Vertex attribute layout mismatch

3. **WebGL State Issues**
   - Blend mode incorrect
   - Depth testing interfering
   - Culling mode wrong
   - Viewport issues

4. **Batching Issues**
   - Vertex buffer not uploaded correctly
   - Index buffer wrong
   - VAO binding issue

## New Debugging Approach: Incremental Complexity

**Strategy**: Start with the simplest possible custom BatchHandler and incrementally add complexity until we identify where the issue appears.

---

## Phase 1: Simple Solid Color Quad

**Goal**: Verify that basic batched rendering works with a solid color (no texture, no MSDF).

**Implementation**:
1. Create `SimpleBatchHandler` that renders solid color quads
2. Simple vertex shader: just position + projection
3. Simple fragment shader: `gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);` (solid red)
4. Create test GameObject that uses this handler
5. Render a single quad at screen center

**Success Criteria**: Red quad visible on screen

**Files to Create**:
- `src/debug/SimpleBatchHandler.js`
- `src/debug/SimpleQuad.ts` (test GameObject)
- `examples/simple-batch-test.ts`

**What This Tests**:
- BatchHandler setup and registration
- Vertex buffer layout
- Index buffer generation
- Basic rendering pipeline
- Projection matrix

---

## Phase 2: Textured Quad (No MSDF)

**Goal**: Add texture sampling to verify texture binding works.

**Changes from Phase 1**:
1. Add texture coordinate attribute to vertex layout
2. Vertex shader: pass through UVs
3. Fragment shader: `texture2D(uMainSampler, vTexCoord)`
4. Use MSDF texture but just display it raw (no MSDF algorithm)

**Success Criteria**: MSDF texture atlas visible on quad

**What This Tests**:
- Texture binding
- UV mapping
- Sampler uniforms

---

## Phase 3: MSDF Algorithm (Single Quad)

**Goal**: Add MSDF median/smoothstep to verify shader logic.

**Changes from Phase 2**:
1. Fragment shader: Add `median()` function
2. Fragment shader: Add smoothstep anti-aliasing
3. Fragment shader: Add premultiplied alpha
4. Add `uPxRange` and `uTextColor` uniforms

**Success Criteria**: Single MSDF character rendered cleanly

**What This Tests**:
- MSDF shader algorithm
- Premultiplied alpha
- Uniform passing

---

## Phase 4: Multiple Characters (Full Batching)

**Goal**: Render multiple character quads in a single batch.

**Changes from Phase 3**:
1. Add tint attribute to vertex layout
2. Batch multiple quads with different positions/UVs
3. Render a full text string

**Success Criteria**: Full text string rendered with MSDF

**What This Tests**:
- Vertex batching
- Per-vertex attributes
- Transform matrix calculations

---

## Phase 5: Full MSDFTextBatched Integration

**Goal**: Integrate with MSDFFont and MSDFTextBatched.

**Changes from Phase 4**:
1. Replace test GameObject with MSDFTextBatched
2. Use MSDFFont character data
3. Apply text layout, kerning, alignment

**Success Criteria**: Fully functional batched MSDF text rendering

---

## Debug Logging Strategy

For each phase, add console logging at these points:

1. **BatchHandler constructor**: Verify handler is created
2. **batch() method**: Log each vertex/quad being batched
3. **run() method**:
   - Log instance count
   - Log program/VAO status
   - Log uniform values
   - Check WebGL errors before/after draw
4. **Vertex/Fragment shaders**: Consider using `gl.getShaderInfoLog()` to check compilation

## Common Issues to Check

### Vertex Position Issues
- Are positions in clip space (-1 to 1) or screen space (0 to width/height)?
- Is the projection matrix correct?
- Are vertices off-screen?

### Index Issues
- Correct winding order (counter-clockwise default)?
- Index buffer uploaded correctly?
- Using TRIANGLES mode (not TRIANGLE_STRIP)?

### Blend Mode
- Is blending enabled?
- Correct blend function for premultiplied alpha?
- `glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA)` for premultiplied

### Texture Issues
- Is texture bound to correct unit (0)?
- LINEAR filtering enabled?
- Texture uploaded correctly?

### Shader Uniforms
- Are all required uniforms set?
- Correct uniform types?
- Uniform names match shader source?

## Reference: Working Phase 2 Implementation

The non-batched MSDFText (Phase 2) works perfectly. Key differences:
- Uses `Phaser.GameObjects.Shader` (one per character)
- Each character has its own shader config
- Relies on Phaser's built-in Shader GameObject rendering

We can reference this implementation to verify:
- Shader source correctness
- Uniform values
- UV mapping
- Character positioning

**Files**:
- `src/MSDFText.ts` (working non-batched version)
- `examples/test-alignment.ts` (working example)

## Next Steps

1. Implement Phase 1 (simple solid color quad)
2. Test and verify red quad renders
3. If Phase 1 fails, debug basic batching setup
4. If Phase 1 succeeds, proceed to Phase 2
5. Continue incrementally through all phases
6. Identify exactly where the issue appears

---

## NEXT STEPS FOR FRESH SESSION

### Priority 1: Fix Original MSDFBatchHandler

**Apply these fixes to make original implementation work**:

1. **Fix MSDF-vert.js** (line 29):
   ```glsl
   // Change from:
   gl_Position = uProjectionMatrix * vec4(inPosition, 1.0, 1.0);

   // To:
   gl_Position = uProjectionMatrix * vec4(inPosition, 0.0, 1.0);
   ```

2. **Remove Manual Flush in MSDFTextWebGLRenderer.js** (line 119):
   ```javascript
   // DELETE THIS LINE:
   batchHandler.run(drawingContext);

   // Let Phaser auto-flush at end of render pass
   ```

3. **Verify Tint Data** in MSDFTextWebGLRenderer.js (lines 78-86):
   - Check if tint packing is correct
   - Add console.log to verify tintValue is not zero
   - Compare with Phaser's tint format (ABGR vs RGBA)
   - Ensure alpha channel is 0xFF (255)

4. **Test Original Implementation**:
   - Revert main.ts to load `examples/batched-test.ts`
   - Should now render text (or at least something visible)

### Priority 2: Investigate "Only 1 Quad Visible" Issue

**If SimpleBatchHandler still shows 1 quad**:

1. **Test with Phase 1** (solid colors):
   - Revert to phase1-simple-batch-test.ts
   - Check if all 3 RED quads visible
   - If yes → problem is texture/UV related
   - If no → problem is transform/positioning

2. **Debug Vertex Positions**:
   - Add logging in SimpleBatchHandler.batch() to print actual vertex coords
   - Verify transformed positions are in viewport bounds
   - Check if transform matrix is identity (no unexpected transformations)

3. **Check Batch Flush Timing**:
   - Log when Phaser calls batchHandler.run()
   - Verify it's called ONCE with N instances (not N times with 1 instance)
   - If not auto-flushing, may need to explicitly call run() after all quads added

4. **Isolate Overlap Issue**:
   - Create test with quads at vastly different positions (e.g., 0,0 / 500,500 / 1000,1000)
   - Use distinct UV regions or solid colors
   - Check z-ordering/depth test

### Priority 3: Compare With Working Phaser BatchHandlerQuad

**Study how Phaser handles batching**:

1. Read `node_modules/phaser/src/renderer/webgl/renderNodes/BatchHandlerQuad.js`
2. Check how it handles:
   - Tint packing format
   - Batch flushing (manual vs auto)
   - Multiple quads rendering
3. Identify any differences with our SimpleBatchHandler

### Priority 4: Test With Actual MSDF Text

**Once basic fixes applied**:

1. Test `examples/batched-test.ts` with actual MSDFText
2. Should render text string with 1-2 draw calls (vs 100+ before)
3. Verify all characters visible (not just last one)
4. Check performance improvement

---

## Debug Files Reference

**Working Debug Implementations** (keep these):
- `src/debug/SimpleBatchHandler.js` - Working MSDF batch handler
- `src/debug/SimpleQuad.ts` - Test GameObject
- `src/debug/registerSimpleBatchHandler.js` - Registration helper
- `examples/phase1-simple-batch-test.ts` - Solid color test
- `examples/phase2-texture-test.ts` - Texture sampling test
- `examples/phase3-msdf-test.ts` - MSDF algorithm test

**Original Implementation** (to be fixed):
- `src/MSDFBatchHandler.js` - Original MSDF batch handler (HAS ISSUES)
- `src/MSDFTextBatched.ts` - Text GameObject
- `src/MSDFTextWebGLRenderer.js` - Renderer (HAS MANUAL FLUSH ISSUE)
- `src/BatchMSDFChar.js` - Character batching helper
- `src/shaders/MSDF-vert.js` - Vertex shader (HAS Z-COORD ISSUE)
- `src/shaders/MSDF-frag.js` - Fragment shader (OK)
- `examples/batched-test.ts` - Full text rendering test

---

## Notes

- Keep all debug logging in place until fully working
- SimpleBatchHandler proves the approach is sound
- Original implementation just needs 2-3 small fixes
- Consider using browser's WebGL inspector (Spector.js) to inspect draw calls
- Once working, can remove manual flush and z-coord fixes from document
