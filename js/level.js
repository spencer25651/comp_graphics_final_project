// The level: the barn, six sections of platforms, and everything that moves.
//
// World layout (+y is up):
//   The barn spans x -10..112, z -14..14. Walls rise to y = 20, the roof ridge is at y = 30.
//   Ground route (sections 1-4) runs along z ~ -6 heading +x, climbing from y = 0 to 8.5.
//   The hay hoist lifts the pig to the loft route (sections 5-6) at z ~ 7, which heads
//   back toward -x at y ~ 15-21 and leaves through the hayloft door above the pig pen.
//   Past the pen floor (x > 20) the floorboards have rotted away: falling means the cellar.

const level = {
  root: createNode("Barn"),
  platforms: [],      // solid boxes the pig collides with (some move)
  hazards: [],        // boxes that send the pig back to its checkpoint
  lanterns: [],
  corn: [],
  checkpoints: [],
  chickens: [],
  crows: [],
  cylinders: [],      // round walls the pig is pushed out of (the silo)
  hints: [],
  bouncers: [],
  spinners: [],       // purely decorative animations: function(t)
  events: [],         // things that happened this frame, for particles and sound
  searchlight: null,
  vane: null,
  dog: null,
  sunDir: vnormalize([-0.35, 1, -0.3]),
  sections: [
    { name: "The Pig Pen", fog: 0.012 },
    { name: "Stable Row", fog: 0.013 },
    { name: "Hay Storage", fog: 0.017 },
    { name: "The Tool Corner", fog: 0.014 },
    { name: "The Rafters", fog: 0.018 },
    { name: "The Hayloft", fog: 0.018 },
    { name: "The Catwalk", fog: 0.012 },
    { name: "Up on the Roof", fog: 0.004 },
    { name: "Along the Ridge", fog: 0.004 },
    { name: "The Silo", fog: 0.004 },
    { name: "Halfway Down", fog: 0.004 },
    { name: "The Farmyard", fog: 0.004 }
  ]
};


// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

// How many times the texture repeats along each axis of a box: its size divided by
// the material's tile size (one number, or [x, y, z] for textures like bales that
// are wider than they are tall)
function boxTexScale(half, mat) {
  const tile = Array.isArray(mat.tile) ? mat.tile : [mat.tile, mat.tile, mat.tile];
  return half.map((h, i) => 2 * h / tile[i]);
}

// A textured box. Its texture repeats every `tile` world units (see uTexScale).
function box(center, half, mat, opts = {}) {
  const joint = opts.rotation ? multiply(translate(...center), opts.rotation) : translate(...center);
  const node = part(opts.parent || level.root, opts.name || "Box", MESH.cube, mat, scale(...half), joint,
    opts.texScale || boxTexScale(half, mat));
  if (opts.shadow === false) node.castShadow = false;
  if (opts.invisible) node.visible = false;
  return node;
}

// A box the pig can stand on. `camera` platforms also block the camera;
// `cameraOnly` ones block only the camera.
function platform(center, half, mat, opts = {}) {
  const node = opts.node || box(center, half, mat, opts);
  const p = {
    node, center: [...center], home: [...center], half: [...half],
    solid: !opts.cameraOnly, cameraOnly: !!opts.cameraOnly, delta: [0, 0, 0], camera: !!(opts.camera || opts.cameraOnly),
    bounce: opts.bounce || 0, conveyor: opts.conveyor || null,
    update: null, onLand: null
  };
  level.platforms.push(p);
  return p;
}

const solid = (center, half, mat, opts = {}) => platform(center, half, mat, { camera: true, ...opts });

// A platform whose center follows path(t)
function mover(center, half, mat, path, opts = {}) {
  const p = platform(center, half, mat, opts);
  p.update = t => {
    p.center = path(t);
    p.node.joint = translate(...p.center);
  };
  return p;
}

// Old hay or rotten boards: shake when stood on, then fall, then come back
function crumbling(center, half, mat, delay) {
  const p = platform(center, half, mat);
  p.state = "solid";
  p.onLand = () => {
    if (p.state !== "solid") return;
    p.state = "shaking";
    p.timer = delay;
    level.events.push({ type: "creak", pos: p.center });
  };
  p.update = (t, dt) => {
    if (p.state === "shaking") {
      p.timer -= dt;
      const j = 0.07 * (1 - p.timer / delay);
      p.node.joint = translate(p.home[0] + (Math.random() - 0.5) * j, p.home[1], p.home[2] + (Math.random() - 0.5) * j);
      if (p.timer <= 0) {
        p.state = "falling";
        p.solid = false;
        p.timer = 3.5;
        p.vy = 0;
        level.events.push({ type: "crumble", pos: [...p.center], mat });
      }
    } else if (p.state === "falling") {
      p.timer -= dt;
      p.vy -= 25 * dt;
      p.center = [p.center[0], p.center[1] + p.vy * dt, p.center[2]];
      p.node.joint = multiply(translate(...p.center), rotateZ(p.vy * 0.02));
      if (p.timer <= 0) {
        p.state = "solid";
        p.solid = true;
        p.center = [...p.home];
        p.node.joint = translate(...p.home);
      }
    }
  };
  return p;
}

// A board hanging from two ropes that swings like a pendulum (hierarchy:
// pivot ─ arm (rotates) ─ ropes + seat (counter-rotates to stay level)).
// The collision box is read back from the seat's world matrix.
function swing(pivot, length, amp, speed, phase, half) {
  const pivotNode = part(level.root, "Swing pivot", MESH.cube, MAT.darkMetal, scale(0.15, 0.15, half[2] + 0.15), translate(...pivot));
  const arm = part(pivotNode, "Swing arm");
  for (const z of [-1, 1])
    part(arm, "Swing rope", MESH.cylinder, MAT.rope, multiply(translate(0, -length / 2, z * (half[2] - 0.12)), scale(0.035, length / 2, 0.035)));
  const seat = part(arm, "Swing seat", MESH.cube, MAT.planks, scale(...half), translate(0, -length, 0), boxTexScale(half, MAT.planks));
  const p = platform(vadd(pivot, [0, -length, 0]), half, MAT.planks, { node: seat });
  p.update = t => {
    const angle = amp * Math.sin(speed * t + phase);
    arm.joint = rotateZ(angle);
    seat.joint = multiply(translate(0, -length, 0), rotateZ(-angle));
    p.center = transformPoint(worldMatrix(seat), [0, 0, 0]);
  };
  return p;
}

// A crate hanging from a wheeled carriage that rolls along an overhead rail
function trolley(railY, z, x0, x1, crateTop, speed) {
  box([(x0 + x1) / 2, railY + 0.25, z], [Math.abs(x1 - x0) / 2 + 2.5, 0.1, 0.12], MAT.darkMetal);
  const carriage = part(level.root, "Trolley carriage", MESH.cube, MAT.darkMetal, scale(0.55, 0.12, 0.2));
  const wheels = [-1, 1].map(s => part(carriage, "Trolley wheel", MESH.cylinder, MAT.darkMetal,
    multiply(rotateX(Math.PI / 2), scale(0.15, 0.06, 0.15)), translate(s * 0.35, 0.15, 0)));
  const drop = railY - crateTop;
  for (const s of [-1, 1])
    part(carriage, "Trolley rope", MESH.cylinder, MAT.rope, multiply(translate(s * 0.4, -drop / 2, 0), scale(0.03, drop / 2, 0.03)));
  const crateNode = part(carriage, "Hanging crate", MESH.cube, MAT.crate, scale(1, 0.5, 1), translate(0, -drop - 0.5, 0), [1, 0.5, 1]);
  const p = platform([x0, crateTop - 0.5, z], [1, 0.5, 1], MAT.crate, { node: crateNode });
  p.update = t => {
    const x = lerp(x0, x1, 0.5 - 0.5 * Math.cos(speed * t));
    carriage.joint = translate(x, railY, z);
    for (const w of wheels) w.joint = multiply(translate(w.joint[12], 0.15, 0), rotateZ(-x / 0.15));
    p.center = transformPoint(worldMatrix(crateNode), [0, 0, 0]);
  };
  return p;
}

