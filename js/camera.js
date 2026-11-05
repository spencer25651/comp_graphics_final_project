// Third-person orbit camera.
// The camera sits on a sphere around a target point just above the pig:
//   offset = distance * (sin(yaw) cos(pitch), sin(pitch), cos(yaw) cos(pitch))
// A ray cast from the target toward the camera stops it in front of walls.

const camera = {
  yaw: -Math.PI / 2, pitch: 0.3, distance: 7.5, currentDistance: 7.5,
  fov: 55 * Math.PI / 180,
  target: [0, 1, 0], pos: [0, 3, 7],
  view: IDENTITY, projection: IDENTITY, viewProj: IDENTITY
};

// A fixed cinematic shot: the camera at `pos` looking at `target` (the ending)
function setCameraShot(pos, target) {
  camera.pos = pos;
  camera.target = target;
  camera.view = lookAt(pos, target);
  camera.projection = perspective(camera.fov, canvas.width / canvas.height, 0.1, 1000);
  camera.viewProj = multiply(camera.projection, camera.view);
}

// look: { yaw, pitch } changes from the mouse and Q/E keys this frame
function updateCamera(dt, look, follow = true) {
  camera.yaw += look.yaw;
  camera.pitch = clamp(camera.pitch + look.pitch, -0.3, 1.25);

  if (follow) {
    // Follow quickly sideways but lag a little vertically, so jumps don't jerk the view
    const goal = vadd(player.pos, [0, 1.1, 0]);
    camera.target = [
      damp(camera.target[0], goal[0], 12, dt),
      damp(camera.target[1], goal[1], 5, dt),
      damp(camera.target[2], goal[2], 12, dt)
    ];
  }

  const cp = Math.cos(camera.pitch);
  const dir = [Math.sin(camera.yaw) * cp, Math.sin(camera.pitch), Math.cos(camera.yaw) * cp];

  // Ray-box (slab) test against the big solid boxes: walls, floors, hay stacks
  let dist = camera.distance;
  for (const p of level.platforms) {
    if (!p.camera || !(p.solid || p.cameraOnly)) continue;
    const t = rayBox(camera.target, dir, vsub(p.center, p.half), vadd(p.center, p.half));
    if (t < dist) dist = t;
  }
  // ...and against the two roof slopes (planes y + k|z| = c), from below when the
  // pig is inside the barn and from above when it is up on the roof,
  // solving dot(n, target + t * dir) = c for the distance t
  const T = camera.target;
  if (T[0] > -10 && T[0] < 112 && Math.abs(T[2]) < 14) {
    for (const side of [-1, 1]) {
      const n = [0, 1, side * 10 / 14], nd = vdot(n, dir), nT = vdot(n, T);
      if (nT < 29.4 && nd > 1e-6) dist = Math.min(dist, (29.4 - nT) / nd);
      if (nT > 30.6 && nd < -1e-6) dist = Math.min(dist, (30.6 - nT) / nd);
    }
  }
  dist = Math.max(dist - 0.35, 1.0);
  // snap in fast when blocked, ease back out slowly
  camera.currentDistance = damp(camera.currentDistance, dist, dist < camera.currentDistance ? 25 : 3, dt);

  camera.pos = vadd(camera.target, vscale(dir, camera.currentDistance));
  camera.view = lookAt(camera.pos, camera.target);
  camera.projection = perspective(camera.fov, canvas.width / canvas.height, 0.1, 1000);
  camera.viewProj = multiply(camera.projection, camera.view);
}
