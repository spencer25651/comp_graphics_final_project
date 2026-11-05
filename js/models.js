// Hierarchical models built from the primitive meshes: the pig, chickens,
// lanterns, collectibles and barn props. Each returns the nodes that get
// animated, so the animation code can set their joint matrices every frame.

// Adds a child node. texScale defaults to the material's uv repeat.
function part(parent, name, mesh = null, mat = null, shape = IDENTITY, joint = IDENTITY, texScale = null) {
  const n = addChild(parent, createNode(name, mesh, mat, shape));
  n.joint = joint;
  n.texScale = texScale || (mat && mat.texMode === 0 ? [mat.uv[0], mat.uv[1], 1] : [1, 1, 1]);
  return n;
}

const EYE_SHINE = material({ mode: 1, color: [1, 1, 1], emissive: 1.5, outline: false });
const BARREL = material({ texture: TEX.beam, texMode: 0, uv: [4, 1], color: [0.9, 0.8, 0.7] });


// ---------------------------------------------------------------------------
// The pig
//
//   root (position + facing)
//   └─ body pivot (bob, squash & stretch: scales everything below it)
//      ├─ body
//      ├─ head pivot (nods, looks up when jumping)
//      │  ├─ head, snout ─ nostrils, eyes ─ shine
//      │  └─ ear pivots (x2, flop with speed and jumps) ─ ear
//      ├─ hip joints (x4, swing when walking) ─ leg, hoof
//      └─ tail segment ─ tail segment ─ ... (6, a corkscrew that wags)
// ---------------------------------------------------------------------------
const PIG_BODY_HEIGHT = 0.62;

function createPig(parent) {
  const pig = {};
  pig.root = part(parent, "Pig");
  pig.bodyPivot = part(pig.root, "Body pivot");
  part(pig.bodyPivot, "Body", MESH.sphere, MAT.pigSkin, scale(0.42, 0.38, 0.6));

  pig.head = part(pig.bodyPivot, "Head pivot", null, null, IDENTITY, translate(0, 0.14, 0.52));
  part(pig.head, "Head", MESH.sphere, MAT.pigSkin, scale(0.31, 0.29, 0.29));
  // A cylinder turned to face forward (its axis is y, rotateX turns y into z)
  const snout = part(pig.head, "Snout", MESH.cylinder, MAT.pigSnout,
    multiply(rotateX(Math.PI / 2), scale(0.14, 0.07, 0.11)), translate(0, -0.05, 0.3));
  for (const s of [-1, 1]) {
    part(snout, "Nostril", MESH.sphere, MAT.nostril, scale(0.028, 0.04, 0.02), translate(s * 0.05, 0, 0.07));
    const eye = part(pig.head, "Eye", MESH.sphere, MAT.eye, scale(0.045, 0.05, 0.04), translate(s * 0.13, 0.08, 0.24));
    part(eye, "Eye shine", MESH.sphere, EYE_SHINE, scale(0.014, 0.014, 0.014), translate(s * 0.012, 0.022, 0.034));
  }
  pig.ears = [-1, 1].map(s => {
    const ear = part(pig.head, "Ear pivot", null, null, IDENTITY, translate(s * 0.17, 0.22, 0.02));
    part(ear, "Ear", MESH.cone, MAT.pigSkin, multiply(translate(0, 0.11, 0), scale(0.1, 0.12, 0.035)));
    ear.side = s;
    return ear;
  });

  // front-left, front-right, back-left, back-right
  pig.legs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => {
    const hip = part(pig.bodyPivot, "Hip joint", null, null, IDENTITY, translate(sx * 0.21, -0.16, sz * 0.3));
    part(hip, "Leg", MESH.cylinder, MAT.pigSkin, multiply(translate(0, -0.2, 0), scale(0.085, 0.2, 0.085)));
    part(hip, "Hoof", MESH.cylinder, MAT.hoof, multiply(translate(0, -0.41, 0), scale(0.09, 0.04, 0.09)));
    hip.base = hip.joint;
    hip.phase = sx * sz > 0 ? 0 : Math.PI;   // diagonal pairs move together (a trot)
    hip.front = sz > 0;
    return hip;
  });

  // Each tail segment is placed relative to the previous one with the same
  // small twist + bend, so the chain winds into a corkscrew
  pig.tail = [];
  let link = pig.bodyPivot;
  for (let i = 0; i < 6; i++) {
    const joint = i === 0 ? translate(0, 0.12, -0.58) : chain(rotateZ(0.9), rotateX(-0.55), translate(0, 0, -0.05));
    link = part(link, "Tail segment", MESH.sphere, MAT.pigSnout, scale(0.035, 0.035, 0.035), joint);
    link.base = joint;
    pig.tail.push(link);
  }
  return pig;
}

