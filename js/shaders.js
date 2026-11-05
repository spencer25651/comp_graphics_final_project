// GLSL ES 3.00 shader sources.
//   LIT      - every surface in the game: textures, Blinn-Phong or toon lighting,
//              sun + lanterns + searchlight, shadow maps, fog, tone mapping
//   DEPTH    - shadow map pass (depth only, from a light's point of view)
//   PARTICLE - round, soft point sprites for dust, hay and sparkles
//   QUAD     - debug view of the sun's shadow map

const LIT_VS = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
in vec3 aOutline;

uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat4 uSunMatrix;      // world -> sun light clip space
uniform mat4 uSpotMatrix;     // world -> searchlight clip space

uniform int   uTexMode;       // 0 = mesh uvs, 1 = box projection
uniform vec3  uTexScale;      // texture repeats along each axis
uniform vec2  uUVOffset;      // scrolls the texture (water, conveyor belt)
uniform float uOutlineWidth;  // > 0 only in the toon outline pass

out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
out vec2 vUV;
out vec4 vSunCoord;
out vec4 vSpotCoord;

void main() {
  // Inverse transpose keeps normals perpendicular under non-uniform scaling
  mat3 normalMatrix = transpose(inverse(mat3(uModel)));
  vec4 world = uModel * vec4(aPosition, 1.0);

  // Toon outline: push the surface outward so its back faces peek out
  // around the real object as a dark rim (the "inverted hull" trick).
  // Only the rotation of the model is used, so the rim is equally thick on
  // every side of a stretched box.
  if (uOutlineWidth > 0.0) {
    mat3 m = mat3(uModel);
    mat3 rotation = mat3(normalize(m[0]), normalize(m[1]), normalize(m[2]));
    world.xyz += rotation * aOutline * uOutlineWidth;
  }

  vWorld = world.xyz;
  vNormal = normalMatrix * aNormal;
  vLocal = aPosition;

  if (uTexMode == 1) {
    // Box projection: each face of a box takes its uvs from the two axes that
    // lie in that face, scaled by the box's size, so a long beam repeats the
    // wood texture instead of stretching it.
    vec3 p = (aPosition * 0.5 + 0.5) * uTexScale;
    vec3 n = abs(aNormal);
    vUV = n.x > 0.5 ? p.zy : (n.y > 0.5 ? p.xz : p.xy);
  } else {
    vUV = aUV * uTexScale.xy;
  }
  vUV += uUVOffset;

  vSunCoord = uSunMatrix * world;
  vSpotCoord = uSpotMatrix * world;
  gl_Position = uViewProj * world;
}
`;

const LIT_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;

#define MAX_LIGHTS 8
#define LIGHT_RANGE 16.0

in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
in vec2 vUV;
in vec4 vSunCoord;
in vec4 vSpotCoord;

uniform vec3 uCameraPos;

// Sun: directional light with a shadow map
uniform vec3  uSunDir;              // unit vector pointing TOWARD the sun
uniform vec3  uSunColor;
uniform sampler2DShadow uSunShadow;
uniform float uSunTexel;            // 1 / shadow map size

// Hemisphere ambient: sky color from above, bounce color from below
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;

// Lanterns: the nearest point lights, picked on the CPU each frame
uniform int  uNumLights;
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];

// The farmer's searchlight: a spotlight with its own shadow map
uniform vec3  uSpotPos;
uniform vec3  uSpotDir;
uniform vec3  uSpotColor;
uniform float uSpotCos;             // cos(cone half-angle); 0 = off
uniform sampler2DShadow uSpotShadow;
uniform float uSpotTexel;

uniform bool  uShadows;
uniform bool  uToon;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uExposure;

// Material
uniform int   uMode;                // 0 lit, 1 glowing, 2 sky, 3 light shaft, 4 toon outline
uniform vec3  uColor;
uniform float uSpecular;
uniform float uShininess;
uniform float uEmissive;
uniform bool  uUseTexture;
uniform sampler2D uTexture;
uniform float uAlpha;

out vec4 fragColor;

// Percentage-closer filtering: the shadow sampler compares the fragment's depth
// against the stored depth (with bilinear filtering of the results), and we
// average a 3x3 block of those comparisons to soften the shadow edge.
float shadowPCF(sampler2DShadow map, vec4 coord, float texel, float bias) {
  vec3 p = coord.xyz / coord.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float sum = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      sum += texture(map, vec3(p.xy + vec2(x, y) * texel, p.z - bias));
  float lit = sum / 9.0;
  return uToon ? step(0.5, lit) : lit;
}

// Blinn-Phong diffuse + specular for one light, or banded toon lighting
vec3 shade(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 albedo) {
  float diff = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = diff > 0.0 ? pow(max(dot(N, H), 0.0), uShininess) : 0.0;
  if (uToon) {
    diff = diff > 0.55 ? 1.0 : (diff > 0.2 ? 0.55 : (diff > 0.0 ? 0.2 : 0.0));
    spec = step(0.6, spec);
  }
  return radiance * (diff * albedo + uSpecular * spec);
}

// Filmic tone mapping (Narkowicz's ACES fit) squeezes bright lantern light into
// [0, 1] without clipping to flat white
vec3 toneMap(vec3 c) {
  c *= uExposure;
  return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
}

float fogFactor(float dist) {
  return exp(-pow(uFogDensity * dist, 2.0));   // exponential-squared fog
}

// Fog, tone map, then gamma-encode the linear color for the screen.
// Height fog also darkens everything below the barn floor (the cellar).
vec3 finalColor(vec3 linear, float dist) {
  vec3 c = mix(uFogColor, linear, fogFactor(dist));
  c = mix(c, uFogColor * 0.25, clamp(-vWorld.y / 10.0, 0.0, 0.9));
  return pow(toneMap(c), vec3(1.0 / 2.2));
}

void main() {
  vec3 toCamera = uCameraPos - vWorld;
  float dist = length(toCamera);
  vec3 V = toCamera / dist;

  if (uMode == 2) {
    // Sky dome: gradient from horizon to zenith plus a sun disk
    vec3 dir = normalize(vLocal);
    vec3 sky = mix(vec3(0.95, 0.72, 0.45), vec3(0.18, 0.38, 0.85), smoothstep(-0.02, 0.55, dir.y));
    sky = mix(vec3(0.25, 0.35, 0.15), sky, smoothstep(-0.15, 0.0, dir.y));
    float s = max(dot(dir, uSunDir), 0.0);
    sky += uSunColor * (pow(s, 600.0) * 8.0 + pow(s, 12.0) * 0.25);
    fragColor = vec4(pow(toneMap(sky), vec3(1.0 / 2.2)), 1.0);
    return;
  }

  if (uMode == 3) {
    // Additive light shaft (drawn with blending ONE, ONE): brightest at the
    // source end, fading along its length and toward its silhouette edges
    float along = clamp(0.5 * (vLocal.y + 1.0), 0.0, 1.0);
    float edge = abs(dot(normalize(vNormal), V));
    fragColor = vec4(uColor * along * along * edge * uAlpha * fogFactor(dist), 1.0);
    return;
  }

  if (uMode == 4) {
    fragColor = vec4(finalColor(vec3(0.012, 0.008, 0.005), dist), 1.0);
    return;
  }

  vec3 albedo = uColor;
  if (uUseTexture) albedo *= texture(uTexture, vUV).rgb;

  if (uMode == 1) {
    fragColor = vec4(finalColor(albedo * uEmissive, dist), 1.0);
    return;
  }

  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;          // two-sided lighting for open shapes

  vec3 ambient = mix(uGroundAmbient, uSkyAmbient, 0.5 + 0.5 * N.y);
  if (uToon) ambient = mix(uGroundAmbient, uSkyAmbient, 0.75);
  vec3 color = albedo * (ambient + uEmissive);

  // Sun
  float NdotL = dot(N, uSunDir);
  if (NdotL > 0.0) {
    float lit = 1.0;
    // slope-scaled bias: surfaces at a grazing angle to the light need more
    if (uShadows) lit = shadowPCF(uSunShadow, vSunCoord, uSunTexel, max(0.0025 * (1.0 - NdotL), 0.0006));
    color += shade(N, V, uSunDir, uSunColor * lit, albedo);
  }

  // Lantern point lights with a smooth range cut-off, so a light can be swapped
  // out of the nearest-8 list without a visible pop
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uNumLights) break;
    vec3 toLight = uLightPos[i] - vWorld;
    float d = length(toLight);
    float window = clamp(1.0 - pow(d / LIGHT_RANGE, 4.0), 0.0, 1.0);
    float atten = window * window / (1.0 + 0.12 * d * d);
    color += shade(N, V, toLight / d, uLightColor[i] * atten, albedo);
  }

  // Searchlight
  if (uSpotCos > 0.0) {
    vec3 toSpot = uSpotPos - vWorld;
    float d = length(toSpot);
    vec3 L = toSpot / d;
    float cone = smoothstep(uSpotCos, uSpotCos + 0.004, dot(-L, uSpotDir));
    if (cone > 0.0) {
      float lit = uShadows ? shadowPCF(uSpotShadow, vSpotCoord, uSpotTexel, 0.0004) : 1.0;
      color += shade(N, V, L, uSpotColor * cone * lit / (1.0 + 0.003 * d * d), albedo);
    }
  }

  fragColor = vec4(finalColor(color, dist), uAlpha);
}
`;

