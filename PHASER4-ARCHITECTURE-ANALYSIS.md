# Phaser 4 GameObject Architecture Analysis

## Overview

After analyzing Phaser 4's source code, here are the key idioms for GameObjects, components, and plugins.

## 1. Component System (Mixins)

Phaser uses plain object mixins, NOT class inheritance for functionality:

```javascript
var Transform = {
    hasTransformComponent: true,      // Marker property
    _scaleX: 1, _scaleY: 1,          // Private fields
    x: 0, y: 0,                      // Public properties
    setPosition: function(x,y) { }   // Methods
};

var Sprite = new Class({
    Extends: GameObject,
    Mixins: [
        Components.Alpha,
        Components.Transform,
        Components.Visible
    ]
});
```

## 2. GameObject Base Structure

```javascript
var GameObject = new Class({
    Extends: EventEmitter,
    Mixins: [Components.Filters, Components.RenderSteps],
    
    initialize: function(scene, type) {
        this.scene = scene;
        this.displayList = null;
        this.type = type;
    }
});
```

Key properties set by Factory/Creator:
- x, y (position)
- scaleX, scaleY
- rotation, alpha
- visible, blendMode
- depth (z-order)

## 3. Factory Pattern

Factory creates and immediately adds to scene:

```javascript
GameObjectFactory.register('sprite', function(x, y, texture, frame) {
    return this.displayList.add(new Sprite(this.scene, x, y, texture, frame));
});

// Usage: scene.add.sprite(100, 100, 'texture')
```

## 4. Creator Pattern

Creator creates from config object, applies BuildGameObject():

```javascript
GameObjectCreator.register('sprite', function(config, addToScene) {
    var sprite = new Sprite(this.scene, 0, 0, key, frame);
    BuildGameObject(this.scene, sprite, config);  // Apply config
    return sprite;
});

// Usage: scene.make.sprite({x: 100, y: 100, key: 'texture', alpha: 0.5})
```

BuildGameObject() applies:
- Position, scale, rotation
- Alpha, blend mode, depth
- Origin, visibility
- Optionally adds to scene

## 5. Registration System

```javascript
GameObjectFactory.register = function(factoryType, factoryFunction) {
    GameObjectFactory.prototype[factoryType] = factoryFunction;  // Add to prototype
};

PluginCache.register('GameObjectFactory', GameObjectFactory, 'add');  // Register plugin
```

This makes scene.add.x() available on all scenes at runtime.

## 6. Plugin Lifecycle

```javascript
boot()           - Called when scene boots (setup displayList, updateList)
start()          - Called when scene starts
shutdown()       - Called when scene shuts down
destroy()        - Called when scene destroyed
```

## 7. RenderNodes (Phaser 4)

RenderNodes replace per-GameObject renderers:

```javascript
var RenderNodes = {
    customRenderNodes: {},      // Custom render nodes per role
    defaultRenderNodes: {},     // Default render nodes
    renderNodeData: {},         // Per-GameObject data
    
    initRenderNodes: function(defaultNodes) { },
    setRenderNodeRole: function(key, renderNode, data) { }
};
```

Roles: Submitter, Transformer, Texturer, Colorizer, BatchHandler

## CRITICAL ISSUE: MSDFTextBatched Self-Adding

Your current code:
```typescript
constructor(...) {
    scene.add.existing(this);  // WRONG!
}
```

This violates Phaser convention. GameObjects should NOT self-add.

Why:
- Prevents using Factory pattern
- Unexpected side effect
- Can't control when/if added

Fix: Remove this line. Let the Factory add it.

## MISSING: Factory and Creator Registration

You need:
1. MSDFTextBatchedFactory.ts - register with GameObjectFactory
2. MSDFTextBatchedCreator.ts - register with GameObjectCreator

Then scene.add.msdfTextBatched() and scene.make.msdfTextBatched() will work.

## RECOMMENDATIONS

### 1. Fix Constructor
```typescript
constructor(scene, x, y, font, text, fontSize) {
    super(scene, 'msdfTextBatched');
    this.font = font;
    this._text = text;
    // DO NOT add to scene!
}
```

### 2. Create Factory
```typescript
GameObjectFactory.register('msdfTextBatched', function(x, y, font, text, fontSize) {
    const obj = new MSDFTextBatched(this.scene, x, y, font, text, fontSize);
    return this.displayList.add(obj);  // Factory adds it
});
```

### 3. Create Creator
```typescript
GameObjectCreator.register('msdfTextBatched', function(config, addToScene) {
    const obj = new MSDFTextBatched(this.scene, 0, 0, config.font, config.text, config.fontSize);
    BuildGameObject(this.scene, obj, config);  // Apply position, alpha, etc.
    return obj;
});
```

### 4. Export Factories
```typescript
import './MSDFTextBatchedFactory';
import './MSDFTextBatchedCreator';
```

### 5. Usage
```typescript
// Works automatically after registration
scene.add.msdfTextBatched(100, 100, font, 'Hello', 42);
scene.make.msdfTextBatched({ x: 100, y: 100, font, text: 'Hello' });
```

## Key Patterns

| Pattern | Purpose |
|---------|---------|
| **Mixins** | Provide components to GameObjects |
| **Factory** | Create + add in one call |
| **Creator** | Create from config with BuildGameObject |
| **RenderWebGL** | Method called by renderer |
| **RenderNodes** | Pluggable rendering system |

## Files Analyzed

- GameObject.js
- GameObjectFactory.js
- GameObjectCreator.js
- BuildGameObject.js
- Sprite.js, SpriteFactory.js, SpriteCreator.js
- Shader.js
- Components/Transform.js, RenderNodes.js
- PluginCache.js

