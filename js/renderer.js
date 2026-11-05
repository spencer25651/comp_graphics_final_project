// WebGL2 setup, mesh upload, shadow maps and the render passes.
//
// A frame is drawn in this order (see renderFrame in game.js):
//   1. sun shadow map        - depth from the sun's point of view
//   2. searchlight shadow map- depth from the spotlight (only near it)
//   3. main pass             - sky, then every lit surface
//   4. toon outlines         - only in toon mode
//   5. light shafts          - additive, no depth writes
//   6. particles             - blended point sprites

const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl2", { antialias: true });
if (!gl) {
  document.body.innerHTML = "<h2 style='color:#fff;font-family:sans-serif'>This game needs a browser with WebGL 2.</h2>";
  throw new Error("WebGL 2 not available");
}
const anisotropyExt = gl.getExtension("EXT_texture_filter_anisotropic");

// Match the drawing buffer to the canvas's on-screen size (capped for speed)
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}


// ---------------------------------------------------------------------------
// Shaders and programs
// ---------------------------------------------------------------------------
function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

// Fixed attribute slots, so one mesh VAO works with both the lit and depth programs
const MESH_ATTRIBUTES = { aPosition: 0, aNormal: 1, aUV: 2, aOutline: 3 };
const PARTICLE_ATTRIBUTES = { aPosition: 0, aColor: 1, aSize: 2 };

// Links a program and looks up every active uniform by name: program.u.uColor, ...
function createProgram(vsSource, fsSource, attributes) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fsSource));
  for (const name in attributes) gl.bindAttribLocation(program, attributes[name], name);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const u = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, "");
    u[name] = gl.getUniformLocation(program, name);
  }
  return { program, u };
}

const LIT = createProgram(LIT_VS, LIT_FS, MESH_ATTRIBUTES);
const DEPTH = createProgram(DEPTH_VS, DEPTH_FS, MESH_ATTRIBUTES);
const PARTICLE = createProgram(PARTICLE_VS, PARTICLE_FS, PARTICLE_ATTRIBUTES);
const QUAD = createProgram(QUAD_VS, QUAD_FS, {});

// Texture units: 0 = surface texture, 1 = sun shadow map, 2 = spot shadow map, 3 = debug
gl.useProgram(LIT.program);
gl.uniform1i(LIT.u.uTexture, 0);
gl.uniform1i(LIT.u.uSunShadow, 1);
gl.uniform1i(LIT.u.uSpotShadow, 2);


// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------
function bindAttribute(location, data, size) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(location);
}

function createMesh(geom) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  bindAttribute(MESH_ATTRIBUTES.aPosition, geom.positions, 3);
  bindAttribute(MESH_ATTRIBUTES.aNormal, geom.normals, 3);
  bindAttribute(MESH_ATTRIBUTES.aUV, geom.uvs, 2);
  bindAttribute(MESH_ATTRIBUTES.aOutline, geom.outlines, 3);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: geom.indices.length, radius: geom.radius };
}


// ---------------------------------------------------------------------------
// Shadow maps
// ---------------------------------------------------------------------------
// A depth texture attached to a framebuffer with no color buffer. Comparison
// mode makes `texture(sampler2DShadow, ...)` return the lit fraction directly.
function createShadowMap(size) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, size, matrix: IDENTITY };
}

// Renders the depth of every shadow caster as seen from the light.
// Polygon offset pushes the stored depths back slightly to prevent "shadow acne"
// (surfaces wrongly shadowing themselves due to limited depth precision).
function renderShadowMap(map, lightMatrix, items) {
  map.matrix = lightMatrix;
  gl.bindFramebuffer(gl.FRAMEBUFFER, map.fbo);
  gl.viewport(0, 0, map.size, map.size);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.useProgram(DEPTH.program);
  gl.uniformMatrix4fv(DEPTH.u.uLightMatrix, false, lightMatrix);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(2.0, 4.0);
  const planes = frustumPlanes(lightMatrix);
  for (const item of items) {
    if (!item.castShadow || !sphereInFrustum(planes, item.center, item.radius)) continue;
    gl.uniformMatrix4fv(DEPTH.u.uModel, false, item.model);
    gl.bindVertexArray(item.mesh.vao);
    gl.drawElements(gl.TRIANGLES, item.mesh.count, gl.UNSIGNED_SHORT, 0);
  }
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}


