# Phase 5: Advanced Features Guide

## Overview

Phase 5 adds advanced text rendering features to the MSDF font system, focusing on dynamic effects, text flow, and visual enhancements. This phase builds on the batched rendering foundation from Phase 4.

## Status Summary

### ✅ Completed (Phase 5.1 & 5.2)

- **Phase 5.1: Word Wrapping** - Automatic text flow with detailed bounds
- **Phase 5.2: Display Callbacks** - Per-character effects (wave, rainbow, rotation, etc.)

### 🚧 Remaining (Phase 5.3-5.5)

- **Phase 5.3: Multi-Color Text** - Per-character color arrays
- **Phase 5.4: Text Effects** - Shadow and shader-based outline
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

## Phase 5.4: Text Effects 🚧 PLANNED

### Shadow Effect (Two-Pass Rendering)

**Complexity**: Low
**Performance**: 2x draw calls per text object

**Implementation:**

1. **Add to MSDFTextBatched.ts:**
   ```typescript
   private _shadowOffset: { x: number; y: number } = { x: 0, y: 0 };
   private _shadowColor: number = 0x000000;
   private _shadowAlpha: number = 0.5;

   setShadow(offsetX: number, offsetY: number, color: number, alpha: number): this {
       this._shadowOffset = { x: offsetX, y: offsetY };
       this._shadowColor = color;
       this._shadowAlpha = alpha;
       return this;
   }

   clearShadow(): this {
       this._shadowOffset = { x: 0, y: 0 };
       return this;
   }

   hasShadow(): boolean {
       return this._shadowOffset.x !== 0 || this._shadowOffset.y !== 0;
   }
   ```

2. **Modify MSDFTextWebGLRenderer.js:**
   ```javascript
   function MSDFTextWebGLRenderer(renderer, src, drawingContext, parentMatrix) {
       // ... existing setup ...

       if (src.hasShadow()) {
           // First pass: Render shadow
           const shadowMatrix = calcMatrix.clone();
           shadowMatrix.translate(src._shadowOffset.x, src._shadowOffset.y);

           const shadowTint = calculateShadowTint(src._shadowColor, src._shadowAlpha);

           // Batch all characters with shadow matrix and tint
           for (let i = 0; i < characterCount; i++) {
               BatchMSDFChar(drawingContext, batchHandler, texture,
                            characters[i], shadowMatrix, shadowTint);
           }
       }

       // Second pass: Render main text (existing code)
       for (let i = 0; i < characterCount; i++) {
           // ... existing character batching ...
       }
   }
   ```

### Shader-Based Outline

**Complexity**: High (shader modification)
**Performance**: Single pass, no extra draw calls

**Implementation:**

1. **Modify shaders/msdf/MSDFFont.frag:**
   ```glsl
   uniform float uOutlineThickness;  // 0 = no outline
   uniform vec4 uOutlineColor;

   void main() {
       vec3 msdfSample = texture2D(iChannel0, vTextureCoord).rgb;
       float dist = median(msdfSample.r, msdfSample.g, msdfSample.b);

       float pxRange = uPxRange;
       vec2 unitRange = vec2(pxRange) / uTexSize;
       vec2 screenTexSize = vec2(1.0) / fwidth(vTextureCoord);
       float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);
       float screenPxDistance = screenPxRange * (dist - 0.5);

       // Text layer
       float textAlpha = clamp(screenPxDistance + 0.5, 0.0, 1.0);

       // Outline layer
       float outlineAlpha = 0.0;
       if (uOutlineThickness > 0.0) {
           float outlineEdge = screenPxDistance + uOutlineThickness;
           outlineAlpha = clamp(outlineEdge + 0.5, 0.0, 1.0);
       }

       // Composite: outline behind text
       vec4 outlineResult = uOutlineColor * outlineAlpha;
       vec4 textResult = uTextColor * textAlpha;
       vec4 finalColor = mix(outlineResult, textResult, textAlpha);

       // Premultiply alpha
       gl_FragColor = vec4(finalColor.rgb * finalColor.a, finalColor.a);
   }
   ```

2. **Update src/MSDFShader.ts:**
   - Add `uOutlineThickness` and `uOutlineColor` to shader config

3. **Add to MSDFTextBatched.ts:**
   ```typescript
   private _outlineThickness: number = 0;
   private _outlineColor: number = 0x000000;

   setOutline(thickness: number, color: number): this;
   clearOutline(): this;
   ```

4. **Update MSDFBatchHandler:**
   - Pass outline uniforms to shader during rendering

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

**Next Session:**
- 🚧 Phase 5.3: Multi-Color Text (per-character color arrays)
- 🚧 Phase 5.4: Text Effects (shadow + shader outline)
- 🚧 Phase 5.5: Character Queries (hit testing)

**Key Achievements:**
- Flexible callback system enabling unlimited effects
- Center-pivot rotation and scaling
- Optimal performance through object reuse
- Clean API that builds on Phase 4 batching

**All test pages working:**
- http://localhost:3000/word-wrap-test.html
- http://localhost:3000/callback-effects-test.html
