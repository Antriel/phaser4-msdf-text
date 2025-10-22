#ifdef GL_ES
precision mediump float;
#else
#define mediump
#endif

uniform sampler2D iChannel0;
uniform vec2 uTexSize;
uniform float uPxRange;
uniform vec4 uTextColor;
uniform vec4 uCharUV;

varying vec2 outTexCoord;

void main() {
    // Debug: Show what UV coordinates we're using

    // Remap UV coordinates
    vec2 uv = mix(uCharUV.xy, uCharUV.zw, outTexCoord);

    // Visualize the UVs as colors
    // Red = U coordinate, Green = V coordinate
    vec3 debugColor = vec3(uv.x, uv.y, 0.0);

    // Also sample the texture
    vec3 textureSample = texture2D(iChannel0, uv).rgb;

    // Show texture RGB in bottom half, UV debug in top half
    vec3 finalColor = outTexCoord.y < 0.5 ? debugColor : textureSample;

    gl_FragColor = vec4(finalColor, 1.0);
}