// state: { pos, yaw, speed, vy, onGround, squash, time }
function animatePig(pig, s, dt) {
  pig.walkPhase = (pig.walkPhase || 0) + dt * (4 + s.speed * 1.6) * (s.onGround ? 1 : 0);
  const stride = s.onGround ? Math.min(s.speed / 6, 1.2) : 0;
  const swing = Math.sin(pig.walkPhase);

  pig.root.joint = multiply(translate(...s.pos), rotateY(s.yaw));

  // Squash on landing / stretch when rising, keeping the volume roughly constant
  const stretch = s.onGround ? -s.squash : clamp(s.vy * 0.012, -0.12, 0.15);
  const sy = 1 + stretch, sxz = 1 / Math.sqrt(sy);
  const bob = Math.abs(swing) * 0.05 * stride + (s.onGround && s.speed < 0.5 ? Math.sin(s.time * 2.5) * 0.008 : 0);
  pig.bodyPivot.joint = multiply(translate(0, PIG_BODY_HEIGHT * sy + bob, 0), scale(sxz, sy, sxz));

  for (const hip of pig.legs) {
    let angle = Math.sin(pig.walkPhase + hip.phase) * 0.7 * stride;
    if (!s.onGround) angle = hip.front ? -0.7 : 0.6;   // tuck the legs in mid-air
    hip.joint = multiply(hip.base, rotateX(angle));
  }

  const look = s.onGround ? Math.sin(pig.walkPhase * 2) * 0.04 * stride : clamp(-s.vy * 0.03, -0.35, 0.3);
  pig.head.joint = multiply(translate(0, 0.14, 0.52), rotateX(look));

  for (const ear of pig.ears) {
    const flop = 0.45 + stride * 0.25 * Math.sin(pig.walkPhase * 2 + ear.side) + (s.onGround ? 0 : clamp(-s.vy * 0.05, -0.8, 0.6));
    ear.joint = chain(translate(ear.side * 0.17, 0.22, 0.02), rotateZ(-ear.side * 0.35), rotateX(flop));
  }

  const wag = Math.sin(s.time * (s.speed > 0.5 ? 14 : 5)) * 0.5;
  pig.tail[0].joint = multiply(pig.tail[0].base, rotateY(wag));
}


// ---------------------------------------------------------------------------
// Hanging lantern: hook ─ swing pivot ─ chain + body ─ cap, glass, base, wires.
// Its point light sits at the glass, read from the body's world matrix.
// ---------------------------------------------------------------------------
function createLantern(parent, anchor, chainLength = 1.5, phase = 0) {
  const L = chainLength;
  const hook = part(parent, "Lantern hook", MESH.cube, MAT.darkMetal, scale(0.08, 0.08, 0.08), translate(...anchor));
  const swing = part(hook, "Lantern swing");
  part(swing, "Chain", MESH.cylinder, MAT.darkMetal, multiply(translate(0, -L / 2, 0), scale(0.018, L / 2, 0.018)));
  const body = part(swing, "Lantern body", null, null, IDENTITY, translate(0, -L, 0));
  part(body, "Cap", MESH.cone, MAT.darkMetal, multiply(translate(0, -0.12, 0), scale(0.2, 0.12, 0.2)));
  part(body, "Glass", MESH.cylinder, MAT.lanternGlass, multiply(translate(0, -0.42, 0), scale(0.13, 0.2, 0.13)));
  part(body, "Base", MESH.cylinder, MAT.darkMetal, multiply(translate(0, -0.65, 0), scale(0.18, 0.04, 0.18)));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
    part(body, "Wire", MESH.cylinder, MAT.darkMetal, multiply(translate(x * 0.13, -0.42, z * 0.13), scale(0.015, 0.23, 0.015)));
  return { hook, swing, body, phase, amp: 0.12 + 0.08 * Math.sin(phase * 7), pos: [...anchor] };
}

function animateLantern(lantern, t) {
  const a = lantern.amp * Math.sin(1.3 * t + lantern.phase);
  const b = lantern.amp * 0.5 * Math.cos(0.9 * t + lantern.phase * 2);
  lantern.swing.joint = multiply(rotateZ(a), rotateX(b));
}


