# Phase 5: Advanced Features Guide

## Overview

Phase 5 adds advanced text rendering features to the MSDF font system, focusing on dynamic effects, text flow, and visual enhancements. This phase builds on the batched rendering foundation from Phase 4.

## Status Summary

### ✅ Completed (Phase 5.1, 5.2 & 5.4)

- **Phase 5.1: Word Wrapping** - Automatic text flow with detailed bounds
- **Phase 5.2: Display Callbacks** - Per-character effects (wave, rainbow, rotation, etc.)
- **Phase 5.4: Text Effects** - Shader-based outline and two-pass shadow rendering

### 🚧 Remaining (Phase 5.3 & 5.5)

- **Phase 5.3: Multi-Color Text** - Per-character color arrays
- **Phase 5.5: Character Queries** - Hit testing and character position queries

---

## Phase 5.1: Word Wrapping ✅

### What Was Built

Automatic word wrapping that respects existing newlines, supports all alignments, and provides detailed text bounds information.

### Files Modified

1. **src/MSDFTextBatched.ts**
   - Added: `_maxWidth`, `_wordWrapCharCode` properties
   - Added: `setMaxWidth()`, `getMaxWidth()`, `setWordWrapCharCode()`, `getWordWrapCharCode()`
   - Added: `wrapText()` private method (word wrapping algorithm)
   - Enhanced: `getTextBounds()` returns detailed line information
   - Updated: `rebuildText()` applies wrapping before layout

2. **src/MSDFFont.ts**
   - Added: `measureLines()` method for detailed line measurements

3. **examples/word-wrap-test.ts** + **word-wrap-test.html**
   - Comprehensive test with 3 text samples
   - Interactive maxWidth adjustment (UP/DOWN arrows)
   - Real-time bounds display

### Key Implementation Details

**Word Wrapping Algorithm:**
```typescript
private wrapText(text: string, maxWidth: number): string {
    // 1. Split by existing newlines first
    const existingLines = text.split('\n');

    // 2. For each line:
    for (const line of existingLines) {
        let currentLine = '';
        let currentWord = '';

        // 3. Build words character by character
        for (let i = 0; i < line.length; i++) {
            const charCode = line.charCodeAt(i);

            if (charCode === this._wordWrapCharCode) {
                // 4. At word boundary, measure and decide
                const testLine = currentLine + currentWord + char;
                const { width } = this.font.measureText(testLine, this._fontSize);

                if (width > maxWidth && currentLine.length > 0) {
                    // Wrap to new line
                    wrappedLines.push(currentLine.trim());
                    currentLine = currentWord + char;
                } else {
                    // Fits on current line
                    currentLine += currentWord + char;
                }
                currentWord = '';
            } else {
                currentWord += char;
            }
        }
    }

    return wrappedLines.join('\n');
}
```

**Key Insights:**
- Wrapping happens **before** character layout (in `rebuildText()`)
- Uses `font.measureText()` which includes kerning
- Preserves existing `\n` characters in original text
- Only recalculates when `_text` or `_maxWidth` changes (via `needsRebuild` flag)

### API Reference

```typescript
// Enable word wrapping
text.setMaxWidth(400);  // Wrap at 400 pixels (0 = no wrapping)

// Change wrap character
text.setWordWrapCharCode(32);  // Space (default)
text.setWordWrapCharCode(45);  // Hyphen

// Get detailed bounds
const bounds = text.getTextBounds();
console.log(bounds.width);           // Total width
console.log(bounds.height);          // Total height
console.log(bounds.lines.count);     // Number of lines
console.log(bounds.lines.lengths);   // Array of line widths
console.log(bounds.lines.shortest);  // Shortest line width
console.log(bounds.lines.longest);   // Longest line width
```

### Testing

**Test Page:** http://localhost:3000/word-wrap-test.html

**What to Test:**
1. Long text wraps at maxWidth boundary
2. UP/DOWN arrows adjust maxWidth in real-time
3. All three text samples wrap correctly
4. Bounds display updates immediately
5. FPS stays at 60 (wrapping cached until text/maxWidth changes)

---

## Phase 5.2: Display Callbacks ✅

### What Was Built

