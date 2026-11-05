// CPU particle system. Each particle is a point with velocity, gravity, drag,
// a lifetime and a color; every frame they are integrated with Euler steps and
// written into one buffer that is drawn as GL_POINTS (see renderParticles).

const MAX_PARTICLES = 4000;
const particles = [];
const particleData = new Float32Array(MAX_PARTICLES * PARTICLE_FLOATS);

const rand = (a, b) => a + Math.random() * (b - a);

function emit(count, { pos, spread = 0.2, vel = [0, 0, 0], speed = 1, up = 0, life = [0.5, 1], size = [0.1, 0.2],
  colors, alpha = 1, gravity = 0, drag = 1, additive = false, fadeIn = 0 }) {
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const dir = vnormalize([rand(-1, 1), rand(-1, 1), rand(-1, 1)]);
    const l = rand(life[0], life[1]);
    particles.push({
      pos: vadd(pos, vscale([rand(-1, 1), rand(-1, 1), rand(-1, 1)], spread)),
      vel: vadd(vadd(vel, vscale(dir, speed * Math.random())), [0, up * rand(0.5, 1), 0]),
      life: l, maxLife: l, size: rand(size[0], size[1]),
      color: colors[Math.floor(Math.random() * colors.length)], alpha,
      gravity, drag, additive, fadeIn
    });
  }
}

// Presets used by the game
const DUST = [[0.55, 0.42, 0.3], [0.65, 0.52, 0.38], [0.45, 0.35, 0.25]];
const HAY = [[0.9, 0.75, 0.35], [0.8, 0.62, 0.25], [1.0, 0.85, 0.5]];
const SPARK = [[1.0, 0.9, 0.4], [1.0, 0.75, 0.2], [1.0, 1.0, 0.8]];

function dustPuff(pos, amount = 1) {
  emit(Math.round(14 * amount), { pos: vadd(pos, [0, 0.1, 0]), spread: 0.3, speed: 2.5 * amount, up: 0.8, life: [0.5, 0.9],
    size: [0.3, 0.6], colors: DUST, alpha: 0.45, gravity: -0.5, drag: 4 });
}
function hayBurst(pos, count = 30) {
  emit(count, { pos, spread: 0.6, speed: 4, up: 3, life: [0.8, 1.4], size: [0.08, 0.16], colors: HAY, gravity: 12, drag: 1.5 });
}
function sparkle(pos, count = 24) {
  emit(count, { pos, spread: 0.1, speed: 4, life: [0.4, 0.8], size: [0.12, 0.25], colors: SPARK, gravity: -1, drag: 3, additive: true });
}
function confetti(pos) {
  emit(250, { pos, spread: 1, speed: 9, up: 8, life: [1.5, 3], size: [0.12, 0.22], gravity: 9, drag: 1.2,
    colors: [[1, 0.4, 0.5], [1, 0.85, 0.3], [0.4, 0.8, 1], [0.6, 1, 0.5], [1, 1, 1]] });
}

// Dust motes floating in the air around the camera target: always about `count` of them
function ambientMotes(center, count) {
  let motes = 0;
  for (const p of particles) if (p.mote) motes++;
  for (let i = motes; i < count && particles.length < MAX_PARTICLES; i++) {
    emit(1, { pos: vadd(center, [rand(-14, 14), rand(-4, 8), rand(-14, 14)]), speed: 0.15, life: [5, 10],
      size: [0.04, 0.08], colors: [[1, 0.85, 0.6]], alpha: 0.6, drag: 0, additive: true, fadeIn: 1.5 });
    particles[particles.length - 1].mote = true;
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles[i] = particles[particles.length - 1];
      particles.pop();
      continue;
    }
    const drag = Math.exp(-p.drag * dt);
    p.vel = [p.vel[0] * drag, (p.vel[1] - p.gravity * dt) * drag, p.vel[2] * drag];
    if (p.mote) p.vel = vadd(p.vel, [rand(-0.2, 0.2) * dt, rand(-0.2, 0.2) * dt, rand(-0.2, 0.2) * dt]);
    p.pos = vadd(p.pos, vscale(p.vel, dt));
  }
}

// Fills particleData: alpha-blended particles first, additive ones after.
// Returns [blendedCount, additiveCount].
function packParticles() {
  let n = 0;
  const write = p => {
    const age = p.maxLife - p.life;
    let a = p.alpha * Math.min(1, p.life * 2.5);              // fade out at the end
    if (p.fadeIn > 0) a *= Math.min(1, age / p.fadeIn);
    const o = n * PARTICLE_FLOATS;
    particleData.set(p.pos, o);
    particleData.set(p.color, o + 3);
    particleData[o + 6] = a;
    particleData[o + 7] = p.size;
    n++;
  };
  for (const p of particles) if (!p.additive) write(p);
  const blended = n;
  for (const p of particles) if (p.additive) write(p);
  return [blended, n - blended];
}