// ---------------------------------------------------------------------------
// Main pass
// ---------------------------------------------------------------------------
let currentMaterial = null;
let texturesEnabled = true;

// Uploads a material's uniforms, skipping the work if it is already current
function setMaterial(m) {
  if (m === currentMaterial) return;
  currentMaterial = m;
  const u = LIT.u;
  gl.uniform1i(u.uMode, m.mode);
  gl.uniform3fv(u.uColor, m.color);
  gl.uniform1f(u.uSpecular, m.specular);
  gl.uniform1f(u.uShininess, m.shininess);
  gl.uniform1f(u.uEmissive, m.emissive);
  gl.uniform1f(u.uAlpha, m.alpha);
  gl.uniform1i(u.uTexMode, m.texMode);
  gl.uniform2fv(u.uUVOffset, m.uvOffset);
  const useTexture = texturesEnabled && m.texture !== null;
  gl.uniform1i(u.uUseTexture, useTexture);
  if (useTexture) gl.bindTexture(gl.TEXTURE_2D, m.texture);
}

function drawItem(item) {
  gl.uniformMatrix4fv(LIT.u.uModel, false, item.model);
  gl.uniform3fv(LIT.u.uTexScale, item.texScale);
  gl.bindVertexArray(item.mesh.vao);
  gl.drawElements(gl.TRIANGLES, item.mesh.count, gl.UNSIGNED_SHORT, 0);
}

const SKY_MATERIAL = {
  mode: 2, color: [1, 1, 1], specular: 0, shininess: 1, emissive: 0, alpha: 1,
  texMode: 0, uvOffset: [0, 0], texture: null
};

// frame: everything about this frame's camera and lights (built in game.js)
function renderScene(items, frame, sunMap, spotMap) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  gl.useProgram(LIT.program);
  const u = LIT.u;
  gl.uniformMatrix4fv(u.uViewProj, false, frame.viewProj);
  gl.uniform3fv(u.uCameraPos, frame.cameraPos);
  gl.uniform3fv(u.uSunDir, frame.sunDir);
  gl.uniform3fv(u.uSunColor, frame.sunColor);
  gl.uniformMatrix4fv(u.uSunMatrix, false, sunMap.matrix);
  gl.uniform1f(u.uSunTexel, 1 / sunMap.size);
  gl.uniform3fv(u.uSkyAmbient, frame.skyAmbient);
  gl.uniform3fv(u.uGroundAmbient, frame.groundAmbient);

  const lights = frame.lights.slice(0, 8);
  gl.uniform1i(u.uNumLights, lights.length);
  if (lights.length > 0) {
    gl.uniform3fv(u.uLightPos, lights.flatMap(l => l.pos));
    gl.uniform3fv(u.uLightColor, lights.flatMap(l => l.color));
  }

  const spot = frame.spot;
  gl.uniform1f(u.uSpotCos, spot ? spot.cos : 0);
  if (spot) {
    gl.uniform3fv(u.uSpotPos, spot.pos);
    gl.uniform3fv(u.uSpotDir, spot.dir);
    gl.uniform3fv(u.uSpotColor, spot.color);
    gl.uniformMatrix4fv(u.uSpotMatrix, false, spotMap.matrix);
    gl.uniform1f(u.uSpotTexel, 1 / spotMap.size);
  }

  gl.uniform1i(u.uShadows, frame.shadows);
  gl.uniform1i(u.uToon, frame.toon);
  gl.uniform3fv(u.uFogColor, frame.fogColor);
  gl.uniform1f(u.uFogDensity, frame.fogDensity);
  gl.uniform1f(u.uExposure, frame.exposure);
  gl.uniform1f(u.uOutlineWidth, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, sunMap.tex);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, spotMap.tex);
  gl.activeTexture(gl.TEXTURE0);
  texturesEnabled = frame.textures;
  currentMaterial = null;

  // Sky dome follows the camera and never writes depth, so it is always "behind"
  gl.depthMask(false);
  setMaterial(SKY_MATERIAL);
  drawItem({ mesh: MESH.sphere, model: multiply(translate(...frame.cameraPos), scale(400, 400, 400)), texScale: [1, 1, 1] });
  gl.depthMask(true);

  // Frustum culling: skip anything whose bounding sphere is off screen
  const planes = frustumPlanes(frame.viewProj);
  const visible = items.filter(it => sphereInFrustum(planes, it.center, it.radius));

  const shafts = [];
  for (const item of visible) {
    if (item.material.mode === 3) { shafts.push(item); continue; }
    setMaterial(item.material);
    drawItem(item);
  }

  // Toon outlines: redraw each object slightly inflated, keeping only its back
  // faces. Where the inflated shell sticks out past the object, it shows as ink.
  if (frame.toon) {
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.uniform1i(u.uMode, 4);
    for (const item of visible) {
      if (item.material.mode !== 0 || !item.material.outline) continue;
      const width = Math.min(0.0035 * vdist(item.center, frame.cameraPos) + 0.01, item.radius * 0.2);
      gl.uniform1f(u.uOutlineWidth, width);
      drawItem(item);
    }
    gl.uniform1f(u.uOutlineWidth, 0);
    gl.disable(gl.CULL_FACE);
    currentMaterial = null;
  }

  // Light shafts glow additively on top of what is already drawn
  if (frame.shafts && shafts.length > 0) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    for (const item of shafts) {
      setMaterial(item.material);
      drawItem(item);
    }
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  gl.bindVertexArray(null);
}