Per-character callback system enabling unlimited dynamic text effects through a flexible API. Characters can have position, scale, rotation, and per-corner tint modifications applied every frame.

### Files Modified

1. **src/MSDFTextBatched.ts**
   - Added: `DisplayCallbackData`, `DisplayCallbackTint` interfaces
   - Added: `DisplayCallback` type definition
   - Extended: `CharacterData` interface with optional callback fields
   - Added: `displayCallback` property, `callbackData` object (reused)
   - Added: `setDisplayCallback()`, `clearDisplayCallback()` methods
   - Updated: `rebuildText()` stores `charCode`, `originalX`, `originalY` for each character

2. **src/MSDFTextWebGLRenderer.js**
   - Added: Temporary objects for callbacks (reused to avoid allocations)
   - Added: `tempCharData`, `tempCharMatrix` for per-character transforms
   - Enhanced: Character render loop with callback invocation
   - Implemented: Per-character matrix composition for rotation/scale
   - Fixed: Transform pivot at character center (not top-left)
   - Fixed: Object reference comparison bug (store original values before callback)

3. **examples/callback-effects-test.ts** + **callback-effects-test.html**
   - 6 different effects demonstrated:
     - Wave (vertical sine wave)
     - Rainbow (color gradient)
     - Breathing (scale pulsing)
     - Jiggle (random position offsets)
     - Rotation (spinning characters)
     - Combined (all effects together)

### Key Implementation Details

**Callback Invocation Flow:**
```javascript
// In MSDFTextWebGLRenderer.js, for each character:

// 1. Store original values BEFORE callback
const originalX = char.originalX !== undefined ? char.originalX : char.x;
const originalY = char.originalY !== undefined ? char.originalY : char.y;

// 2. Populate callback data
callbackData.index = i;
callbackData.charCode = char.charCode;
callbackData.x = originalX;
callbackData.y = originalY;
callbackData.scale = 1;
callbackData.rotation = 0;
callbackData.tint = { topLeft, topRight, bottomLeft, bottomRight };

// 3. Invoke callback
const result = src.displayCallback(callbackData);

// 4. Detect changes by comparing to ORIGINAL values
const posChanged = result.x !== originalX || result.y !== originalY;
const scaleChanged = result.scale !== 1;
const rotationChanged = result.rotation !== 0;

// 5. Apply transforms via matrix
if (scaleChanged || rotationChanged) {
    const centerX = char.w / 2;
    const centerY = char.h / 2;

    // Start with parent transform
    tempCharMatrix.copyFrom(calcMatrix);

    // Translate to character position + center
    tempCharMatrix.translate(result.x + centerX, result.y + centerY);

    // Apply rotation around center
    if (rotationChanged) {
        tempCharMatrix.rotate(result.rotation);
    }

    // Apply scale from center
    if (scaleChanged) {
        tempCharMatrix.scale(result.scale, result.scale);
    }

    // Offset quad to draw centered on transform
    tempCharData.x = -centerX;
    tempCharData.y = -centerY;
}
```

**Critical Bugs Fixed:**

1. **Reference Comparison Bug** (lines 131-158)
   - **Problem**: Comparing `result.x !== callbackData.x` always false because they're the same object
   - **Solution**: Store `originalX` and `originalY` **before** callback, compare against those

2. **Rotation Pivot Bug** (lines 169-200)
   - **Problem**: Characters rotating around top-left corner, flying off-screen
   - **Solution**: Position matrix at character center, offset quad by `(-centerX, -centerY)`

3. **Matrix Composition Order** (lines 175-189)
   - **Problem**: Using `applyITRS()` then `multiply()` produced wrong transform hierarchy
   - **Solution**: `copyFrom(parent)` then apply character transforms step-by-step

### API Reference