// Pulley hoist: a lift and a counterweight hang from one wheel and move opposite
// ways. The wheel turns by (distance moved / radius) so the rope doesn't slip.
function hoist(x, liftZ, weightZ, yLow, yHigh, speed) {
  const wheelY = 19.5, wheelZ = (liftZ + weightZ) / 2, R = Math.abs(liftZ - weightZ) / 2;
  const mid = (yLow + yHigh) / 2, amp = (yHigh - yLow) / 2;
  box([x, wheelY, wheelZ], [0.6, 0.2, 0.2], MAT.darkMetal, { name: "Axle" });
  const wheel = part(level.root, "Pulley wheel", null, null, IDENTITY, translate(x, wheelY, wheelZ));
  part(wheel, "Pulley rim", MESH.torus, MAT.darkMetal, multiply(rotateZ(Math.PI / 2), scale(R * 0.95, 0.4, R * 0.95)));
  for (let i = 0; i < 6; i++)
    part(wheel, "Pulley spoke", MESH.cylinder, MAT.beam, chain(rotateX(i * Math.PI / 3), translate(0, R / 2, 0), scale(0.08, R / 2, 0.08)));

  const lift = platform([x, yLow, liftZ], [1.3, 0.25, 1.3], MAT.planks);
  const weight = platform([x, yHigh, weightZ], [0.7, 0.5, 0.7], MAT.metal);
  const ropes = [lift, weight].map(pl => part(level.root, "Hoist rope", MESH.cylinder, MAT.rope));
  const setRope = (rope, pl, z) => {
    const top = pl.center[1] + pl.half[1], len = (wheelY - top) / 2;
    rope.joint = translate(x, top + len, z);
    rope.shape = scale(0.04, len, 0.04);
    rope.texScale = [1, len, 1];
  };
  lift.update = t => {
    lift.center = [x, mid - amp * Math.cos(speed * t), liftZ];
    lift.node.joint = translate(...lift.center);
    setRope(ropes[0], lift, liftZ);
    wheel.joint = multiply(translate(x, wheelY, wheelZ), rotateX((lift.center[1] - yLow) / R));
  };
  weight.update = t => {
    weight.center = [x, mid + amp * Math.cos(speed * t), weightZ];
    weight.node.joint = translate(...weight.center);
    setRope(ropes[1], weight, weightZ);
  };
}

// Loose hay pile: an invisible box to bounce on under a squashy hay mound
function hayPile(center, half, bounce) {
  const p = platform(center, half, MAT.looseHay, { invisible: true, bounce });
  const mound = part(level.root, "Hay mound", MESH.sphere, MAT.looseHay, scale(half[0] + 0.25, 0.95, half[2] + 0.25));
  const b = { mound, center, squash: 0 };
  p.onLand = () => { b.squash = 1; };
  level.bouncers.push(b);
  return p;
}

// Metal water trough: a base, four rims and a scrolling water surface
function trough(x, z, top, halfLen, bottom) {
  const parts = [
    [[x, (bottom + top - 0.25) / 2, z], [0.75, (top - 0.25 - bottom) / 2, halfLen]],
    [[x - 0.67, top - 0.3, z], [0.08, 0.3, halfLen]],
    [[x + 0.67, top - 0.3, z], [0.08, 0.3, halfLen]],
    [[x, top - 0.3, z - halfLen + 0.08], [0.75, 0.3, 0.08]],
    [[x, top - 0.3, z + halfLen - 0.08], [0.75, 0.3, 0.08]]
  ];
  for (const [c, h] of parts) solid(c, h, MAT.metal, { camera: false });
  box([x, top - 0.22, z], [0.6, 0.02, halfLen - 0.12], MAT.water, { shadow: false });
}

// Wall made of boxes, leaving rectangular holes (windows, doors).
// axis "x": the wall runs along x at z = fixed; axis "z": runs along z at x = fixed.
function wall(axis, fixed, a0, a1, y0, y1, holes = []) {
  const piece = (b0, b1, c0, c1) => {
    if (b1 - b0 < 0.01 || c1 - c0 < 0.01) return;
    const m = (b0 + b1) / 2, hb = (b1 - b0) / 2, my = (c0 + c1) / 2, hy = (c1 - c0) / 2;
    solid(axis === "x" ? [m, my, fixed] : [fixed, my, m], axis === "x" ? [hb, hy, 0.3] : [0.3, hy, hb], MAT.barnWall);
  };
  let cursor = a0;
  for (const h of holes) {
    piece(cursor, h[0], y0, y1);
    piece(h[0], h[1], y0, h[2]);
    piece(h[0], h[1], h[3], y1);
    box(axis === "x" ? [(h[0] + h[1]) / 2, h[2] - 0.1, fixed] : [fixed, h[2] - 0.1, (h[0] + h[1]) / 2],
      axis === "x" ? [(h[1] - h[0]) / 2 + 0.2, 0.12, 0.4] : [0.4, 0.12, (h[1] - h[0]) / 2 + 0.2], MAT.darkBeam);
    cursor = h[1];
  }
  piece(cursor, a1, y0, y1);
}

// Shaft of sunlight coming down through a hole in the roof
function lightShaft(top, width, length) {
  const node = part(level.root, "Light shaft", MESH.cylinder, MAT.shaft,
    multiply(translate(0, -length, 0), scale(width, length, width)), multiply(translate(...top), alignY(level.sunDir)));
  node.castShadow = false;
  return node;
}

function hazard(center, half, message, sound = "hurt") { level.hazards.push({ center, half, message, sound }); }
function hint(min, max, text) { level.hints.push({ min, max, text }); }
function addCorn(...positions) { for (const p of positions) level.corn.push(createCorn(level.root, p)); }
function lantern(anchor, chainLength = 1.5) {
  level.lanterns.push(createLantern(level.root, anchor, chainLength, anchor[0] * 0.37 + anchor[2]));
}

// spawn: where the pig respawns; shoe: where the horseshoe stands
function checkpoint(spawn, shoe, cameraYaw, killY) {
  const h = createHorseshoe(level.root, shoe);
  level.checkpoints.push({ spawn, shoe, cameraYaw, killY, section: level.checkpoints.length, active: false, ...h });
}

function chicken(y, z, x0, x1) {
  const model = createChicken(level.root);
  level.chickens.push({ model, y, z, x0, x1, x: (x0 + x1) / 2, dir: 1, yaw: Math.PI / 2, pause: 0, flap: 0, half: [0.35, 0.45, 0.35] });
}


