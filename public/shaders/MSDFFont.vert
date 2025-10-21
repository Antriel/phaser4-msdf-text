// Vertex attributes (provided by Phaser 4 renderer)
attribute vec2 inPosition;
attribute vec2 inTexCoord;
attribute vec4 inColor;

// Uniforms (transformation matrices)
uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;

// Varyings (passed to fragment shader)
varying vec2 outTexCoord;
varying vec4 outColor;

void main(void) {
    // Transform vertex position to clip space
    gl_Position = uProjectionMatrix * uViewMatrix * vec4(inPosition, 0.0, 1.0);

    // Pass texture coordinates to fragment shader
    outTexCoord = inTexCoord;

    // Pass vertex color to fragment shader
    outColor = inColor;
}