// ---------------------------------------------------------------------------
// Chicken: body ─ head pivot (pecks) ─ head, beak, comb, wattle, eyes
//               ─ wing pivots (flap) ─ wing
//               ─ hip joints (walk) ─ leg, foot
// ---------------------------------------------------------------------------
function createChicken(parent) {
  const c = {};
  c.root = part(parent, "Chicken");
  c.body = part(c.root, "Chicken body", MESH.sphere, MAT.chicken, scale(0.26, 0.24, 0.32), translate(0, 0.45, 0));
  part(c.body, "Tail", MESH.cone, MAT.chicken, multiply(rotateX(-0.6), scale(0.12, 0.18, 0.06)), translate(0, 0.14, -0.3));
  c.head = part(c.body, "Head pivot", null, null, IDENTITY, translate(0, 0.2, 0.2));
  part(c.head, "Head", MESH.sphere, MAT.chicken, scale(0.13, 0.14, 0.13), translate(0, 0.1, 0.05));
  part(c.head, "Beak", MESH.cone, MAT.beak, multiply(rotateX(Math.PI / 2), scale(0.045, 0.07, 0.04)), translate(0, 0.08, 0.22));
  part(c.head, "Comb", MESH.sphere, MAT.comb, scale(0.025, 0.07, 0.08), translate(0, 0.24, 0.05));
  part(c.head, "Wattle", MESH.sphere, MAT.comb, scale(0.025, 0.045, 0.03), translate(0, 0.0, 0.16));
  for (const s of [-1, 1])
    part(c.head, "Eye", MESH.sphere, MAT.eye, scale(0.022, 0.026, 0.022), translate(s * 0.1, 0.13, 0.1));
  c.wings = [-1, 1].map(s => {
    const w = part(c.body, "Wing pivot", null, null, IDENTITY, translate(s * 0.23, 0.05, 0));
    part(w, "Wing", MESH.sphere, MAT.chicken, multiply(translate(s * 0.02, -0.04, -0.02), scale(0.05, 0.15, 0.22)));
    w.side = s;
    return w;
  });
  c.legs = [-1, 1].map(s => {
    const hip = part(c.body, "Hip joint", null, null, IDENTITY, translate(s * 0.1, -0.2, 0));
    part(hip, "Leg", MESH.cylinder, MAT.beak, multiply(translate(0, -0.12, 0), scale(0.022, 0.12, 0.022)));
    part(hip, "Foot", MESH.cube, MAT.beak, multiply(translate(0, -0.24, 0.03), scale(0.06, 0.012, 0.08)));
    hip.side = s;
    return hip;
  });
  return c;
}

function animateChicken(c, t, walking, flapping) {
  const phase = t * 9;
  for (const hip of c.legs)
    hip.joint = multiply(translate(hip.side * 0.1, -0.2, 0), rotateX(walking ? Math.sin(phase + (hip.side > 0 ? Math.PI : 0)) * 0.6 : 0));
  const peck = walking ? Math.sin(phase * 0.5) * 0.15 : Math.max(0, Math.sin(t * 5)) * 0.8;
  c.head.joint = multiply(translate(0, 0.2, 0.2), rotateX(peck));
  for (const w of c.wings) {
    const flap = flapping ? 0.3 + Math.sin(t * 30) * 0.9 : 0.05 * Math.sin(t * 3);
    w.joint = multiply(translate(w.side * 0.23, 0.05, 0), rotateZ(w.side * flap));
  }
  c.body.joint = multiply(translate(0, 0.45 + (walking ? Math.abs(Math.sin(phase)) * 0.03 : 0), 0), rotateX(walking ? 0.1 : 0));
}


// ---------------------------------------------------------------------------
// Crow: body ─ head ─ beak, eyes;  body ─ wing pivots (flap) ─ wing;  body ─ tail
// ---------------------------------------------------------------------------
function createCrow(parent) {
  const c = {};
  c.root = part(parent, "Crow");
  c.body = part(c.root, "Crow body", MESH.sphere, MAT.crow, scale(0.16, 0.15, 0.3));
  part(c.body, "Crow tail", MESH.cone, MAT.crow, chain(rotateX(-Math.PI / 2 - 0.2), scale(0.11, 0.16, 0.03)), translate(0, 0.02, -0.38));
  const head = part(c.body, "Crow head", MESH.sphere, MAT.crow, scale(0.11, 0.1, 0.12), translate(0, 0.08, 0.3));
  part(head, "Crow beak", MESH.cone, MAT.crowBeak, chain(rotateX(Math.PI / 2), scale(0.035, 0.09, 0.03)), translate(0, -0.02, 0.17));
  for (const s of [-1, 1]) part(head, "Eye", MESH.sphere, EYE_SHINE, scale(0.02, 0.02, 0.02), translate(s * 0.08, 0.03, 0.07));
  c.wings = [-1, 1].map(s => {
    const w = part(c.body, "Wing pivot", null, null, IDENTITY, translate(s * 0.12, 0.06, 0));
    part(w, "Wing", MESH.sphere, MAT.crow, multiply(translate(s * 0.3, 0, -0.02), scale(0.3, 0.025, 0.15)));
    w.side = s;
    return w;
  });
  return c;
}