// ---------------------------------------------------------------------------
// The barn itself
// ---------------------------------------------------------------------------
function buildBarn() {
  const W = 14, EAVE = 20, RIDGE = 30;

  // Pen floor; beyond x = 20 there is only the cellar far below
  solid([5, -0.5, 0], [15.3, 0.5, 14], MAT.floor);
  box([20.1, -7, 0], [0.2, 7, 14], MAT.stone);
  box([66, -14.5, 0], [46.3, 0.5, 14], MAT.mud);

  // Walls with windows, the searchlight's window and the hayloft door
  wall("x", -W, -10.3, 112.3, -14, EAVE, [[28, 33, 6, 11], [58, 63, 8, 13], [89, 107, 9.5, 15.5]]);
  wall("x", W, -10.3, 112.3, -14, EAVE, [[8, 13, 6, 11], [38, 43, 10, 15], [68, 73, 12, 17], [98, 103, 13, 18]]);
  wall("z", -10, -13.7, 13.7, -1, EAVE, [[-9, -4, 3, 6], [3, 11, 15.5, EAVE]]);
  wall("z", 112, -13.7, 13.7, -14, EAVE, [[-4, 4, 8, 13]]);

  // Triangular gable ends above the walls
  for (const x of [-10, 112])
    part(level.root, "Gable", MESH.prism, MAT.barnWall, chain(rotateY(Math.PI / 2), scale(W + 0.3, (RIDGE - EAVE) / 2, 0.3)),
      translate(x, (RIDGE + EAVE) / 2, 0), [(2 * W + 0.6) / 5, 2, 0.12]);

  // Roof: strips of corrugated tin down each slope, with a few missing (holes
  // that let sunbeams in). The roof does not cast shadows by default, so the
  // sun reaches the interior; the pause menu can turn that on.
  const alpha = Math.atan2(RIDGE - EAVE, W);
  const slope = Math.hypot(RIDGE - EAVE, W) + 1.2, strips = 10, stripW = slope / strips;
  // holes per strip ("side,index"); the two strips at the ridge have rotted through
  // where the pig must jump a gap on the roof
  const holes = {
    "-1,3": [[44, 50]], "-1,5": [[76, 80]], "-1,6": [[100, 104]], "1,2": [[16, 21]], "1,4": [[60, 66]], "1,6": [[90, 94]],
    "-1,0": RIDGE_GAPS, "1,0": RIDGE_GAPS
  };
  level.roof = [];
  for (const side of [-1, 1])
    for (let i = 0; i < strips; i++) {
      const d = (i + 0.5) * stripW;
      const z = side * d * Math.cos(alpha), y = RIDGE + 0.25 - d * Math.sin(alpha);
      const gaps = holes[side + "," + i] || [];
      // Each strip is split at x = 80.5: the roof over the Tool Corner always casts
      // shadows, so that corner stays dim and the farmer's floodlight stands out
      const cuts = [-11.5, ...gaps.flat(), 80.5, 113.5].sort((a, b) => a - b);
      for (let c = 0; c + 1 < cuts.length; c++) {
        const [x0, x1] = [cuts[c], cuts[c + 1]];
        if (gaps.some(g => g[0] === x0)) continue;
        const node = box([(x0 + x1) / 2, y, z], [(x1 - x0) / 2, 0.1, stripW / 2 + 0.03], MAT.roof, { rotation: rotateX(side * alpha), shadow: false });
        node.alwaysShadow = x0 >= 80.5;
        level.roof.push(node);
      }
      for (const g of gaps)
        if (i > 0) lightShaft([(g[0] + g[1]) / 2, y - 0.3, z], (g[1] - g[0]) * 0.32, y / level.sunDir[1] / 2);
    }

  // Roof trusses: tie beam, king post and two rafters every 12 units
  for (let x = -4; x <= 104; x += 12) {
    box([x, EAVE, 0], [0.3, 0.3, W], MAT.beam);
    box([x, (RIDGE + EAVE) / 2, 0], [0.25, (RIDGE - EAVE) / 2, 0.25], MAT.beam);
    for (const side of [-1, 1]) {
      const d = slope / 2;
      box([x, RIDGE - 0.5 - d * Math.sin(alpha), side * d * Math.cos(alpha)], [0.25, 0.3, d], MAT.beam, { rotation: rotateX(side * alpha) });
      box([x, EAVE / 2 - 2, side * (W - 0.6)], [0.3, EAVE / 2 + 2, 0.3], MAT.darkBeam);
    }
  }
  box([56, RIDGE - 0.6, 0], [57, 0.3, 0.3], MAT.beam, { name: "Ridge beam" });

  // Hay tracks along the barn that the lanterns hang from
  box([28, 9.4, -3], [28, 0.15, 0.15], MAT.beam);
  box([84, 13.2, -3], [28, 0.15, 0.15], MAT.beam);
}


// ---------------------------------------------------------------------------
// Section 1: The Pig Pen (x -10..20, on the floor)
// ---------------------------------------------------------------------------
function buildPen() {
  checkpoint([-5, 0, -6.5], [-6.5, 0, -9.5], -Math.PI / 2, -5);

  solid([5, 1.5, 0], [15.3, 1.5, 0.2], MAT.planks);                // wall between the pen and the rest of the floor
  box([-1, 0.015, -9], [2.2, 0.02, 1.8], MAT.mud, { shadow: false });
  box([5.5, 0.015, -3], [1.5, 0.02, 1.1], MAT.mud, { shadow: false });

  // A fence the pig must jump: posts and rails to look at, one invisible box to collide with
  for (let z = -13; z <= -1; z += 2) box([2, 0.55, z], [0.1, 0.55, 0.1], MAT.beam);
  for (const y of [0.4, 0.95]) box([2, y, -7], [0.05, 0.07, 6.6], MAT.beam);
  solid([2, 0.55, -7], [0.15, 0.55, 6.6], MAT.beam, { invisible: true, camera: false });

  trough(7.5, -8, 0.8, 2.2, 0);

  solid([10.5, 0.6, -4], [1.0, 0.6, 0.8], MAT.bale);
  solid([12.6, 1.2, -4.6], [0.9, 1.2, 0.8], MAT.bale);
  solid([14, 1.6, -7], [0.25, 1.6, 7], MAT.planks);                  // the pen gate: too tall to jump from the floor
  box([14, 3.25, -7], [0.32, 0.08, 7], MAT.darkBeam);

  // props
  for (const [x, z] of [[-8.5, -12.5], [-7, -12.6], [-8.6, -11.2]]) sack(level.root, [x, 0, z], x);
  barrel(level.root, [-8.6, 0.6, -2], 0.5, 0.6);
  bucket(level.root, [6.2, 0, -10.8]);
  ladder(level.root, [-9.6, 0, 8], 9, Math.PI / 2);
  solid([-6, 0.6, -1.4], [1.5, 0.6, 0.6], MAT.bale, { camera: false });
  part(level.root, "Loose hay", MESH.sphere, MAT.looseHay, scale(1.6, 0.35, 1.3), translate(-7.5, 0, -5));
  wagonWheel(level.root, [-9.4, 1.1, -7.5], 1.1, rotateY(Math.PI / 2 - 0.15));
  for (let i = 0; i < 4; i++) crate(level.root, [16 + (i % 2) * 1.6, 0.75 + Math.floor(i / 2) * 1.5, -12.6], 0.75, i * 0.2);
  // the other side of the pen wall, seen from the loft later
  for (const [x, z] of [[0, 4], [6, 10], [-4, 11]]) solid([x, 0.6, z], [1.0, 0.6, 0.8], MAT.bale, { camera: false });
  barrel(level.root, [10, 0.6, 6], 0.5, 0.6);
  sack(level.root, [12, 0, 11]);

  lantern([2, 9.25, -3]);
  lantern([12, 9.25, -3]);

  addCorn([-1, 0.8, -9], [2, 1.9, -6.5], [5.5, 0.8, -3], [7.5, 1.6, -8], [10.5, 2.0, -4], [12.6, 3.3, -4.6], [17, 0.8, -10.5]);

  hint([-10, -5, -14], [1.3, 5, 0], "Move with WASD or the arrow keys · Drag or click the screen to look around");
  hint([1.3, -5, -14], [6.5, 5, 0], "Press SPACE to jump over the fence (hold it to jump higher)");
  hint([8.5, -5, -14], [13.8, 5, 0], "Climb the hay bales to get over the pen gate");
  hint([14.3, -5, -14], [20.3, 5, 0], "Hold SHIFT to sprint for longer jumps. Grab the horseshoe: it's a checkpoint!");
}


