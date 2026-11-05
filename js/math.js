// Matrix and vector math.
// Matrices are 4x4, column-major Float32Arrays (m[col * 4 + row]), the layout
// WebGL expects. This file grew out of transforms.js from HW5.

function multiply(a, b) {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + i] * b[j * 4 + k];
      r[j * 4 + i] = sum;
    }
  return r;
}

// multiply(a, b, c, ...) for longer chains
function chain(...ms) {
  return ms.reduce((acc, m) => multiply(acc, m));
}

function translate(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function scale(x, y, z) {
  return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
}

function rotateX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotateY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotateZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

// Orthographic projection of the box [l,r] x [b,t] x [-n,-f] (eye space) to clip space.
// The sun's shadow map uses this because sunlight rays are parallel.
function ortho(l, r, b, t, n, f) {
  return new Float32Array([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1
  ]);
}

// View matrix for an eye at `eye` looking at `target`. The rows are the camera's
// right (s), up (u) and backward (-f) axes, followed by a translation of -eye.
function lookAt(eye, target, up = [0, 1, 0]) {
  const f = vnormalize(vsub(target, eye));
  const s = vnormalize(vcross(f, up));
  const u = vcross(s, f);
  return new Float32Array([
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -vdot(s, eye), -vdot(u, eye), vdot(f, eye), 1
  ]);
}

// Rotation that turns the local +y axis to point along `dir` (aims the light shafts)
function alignY(dir) {
  const y = vnormalize(dir);
  const helper = Math.abs(y[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const x = vnormalize(vcross(helper, y));
  const z = vcross(x, y);
  return new Float32Array([...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1]);
}

function transformPoint(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

// Rotates/scales a direction (ignores the translation column)
function transformDir(m, [x, y, z]) {
  const v = [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z
  ];
  return vnormalize(v);
}

// Largest scale factor of a matrix's 3x3 part (for bounding spheres)
function maxScale(m) {
  return Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
}

const IDENTITY = translate(0, 0, 0);


// ---------------------------------------------------------------------------
// 3-component vectors as plain arrays
// ---------------------------------------------------------------------------
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlength = a => Math.hypot(a[0], a[1], a[2]);
const vdist = (a, b) => vlength(vsub(a, b));
const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function vnormalize(a) {
  const len = vlength(a) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Frame-rate independent smoothing: moves `current` toward `target`,
// closing the same fraction of the gap per second no matter the frame rate.
function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

// Shortest signed difference between two angles
function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// "#rrggbb" (an sRGB color, like a color picker gives) -> linear RGB for lighting math
function rgb(hex) {
  return [1, 3, 5].map(i => Math.pow(parseInt(hex.substr(i, 2), 16) / 255, 2.2));
}


// ---------------------------------------------------------------------------
// Culling and ray casting
// ---------------------------------------------------------------------------

// The six clip planes of a view-projection matrix (Gribb & Hartmann).
// A point p is inside when dot(plane.xyz, p) + plane.w >= 0 for every plane.
function frustumPlanes(m) {
  const row = i => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const planes = [];
  for (const [r, sign] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]]) {
    const p = r3.map((v, i) => v + sign * r[i]);
    const len = Math.hypot(p[0], p[1], p[2]);
    planes.push(p.map(v => v / len));
  }
  return planes;
}

function sphereInFrustum(planes, c, r) {
  for (const p of planes)
    if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3] < -r) return false;
  return true;
}

// Ray vs axis-aligned box using the slab method: intersect the ray with the
// pair of planes on each axis and keep the overlap of the three intervals.
// Returns the distance along the (normalized) ray to the hit, or Infinity.
function rayBox(origin, dir, min, max) {
  let tNear = -Infinity, tFar = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (origin[i] < min[i] || origin[i] > max[i]) return Infinity;
      continue;
    }
    let t1 = (min[i] - origin[i]) / dir[i], t2 = (max[i] - origin[i]) / dir[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tNear = Math.max(tNear, t1);
    tFar = Math.min(tFar, t2);
    if (tNear > tFar) return Infinity;
  }
  if (tFar < 0) return Infinity;
  return Math.max(tNear, 0);
}