// ---------------------------------------------------------------------------
// Particles: one dynamic buffer of [x y z  r g b a  size] per particle
// ---------------------------------------------------------------------------
const PARTICLE_FLOATS = 8;
const particleVAO = gl.createVertexArray();
const particleBuffer = gl.createBuffer();
gl.bindVertexArray(particleVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
gl.bufferData(gl.ARRAY_BUFFER, 4 * PARTICLE_FLOATS * 4096, gl.DYNAMIC_DRAW);
gl.vertexAttribPointer(PARTICLE_ATTRIBUTES.aPosition, 3, gl.FLOAT, false, 32, 0);
gl.vertexAttribPointer(PARTICLE_ATTRIBUTES.aColor, 4, gl.FLOAT, false, 32, 12);
gl.vertexAttribPointer(PARTICLE_ATTRIBUTES.aSize, 1, gl.FLOAT, false, 32, 28);
for (const name in PARTICLE_ATTRIBUTES) gl.enableVertexAttribArray(PARTICLE_ATTRIBUTES[name]);
gl.bindVertexArray(null);

// The first `blendedCount` particles use normal alpha blending (dust, hay),
// the rest add their light (sparkles, motes in the sunbeams)
function renderParticles(data, blendedCount, additiveCount, frame) {
  if (blendedCount + additiveCount === 0) return;
  gl.useProgram(PARTICLE.program);
  gl.uniformMatrix4fv(PARTICLE.u.uViewProj, false, frame.viewProj);
  gl.uniform3fv(PARTICLE.u.uCameraPos, frame.cameraPos);
  gl.uniform1f(PARTICLE.u.uPointScale, canvas.height / (2 * Math.tan(frame.fov / 2)));
  gl.uniform1f(PARTICLE.u.uFogDensity, frame.fogDensity);
  gl.bindVertexArray(particleVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, (blendedCount + additiveCount) * PARTICLE_FLOATS);
  gl.enable(gl.BLEND);
  gl.depthMask(false);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.POINTS, 0, blendedCount);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.drawArrays(gl.POINTS, blendedCount, additiveCount);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}


// ---------------------------------------------------------------------------
// Debug: show a shadow map in the corner of the screen
// ---------------------------------------------------------------------------
const emptyVAO = gl.createVertexArray();
function renderShadowDebug(map) {
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(QUAD.program);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, map.tex);
  // read raw depth values: turn off comparison (and filtering, which raw depth doesn't support)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.uniform1i(QUAD.u.uDepth, 3);
  const h = 0.7, w = h * canvas.height / canvas.width;
  gl.uniform4f(QUAD.u.uRect, -0.98, -0.98, w, h);
  gl.bindVertexArray(emptyVAO);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
}