// ---------------------------------------------------------------------------
// Section 2: Stable Row (x 20..57) - stall dividers, a trough, a swing, a trolley
// ---------------------------------------------------------------------------
function buildStables() {
  checkpoint([18.5, 0, -6.5], [18.5, 0, -9.5], -Math.PI / 2, -5);

  // Stall dividers: plank walls rising out of the cellar, capped with a beam
  for (const [x, top] of [[23, 1.5], [27, 2.5]]) {
    platform([x, top - 0.15, -6.5], [0.5, 0.15, 5.5], MAT.beam);
    box([x, top - 1.5, -6.5], [0.12, 1.2, 5.5], MAT.planks);
    for (const z of [-11.7, -1.3]) box([x, (top - 14) / 2, z], [0.18, (top + 14) / 2, 0.18], MAT.darkBeam);
  }
  trough(31, -7, 2.0, 2.5, 1.25);
  for (const z of [-9, -5]) box([31, -6, z], [0.12, 7.3, 0.12], MAT.beam);

  // Rope swing hanging from a crossbeam
  box([36.5, 10.2, -7], [0.3, 0.3, 7], MAT.beam);
  swing([36.5, 10, -6.5], 7, 0.42, 1.3, 0, [1.1, 0.15, 1.1]);

  // Tack shelf on a post
  platform([42.5, 3.3, -6], [1.0, 0.2, 1.5], MAT.planks);
  box([42.5, -5.5, -6], [0.2, 8.6, 0.2], MAT.beam);
  part(level.root, "Saddle", MESH.sphere, material({ color: rgb("#6b3a1e"), specular: 0.5, shininess: 30 }),
    scale(0.45, 0.2, 0.35), translate(42.5, 3.55, -7.1));

  // Feed tray hanging from a rail, sliding back and forth
  box([47.25, 10.3, -6], [4.5, 0.12, 0.12], MAT.darkMetal);
  const tray = mover([47.25, 3.3, -6], [1.0, 0.2, 1.0], MAT.planks, t => [47.25 + 2.25 * Math.sin(0.9 * t), 3.3, -6]);
  for (const s of [-1, 1])
    part(tray.node, "Tray rope", MESH.cylinder, MAT.rope, multiply(translate(0, 3.4, 0), scale(0.03, 3.4, 0.03)), translate(s * 0.8, 0.2, 0));

  // Tack room: a little shed whose roof is the next checkpoint
  solid([54.5, -5, -7], [3, 9, 4], MAT.planks);
  box([54.5, 4.05, -7], [3.2, 0.05, 4.2], MAT.darkBeam);
  checkpoint([54.5, 4.1, -6], [55.8, 4.1, -9.5], -Math.PI / 2, -5);

  // Horse stall backs along the south wall, with hay racks
  for (const x of [25, 29, 33]) box([x, 0.5, -13.3], [1.6, 0.2, 0.5], MAT.hayStrip);
  for (const x of [22, 34, 40, 45]) box([x, 4, -13.6], [0.15, 0.15, 0.2], MAT.iron, { name: "Hook" });

  lantern([24, 9.25, -3]);
  lantern([39, 9.25, -3]);
  lantern([50, 9.25, -3]);

  addCorn([23, 2.4, -6.5], [27, 3.4, -9], [31, 2.9, -7], [36.5, 4.4, -6.5], [39.8, 5.4, -6.5], [42.5, 4.4, -6], [47.25, 5.0, -6]);
  hint([20.3, -5, -14], [24, 6, 0], "The floor has rotted away. Fall into the cellar and you go back to the last horseshoe");
  hint([31.5, 0, -14], [34, 6, 0], "Time your jump onto the swing");
}


// ---------------------------------------------------------------------------
// Section 3: Hay Storage (x 57..90) - crumbling bales, a bouncy hay pile, a conveyor
// ---------------------------------------------------------------------------
function buildHayStorage() {
  for (const [x, z] of [[59.5, -5], [62.5, -7.5], [65.5, -5.5]]) {
    crumbling([x, 3.5, z], [1.0, 0.5, 0.9], MAT.bale, 0.6);
    box([x, -5.25, z], [0.15, 8.25, 0.15], MAT.darkBeam);
  }

  hayPile([70, 3.0, -6], [2.0, 0.5, 1.6], 19);
  solid([70, -5.5, -6], [2.1, 8.5, 1.7], MAT.bale, { camera: false });

  solid([75.2, -3, -6], [2.0, 10.5, 2.5], MAT.bale);

  // Conveyor belt that pushes the pig backward; rollers spin at each end
  platform([81, 7.2, -6], [3.5, 0.3, 1.0], MAT.belt, { conveyor: [-3.5, 0, 0] });
  for (const z of [-7.1, -4.9]) box([81, 7.1, z], [3.8, 0.3, 0.08], MAT.metal);
  for (const x of [77.6, 84.4]) {
    const roller = part(level.root, "Roller", MESH.cylinder, MAT.darkMetal, multiply(rotateX(Math.PI / 2), scale(0.3, 1.0, 0.3)));
    level.spinners.push(t => { roller.joint = multiply(translate(x, 7.2, -6), rotateZ(t * 3.5 / 0.3)); });
    box([x, -3.5, -7], [0.15, 10.5, 0.15], MAT.darkBeam);
    box([x, -3.5, -5], [0.15, 10.5, 0.15], MAT.darkBeam);
  }

  solid([87.5, -3, -6], [2.0, 11, 2.5], MAT.bale);
  checkpoint([87.5, 8, -6], [88.5, 8, -8], -Math.PI / 2, -5);

  // Big stacks of bales along the walls (the south stack hides a bonus cob)
  solid([66, -3, -12.2], [8, 10, 1.5], MAT.bale);
  solid([72, -3, 11], [10, 9, 2.5], MAT.bale, { camera: false });
  solid([60, -3, 11.5], [2, 7, 2], MAT.bale, { camera: false });

  lantern([62, 13.05, -3], 2.5);
  lantern([75, 13.05, -3], 2.0);
  lantern([84, 13.05, -3], 2.0);

  addCorn([59.5, 5.1, -5], [62.5, 5.1, -7.5], [65.5, 5.1, -5.5], [70, 8.0, -6], [75.2, 8.6, -6], [79, 8.6, -6], [83, 8.6, -6], [66, 7.9, -12.2]);
  hint([57.5, 0, -14], [61, 9, 0], "Old bales crumble under you. Keep moving!");
  hint([67, 0, -14], [71.5, 9, 0], "Jump on the loose hay to bounce high");
  hint([76.5, 5, -14], [85, 12, 0], "The belt pushes you back. Sprint across!");
}


