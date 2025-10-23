/**
 * MSDF Fragment Shader for Batched Rendering
 *
 * This fragment shader implements Multi-channel Signed Distance Field (MSDF)
 * text rendering for batched characters.
 *
 * MSDF Algorithm:
 * 1. Sample RGB channels from texture (distance field data)
 * 2. Calculate median(r, g, b) to get signed distance
 * 3. Apply smoothstep for anti-aliasing
 * 4. Output premultiplied alpha (required by Phaser 4)
 *
 * Based on the Ceramic Engine MSDF implementation (MIT licensed).
 */

export default [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    '',
    '// Uniforms',
    'uniform sampler2D uMainSampler;',
    'uniform vec2 uResolution;',
    'uniform float uPxRange;',
    'uniform vec4 uTextColor;',
    '',
    '// Varyings (from vertex shader)',
    'varying vec2 outTexCoord;',
    'varying vec4 outTint;',
    '',
    '// Median function - the heart of MSDF',
    '// Extracts signed distance from RGB channels',
    'float median(float r, float g, float b)',
    '{',
    '    return max(min(r, g), min(max(r, g), b));',
    '}',
    '',
    'void main()',
    '{',
    '    // Sample the MSDF texture at character-specific UV',
    '    vec3 textureSample = texture2D(uMainSampler, outTexCoord).rgb;',
    '    ',
    '    // Get the median distance value from RGB channels',
    '    float dist = median(textureSample.r, textureSample.g, textureSample.b);',
    '    ',
    '    // Apply smoothstep for anti-aliasing',
    '    // The range (0.4, 0.6) provides clean anti-aliasing around the 0.5 threshold',
    '    float alpha = smoothstep(0.4, 0.6, dist);',
    '    ',
    '    // Apply text color (from uniform) and tint (from vertex)',
    '    vec4 color = uTextColor * outTint;',
    '    ',
    '    // Output premultiplied alpha (required by Phaser 4)',
    '    // RGB channels are multiplied by alpha, alpha channel remains as-is',
    '    gl_FragColor = vec4(color.rgb * alpha, alpha * color.a);',
    '}'
].join('\n');