function animateCrow(c, t) {
  const flap = Math.sin(t * 11) * 0.65;
  for (const w of c.wings) w.joint = multiply(translate(w.side * 0.12, 0.06, 0), rotateZ(w.side * flap));
  c.body.joint = translate(0, Math.sin(t * 11 - 1) * 0.06, 0);
}


// ---------------------------------------------------------------------------
// Farm dog: body pivot ─ body, collar
//                     ─ head pivot ─ head, snout, nose, eyes, ear pivots ─ ear
//                     ─ hip joints x4 ─ leg, paw
//                     ─ tail pivot ─ tail
// ---------------------------------------------------------------------------
function createDog(parent) {
  const d = {};
  d.root = part(parent, "Dog");
  d.body = part(d.root, "Dog body pivot", null, null, IDENTITY, translate(0, 0.75, 0));
  part(d.body, "Dog body", MESH.sphere, MAT.dogFur, scale(0.32, 0.3, 0.62));
  part(d.body, "Collar", MESH.torus, MAT.comb, chain(rotateX(Math.PI / 2), scale(0.21, 0.2, 0.21)), translate(0, 0.14, 0.45));
  d.head = part(d.body, "Dog head pivot", null, null, IDENTITY, translate(0, 0.3, 0.55));
  part(d.head, "Dog head", MESH.sphere, MAT.dogFur, scale(0.24, 0.22, 0.26), translate(0, 0.05, 0.1));
  part(d.head, "Snout", MESH.cube, MAT.dogDark, scale(0.11, 0.09, 0.15), translate(0, -0.03, 0.33), [1, 1, 1]);
  part(d.head, "Nose", MESH.sphere, MAT.eye, scale(0.05, 0.04, 0.04), translate(0, 0.04, 0.48));
  for (const s of [-1, 1]) part(d.head, "Eye", MESH.sphere, MAT.eye, scale(0.035, 0.04, 0.03), translate(s * 0.11, 0.12, 0.3));
  d.ears = [-1, 1].map(s => {
    const ear = part(d.head, "Ear pivot", null, null, IDENTITY, translate(s * 0.17, 0.2, 0.06));
    part(ear, "Ear", MESH.sphere, MAT.dogDark, multiply(translate(s * 0.03, -0.12, 0), scale(0.06, 0.17, 0.11)));
    ear.side = s;
    return ear;
  });
  d.legs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => {
    const hip = part(d.body, "Hip joint", null, null, IDENTITY, translate(sx * 0.18, -0.15, sz * 0.38));
    part(hip, "Leg", MESH.cylinder, MAT.dogFur, multiply(translate(0, -0.25, 0), scale(0.07, 0.25, 0.07)));
    part(hip, "Paw", MESH.sphere, MAT.dogDark, multiply(translate(0, -0.52, 0.03), scale(0.08, 0.05, 0.1)));
    hip.base = hip.joint;
    hip.phase = sx * sz > 0 ? 0 : Math.PI;
    return hip;
  });
  d.tail = part(d.body, "Tail pivot", null, null, IDENTITY, translate(0, 0.15, -0.6));
  part(d.tail, "Tail", MESH.cylinder, MAT.dogFur, multiply(translate(0, 0.22, 0), scale(0.05, 0.22, 0.05)));
  return d;
}