// ---------------------------------------------------------------------------
// Section 4: The Tool Corner (x 90..112) - hide from the farmer's floodlight
// ---------------------------------------------------------------------------
function buildToolCorner() {
  platform([93.5, 7.75, -6.5], [3.0, 0.25, 2.5], MAT.planks);
  for (const [x, z] of [[91, -8.6], [96, -8.6], [91, -4.4], [96, -4.4]]) box([x, -3.2, z], [0.15, 10.7, 0.15], MAT.darkBeam);
  solid([92, 8.75, -8.3], [0.75, 0.75, 0.75], MAT.crate, { texScale: [1, 1, 1] });
  solid([95.6, 8.6, -8.4], [0.6, 0.6, 0.6], MAT.crate, { texScale: [1, 1, 1] });
  rake(level.root, [94.2, 8.0, -5.4], 0.6);
  hazard([94.2, 8.2, -5.4], [0.65, 0.22, 0.25], "Ouch! Rake tines!");

  // Tool cart rolling back and forth, carrying a crate to hide behind
  const cartPath = t => [99.5 + 1.5 * Math.sin(0.8 * t), 7.75, -6.3];
  const cart = mover(cartPath(0), [1.2, 0.25, 1.6], MAT.planks, cartPath);
  mover(vadd(cartPath(0), [0, 0.85, -1.0]), [0.6, 0.6, 0.6], MAT.crate, t => vadd(cartPath(t), [0, 0.85, -1.0]), { texScale: [1, 1, 1] });
  for (const [x, z] of [[-0.8, -1.4], [0.8, -1.4], [-0.8, 1.4], [0.8, 1.4]]) {
    const w = wagonWheel(cart.node, [x, -0.25, z], 0.32);
    level.spinners.push(t => { w.joint = multiply(translate(x, -0.25, z), rotateZ(-1.5 * Math.sin(0.8 * t) / 0.32)); });
  }

  platform([105, 8.25, -6.5], [1.6, 0.25, 2.5], MAT.planks);
  box([105, -3, -6.5], [0.2, 11, 0.2], MAT.darkBeam);
  barrel(level.root, [104.4, 9.1, -8.3], 0.5, 0.6);
  solid([104.4, 9.1, -8.3], [0.5, 0.6, 0.5], MAT.crate, { invisible: true, camera: false });

  hoist(109.5, -6, -10.5, 8.25, 15.25, 0.6);

  platform([109.5, 15.25, 0.25], [1.2, 0.25, 3.75], MAT.planks);
  platform([104.6, 15.25, 7.5], [6.1, 0.25, 4.0], MAT.planks);
  for (const [x, z] of [[99, 4], [99, 11], [109, 11], [109.5, 0]]) box([x, 0.5, z], [0.2, 14.5, 0.2], MAT.darkBeam);
  checkpoint([104, 15.5, 7.5], [100, 15.5, 10.5], Math.PI / 2, 9);

  // The floodlight on a pole outside the big south window
  const S = level.searchlight = {
    pos: [98, 14, -19.5], dir: [0, 0, 1], cutoff: 11 * Math.PI / 180, range: 45,
    color: [7, 8.5, 11], exposure: 0
  };
  box([98, 6.5, -20.2], [0.15, 7.5, 0.15], MAT.darkMetal);
  const lamp = part(level.root, "Floodlight");
  part(lamp, "Housing", MESH.cylinder, MAT.darkMetal, multiply(translate(0, -0.35, 0), scale(0.5, 0.45, 0.5)));
  part(lamp, "Lens", MESH.cylinder, MAT.spotGlass, multiply(translate(0, 0.12, 0), scale(0.42, 0.03, 0.42)));
  const beam = part(level.root, "Floodlight beam", MESH.openCone, MAT.spotBeam);
  S.update = t => {
    const target = [98 + 8.5 * Math.sin(0.5 * t), 8.5, -6.5];
    S.dir = vnormalize(vsub(target, S.pos));
    lamp.joint = multiply(translate(...S.pos), alignY(S.dir));
    // open cone: apex (y = 1) at the lamp, opening along -y, which alignY(-dir) turns toward the target
    const len = 16, r = len * Math.tan(S.cutoff);
    beam.joint = multiply(translate(...S.pos), alignY(vscale(S.dir, -1)));
    beam.shape = multiply(translate(0, -len / 2, 0), scale(r, len / 2, r));
  };

  lantern([95, 13.05, -3], 1.6);
  lantern([106, 13.05, -3], 1.6);
  lantern([104, 19.7, 11], 1.2);

  // tool wall decor
  for (let i = 0; i < 5; i++) box([92 + i * 1.5, 12, 13.6], [0.04, 0.8, 0.04], MAT.beam, { name: "Hanging tool" });
  wagonWheel(level.root, [111.4, 2, 8], 1.2, rotateY(Math.PI / 2));

  addCorn([91.5, 9.2, -5], [94.2, 9.9, -5.4], [99.5, 9.3, -5.6], [105, 9.6, -5], [109.5, 13, -6], [109.5, 16.6, 0.5]);
  hint([89.5, 6, -14], [93, 14, 0], "The farmer's floodlight! Hide behind crates and barrels so it can't see you");
  hint([106.6, 6, -14], [111.7, 18, -4], "Ride the hay hoist up to the rafters");
}


// ---------------------------------------------------------------------------
// Section 5: The Rafters (x 98 -> 52 at y 15-16) - narrow beams, chickens, a trolley
// ---------------------------------------------------------------------------
function buildRafters() {
  platform([92, 15.25, 7.5], [6.5, 0.25, 0.4], MAT.beam);
  chicken(15.5, 7.5, 87, 97);

  trolley(19.4, 7.5, 84, 74, 15.5, 0.5);

  for (const [x, top] of [[70.5, 15.5], [67, 16.3], [63.5, 15.8]]) {
    platform([x, top - 0.25, 7.5], [0.45, 0.25, 4.5], MAT.beam);
    for (const z of [3.2, 11.8]) box([x, (top + 24) / 2, z], [0.04, (24 - top) / 2, 0.04], MAT.darkMetal, { name: "Hanger rod" });
  }

  platform([57.5, 15.25, 5], [5, 0.25, 0.45], MAT.beam);
  chicken(15.5, 5, 54, 61);

  platform([47, 15, 7], [5.5, 0.5, 5], MAT.planks);
  for (const [x, z] of [[42, 2.5], [52, 2.5], [42, 11.5], [52, 11.5]]) box([x, 0.5, z], [0.25, 14, 0.25], MAT.darkBeam);
  checkpoint([47, 15.5, 7.5], [49, 15.5, 10.5], Math.PI / 2, 10);
  for (const [x, z] of [[44, 11], [46, 11], [50.5, 10.8]]) sack(level.root, [x, 15.5, z], x);

  lantern([92, 19.7, 11], 1.2);
  lantern([80, 19.7, 3], 1.2);
  lantern([68, 19.7, 11], 1.2);
  lantern([56, 19.7, 2], 1.2);

  addCorn([92, 16.6, 7.5], [88, 16.6, 7.5], [79, 17.2, 7.5], [70.5, 16.6, 7.5], [67, 17.4, 10], [63.5, 16.9, 4.5], [57.5, 16.6, 5]);
  hint([98.5, 14, 3.5], [104, 20, 11.5], "Chickens peck you off the beams. Jump over them, or bounce on their heads!");
  hint([84, 14, 3.5], [87, 20, 11.5], "Ride the hanging crate across the gap");
}


// ---------------------------------------------------------------------------
// Section 6: The Hayloft (x 41 -> -10) - rotten boards, a hay bounce, swings, the door
// ---------------------------------------------------------------------------
function buildHayloft() {
  for (const [x, z] of [[38.5, 6], [35, 9], [31.5, 5.5]])
    crumbling([x, 15.25, z], [1.2, 0.25, 1.5], MAT.planks, 0.45);

  hayPile([27, 14.5, 7], [1.6, 0.5, 1.6], 21);
  box([27, 0, 7], [1.7, 14, 1.7], MAT.bale);

  platform([19, 20.6, 7], [4, 0.25, 1.0], MAT.planks);
  checkpoint([17.5, 20.85, 7], [21.5, 20.85, 7.6], Math.PI / 2, 12);

  swing([11, 24.2, 7], 6, 0.45, 1.4, 0, [1.0, 0.15, 1.0]);
  swing([2, 24.2, 7], 6, 0.45, 1.4, Math.PI, [1.0, 0.15, 1.0]);
  for (const x of [11, 2]) box([x, 24.4, 7], [0.2, 0.2, 7], MAT.beam);

  // Ledge out through the hayloft door
  platform([-8.5, 15, 7], [5.5, 0.5, 3], MAT.planks);
  checkpoint([-6, 15.5, 7], [-4.5, 15.5, 9.3], Math.PI / 2, 10);

  lantern([36, 19.7, 2.5], 1.2);
  lantern([24, 19.7, 11], 1.2);
  lantern([8, 19.7, 11.5], 1.0);
  lantern([-4, 19.7, 2.5], 1.0);

  addCorn([38.5, 16.6, 6], [35, 16.6, 9], [31.5, 16.6, 5.5], [27, 19.5, 7], [19, 22.2, 7], [11, 19.8, 7], [2, 19.8, 7], [-8, 16.8, 7]);
  hint([41.5, 14, 2], [52.5, 20, 12], "These old floorboards won't hold for long!");
  hint([28, 14, 2], [32.5, 20, 12], "Bounce on the hay to reach the catwalk");
}


