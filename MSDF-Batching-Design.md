# MSDF Batching Implementation Design

## Current State (Phase 3)
- MSDFText extends Container
- Each character = one Shader GameObject
- Result: One draw call per character (very inefficient)

## Target State (Phase 4)
- MSDFText as standalone GameObject with custom WebGL renderer
- All characters batched using RenderNode pipeline
- Result: 1-2 draw calls for entire text (efficient)

## Architecture

### Pattern: Custom BatchHandler (like BatchHandlerPointLight)

Based on Phaser 4's existing batching implementations, we'll follow the pattern used by `BatchHandlerPointLight`:

1. **Extend BatchHandler** with custom shader
2. **Define custom vertex buffer layout** (position, UV, tint)
3. **Override setupUniforms()** for MSDF-specific uniforms
4. **Create WebGLRenderer** that iterates characters and submits quads

### Components to Implement

#### 1. MSDF Shaders
**Files:** `src/shaders/MSDF-vert.js`, `src/shaders/MSDF-frag.js`

**Vertex Shader:**
```glsl
attribute vec2 inPosition;
attribute vec2 inTexCoord;
attribute vec4 inTint;

uniform mat4 uProjectionMatrix;

varying vec2 outTexCoord;
varying vec4 outTint;

void main() {
    gl_Position = uProjectionMatrix * vec4(inPosition, 1.0, 1.0);
    outTexCoord = inTexCoord;
    outTint = inTint;
}
```

**Fragment Shader:**
```glsl
precision mediump float;

uniform sampler2D uMainSampler;
uniform float uPxRange;
uniform vec4 uTextColor;

varying vec2 outTexCoord;
varying vec4 outTint;

float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

void main() {
    vec3 sample = texture2D(uMainSampler, outTexCoord).rgb;
    float dist = median(sample.r, sample.g, sample.b);
    float alpha = smoothstep(0.4, 0.6, dist);

    // Apply text color (from uniform or tint)
    vec4 color = uTextColor * outTint;

    // Premultiplied alpha (required by Phaser 4)
    gl_FragColor = vec4(color.rgb * alpha, alpha);
}
```

#### 2. MSDFBatchHandler
**File:** `src/MSDFBatchHandler.js`

```javascript
class MSDFBatchHandler extends BatchHandler {
    defaultConfig: {
        name: 'BatchHandlerMSDF',
        shaderName: 'MSDF',
        verticesPerInstance: 4,
        indicesPerInstance: 6,
        vertexSource: MSDFVertShader,
        fragmentSource: MSDFFragShader,
        vertexBufferLayout: {
            usage: 'DYNAMIC_DRAW',
            layout: [
                { name: 'inPosition', size: 2 },    // x, y
                { name: 'inTexCoord', size: 2 },    // u, v
                { name: 'inTint', size: 4 }         // r, g, b, a (tint color)
            ]
        }
    }

    setupUniforms(drawingContext) {
        // Set MSDF-specific uniforms
        this.programManager.setUniform('uPxRange', this._pxRange || 4);
        this.programManager.setUniform('uTextColor', this._textColor || [1, 1, 1, 1]);
        // ... standard uniforms
    }
}
```

#### 3. MSDFTextWebGLRenderer
**File:** `src/MSDFTextWebGLRenderer.js`

Similar to `BitmapTextWebGLRenderer`:
- Get SubmitterNode from GameObject
- Iterate through characters
- For each character, call `BatchMSDFChar()`

#### 4. BatchMSDFChar
**File:** `src/BatchMSDFChar.js`

Similar to `BatchChar`:
- Compute transformed quad vertices (4 corners)
- Extract UV coordinates from character data
- Call `submitterNode.run()` with texture, transform, and tint data

#### 5. MSDFText GameObject (Updated)
**File:** `src/MSDFText.ts` (major refactor)

**Changes:**
- Remove Container inheritance
- Extend `Phaser.GameObjects.GameObject` instead
- Add `renderWebGL` method that delegates to `MSDFTextWebGLRenderer`
- Add `defaultRenderNodes` config (Submitter + BatchHandler)
- Store character layout data (not Shader GameObjects)
- Calculate character positions/UVs in `rebuildText()` but don't create Shaders

## Data Flow

```
MSDFText.renderWebGL()
  ↓
MSDFTextWebGLRenderer (iterate characters)
  ↓
BatchMSDFChar (for each character)
  ↓ (compute quad vertices + UV)
SubmitterQuad.run()
  ↓
MSDFBatchHandler.batch()
  ↓ (accumulate vertices in buffer)
Vertex Buffer
  ↓ (when batch full or render complete)
MSDFBatchHandler.setupUniforms() → set uPxRange, uTextColor
  ↓
drawElements() → MSDF Fragment Shader
  ↓
Result: All characters drawn in 1-2 draw calls
```

## Vertex Buffer Layout

Each character quad = 4 vertices × attributes:

```
Vertex 0 (bottom-left):  [x0, y0, u0, v1, r, g, b, a]
Vertex 1 (top-left):     [x0, y1, u0, v0, r, g, b, a]
Vertex 2 (bottom-right): [x1, y0, u1, v1, r, g, b, a]
Vertex 3 (top-right):    [x1, y1, u1, v0, r, g, b, a]
```

Indices: `[0, 0, 1, 2, 3, 3]` (TRIANGLE_STRIP with degenerate triangles)

## Key Differences from Current Implementation

| Current (Phase 3) | Batched (Phase 4) |
|-------------------|-------------------|
| Container with child Shader GameObjects | Standalone GameObject |
| One Shader per character | One shared shader for all characters |
| Per-character setupUniforms() | One setupUniforms() per batch |
| N draw calls for N characters | 1-2 draw calls total |
| ~10ms for 100 characters | ~1ms for 100 characters (estimated) |

## Integration with Phaser 4

### RenderNode Registration
```javascript
// In game config or initialization
renderNodeManager.add('MSDFBatchHandler', MSDFBatchHandler);
```

### MSDFText Configuration
```javascript
class MSDFText extends Phaser.GameObjects.GameObject {
    defaultRenderNodes = {
        'Submitter': 'SubmitterQuad',      // Standard submitter
        'BatchHandler': 'MSDFBatchHandler'  // Custom MSDF batch handler
    };
}
```

## Implementation Order

1. ✅ Research batching architecture (DONE)
2. ⏳ Create MSDF shaders (MSDF-vert.js, MSDF-frag.js)
3. Create MSDFBatchHandler
4. Create MSDFTextWebGLRenderer + BatchMSDFChar
5. Refactor MSDFText to use batching
6. Test and verify performance improvements

## Expected Performance Gains

- **Before:** 100 characters = 100 draw calls (~10-20ms per frame)
- **After:** 100 characters = 1-2 draw calls (~1-2ms per frame)
- **Improvement:** 5-10x faster rendering for text-heavy scenes

## Risks and Challenges

1. **Shader Complexity:** MSDF shader needs careful handling of median + smoothstep
2. **Uniform Management:** uPxRange and uTextColor need to be accessible to BatchHandler
3. **Per-Text Colors:** Need to handle different text colors efficiently (via tint attribute)
4. **GameObject Refactor:** MSDFText needs significant refactoring (Container → GameObject)

## Fallback Strategy

If custom BatchHandler proves too complex:
- Keep current Container approach
- Optimize by reducing shader switches
- Use shared shader configs where possible
- Accept per-character draw calls but optimize uniform updates