```typescript
// Callback signature
type DisplayCallback = (data: DisplayCallbackData) => DisplayCallbackData;

interface DisplayCallbackData {
    parent: MSDFText;      // Reference to text object
    index: number;         // Character index (0-based)
    charCode: number;      // Character code
    x: number;             // Position (modifiable)
    y: number;
    scale: number;         // Scale (modifiable, 1 = normal)
    rotation: number;      // Rotation in radians (modifiable)
    tint: {                // Per-corner tint (modifiable)
        topLeft: number;    // ABGR format: (A << 24) | (B << 16) | (G << 8) | R
        topRight: number;
        bottomLeft: number;
        bottomRight: number;
    };
    data: any;             // Custom user data
}

// Set callback
text.setDisplayCallback((data) => {
    // Modify data properties
    data.y += Math.sin(data.index * 0.5 + time * 0.003) * 15;
    data.scale = 1.2;
    data.rotation = Math.PI / 4;

    // Tint format: ABGR (Alpha, Blue, Green, Red)
    data.tint.topLeft = 0xFFFF00FF;  // Yellow

    return data;  // Must return data
});

// Clear callback
text.clearDisplayCallback();
```

**Effect Examples:**

```typescript
// Wave effect
text.setDisplayCallback((data) => {
    data.y += Math.sin(data.index * 0.5 + time * 0.003) * 15;
    return data;
});

// Rainbow colors
text.setDisplayCallback((data) => {
    const hue = (data.index * 30 + time * 0.1) % 360;
    const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1);
    const tint = (255 << 24) | (color.b << 16) | (color.g << 8) | color.r;
    data.tint.topLeft = tint;
    data.tint.topRight = tint;
    data.tint.bottomLeft = tint;
    data.tint.bottomRight = tint;
    return data;
});

// Breathing/pulsing
text.setDisplayCallback((data) => {
    data.scale = 1 + Math.sin(data.index * 0.2 + time * 0.002) * 0.3;
    return data;
});

// Rotation (around character center)
text.setDisplayCallback((data) => {
    data.rotation = time * 0.002 + data.index * 0.2;
    return data;
});

// Jiggle (smooth random motion)
text.setDisplayCallback((data) => {
    const jiggleX = Math.sin(time * 0.01 + data.index * 1.5) * 3;
    const jiggleY = Math.cos(time * 0.012 + data.index * 1.7) * 3;
    data.x += jiggleX;
    data.y += jiggleY;
    return data;
});
```

### Performance Optimization

**Object Reuse Pattern:**
- `callbackData` - Reused across all characters, all frames
- `tempCharData` - Reused when character properties change
- `tempCharMatrix` - Reused when rotation/scale applied
- **Result**: Zero per-frame allocations, smooth 60 FPS

### Testing

**Test Page:** http://localhost:3000/callback-effects-test.html

**What to Test:**
1. Wave effect - Characters move in sine wave
2. Rainbow - Colors cycle smoothly
3. Breathing - Characters pulse in size
4. Jiggle - Random smooth motion
5. Rotation - Characters spin around their centers (NOT top-left)
6. Combined - All effects work together
7. Performance - 60 FPS with all effects running

**Performance Check:**
- Open DevTools Performance tab
- Record 5 seconds
- Verify consistent 16.67ms frame time
- Check for memory leaks (should stabilize)
- Verify minimal GC (objects reused)

---

## Phase 5.3: Multi-Color Text 🚧 NEXT SESSION

### Goal

Static per-character color arrays for multi-color text without callbacks.

### Implementation Plan

1. **Add to MSDFTextBatched.ts:**
   ```typescript
   private _characterColors?: number[];  // ABGR format

   setCharacterColors(colors: number[]): this {
       this._characterColors = colors;
       return this;
   }

   clearCharacterColors(): this {
       this._characterColors = undefined;
       return this;
   }
   ```

2. **Modify MSDFTextWebGLRenderer.js:**
   ```javascript
   // In character render loop, check for per-character color
   let charTint = tempTintData;  // Default

   if (src._characterColors && i < src._characterColors.length) {
       const colorValue = src._characterColors[i];
       charTint = {
           tintTopLeft: colorValue,
           tintTopRight: colorValue,
           tintBottomLeft: colorValue,
           tintBottomRight: colorValue
       };
   }

   // Callback tint takes precedence
   if (hasCallback && tintChanged) {
       charTint = callbackTintData;
   }
   ```

3. **Create multi-color-test.ts:**
   - Rainbow text (static colors)
   - Alternating colors
   - Gradient text
   - Callback + colors interaction

### API Design