const DEPTH_VS = `#version 300 es
in vec3 aPosition;
uniform mat4 uLightMatrix;
uniform mat4 uModel;
void main() {
  gl_Position = uLightMatrix * uModel * vec4(aPosition, 1.0);
}
`;

// No color output: only the depth buffer is written
const DEPTH_FS = `#version 300 es
precision mediump float;
void main() {}
`;

const PARTICLE_VS = `#version 300 es
in vec3 aPosition;
in vec4 aColor;
in float aSize;

uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform float uPointScale;    // viewport height / (2 tan(fov/2)): world size -> pixels
uniform float uFogDensity;

out vec4 vColor;

void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  gl_PointSize = aSize * uPointScale / gl_Position.w;   // perspective: farther = smaller
  float fog = exp(-pow(uFogDensity * distance(aPosition, uCameraPos), 2.0));
  vColor = vec4(aColor.rgb, aColor.a * fog);
}
`;

const PARTICLE_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;   // -1..1 across the point sprite
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;                // round, not square
  float soft = 1.0 - r2;
  fragColor = vec4(vColor.rgb, vColor.a * soft * soft);
}
`;

// Draws a screen rectangle with no vertex buffer: gl_VertexID 0..3 -> corners
const QUAD_VS = `#version 300 es
uniform vec4 uRect;           // x, y, width, height in clip space
out vec2 vUV;
void main() {
  vec2 c = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vUV = c;
  gl_Position = vec4(uRect.xy + c * uRect.zw, 0.0, 1.0);
}
`;

const QUAD_FS = `#version 300 es
precision highp float;
uniform sampler2D uDepth;
in vec2 vUV;
out vec4 fragColor;
void main() {
  float d = texture(uDepth, vUV).r;
  fragColor = vec4(vec3(d * d), 1.0);
}
`;
