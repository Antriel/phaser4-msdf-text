# MSDFText Refactor Plan - Container to Batched GameObject

## Overview
Refactoring MSDFText from a Container with individual Shader GameObjects to a standalone GameObject with batched rendering.

## Current Implementation (Phase 3)
```typescript
class MSDFText extends Phaser.GameObjects.Container {
    private characterQuads: CharacterQuad[] = [];  // Array of Shader GameObjects

    rebuildText() {
        // Creates one Shader GameObject per character
        for each character:
            const shader = this.scene.add.shader(config, ...);
            this.add(shader);  // Add to Container
            this.characterQuads.push({ shader, charCode });
    }
}
```

**Problems:**
- One draw call per character
- Heavy memory usage (one GameObject per character)
- Slow rendering for long text

## New Implementation (Phase 4)
```typescript
class MSDFText extends Phaser.GameObjects.GameObject {
    private _characters: CharacterData[] = [];  // Array of layout data (not GameObjects)
    private _texture: WebGLTextureWrapper;

    renderWebGL(renderer, drawingContext, parentMatrix) {
        MSDFTextWebGLRenderer(renderer, this, drawingContext, parentMatrix);
    }

    rebuildText() {
        // Calculate character layout data only (no Shader creation)
        for each character:
            this._characters.push({
                x, y, w, h,  // Position and size
                u0, v0, u1, v1  // UV coordinates
            });
    }
}
```

**Benefits:**
- 1-2 draw calls total (batched)
- Minimal memory (just layout data)
- Fast rendering even for long text

## Changes Required

### 1. Class Inheritance
```typescript
// OLD
class MSDFText extends Phaser.GameObjects.Container

// NEW
class MSDFText extends Phaser.GameObjects.GameObject
```

### 2. Properties
```typescript
// REMOVE
private characterQuads: CharacterQuad[] = [];

// ADD
private _characters: CharacterData[] = [];
private _texture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
private _pxRange: number = 4;

// ADD defaultRenderNodes config
defaultRenderNodes = {
    BatchHandler: MSDFBatchHandler  // Custom batch handler instance or string reference
};
```

### 3. renderWebGL Method
```typescript
// ADD
renderWebGL(renderer, drawingContext, parentMatrix) {
    if (this.needsRebuild) {
        this.rebuildText();
        this.needsRebuild = false;
    }
    MSDFTextWebGLRenderer(renderer, this, drawingContext, parentMatrix);
}
```

### 4. rebuildText Method
```typescript
// OLD - Creates Shader GameObjects
rebuildText() {
    const shader = this.scene.add.shader(...);
    this.add(shader);
    this.characterQuads.push({ shader, charCode });
}

// NEW - Creates layout data only
rebuildText() {
    this._characters = [];

    for each character:
        this._characters.push({
            x: charX,
            y: charY,
            w: charWidth,
            h: charHeight,
            u0: char.u0,
            v0: char.v0,
            u1: char.u1,
            v1: char.v1
        });
}
```

### 5. clearCharacters Method
```typescript
// OLD - Destroys Shader GameObjects
clearCharacters() {
    for (const quad of this.characterQuads) {
        quad.shader.destroy();
    }
    this.characterQuads = [];
    this.removeAll();
}

// NEW - Clears data array only
clearCharacters() {
    this._characters = [];
}
```

### 6. updateCharacterColors Method
```typescript
// OLD - Updates shader uniforms
updateCharacterColors() {
    for (const quad of this.characterQuads) {
        quad.shader.setUniform('uTextColor.value', color);
    }
}

// NEW - Just stores color (applied during rendering)
updateCharacterColors() {
    // Color is stored in this._color
    // Applied by MSDFTextWebGLRenderer -> batchHandler.setTextColor()
}
```

### 7. Remove preUpdate
```typescript
// REMOVE (no longer needed since we're not a Container)
preUpdate() {
    if (this.needsRebuild) {
        this.rebuildText();
        this.needsRebuild = false;
    }
}
```

### 8. Constructor Changes
```typescript
// OLD
constructor(...) {
    super(scene, x, y);  // Container constructor
    scene.add.existing(this);
}

// NEW
constructor(...) {
    super(scene, 'MSDFText');  // GameObject constructor with type
    this.setPosition(x, y);
    scene.add.existing(this);

    // Get texture wrapper
    this._texture = scene.sys.textures.getFrame(font.textureKey).glTexture;
    this._pxRange = font.distanceField.distanceRange;
}
```

### 9. Alignment
Alignment logic stays the same, but applies to character data instead of Shader positions:

```typescript
// OLD
applyAlignment() {
    for (const quad of this.characterQuads) {
        quad.shader.x += offset;
    }
}

// NEW
applyAlignment() {
    for (const char of this._characters) {
        char.x += offset;
    }
}
```

## Character Data Interface
```typescript
interface CharacterData {
    x: number;       // X position in text space
    y: number;       // Y position in text space
    w: number;       // Width
    h: number;       // Height
    u0: number;      // UV left
    v0: number;      // UV top
    u1: number;      // UV right
    v1: number;      // UV bottom
}
```

## Integration Steps

1. ✅ Create MSDF shaders (MSDF-vert.js, MSDF-frag.js)
2. ✅ Create MSDFBatchHandler
3. ✅ Create BatchMSDFChar
4. ✅ Create MSDFTextWebGLRenderer
5. ⏳ Refactor MSDFText to GameObject
6. Register MSDFBatchHandler with Phaser
7. Test rendering
8. Verify performance improvements

## Testing Checklist

- [ ] Text renders correctly
- [ ] Text color works
- [ ] Text alignment works (left, center, right)
- [ ] Font size scaling works
- [ ] Multi-line text works
- [ ] Kerning is applied correctly
- [ ] Performance is improved (fewer draw calls)
- [ ] No visual regressions