```typescript
// Generate rainbow colors
const colors = text.getText().split('').map((_, i) => {
    const hue = (i * 30) % 360;
    const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1);
    return (255 << 24) | (color.b << 16) | (color.g << 8) | color.r;
});
text.setCharacterColors(colors);

// Alternating colors
const colors = text.getText().split('').map((_, i) =>
    i % 2 === 0 ? 0xFF0000FF : 0x0000FFFF  // Red/Blue
);
text.setCharacterColors(colors);

// Clear colors
text.clearCharacterColors();
```

**Priority Order:**
1. Callback tint (highest priority - dynamic)
2. Character colors (medium priority - static)
3. Global tint (lowest priority - fallback)

---

## Phase 5.4: Text Effects ✅

### What Was Built

Shader-based outline (single-pass) and two-pass shadow rendering with full callback support. Both effects work independently or combined, with automatic batching optimization.

### Files Modified

1. **src/MSDFBatchHandler.js**
   - Modified: Fragment shader to add outline support
   - Added: `uOutlineWidth` and `uOutlineColor` uniforms
   - Added: Background fade to prevent artifacts
   - Added: `_outlineWidth`, `_outlineColor` properties
   - Added: `setOutline()` method with NaN validation
   - Added: `hasOutlineChanged()` for batch flushing detection
   - Enhanced: `setupUniforms()` to pass outline parameters to shader

2. **src/MSDFTextBatched.ts**
   - Added: Outline properties (`_outlineWidth`, `_outlineColor`)
   - Added: Shadow properties (`_shadowOffset`, `_shadowColor`, `_shadowAlpha`)
   - Added: `setOutline()`, `clearOutline()`, `hasOutline()` methods
   - Added: `setShadow()`, `clearShadow()`, `hasShadow()` methods

3. **src/MSDFTextWebGLRenderer.js**
   - Added: Outline batch flushing logic (before character rendering)
   - Added: Shadow pass rendering (before main text pass)
   - Enhanced: Shadow pass respects display callbacks
   - Fixed: NaN validation for outline parameters

4. **examples/outline-test.ts** + **outline-test.html**
   - 5 text samples with different outline styles
   - Interactive controls (UP/DOWN for width, 1-5 for colors)
   - Real-time outline parameter adjustment

5. **examples/shadow-test.ts** + **shadow-test.html**
   - 5 text samples including callback-aware shadow
   - Interactive controls (arrows for offset, +/- for alpha)
   - Wave effect with shadow following the animation

### Key Implementation Details

#### Outline Effect (Shader-Based)

**Fragment Shader Algorithm:**
```glsl
// Calculate edges
float outlineEdge = 0.5 - (uOutlineWidth / uPxRange);
float textEdge = 0.5;

// Alpha for text and outline region
float textAlpha = smoothstep(textEdge - 0.05, textEdge + 0.05, dist);
float outsideOutline = smoothstep(outlineEdge - 0.05, outlineEdge + 0.05, dist);
float outsideText = 1.0 - textAlpha;

// Background fade prevents artifacts
float backgroundFade = smoothstep(0.0, 0.2, dist);

// Outline visible in ring: outside outline boundary AND outside text AND not far background
float outlineAlpha = outsideOutline * outsideText * backgroundFade;

// Composite text over outline
vec4 outlineResult = uOutlineColor * outlineAlpha;
vec4 textResult = outTint * textAlpha;
float finalAlpha = textA + outlineA * (1.0 - textA);
vec3 finalRGB = (textRGB * textA + outlineRGB * outlineA * (1.0 - textA)) / finalAlpha;

// Output premultiplied alpha
gl_FragColor = vec4(finalRGB * finalAlpha, finalAlpha);
```

**Key Insights:**
1. **Ring Creation**: `outsideOutline * outsideText` creates the ring between boundaries
2. **Background Fade**: `smoothstep(0.0, 0.2, dist)` prevents black squares on far background
3. **Batch Flushing**: Different outline settings trigger batch flush via `hasOutlineChanged()`
4. **No Extra Draw Calls**: Outline rendered in same pass as text

**Debugging Journey:**
- Initial attempt had full black squares behind letters (outline alpha covered entire quad)
- Fixed by multiplying `outsideOutline * outsideText * backgroundFade` to create proper ring mask
- NaN validation added after debugging showed invalid data propagation

