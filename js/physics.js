// Pig movement and collision.
//
// The pig collides as an axis-aligned box (AABB) that does not rotate with it.
// Each physics step moves it along x, then z, then y, and after each move pushes
// it back out of any platform it now overlaps. Resolving one axis at a time
// tells us which side was hit: landing on top, bumping a wall, or hitting a ceiling.

const PLAYER_HALF = [0.38, 0.55, 0.38];     // box: feet at pos.y, top at pos.y + 1.1

const MOVE = {
  walk: 6, sprint: 9.5,                       // units per second
  groundAccel: 55, airAccel: 24,              // how quickly speed changes
  gravity: 32, jump: 12, maxFall: 40,         // jump height = jump^2 / (2 gravity) = 2.25
  shortHopGravity: 2.4,                       // extra gravity when the jump key is let go early
  coyoteTime: 0.1,                            // can still jump this long after walking off a ledge
  jumpBuffer: 0.13,                           // a jump pressed this long before landing still counts
  stepHeight: 0.35                            // ledges this low are stepped onto automatically
};

const player = {
  pos: [0, 0, 0], vel: [0, 0, 0], yaw: Math.PI / 2,
  onGround: false, ground: null, jumping: false,
  coyote: 0, buffer: 0, squash: 0
};

const playerMin = () => [player.pos[0] - PLAYER_HALF[0], player.pos[1], player.pos[2] - PLAYER_HALF[2]];
const playerMax = () => [player.pos[0] + PLAYER_HALF[0], player.pos[1] + 2 * PLAYER_HALF[1], player.pos[2] + PLAYER_HALF[2]];
const playerCenter = () => [player.pos[0], player.pos[1] + PLAYER_HALF[1], player.pos[2]];

// Strict overlap with a tiny tolerance, so boxes that merely touch (the pig
// standing on a platform) don't count as overlapping
function boxesOverlap(aMin, aMax, bMin, bMax, eps = 1e-4) {
  return aMin[0] < bMax[0] - eps && aMax[0] > bMin[0] + eps &&
         aMin[1] < bMax[1] - eps && aMax[1] > bMin[1] + eps &&
         aMin[2] < bMax[2] - eps && aMax[2] > bMin[2] + eps;
}

function touchingBox(center, half) {
  return boxesOverlap(playerMin(), playerMax(), vsub(center, half), vadd(center, half));
}

function updatePlayer(dt, input, cameraYaw, events) {
  const p = player;

  // 1. Ride whatever we are standing on (moving platforms, conveyor belts)
  if (p.ground) {
    p.pos = vadd(p.pos, p.ground.delta);
    if (p.ground.conveyor) p.pos = vadd(p.pos, vscale(p.ground.conveyor, dt));
  }

  // 2. Steering relative to the camera: "forward" is the way the camera looks
  const forward = [-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)];
  const right = [Math.cos(cameraYaw), 0, -Math.sin(cameraYaw)];
  let wish = vadd(vscale(forward, input.forward), vscale(right, input.right));
  const wishLen = Math.hypot(wish[0], wish[2]);
  if (wishLen > 1) wish = vscale(wish, 1 / wishLen);
  const speed = input.sprint ? MOVE.sprint : MOVE.walk;

  // Accelerate the horizontal velocity toward the target, by at most `accel`
  const accel = (p.onGround ? MOVE.groundAccel : MOVE.airAccel) * dt;
  const dvx = wish[0] * speed - p.vel[0], dvz = wish[2] * speed - p.vel[2];
  const dv = Math.hypot(dvx, dvz);
  const k = dv > accel ? accel / dv : 1;
  p.vel[0] += dvx * k;
  p.vel[2] += dvz * k;

  if (wishLen > 0.1) p.yaw += angleDiff(p.yaw, Math.atan2(wish[0], wish[2])) * Math.min(1, dt * 12);

  // 3. Jump (with coyote time and input buffering, which make jumps feel fair)
  p.coyote = p.onGround ? MOVE.coyoteTime : p.coyote - dt;
  p.buffer = input.jumpPressed ? MOVE.jumpBuffer : p.buffer - dt;
  if (p.buffer > 0 && p.coyote > 0) {
    p.vel[1] = MOVE.jump;
    p.buffer = p.coyote = 0;
    p.jumping = true;
    p.onGround = false;
    p.ground = null;
    events.push({ type: "jump", pos: [...p.pos] });
  }

  // 4. Gravity: stronger while rising if the jump key was released (short hop)
  if (p.vel[1] <= 0) p.jumping = false;
  const g = MOVE.gravity * (p.jumping && !input.jumpHeld ? MOVE.shortHopGravity : 1);
  p.vel[1] = Math.max(p.vel[1] - g * dt, -MOVE.maxFall);

  // 5. Move and collide one axis at a time
  const wasOnGround = p.onGround;
  p.onGround = false;
  p.ground = null;
  moveAxis(0, p.vel[0] * dt, wasOnGround, events);
  moveAxis(2, p.vel[2] * dt, wasOnGround, events);
  moveAxis(1, p.vel[1] * dt, wasOnGround, events);
  pushOutOfCylinders();

  p.squash = Math.max(0, p.squash - dt * 4);
}