// speed: how fast it is running; excited: barking/wagging hard
function animateDog(d, t, dt, speed, excited) {
  d.phase = (d.phase || 0) + dt * (2 + speed * 1.8);
  const stride = Math.min(speed / 6, 1);
  for (const hip of d.legs) hip.joint = multiply(hip.base, rotateX(Math.sin(d.phase + hip.phase) * 0.8 * stride));
  d.body.joint = translate(0, 0.75 + Math.abs(Math.sin(d.phase)) * 0.06 * stride, 0);
  const bark = excited && speed < 0.5 ? Math.max(0, Math.sin(t * 9)) * 0.25 : 0;
  d.head.joint = multiply(translate(0, 0.3, 0.55), rotateX(-bark + Math.sin(d.phase * 2) * 0.05 * stride));
  for (const ear of d.ears)
    ear.joint = chain(translate(ear.side * 0.17, 0.2, 0.06), rotateZ(ear.side * (0.2 + 0.4 * stride + bark)));
  d.tail.joint = chain(translate(0, 0.15, -0.6), rotateX(-0.7), rotateZ(Math.sin(t * (excited ? 18 : 6)) * 0.5));
}


// ---------------------------------------------------------------------------
// Weathervane: post ─ arm (spins about y) ─ shaft, arrowhead, tail fin
//                   ─ rooster on top
// ---------------------------------------------------------------------------
const VANE_ARM = 2.4;

function createWeathervane(parent, pos, armHeight) {
  const root = part(parent, "Weathervane", MESH.cylinder, MAT.darkMetal, multiply(translate(0, 1.1, 0), scale(0.06, 1.1, 0.06)), translate(...pos));
  const arm = part(root, "Vane arm", null, null, IDENTITY, translate(0, armHeight, 0));
  part(arm, "Vane shaft", MESH.cube, MAT.darkMetal, scale(VANE_ARM, 0.05, 0.05), IDENTITY, [1, 1, 1]);
  part(arm, "Arrowhead", MESH.cone, MAT.darkMetal, chain(rotateZ(-Math.PI / 2), scale(0.22, 0.3, 0.05)), translate(VANE_ARM + 0.25, 0, 0));
  part(arm, "Tail fin", MESH.cube, MAT.darkMetal, scale(0.35, 0.3, 0.03), translate(-VANE_ARM + 0.2, 0.15, 0), [1, 1, 1]);
  const rooster = part(root, "Rooster", MESH.sphere, MAT.gold, scale(0.32, 0.24, 0.07), translate(0, 2.35, 0));
  part(rooster, "Rooster head", MESH.sphere, MAT.gold, scale(0.12, 0.13, 0.06), translate(0.28, 0.22, 0));
  part(rooster, "Rooster comb", MESH.sphere, MAT.gold, scale(0.08, 0.06, 0.04), translate(0.28, 0.36, 0));
  part(rooster, "Rooster tail", MESH.cone, MAT.gold, chain(rotateZ(0.6), scale(0.16, 0.3, 0.05)), translate(-0.3, 0.2, 0));
  return { root, arm, pos, armHeight, angle: 0 };
}


// ---------------------------------------------------------------------------
// Collectible corn cob and checkpoint horseshoe
// ---------------------------------------------------------------------------
function createCorn(parent, pos) {
  const root = part(parent, "Corn", null, null, IDENTITY, translate(...pos));
  const spin = part(root, "Corn spin");
  part(spin, "Cob", MESH.sphere, MAT.corn, scale(0.13, 0.3, 0.13));
  for (let i = 0; i < 3; i++)
    part(spin, "Husk", MESH.cone, MAT.husk, chain(rotateY(i * 2.09), translate(0, -0.12, 0.08), rotateX(0.35), scale(0.08, 0.2, 0.03)));
  return { root, spin, pos: [...pos], collected: false, phase: pos[0] * 0.7 };
}

function createHorseshoe(parent, pos) {
  const root = part(parent, "Checkpoint", null, null, IDENTITY, translate(...pos));
  part(root, "Post", MESH.cylinder, MAT.beam, multiply(translate(0, 0.5, 0), scale(0.07, 0.5, 0.07)), IDENTITY, [1, 1, 1]);
  const spin = part(root, "Horseshoe spin", null, null, IDENTITY, translate(0, 1.35, 0));
  // The torus' gap is turned to the top (a lucky horseshoe opens upward)
  const shoe = part(spin, "Horseshoe", MESH.horseshoe, MAT.iron, chain(rotateX(Math.PI / 2), rotateY(0.3 * Math.PI), scale(0.3, 0.3, 0.3)));
  return { root, spin, shoe };
}


// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
function barrel(parent, pos, r = 0.5, h = 0.6) {
  const root = part(parent, "Barrel", MESH.cylinder, BARREL, scale(r, h, r), translate(...pos));
  for (const y of [-0.65, 0.65])
    part(root, "Barrel band", MESH.torus, MAT.darkMetal, scale(0.8 * r, 0.08, 0.8 * r), translate(0, y * h, 0));
  part(root, "Barrel lid", MESH.cylinder, MAT.beam, scale(r * 0.92, 0.02, r * 0.92), translate(0, h, 0));
  return root;
}

function crate(parent, pos, size = 0.75, yaw = 0) {
  return part(parent, "Crate", MESH.cube, MAT.crate, scale(size, size, size), multiply(translate(...pos), rotateY(yaw)), [1, 1, 1]);
}

function sack(parent, pos, yaw = 0) {
  const root = part(parent, "Sack", MESH.sphere, MAT.burlap, scale(0.38, 0.45, 0.32), multiply(translate(pos[0], pos[1] + 0.42, pos[2]), rotateY(yaw)));
  part(root, "Sack tie", MESH.cylinder, MAT.rope, scale(0.09, 0.07, 0.09), translate(0, 0.47, 0));
  return root;
}

function bucket(parent, pos) {
  const root = part(parent, "Bucket", MESH.cylinder, MAT.metal, scale(0.22, 0.22, 0.22), translate(pos[0], pos[1] + 0.22, pos[2]), [1, 1, 1]);
  part(root, "Handle", MESH.torus, MAT.darkMetal, chain(rotateX(Math.PI / 2), scale(0.18, 0.05, 0.18)), translate(0, 0.22, 0));
  return root;
}

function ladder(parent, pos, height, yaw = 0) {
  const root = part(parent, "Ladder", null, null, IDENTITY, multiply(translate(...pos), rotateY(yaw)));
  for (const x of [-0.35, 0.35])
    part(root, "Ladder rail", MESH.cube, MAT.beam, scale(0.05, height / 2, 0.06), translate(x, height / 2, 0));
  for (let y = 0.4; y < height; y += 0.45)
    part(root, "Rung", MESH.cylinder, MAT.beam, multiply(rotateZ(Math.PI / 2), scale(0.035, 0.35, 0.035)), translate(0, y, 0));
  return root;
}

function wagonWheel(parent, pos, radius, joint = IDENTITY) {
  const root = part(parent, "Wheel", null, null, IDENTITY, multiply(translate(...pos), joint));
  // the wheel lies in the xy plane, so it rolls about z
  part(root, "Rim", MESH.torus, MAT.darkBeam, chain(rotateX(Math.PI / 2), scale(radius * 0.9, radius * 0.25, radius * 0.9)));
  part(root, "Hub", MESH.cylinder, MAT.darkMetal, chain(rotateX(Math.PI / 2), scale(radius * 0.18, radius * 0.18, radius * 0.18)));
  for (let i = 0; i < 8; i++)
    part(root, "Spoke", MESH.cylinder, MAT.beam, chain(rotateZ(i * Math.PI / 4), translate(0, radius * 0.45, 0), scale(radius * 0.05, radius * 0.45, radius * 0.05)));
  return root;
}

function tree(parent, pos, size = 1) {
  const root = part(parent, "Tree", null, null, IDENTITY, translate(...pos));
  part(root, "Trunk", MESH.cylinder, MAT.bark, scale(0.35 * size, 2 * size, 0.35 * size), translate(0, 2 * size, 0));
  for (const [y, r] of [[4.5, 2.6], [6.2, 2.0], [7.6, 1.3]])
    part(root, "Leaves", MESH.cone, MAT.leaves, scale(r * size, 1.6 * size, r * size), translate(0, y * size, 0));
  return root;
}

// A hay rake lying tines-up: the barn's version of spikes
function rake(parent, pos, length, alongX = true) {
  const root = part(parent, "Rake", null, null, IDENTITY, multiply(translate(...pos), rotateY(alongX ? 0 : Math.PI / 2)));
  part(root, "Rake head", MESH.cube, MAT.darkBeam, scale(length, 0.06, 0.1), translate(0, 0.06, 0), [length, 1, 1]);
  part(root, "Rake handle", MESH.cylinder, MAT.beam, chain(rotateX(Math.PI / 2), scale(0.04, 1.2, 0.04)), translate(0, 0.05, -1.25));
  for (let x = -length + 0.1; x <= length - 0.05; x += 0.2)
    part(root, "Tine", MESH.cone, MAT.metal, scale(0.035, 0.18, 0.035), translate(x, 0.3, 0), [1, 1, 1]);
  return root;
}