#### Shadow Effect (Two-Pass Rendering)

**Render Pass Algorithm:**
```javascript
// SHADOW PASS (renders first, behind text)
if (src.hasShadow()) {
    const shadowOffset = src._shadowOffset;
    const shadowColor = src._shadowColor;
    const shadowAlpha = src._shadowAlpha;

    // Calculate shadow tint (ABGR format)
    const shadowTintValue = (shadowA << 24) | (shadowB << 16) | (shadowG << 8) | shadowR;

    // Render each character with shadow offset
    for (let i = 0; i < characterCount; i++) {
        const char = characters[i];

        // Apply offset
        tempCharData.x = char.x + shadowOffset.x;
        tempCharData.y = char.y + shadowOffset.y;
        // ... copy other char data ...

        // Apply display callback to shadow if present
        if (hasCallback) {
            callbackData.x = originalX + shadowOffset.x;
            callbackData.y = originalY + shadowOffset.y;
            const result = src.displayCallback(callbackData);

            // Apply transforms to shadow (rotation, scale, position)
            if (scaleChanged || rotationChanged) {
                // Build matrix with shadow transforms
                tempCharMatrix.copyFrom(calcMatrix);
                tempCharMatrix.translate(result.x + centerX, result.y + centerY);
                // ... apply rotation/scale ...
            }
        }

        // Batch shadow character
        BatchMSDFChar(drawingContext, batchHandler, texture, shadowCharData, shadowMatrix, shadowTint);
    }
}

// MAIN TEXT PASS (existing code continues)
```

**Key Insights:**
1. **Shadow First**: Shadow pass renders before text pass, so text appears on top
2. **Callback-Aware**: Shadows receive same callback as text, follow wave/rotation/scale
3. **Offset Application**: Shadow offset added to callback position (`originalX + shadowOffset.x`)
4. **Performance**: 2x draw calls per text object (shadow batch + text batch)

### API Reference

```typescript
// Outline API
text.setOutline(width: number, color: number, alpha?: number): this
text.clearOutline(): this
text.hasOutline(): boolean

// Examples
text.setOutline(1.5, 0x000000, 1.0);  // Black outline
text.setOutline(2.0, 0xff0000, 0.8);  // Red semi-transparent
text.clearOutline();

// Shadow API
text.setShadow(offsetX: number, offsetY: number, color?: number, alpha?: number): this
text.clearShadow(): this
text.hasShadow(): boolean

// Examples
text.setShadow(4, 4, 0x000000, 0.7);  // Classic drop shadow
text.setShadow(3, 3, 0x0000ff, 0.5);  // Blue shadow
text.clearShadow();

// Combined
text.setOutline(1.5, 0x000000, 1.0);
text.setShadow(4, 4, 0x000000, 0.6);
text.setDisplayCallback((data) => {
    // Wave effect - both outline and shadow follow
    data.y += Math.sin(data.index * 0.5 + time * 0.003) * 20;
    return data;
});
```

### Critical Bugs Fixed

**1. Black Squares Issue (Outline)**
- **Problem**: Outline alpha covered entire character quad, creating black squares
- **Root Cause**: `outlineAlpha = smoothstep(outlineEdge, ...)` was 1.0 across most of background
- **Solution**: Ring masking: `outsideOutline * outsideText * backgroundFade`
- **Result**: Clean outline ring, no background artifacts

**2. NaN Propagation**
- **Problem**: Invalid outline data (NaN) caused rendering failures
- **Solution**: Added validation in `setOutline()` and renderer
- **Prevention**: All color/width values checked before use

**3. Batch Flushing**
- **Problem**: Multiple text objects shared batch handler, last outline settings won
- **Solution**: `hasOutlineChanged()` detects setting changes, flushes batch before applying new values
- **Trade-off**: More draw calls when outline settings differ, but correct per-text rendering

### Performance Characteristics

**Outline Effect:**
- **Draw Calls**: Same as no outline (single pass)
- **Batch Behavior**: Flushes when outline settings change between texts
- **Shader Cost**: Minimal (one if-branch, simple arithmetic)