// ---------------------------------------------------------------------------
// Section 7: Up on the Roof - hay hook lift, gable boards, then the long ridge
// ---------------------------------------------------------------------------
const RIDGE_GAPS = [[40, 43.5], [74, 77.5]];   // rotted boards at the ridge (also cut out of the roof)
const RIDGE_TOP = 30.5;

function buildRoof() {
  // Hay hook: a pallet on a rope from the hay-hood beam, going up and down
  box([-13.2, 23.6, 7], [3, 0.2, 0.2], MAT.beam, { name: "Hay hood beam" });
  const rope = part(level.root, "Hay hook rope", MESH.cylinder, MAT.rope);
  const hook = part(level.root, "Hay hook", MESH.horseshoe, MAT.darkMetal, chain(rotateX(Math.PI / 2), scale(0.2, 0.2, 0.2)));
  const lift = mover([-15.6, 15.35, 7], [0.8, 0.15, 1.0], MAT.planks, t => [-15.6, 18.45 - 3.1 * Math.cos(0.7 * t), 7]);
  const liftUpdate = lift.update;
  lift.update = t => {
    liftUpdate(t);
    const top = lift.center[1] + 0.15, len = (23.4 - top) / 2;
    rope.joint = translate(-15.6, top + len, 7);
    rope.shape = scale(0.03, len, 0.03);
    rope.texScale = [1, len, 1];
    hook.joint = translate(-15.6, top + 0.35, 7);
  };

  // Hay hood over the loft door, then boards nailed up the outside of the gable
  platform([-12, 21.45, 7], [1.4, 0.15, 2.2], MAT.roof);
  for (const [z, top, x, hx] of [[3.9, 23.2, -11.25, 0.75], [1.6, 25.0, -11.25, 0.75], [-0.5, 26.8, -11.25, 0.75], [-0.2, 28.6, -13.0, 0.6]]) {
    platform([x, top - 0.15, z], [hx, 0.15, 0.8], MAT.planks);
    box([(x - 10.3) / 2, top - 0.4, z], [(-10.3 - x) / 2, 0.08, 0.08], MAT.darkMetal, { name: "Bracket" });   // from the wall to the board
  }

  // The ridge walkway, broken where the boards rotted through
  const cuts = [-11.6, ...RIDGE_GAPS.flat(), 113.5];
  for (let c = 0; c + 1 < cuts.length; c += 2)
    platform([(cuts[c] + cuts[c + 1]) / 2, RIDGE_TOP - 0.15, 0], [(cuts[c + 1] - cuts[c]) / 2, 0.15, 0.75], MAT.darkBeam);

  // Cupolas: little ventilation houses on the ridge to climb over
  const cupola = (x, half) => {
    solid([x, RIDGE_TOP + half[1], 0], half, MAT.planks, { camera: false });
    box([x, RIDGE_TOP + 2 * half[1] + 0.05, 0], [half[0] + 0.2, 0.05, half[2] + 0.2], MAT.roof, { name: "Cupola cap" });
    for (const s of [-1, 1]) box([x, RIDGE_TOP + half[1], s * (half[2] + 0.01)], [half[0] * 0.6, half[1] * 0.5, 0.02], MAT.darkBeam, { name: "Louver" });
  };
  cupola(10, [1.3, 1.0, 1.3]);
  solid([52.3, RIDGE_TOP + 0.7, 0], [0.7, 0.7, 0.7], MAT.metal, { camera: false });   // vent pipe box
  cupola(56, [2.0, 1.3, 2.0]);
  cupola(98, [1.3, 1.0, 1.3]);

  // Weathervane on the big cupola: its arm sweeps across the top at pig height
  level.vane = createWeathervane(level.root, [56, RIDGE_TOP + 2.65, 0], 0.6);

  // Crows flying back and forth along the ridge
  crow(t => [lerp(14, 36, 0.5 - 0.5 * Math.cos(0.35 * t)), RIDGE_TOP + 0.65, 0]);
  crow(t => [lerp(80, 95, 0.5 - 0.5 * Math.cos(0.45 * t + 1)), RIDGE_TOP + 0.65, 0]);

  checkpoint([61.5, RIDGE_TOP, 0], [63, RIDGE_TOP, 0], -Math.PI / 2, 26);

  addCorn([-15.6, 19, 7], [-11.25, 27.8, -0.7], [-13.0, 29.4, 0], [2, 31.3, 0], [10, 33.3, 0], [24, 32.4, 0], [41.7, 32.2, 0],
    [56.8, 34.1, 1.2], [68, 31.3, 0], [75.7, 32.2, 0], [88, 32.4, 0], [98, 33.3, 0], [108, 31.3, 0]);
  hint([-14, 14, 2], [-3, 18, 12], "Ride the hay hook up, then climb the boards on the gable");
  hint([-11.6, 29, -2], [4, 34, 2], "Stay on the ridge! The roof is far too steep for a pig");
  hint([12, 29, -2], [37, 34, 2], "Crows! Jump over them");
  hint([50, 29, -2], [58, 36, 2], "Jump over the spinning weathervane");
}

function crow(path) {
  const model = createCrow(level.root);
  level.crows.push({ model, path, pos: path(0), dir: [1, 0, 0], cooldown: 0 });
}


// ---------------------------------------------------------------------------
// Section 8: The Silo - down a spiral of brackets around the silo, over the duck pond
// ---------------------------------------------------------------------------
const SILO = { x: 127, z: 0, radius: 4.5, height: 32 };

