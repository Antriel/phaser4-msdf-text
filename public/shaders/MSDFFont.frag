#ifdef GL_ES
precision mediump float;
#else
#define mediump
#endif

// MSDF texture
uniform sampler2D iChannel0;

// MSDF parameters
uniform vec2 uTexSize;      // Texture dimensions in pixels
uniform float uPxRange;     // Distance field range (typically 2-4)

// Text color
uniform vec4 uTextColor;

// Character UV bounds in atlas (u0, v0, u1, v1)
// When rendering individual characters, this maps the quad to the character's region
// Default: (0, 0, 1, 1) renders entire texture
uniform vec4 uCharUV;

// From vertex shader
varying vec2 outTexCoord;

// Median function - the heart of MSDF
// Extracts signed distance from RGB channels
float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

void main() {
    // Remap UV coordinates from quad [0,1] to character atlas region [u0,v0]→[u1,v1]
    vec2 uv = mix(uCharUV.xy, uCharUV.zw, outTexCoord);

    // Sample the MSDF texture
    vec3 textureSample = texture2D(iChannel0, uv).rgb;

    // Get the median distance value
    float dist = median(textureSample.r, textureSample.g, textureSample.b);

    // Apply smoothstep for anti-aliasing
    // The range (0.4, 0.6) provides good anti-aliasing around the 0.5 threshold
    float alpha = smoothstep(0.4, 0.6, dist);

    // Use premultiplied alpha (required by Phaser's shader rendering)
    vec3 rgb = uTextColor.rgb * alpha;
    gl_FragColor = vec4(rgb, alpha * uTextColor.a);
}