**Shadow Effect:**
- **Draw Calls**: 2x per text object (shadow pass + text pass)
- **Batch Behavior**: Characters batch within each pass
- **CPU Cost**: 2x character loop iterations
- **Callback Impact**: Shadow follows callback transforms (same cost)

**Combined (Outline + Shadow):**
- **Draw Calls**: 2x (shadow pass + text pass with outline)
- **Outline**: Free in shader, no extra passes
- **Total Overhead**: Only shadow pass adds cost

### Testing

**Test Pages:**
- http://localhost:3000/outline-test.html
- http://localhost:3000/shadow-test.html

**Outline Test - What to Test:**
1. UP/DOWN arrows change outline width (0-5 range)
2. Keys 1-5 change outline color (black, white, red, blue, yellow)
3. All 5 text samples update in real-time
4. No black squares or background artifacts
5. 60 FPS maintained

**Shadow Test - What to Test:**
1. Arrow keys adjust shadow offset (-20 to +20)
2. Keys 1-5 change shadow color
3. +/- keys adjust shadow alpha (transparency)
4. Wave effect text has shadow following the wave motion
5. 60 FPS with all shadows rendering

**Performance Check:**
- Outline test: ~5-10 draw calls (one batch per text with different settings)
- Shadow test: ~10 draw calls (2x per text object)
- Combined: 2x draw calls per text, outline is free in shader

---

## Phase 5.5: Character Queries & Hit Testing 🚧 PLANNED

### Goal

Enable interaction with individual characters through position queries and hit testing.

### Implementation Plan

1. **Add to MSDFTextBatched.ts:**
   ```typescript
   getCharacterAt(index: number): CharacterData | undefined {
       return this._characters[index];
   }

   getCharacterBounds(index: number): { x: number; y: number; w: number; h: number } | undefined {
       const char = this._characters[index];
       if (!char) return undefined;

       return {
           x: this.x + char.x,  // World space
           y: this.y + char.y,
           w: char.w,
           h: char.h
       };
   }

   getCharacterIndexAt(worldX: number, worldY: number): number {
       // Convert to local space
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

       return -1;  // Not found
   }
   ```

2. **Create hit-testing-test.ts:**
   - Click on character to highlight
   - Hover effects per character
   - Character selection and manipulation

---

## Development Notes for Next Session

### Files to Modify (Phase 5.3)

1. `src/MSDFTextBatched.ts` - Add character colors properties and methods
2. `src/MSDFTextWebGLRenderer.js` - Check for per-character colors, apply with priority
3. `examples/multi-color-test.ts` - Create comprehensive examples
4. `multi-color-test.html` - HTML test page

### Key Implementation Points

1. **Tint Priority**: Callback > CharacterColors > GlobalTint
2. **ABGR Format**: `(A << 24) | (B << 16) | (G << 8) | R`
3. **Array Length**: Handle cases where `_characterColors.length < _characters.length`
4. **Performance**: No per-frame allocations, reuse tint objects

### Testing Checklist

- [ ] Rainbow text (static colors)
- [ ] Alternating colors (red/blue)
- [ ] Gradient (smooth color transition)
- [ ] Callback + colors interaction (callback should win)
- [ ] Performance: 60 FPS with colors
- [ ] Memory: No leaks, stable memory usage

---

## Summary

**Completed:**
- ✅ Phase 5.1: Word Wrapping (automatic text flow, detailed bounds)
- ✅ Phase 5.2: Display Callbacks (wave, rainbow, breathing, rotation effects)
- ✅ Phase 5.4: Text Effects (shader-based outline + two-pass shadow)

**Remaining:**
- 🚧 Phase 5.3: Multi-Color Text (per-character color arrays)
- 🚧 Phase 5.5: Character Queries (hit testing)

**Key Achievements:**
- Flexible callback system enabling unlimited effects
- Center-pivot rotation and scaling
- Shader-based outline (no extra draw calls)
- Callback-aware shadows (follow wave/rotation/scale)
- Background fade prevention for clean rendering
- Optimal performance through object reuse and batching
- Clean API that builds on Phase 4 batching

**All test pages working:**
- http://localhost:3000/word-wrap-test.html
- http://localhost:3000/callback-effects-test.html
- http://localhost:3000/outline-test.html
- http://localhost:3000/shadow-test.html