function buildSilo() {
  const { x: sx, z: sz } = SILO;

  // Grain chute bridge from the barn's gable to the silo
  part(level.root, "Grain chute", MESH.cylinder, MAT.metal, chain(rotateZ(Math.PI / 2), scale(0.55, 4.6, 0.55)), translate(117.8, 28.5, 0), [3, 4, 1]);
  platform([115.4, 29.35, 0], [1.2, 0.15, 0.8], MAT.metal);
  crumbling([117.6, 29.35, 0], [0.8, 0.15, 0.8], MAT.metal, 0.5);
  platform([119.4, 29.35, 0], [0.8, 0.15, 0.9], MAT.metal);
  checkpoint([119.4, 29.5, 0], [119.4, 29.5, 0.75], -Math.PI / 2, -5);

  // The silo, its dome and hoops. The pig is pushed out of its round wall in
  // game.js; an invisible box keeps the camera out of it.
  part(level.root, "Silo", MESH.cylinder, MAT.silo, scale(SILO.radius, SILO.height / 2, SILO.radius), translate(sx, SILO.height / 2, sz));
  part(level.root, "Silo dome", MESH.sphere, MAT.roof, scale(4.6, 2.6, 4.6), translate(sx, SILO.height, sz), [3, 2, 1]);
  for (let y = 3; y < SILO.height; y += 4)
    part(level.root, "Silo hoop", MESH.torus, MAT.darkMetal, scale(3.55, 0.1, 3.55), translate(sx, y, sz));
  platform([sx, SILO.height / 2, sz], [3.8, SILO.height / 2, 3.8], MAT.silo, { invisible: true, cameraOnly: true });
  level.cylinders.push({ x: sx, z: sz, radius: SILO.radius, top: SILO.height + 2.6 });

  // Spiral of brackets: one every 0.45 rad, each 1.12 lower. Some are missing,
  // some crumble, and two ride back and forth around the silo.
  const R = 5.7, kinds = { 3: "gap", 6: "gap", 7: "orbit", 8: "gap", 10: "crumble", 12: "rest", 14: "gap",
    16: "gap", 17: "orbit", 18: "gap", 20: "crumble", 22: "gap" };
  const at = (a, y) => [sx + R * Math.cos(a), y, sz + R * Math.sin(a)];
  let last;
  for (let k = 0; k < 24; k++) {
    const a = Math.PI + k * 0.45, top = 27.8 - 1.12 * k, kind = kinds[k];
    const c = at(a, top - 0.15);
    if (kind === "gap") continue;
    if (kind === "orbit") {
      const p = platform(c, [0.8, 0.15, 0.8], MAT.metal);
      p.update = t => {
        p.center = at(a + 0.45 * Math.sin(0.8 * t + k), top - 0.15);
        p.node.joint = translate(...p.center);
      };
    } else if (kind === "crumble") {
      crumbling(c, [0.85, 0.15, 0.85], MAT.planks, 0.5);
    } else {
      const half = kind === "rest" ? 1.3 : 0.85;
      platform(c, [half, 0.15, half], MAT.planks);
      box(at(a, top - 0.55).map((v, i) => i === 1 ? v : lerp(i === 0 ? sx : sz, v, 0.86)), [0.12, 0.35, 0.12], MAT.darkMetal, { name: "Bracket" });
      if (kind === "rest") checkpoint(at(a, top), at(a + 0.12, top), 0.88, -5);
    }
    if ([2, 5, 9, 11, 15, 19, 21].includes(k)) addCorn(at(a, top + 0.9));
    last = c;
  }

  // Crows circling the silo at two heights
  crow(t => at(-0.5 * t, 18.2));
  crow(t => at(-0.6 * t + 2, 7.1));

  // The duck pond around the silo, and the dock out of it
  box([124.3, 0.03, 0], [11.8, 0.03, 12.7], MAT.mud, { shadow: false });
  box([124.3, 0.1, 0], [11.8, 0.05, 12], MAT.water, { shadow: false });
  hazard([124.3, 0.2, 0], [11.8, 0.4, 12], "Splash! Pigs can't swim.", "splash");
  // falling past the pond, to the grass on either side, is also too far
  for (const s of [-1, 1]) hazard([124.3, 0.2, s * 26], [11.8, 0.4, 14], "Thud! That was a long way down.", "fall");
  for (let i = 0; i < 14; i++) {
    const a = i * 0.9, r = 9 + (i % 3);
    part(level.root, "Reed", MESH.cylinder, MAT.husk, scale(0.04, 0.7, 0.04), translate(126.5 + r * Math.cos(a), 0.7, r * Math.sin(a) * 1.2));
  }
  platform([last[0] + 4.5, 0.75, last[2]], [3.1, 0.15, 1.3], MAT.planks);
  for (const dx of [2, 4.5, 7]) box([last[0] + dx, 0.2, last[2] + 1.2], [0.1, 0.5, 0.1], MAT.darkBeam, { name: "Dock post" });

  hint([114, 28, -2], [121, 32, 2], "Work your way down around the silo. Pigs can't swim!");
}


// ---------------------------------------------------------------------------
// Section 9: The Farmyard - get past the farm dog to the open gate
// ---------------------------------------------------------------------------
const YARD = { x0: 141, x1: 163.5, z: 13.5 };
const FOREST = { x: 184 };   // where the trees start, past the gate

function buildFarmyard() {
  checkpoint([136.8, 0.9, 4.55], [135, 0.9, 5.6], -Math.PI / 2, -5);

  // Tall hog-wire fences along the sides, low rail fences across
  for (const s of [-1, 1]) {
    solid([151, 1.3, s * YARD.z], [15, 1.3, 0.1], MAT.beam, { invisible: true, camera: false });
    for (let x = 136; x <= 166; x += 2.5) box([x, 1.3, s * YARD.z], [0.1, 1.3, 0.1], MAT.beam);
    for (const y of [0.6, 1.5, 2.4]) box([151, y, s * YARD.z], [15, 0.05, 0.04], MAT.darkMetal);
  }
  const railFence = (x, z0, z1) => {
    solid([x, 0.55, (z0 + z1) / 2], [0.12, 0.55, (z1 - z0) / 2], MAT.beam, { invisible: true, camera: false });
    for (let z = z0; z <= z1 + 0.01; z += 2.2) box([x, 0.6, z], [0.1, 0.6, 0.1], MAT.beam);
    for (const y of [0.45, 0.95]) box([x, y, (z0 + z1) / 2], [0.05, 0.07, (z1 - z0) / 2], MAT.beam);
  };
  railFence(YARD.x0, -YARD.z, YARD.z);
  railFence(YARD.x1, -YARD.z, -2.2);
  railFence(YARD.x1, 2.2, YARD.z);
  part(level.root, "Open gate", MESH.cube, MAT.beam, scale(2.1, 0.5, 0.06), chain(translate(YARD.x1, 0.6, 2.2), rotateY(-1.3), translate(2.1, 0, 0)), [3, 1, 1]);

  // Kennel: walls and a peaked roof; too tall to climb
  solid([152, 1.25, 10.8], [1.1, 1.25, 0.9], MAT.redPaint);
  part(level.root, "Kennel roof", MESH.prism, MAT.roof, chain(rotateY(Math.PI / 2), scale(1.1, 0.5, 1.4)), translate(152, 2.4, 10.8), [1, 1, 1]);
  box([152, 0.55, 9.88], [0.45, 0.5, 0.02], MAT.eye, { name: "Kennel door" });
  level.dog = { model: createDog(level.root), home: [152, 0, 8.6], pos: [152, 0, 8.6], yaw: Math.PI, half: [0.4, 0.55, 0.4], barkTimer: 0, speed: 0 };

  // Places the dog can't follow you: bales, the tractor, the trough, a woodpile, the wagon
  solid([145, 0.6, -4], [1.0, 0.6, 0.8], MAT.bale, { camera: false });
  solid([145, 1.8, -4.1], [0.85, 0.6, 0.7], MAT.bale, { camera: false });
  solid([144.2, 0.6, 4], [0.9, 0.6, 0.8], MAT.bale, { camera: false });

  // Tractor: hood and cab are both standable
  solid([150, 1.0, 0.5], [1.9, 0.9, 0.9], MAT.redPaint, { camera: false });
  solid([148.9, 2.6, 0.5], [0.75, 0.7, 0.85], MAT.redPaint, { camera: false });
  part(level.root, "Exhaust", MESH.cylinder, MAT.darkMetal, scale(0.07, 0.6, 0.07), translate(151.2, 2.4, 0.9));
  for (const [x, r] of [[148.6, 0.95], [151.4, 0.55]])
    for (const s of [-1, 1]) wagonWheel(level.root, [x, r, 0.5 + s * 1.15], r, rotateY(0));

  solid([155, 0.6, -1], [0.9, 0.6, 0.8], MAT.bale, { camera: false });
  trough(155.5, -6, 0.8, 2, 0);
  solid([157.5, 0.55, 6], [1.6, 0.55, 0.9], MAT.bark, { camera: false, texScale: [3, 1, 1] });
  for (let i = 0; i < 5; i++)
    part(level.root, "Log", MESH.cylinder, MAT.bark, chain(rotateZ(Math.PI / 2), scale(0.28, 1.65, 0.28)), translate(157.5, 1.25, 5.4 + i * 0.3), [2, 1, 1]);

  platform([160, 1.3, -2], [2.6, 0.25, 1.6], MAT.redPaint);
  part(level.root, "Wagon hay", MESH.sphere, MAT.looseHay, scale(2.4, 0.8, 1.4), translate(160, 1.55, -2));
  for (const [x, z] of [[158, -3.8], [162, -3.8], [158, -0.2], [162, -0.2]]) wagonWheel(level.root, [x, 0.75, z], 0.75);

  addCorn([145, 3.3, -4.1], [148.9, 4.2, 0.5], [152, 0.8, 12.6], [155.5, 1.6, -6], [157.5, 1.9, 6], [160, 2.9, -2], [164.3, 0.8, 0]);
  hint([137, -1, -13], [144, 4, 13], "Uh oh, the farm dog! Sprint, or climb up where it can't reach you");
}


