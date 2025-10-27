/**
 * MSDF Vertex Shader for Batched Rendering
 *
 * This vertex shader is used by MSDFBatchHandler to render batched MSDF text.
 * It transforms vertex positions and passes through UV coordinates and tint.
 *
 * Based on Phaser's Multi-vert.js but simplified for MSDF text rendering.
 */

export default [
    'precision mediump float;',
    '',
    '// Uniforms',
    'uniform mat4 uProjectionMatrix;',
    'uniform vec2 uResolution;',
    '',
    '// Vertex attributes',
    'attribute vec2 inPosition;',
    'attribute vec2 inTexCoord;',
    'attribute vec4 inTint;',
    '',
    '// Varyings (passed to fragment shader)',
    'varying vec2 outTexCoord;',
    'varying vec4 outTint;',
    '',
    'void main()',
    '{',
    '    // Transform position to clip space',
    '    gl_Position = uProjectionMatrix * vec4(inPosition, 0.0, 1.0);',
    '    ',
    '    // Pass through texture coordinates (already mapped to character in atlas)',
    '    outTexCoord = inTexCoord;',
    '    ',
    '    // Pass through tint color',
    '    outTint = inTint;',
    '}'
].join('\n');