// Round walls (the silo): if the pig's center is closer to the axis than
// radius + the pig's half width, slide it straight out along the radius
function pushOutOfCylinders() {
  const p = player;
  for (const c of level.cylinders) {
    if (p.pos[1] > c.top) continue;
    const dx = p.pos[0] - c.x, dz = p.pos[2] - c.z, r = Math.hypot(dx, dz);
    const minR = c.radius + PLAYER_HALF[0];
    if (r >= minR || r < 1e-6) continue;
    p.pos[0] = c.x + dx / r * minR;
    p.pos[2] = c.z + dz / r * minR;
  }
}

// Moves a box standing on the ground sideways, stopping it at solid platforms.
// The dog uses this, so it runs around bales and the tractor instead of through them.
function slideBox(pos, half, dx, dz) {
  for (const [axis, amount] of [[0, dx], [2, dz]]) {
    pos[axis] += amount;
    const min = [pos[0] - half[0], pos[1], pos[2] - half[2]];
    const max = [pos[0] + half[0], pos[1] + 2 * half[1], pos[2] + half[2]];
    for (const plat of level.platforms) {
      if (!plat.solid) continue;
      const bMin = vsub(plat.center, plat.half), bMax = vadd(plat.center, plat.half);
      if (!boxesOverlap(min, max, bMin, bMax)) continue;
      pos[axis] = amount > 0 ? bMin[axis] - half[axis] : bMax[axis] + half[axis];
      min[axis] = pos[axis] - half[axis];
      max[axis] = pos[axis] + half[axis];
    }
  }
}

function moveAxis(axis, amount, wasOnGround, events) {
  const p = player;
  const prev = p.pos[axis];
  p.pos[axis] += amount;
  const size = axis === 1 ? 2 * PLAYER_HALF[1] : PLAYER_HALF[axis];

  for (const plat of level.platforms) {
    if (!plat.solid) continue;
    const bMin = vsub(plat.center, plat.half), bMax = vadd(plat.center, plat.half);
    if (!boxesOverlap(playerMin(), playerMax(), bMin, bMax)) continue;
    // how far the platform itself moved this step, so a fast lift still counts as "below"
    const eps = 0.05 + Math.abs(plat.delta[axis]);

    if (axis === 1) {
      const fromAbove = prev >= bMax[1] - eps;
      const fromBelow = prev + size <= bMin[1] + eps;
      // already inside (something moved into us): leave by the shorter way
      const upIsShorter = bMax[1] - p.pos[1] < p.pos[1] + size - bMin[1];
      if (fromAbove || (!fromBelow && upIsShorter)) {
        p.pos[1] = bMax[1];
        land(plat, events);
      } else {
        p.pos[1] = bMin[1] - size;
        if (p.vel[1] > 0) p.vel[1] = 0;
      }
      continue;
    }

    // Walk up small steps instead of stopping against them
    const rise = bMax[1] - p.pos[1];
    if (wasOnGround && rise > 0 && rise <= MOVE.stepHeight) {
      p.pos[1] = bMax[1];
      continue;
    }
    let pushToMin;
    if (prev + size <= bMin[axis] + eps) pushToMin = true;
    else if (prev - size >= bMax[axis] - eps) pushToMin = false;
    else pushToMin = p.pos[axis] + size - bMin[axis] < bMax[axis] - (p.pos[axis] - size);
    p.pos[axis] = pushToMin ? bMin[axis] - size : bMax[axis] + size;
    if ((pushToMin && p.vel[axis] > 0) || (!pushToMin && p.vel[axis] < 0)) p.vel[axis] = 0;
  }
}

function land(plat, events) {
  const p = player;
  if (plat.onLand) plat.onLand();
  if (plat.bounce && p.vel[1] <= 0) {
    p.vel[1] = plat.bounce;
    p.jumping = false;
    events.push({ type: "bounce", pos: [...p.pos] });
    return;
  }
  if (p.vel[1] < -7) {
    p.squash = clamp(-p.vel[1] / 60, 0.1, 0.3);
    events.push({ type: "land", pos: [...p.pos], impact: -p.vel[1] });
  }
  if (p.vel[1] < 0) p.vel[1] = 0;
  p.onGround = true;
  p.ground = plat;
}
