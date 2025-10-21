#extension GL_OES_standard_derivatives : enable

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

// From vertex shader
varying vec2 outTexCoord;
varying vec4 outColor;

// Median function - the heart of MSDF
// Extracts signed distance from RGB channels
float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

void main() {
    // Calculate the distance field unit in screen space
    vec2 msdfUnit = uPxRange / uTexSize;

    // Sample the MSDF texture
    vec3 textureSample = texture2D(iChannel0, outTexCoord).rgb;

    // Get signed distance from the three channels
    float sigDist = median(textureSample.r, textureSample.g, textureSample.b) - 0.5;

    // Scale by screen-space derivatives for proper anti-aliasing
    // This is what makes MSDF resolution-independent
    sigDist *= dot(msdfUnit, 0.5 / fwidth(outTexCoord));

    // Calculate opacity with smooth edges
    float opacity = clamp(sigDist + 0.5, 0.0, 1.0);

    // Blend with transparent background
    vec4 bgColor = vec4(0.0, 0.0, 0.0, 0.0);

    // Mix background with text color based on opacity
    gl_FragColor = mix(bgColor, outColor, opacity);
}