// ---------------------------------------------------------------------------
// Outside: grass and trees around the barn and the meadow past the gate
// ---------------------------------------------------------------------------
function buildOutside() {
  const grass = (c, h) => solid(c, h, MAT.grass, { shadow: false, texScale: [h[0] / 3, 1, h[2] / 3] });
  grass([-70, -1, 0], [59.7, 1, 120]);
  grass([172, -1, 0], [59.7, 1, 120]);
  grass([51, -1, -67], [61.3, 1, 52.7]);
  grass([51, -1, 67], [61.3, 1, 52.7]);

  for (const [x, z, s] of [[-32, -18, 1.2], [-38, 16, 1.4], [-55, 2, 1.6], [-28, 32, 1.1], [-45, -40, 1.5],
    [130, 22, 1.3], [128, -25, 1.2], [40, 40, 1.4], [70, -38, 1.3], [10, -32, 1.1], [95, 34, 1.2],
    [150, 24, 1.2], [155, -26, 1.3]])
    tree(level.root, [x, 0, z], s);

  // The forest past the farm gate, where the pig runs off to at the end. A path
  // stays open straight out from the gate so you can watch the pig go.
  const rand = seededRandom(7);
  for (let i = 0; i < 80; i++) {
    const x = FOREST.x + rand() * 45, z = -45 + rand() * 90;
    if (Math.abs(z) < 3.5 && x < FOREST.x + 14) continue;
    tree(level.root, [x, 0, z], 1.1 + rand() * 0.8);
  }
  for (let i = 0; i < 14; i++) {
    const z = -30 + i * 4.6 + rand() * 2;
    if (Math.abs(z) < 3) continue;
    part(level.root, "Bush", MESH.sphere, MAT.leaves, scale(1.4, 0.9, 1.4), translate(FOREST.x - 1 + rand() * 2, 0.5, z));
  }

  for (let z = -30; z <= 30; z += 10) {
    box([-40, 0.6, z], [0.12, 0.6, 0.12], MAT.beam);
    box([-40, 0.8, z + 5], [0.05, 0.07, 5], MAT.beam);
  }
}

function buildLevel() {
  buildBarn();
  buildPen();
  buildStables();
  buildHayStorage();
  buildToolCorner();
  buildRafters();
  buildHayloft();
  buildRoof();
  buildSilo();
  buildFarmyard();
  buildOutside();
}


// ---------------------------------------------------------------------------
// Per-frame animation of the level
// ---------------------------------------------------------------------------
function updateLevel(t, dt) {
  for (const p of level.platforms) {
    if (!p.update) continue;
    const before = [...p.center];
    p.update(t, dt);
    p.delta = vsub(p.center, before);
  }
  for (const spin of level.spinners) spin(t);
  for (const l of level.lanterns) animateLantern(l, t);

  for (const c of level.corn) {
    if (c.collected) continue;
    c.root.joint = translate(c.pos[0], c.pos[1] + 0.15 * Math.sin(2 * t + c.phase), c.pos[2]);
    c.spin.joint = multiply(rotateY(t * 2 + c.phase), rotateZ(0.25));
  }
  for (const cp of level.checkpoints)
    cp.spin.joint = multiply(translate(0, 1.35 + (cp.active ? 0.1 * Math.sin(3 * t) : 0), 0), rotateY(t * (cp.active ? 2.5 : 0.6)));

  for (const b of level.bouncers) {
    b.squash = Math.max(0, b.squash - dt * 4);
    const s = Math.sin(b.squash * Math.PI) * 0.35;
    b.mound.joint = multiply(translate(...b.center), scale(1 + s * 0.4, 1 - s, 1 + s * 0.4));
  }

  if (level.searchlight) level.searchlight.update(t);

  const v = level.vane;
  if (v) {
    v.angle = 1.5 * t;
    v.arm.joint = multiply(translate(0, v.armHeight, 0), rotateY(v.angle));
  }

  // Crows follow their path; they face the way they're flying
  for (const c of level.crows) {
    const next = c.path(t + 0.05);
    c.pos = c.path(t);
    const heading = vsub(next, c.pos);
    if (vlength(heading) > 1e-4) c.dir = vnormalize(heading);
    c.cooldown = Math.max(0, c.cooldown - dt);
    c.model.root.joint = multiply(translate(...c.pos), rotateY(Math.atan2(c.dir[0], c.dir[2])));
    animateCrow(c.model, t);
  }

  // texture animation: slide the uvs over time
  MAT.water.uvOffset = [0.03 * t, 0.05 * Math.sin(t * 0.5)];
  MAT.belt.uvOffset = [3.5 * t / MAT.belt.tile, 0];
}

// The farm dog chases the pig across the yard while the pig is on the ground.
// It can't climb, so if the pig gets up on something it waits underneath, barking.
// During the ending it runs to the gate and barks after the escaping pig.
function updateDog(t, dt, ending) {
  const d = level.dog;
  if (!d) return;
  const p = player.pos;
  const inYard = p[0] > YARD.x0 && p[0] < YARD.x1 && Math.abs(p[2]) < YARD.z;
  const dist = Math.hypot(p[0] - d.pos[0], p[2] - d.pos[2]);
  d.excited = ending || (inYard && dist < 14);
  const onGround = p[1] < 1.0;

  const goal = ending ? [YARD.x1 - 1.2, 0, 0] : d.excited ? p : d.home;
  const speed = ending ? 6 : d.excited ? 8.2 : 3;
  const stop = d.excited && !onGround ? 1.4 : 0.05;
  const gx = goal[0] - d.pos[0], gz = goal[2] - d.pos[2], gd = Math.hypot(gx, gz);
  let moved = 0;
  if (gd > stop) {
    moved = Math.min(speed * dt, gd - stop);
    slideBox(d.pos, d.half, gx / gd * moved, gz / gd * moved);
  }
  if (gd > 0.1) d.yaw += angleDiff(d.yaw, Math.atan2(gx, gz)) * Math.min(1, dt * 10);
  d.pos[0] = clamp(d.pos[0], YARD.x0 + 0.6, YARD.x1 - 0.6);
  d.pos[2] = clamp(d.pos[2], -YARD.z + 0.6, YARD.z - 0.6);
  d.speed = moved / dt;

  d.model.root.joint = multiply(translate(...d.pos), rotateY(d.yaw));
  animateDog(d.model, t, dt, d.speed, d.excited);

  d.barkTimer -= dt;
  if (d.excited && d.barkTimer <= 0) {
    d.barkTimer = 0.6 + Math.random() * 0.6;
    level.events.push({ type: "bark", pos: [...d.pos] });
  }
}

function updateChickens(t, dt) {
  for (const c of level.chickens) {
    c.flap = Math.max(0, c.flap - dt);
    if (c.pause > 0) {
      c.pause -= dt;
    } else {
      c.x += c.dir * 1.5 * dt;
      if (c.x > c.x1 || c.x < c.x0) {
        c.x = clamp(c.x, c.x0, c.x1);
        c.dir = -c.dir;
        c.pause = 0.6 + Math.random() * 1.2;
      }
    }
    c.yaw += angleDiff(c.yaw, c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) * Math.min(1, dt * 8);
    c.model.root.joint = multiply(translate(c.x, c.y + (c.flap > 0 ? 0.3 * Math.sin(c.flap * Math.PI) : 0), c.z), rotateY(c.yaw));
    animateChicken(c.model, t, c.pause <= 0, c.flap > 0);
  }
}
