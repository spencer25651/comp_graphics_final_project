// Mesh generators. Every shape is centered at the origin and roughly fills
// [-1, 1]^3, so a node's `shape` matrix (scale, then place) sizes it.
// Each returns { positions, normals, uvs, outlines, indices, radius }:
//   uvs      - texture coordinates (Texture Mapping)
//   outlines - direction each vertex moves for the toon outline pass
//   radius   - bounding sphere radius (frustum culling)

function finishGeometry(pos, nrm, uv, idx, outlineFromNormals = false) {
  const outlines = new Float32Array(pos.length);
  let radius = 0;
  for (let i = 0; i < pos.length; i += 3) {
    // Convex shapes push each vertex straight out from the center by its own
    // position, so a cube corner (1,1,1) moves out by the outline width on every
    // axis and the hull stays closed at hard edges. The torus is not convex
    // around its center, so it uses its normals instead.
    for (let k = 0; k < 3; k++) outlines[i + k] = outlineFromNormals ? nrm[i + k] : pos[i + k];
    radius = Math.max(radius, Math.hypot(pos[i], pos[i + 1], pos[i + 2]));
  }
  return orient({
    positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uv),
    outlines, indices: new Uint16Array(idx), radius
  });
}

function createCube() {
  const pos = [
    -1, -1,  1,   1, -1,  1,   1,  1,  1,  -1,  1,  1,   // front
     1, -1, -1,  -1, -1, -1,  -1,  1, -1,   1,  1, -1,   // back
    -1,  1,  1,   1,  1,  1,   1,  1, -1,  -1,  1, -1,   // top
    -1, -1, -1,   1, -1, -1,   1, -1,  1,  -1, -1,  1,   // bottom
     1, -1,  1,   1, -1, -1,   1,  1, -1,   1,  1,  1,   // right
    -1, -1, -1,  -1, -1,  1,  -1,  1,  1,  -1,  1, -1    // left
  ];
  const faceNormals = [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]];
  const nrm = faceNormals.flatMap(n => [...n, ...n, ...n, ...n]);
  const uv = [], idx = [];
  for (let f = 0; f < 6; f++) {
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return finishGeometry(pos, nrm, uv, idx);
}

// Cylinder of radius 1 along y from -1 to 1. u wraps around, v runs up.
function createCylinder(segments) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    pos.push(x, -1, z, x, 1, z);
    nrm.push(x, 0, z, x, 0, z);
    uv.push(i / segments, 0, i / segments, 1);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
  }
  for (const y of [-1, 1]) {
    const center = pos.length / 3;
    pos.push(0, y, 0);
    nrm.push(0, y, 0);
    uv.push(0.5, 0.5);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(Math.cos(a), y, Math.sin(a));
      nrm.push(0, y, 0);
      uv.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
    }
    for (let i = 1; i <= segments; i++) idx.push(center, center + i, center + i + 1);
  }
  return finishGeometry(pos, nrm, uv, idx);
}

// Unit sphere. (u, v) are longitude and latitude, the usual spherical mapping.
function createSphere(stacks, slices) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * Math.PI, y = Math.cos(phi), r = Math.sin(phi);
    for (let j = 0; j <= slices; j++) {
      const th = (j / slices) * Math.PI * 2, x = r * Math.cos(th), z = r * Math.sin(th);
      pos.push(x, y, z);
      nrm.push(x, y, z);
      uv.push(j / slices, 1 - i / stacks);
    }
  }
  for (let i = 0; i < stacks; i++)
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j, b = a + slices + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return finishGeometry(pos, nrm, uv, idx);
}

// Cone with its apex at y = 1 and a base of radius 1 at y = -1
function createCone(segments, capped = true) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    const am = ((i + 0.5) / segments) * Math.PI * 2;   // apex normal halfway around the segment
    const l = Math.hypot(1, 0.5);
    pos.push(x, -1, z, 0, 1, 0);
    nrm.push(x / l, 0.5 / l, z / l, Math.cos(am) / l, 0.5 / l, Math.sin(am) / l);
    uv.push(i / segments, 0, (i + 0.5) / segments, 1);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2);
  }
  if (capped) {
    const center = pos.length / 3;
    pos.push(0, -1, 0);
    nrm.push(0, -1, 0);
    uv.push(0.5, 0.5);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(Math.cos(a), -1, Math.sin(a));
      nrm.push(0, -1, 0);
      uv.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
    }
    for (let i = 1; i <= segments; i++) idx.push(center, center + i, center + i + 1);
  }
  return finishGeometry(pos, nrm, uv, idx);
}

// Torus in the XZ plane: major radius R, tube radius r. `arc` < 2*PI leaves a
// gap, which is how the horseshoes are made.
function createTorus(R, r, segU, segV, arc = Math.PI * 2) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * arc, cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
      pos.push((R + r * cv) * cu, r * sv, (R + r * cv) * su);
      nrm.push(cv * cu, sv, cv * su);
      uv.push(i / segU, j / segV);
    }
  }
  for (let i = 0; i < segU; i++)
    for (let j = 0; j < segV; j++) {
      const a = i * (segV + 1) + j, b = a + segV + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return finishGeometry(pos, nrm, uv, idx, true);
}

// Triangular prism: triangle (-1,-1) (1,-1) (0,1) in xy, extruded from z = -1 to 1.
// Used for the barn's gable ends.
function createPrism() {
  const A = [-1, -1], B = [1, -1], C = [0, 1];
  const pos = [], nrm = [], uv = [], idx = [];
  function quad(p, n) {
    const b = pos.length / 3;
    for (const v of p) pos.push(...v);
    for (let i = 0; i < 4; i++) nrm.push(...n);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  for (const z of [1, -1]) {
    const b = pos.length / 3;
    pos.push(A[0], A[1], z, B[0], B[1], z, C[0], C[1], z);
    for (let i = 0; i < 3; i++) nrm.push(0, 0, z);
    uv.push(0, 0, 1, 0, 0.5, 1);
    idx.push(b, b + 1, b + 2);
  }
  const s = Math.sqrt(5);
  quad([[A[0], A[1], 1], [B[0], B[1], 1], [B[0], B[1], -1], [A[0], A[1], -1]], [0, -1, 0]);
  quad([[B[0], B[1], 1], [C[0], C[1], 1], [C[0], C[1], -1], [B[0], B[1], -1]], [2 / s, 1 / s, 0]);
  quad([[C[0], C[1], 1], [A[0], A[1], 1], [A[0], A[1], -1], [C[0], C[1], -1]], [-2 / s, 1 / s, 0]);
  return finishGeometry(pos, nrm, uv, idx);
}

function faceNormal(P, a, b, c) {
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

// Reorders every triangle to be counter-clockwise when seen from the side its
// normals point to, so face culling and gl_FrontFacing agree with the normals.
function orient(geom) {
  const P = geom.positions, N = geom.normals, I = geom.indices;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const f = faceNormal(P, a, b, c);
    let dot = 0;
    for (const v of [a, b, c]) dot += f[0] * N[v * 3] + f[1] * N[v * 3 + 1] + f[2] * N[v * 3 + 2];
    if (dot < 0) { I[t + 1] = c; I[t + 2] = b; }
  }
  return geom;
}
