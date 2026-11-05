// Game state, input, the main loop, and per-frame render setup.

buildLevel();
const pig = createPig(level.root);

const state = {
  mode: "title",          // title | playing | paused | dying | won
  time: 0,                // animation clock (keeps running for the title screen)
  runTime: 0,             // the speedrun timer
  deaths: 0, cornCount: 0,
  checkpoint: 0, deathTimer: 0, fog: level.sections[0].fog,
  bannerTimer: 0, toastTimer: 0
};

const settings = {
  toon: false, shadows: true, textures: true, fog: true, lights: true,
  particles: true, shafts: true, roofShadows: false, showShadowMap: false
};
const SETTING_KEYS = {
  KeyT: ["toon", "Toon shading"], Digit1: ["shadows", "Shadow maps"], Digit2: ["textures", "Textures"],
  Digit3: ["fog", "Fog"], Digit4: ["lights", "Lantern lights"], Digit5: ["particles", "Particles"],
  Digit6: ["shafts", "Light shafts"], Digit7: ["roofShadows", "Roof casts shadows"], Digit8: ["showShadowMap", "Shadow map view"]
};

const sunMap = createShadowMap(2048);
const spotMap = createShadowMap(1024);
const LANTERN_COLOR = [3.2, 1.9, 0.8];

const $ = id => document.getElementById(id);


// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = new Set();
let jumpPressed = false;
let lookYaw = 0, lookPitch = 0, dragging = false;

document.addEventListener("keydown", e => {
  initAudio();
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === "Space") jumpPressed = true;
  if (e.code === "Enter" && state.mode === "title") startGame();
  if ((e.code === "Enter" || e.code === "Space") && state.mode === "ending") showResults();
  if (e.code === "Escape" || e.code === "KeyP") togglePause();
  if (e.code === "KeyM") { audio.muted = !audio.muted; toast("Sound: " + (audio.muted ? "OFF" : "ON")); }
  if (SETTING_KEYS[e.code]) {
    const [key, label] = SETTING_KEYS[e.code];
    settings[key] = !settings[key];
    syncSettingsUI();
    toast(label + ": " + (settings[key] ? "ON" : "OFF"));
  }
});
document.addEventListener("keyup", e => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

canvas.addEventListener("mousedown", () => {
  initAudio();
  if (state.mode === "ending") showResults();
  dragging = true;
  if (state.mode === "playing" && document.pointerLockElement !== canvas) {
    lockPointer();
  }
});
window.addEventListener("mouseup", () => dragging = false);
window.addEventListener("mousemove", e => {
  if (document.pointerLockElement === canvas || dragging) {
    lookYaw -= e.movementX * 0.0035;
    lookPitch += e.movementY * 0.0035;
  }
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== canvas && state.mode === "playing") togglePause();
});

// Pointer lock hides the cursor so the mouse turns the camera freely. Browsers can
// refuse it (e.g. right after Esc); drag-to-look still works then.
function lockPointer() {
  try {
    const request = canvas.requestPointerLock();
    if (request && request.catch) request.catch(() => {});
  } catch (e) { /* not supported */ }
}

function readInput() {
  const k = c => keys.has(c) ? 1 : 0;
  const input = {
    forward: Math.max(k("KeyW"), k("ArrowUp")) - Math.max(k("KeyS"), k("ArrowDown")),
    right: Math.max(k("KeyD"), k("ArrowRight")) - Math.max(k("KeyA"), k("ArrowLeft")),
    sprint: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    jumpPressed, jumpHeld: keys.has("Space")
  };
  jumpPressed = false;
  return input;
}


// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame() {
  initAudio();
  state.mode = "playing";
  state.runTime = 0;
  state.deaths = 0;
  state.cornCount = 0;
  state.checkpoint = 0;
  for (const c of level.corn) { c.collected = false; c.root.visible = true; }
  for (const cp of level.checkpoints) { cp.active = false; cp.shoe.material = MAT.iron; }
  activateCheckpoint(0, false);
  respawn();
  for (const id of ["title", "win", "pause"]) $(id).classList.add("hidden");
  document.body.classList.remove("cinematic");
  state.ending = null;
  lockPointer();
}

function togglePause() {
  if (state.mode === "playing") {
    state.mode = "paused";
    $("pause").classList.remove("hidden");
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  } else if (state.mode === "paused") {
    state.mode = "playing";
    $("pause").classList.add("hidden");
  }
}

function respawn() {
  const cp = level.checkpoints[state.checkpoint];
  player.pos = [...cp.spawn];
  player.vel = [0, 0, 0];
  player.ground = null;
  player.onGround = false;
  player.yaw = cp.cameraYaw + Math.PI;
  camera.yaw = cp.cameraYaw;
  camera.target = vadd(player.pos, [0, 1.1, 0]);
  if (level.searchlight) level.searchlight.exposure = 0;
  if (level.dog) level.dog.pos = [...level.dog.home];
  state.mode = "playing";
}

function die(message, sound) {
  if (state.mode !== "playing") return;
  state.mode = "dying";
  state.deathTimer = 1.1;
  state.deaths++;
  sound();
  $("deathMessage").textContent = message;
  $("fade").classList.add("show");
}

function activateCheckpoint(i, announce = true) {
  const cp = level.checkpoints[i];
  state.checkpoint = i;
  cp.active = true;
  cp.shoe.material = MAT.gold;
  if (announce) {
    SFX.oink();
    sparkle(vadd(cp.shoe, [0, 1.4, 0]), 40);
  }
  $("banner").textContent = level.sections[cp.section].name;
  state.bannerTimer = 3;
}

// ---------------------------------------------------------------------------
// The ending: the pig runs off into the forest by itself while the camera
// holds a cinematic shot from the gate, then the results card appears
// ---------------------------------------------------------------------------
const RESULTS_AT = 6.5;      // seconds into the ending

function win() {
  state.mode = "ending";
  state.ending = {
    time: 0,
    hops: [1.1, 2.5],                            // happy little jumps along the way
    camStart: [YARD.x1 - 0.6, 1.8, -5.5],        // low, beside the gate
    camEnd: [YARD.x1 - 4.5, 8, -11],             // craned up and back to see the forest
    look: vadd(player.pos, [0, 0.8, 0])
  };
  SFX.win();
  confetti(vadd(player.pos, [0, 1, 0]));
  $("banner").textContent = "FREE!";
  state.bannerTimer = 3.5;
  document.body.classList.add("cinematic");
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

// One physics step of the pig running away on its own. It steers exactly like
// the player does: "forward" with the camera yaw pointed at the forest.
function runEnding(dt) {
  const e = state.ending;
  e.time += dt;
  const goal = [FOREST.x + 22, 0, 0];
  const dx = goal[0] - player.pos[0], dz = goal[2] - player.pos[2];
  const hop = e.hops.length > 0 && e.time > e.hops[0];
  if (hop) e.hops.shift();
  const input = { forward: Math.hypot(dx, dz) > 1 ? 1 : 0, right: 0, sprint: false, jumpPressed: hop, jumpHeld: true };
  updatePlayer(dt, input, Math.atan2(-dx, -dz), level.events);
  if (e.time > RESULTS_AT && state.mode === "ending") showResults();
}

// The camera glides from camStart to camEnd (eased with smoothstep) while its
// aim smoothly follows the pig
function updateEndingCamera(dt) {
  const e = state.ending;
  const k = clamp(e.time / RESULTS_AT, 0, 1), s = k * k * (3 - 2 * k);
  e.look = vlerp(e.look, vadd(player.pos, [0, 0.8, 0]), 1 - Math.exp(-3 * dt));
  setCameraShot(vlerp(e.camStart, e.camEnd, s), e.look);
}

// Score: 100 per corn cob, 5 per second under 15 minutes, minus 50 per fall
function showResults() {
  state.mode = "won";
  document.body.classList.remove("cinematic");
  const total = level.corn.length, corn = state.cornCount, seconds = state.runTime;
  const cornPoints = corn * 100;
  const timeBonus = Math.max(0, Math.round((15 * 60 - seconds) * 5));
  const fallPenalty = state.deaths * 50;
  const score = Math.max(0, cornPoints + timeBonus - fallPenalty);

  const ratio = corn / total;
  const [rating, stars] = ratio >= 0.95 ? ["Golden Hog", 3] : ratio >= 0.6 ? ["Prize Pig", 2]
    : ratio >= 0.25 ? ["Happy Hog", 1] : ["Runaway Piglet", 0];

  // Best time and score are kept in the browser between visits (if it allows storage)
  let records = {}, notes = [];
  try { records = JSON.parse(localStorage.getItem("hogwild-records")) || {}; } catch (e) { /* no storage */ }
  if (!records.time || seconds < records.time) { records.time = seconds; notes.push("New best time!"); }
  if (!records.score || score > records.score) { records.score = score; notes.push("New high score!"); }
  try { localStorage.setItem("hogwild-records", JSON.stringify(records)); } catch (e) { /* no storage */ }

  $("rating").textContent = rating;
  $("stars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
  $("resTime").textContent = formatTime(seconds);
  $("resCorn").textContent = `${corn} / ${total}`;
  $("resFalls").textContent = state.deaths;
  $("resCornPts").textContent = "+" + cornPoints;
  $("resTimePts").textContent = "+" + timeBonus;
  $("resFallPts").textContent = "−" + fallPenalty;
  $("resBest").innerHTML = notes.length ? `<b>${notes.join(" ")}</b>`
    : `Best time ${formatTime(records.time)} · High score ${records.score}`;
  $("win").classList.remove("hidden");

  // count the score up from 0
  const start = performance.now();
  (function countUp(now) {
    const k = Math.min(1, (now - start) / 1500);
    $("resScore").textContent = Math.round(score * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(countUp);
  })(start);
}

// Everything that can happen to the pig other than moving
function checkGameplay(dt) {
  const center = playerCenter();
  const cp = level.checkpoints[state.checkpoint];

  if (player.pos[1] < cp.killY) return die(player.pos[0] > 20 && cp.killY < 0 ? "Into the cellar!" : "Oof! Too far to fall.", SFX.fall);
  for (const h of level.hazards)
    if (touchingBox(h.center, h.half)) return die(h.message, SFX[h.sound]);

  // Up on the roof, dropping below the ridge means sliding down the slope
  const [px, py, pz] = player.pos;
  if (state.checkpoint >= 7 && px > -10 && px < 112 && Math.abs(pz) < 14) {
    const roofY = 30.25 - (10 / 14) * Math.abs(pz);
    if (py > roofY - 1.2 && py < roofY - 0.2) return die("Whoa! The pig slid off the roof!", SFX.fall);
  }

  const d = level.dog;
  if (d && touchingBox([d.pos[0], d.half[1], d.pos[2]], vadd(d.half, [0.1, 0, 0.1])))
    return die("The farm dog caught you!", SFX.bark);

  for (const c of level.corn) {
    if (c.collected || vdist(center, c.pos) > 1.1) continue;
    c.collected = true;
    c.root.visible = false;
    state.cornCount++;
    SFX.corn();
    sparkle(c.pos);
  }

  for (let i = state.checkpoint + 1; i < level.checkpoints.length; i++) {
    const next = level.checkpoints[i];
    for (const p of [next.spawn, next.shoe])
      if (Math.hypot(p[0] - player.pos[0], p[2] - player.pos[2]) < 2.2 && Math.abs(p[1] - player.pos[1]) < 2.5)
        activateCheckpoint(i);
  }

  // Chickens: land on one to bounce, otherwise get knocked back
  for (const c of level.chickens) {
    const cc = [c.x, c.y + c.half[1], c.z];
    if (!touchingBox(cc, c.half)) continue;
    c.flap = 0.8;
    SFX.bawk();
    emit(10, { pos: vadd(cc, [0, 0.3, 0]), spread: 0.3, speed: 2, life: [0.6, 1.2], size: [0.08, 0.14], colors: [[1, 1, 1]], gravity: 2, drag: 2 });
    if (player.vel[1] < 0 && player.pos[1] > cc[1]) {
      player.vel[1] = 13;
    } else {
      knockBack([(Math.sign(player.pos[0] - c.x) || 1) * 9, 8, 0]);
    }
  }

  // Crows knock the pig along the direction they're flying
  for (const c of level.crows) {
    if (c.cooldown > 0 || !touchingBox(c.pos, [0.35, 0.25, 0.35])) continue;
    c.cooldown = 1;
    SFX.caw();
    emit(8, { pos: c.pos, spread: 0.3, speed: 2, life: [0.6, 1.2], size: [0.08, 0.14], colors: [[0.1, 0.1, 0.12]], gravity: 2, drag: 2 });
    knockBack([c.dir[0] * 6, 6.5, c.dir[2] * 6]);
  }

  // Weathervane arm: a spinning line segment at one height. The pig is hit if
  // the arm's height is inside the pig's box and the pig's center is close to
  // the segment (distance measured with a 2D cross product).
  const v = level.vane;
  if (v && v.cooldown <= 0) {
    const armY = v.pos[1] + v.armHeight;
    if (py < armY && py + 2 * PLAYER_HALF[1] > armY) {
      const dir = [Math.cos(v.angle), -Math.sin(v.angle)];       // the arm's local x axis in world xz
      const rx = px - v.pos[0], rz = pz - v.pos[2];
      const along = rx * dir[0] + rz * dir[1];
      const perp = Math.abs(dir[0] * rz - dir[1] * rx);
      if (perp < PLAYER_HALF[0] + 0.1 && along > -VANE_ARM - 0.2 && along < VANE_ARM + 0.6) {
        v.cooldown = 0.6;
        SFX.clang();
        // push the way that part of the arm is moving: d/dangle of (cos, -sin) * along
        knockBack([-Math.sin(v.angle) * Math.sign(along) * 6, 6, -Math.cos(v.angle) * Math.sign(along) * 6]);
      }
    }
  }
  if (v) v.cooldown = (v.cooldown || 0) - dt;

  // Searchlight: lit if inside the cone, in range, and no box blocks the ray
  const S = level.searchlight;
  if (S) {
    const toPig = vsub(center, S.pos), d = vlength(toPig);
    let seen = false;
    if (d < S.range && vdot(vscale(toPig, 1 / d), S.dir) > Math.cos(S.cutoff)) {
      seen = true;
      const dir = vscale(toPig, 1 / d);
      for (const p of level.platforms) {
        if (!p.solid) continue;
        if (rayBox(S.pos, dir, vsub(p.center, p.half), vadd(p.center, p.half)) < d - 0.6) { seen = false; break; }
      }
    }
    S.exposure = clamp(S.exposure + (seen ? dt * 2.5 : -dt * 1.5), 0, 1);
    if (S.exposure >= 1) return die("The farmer spotted you!", SFX.caught);
  }

  if (player.pos[0] > YARD.x1 + 1.5 && player.onGround) win();
}

function knockBack(vel) {
  player.vel = vel;
  player.onGround = false;
  player.ground = null;
}

// Sounds and particles for things the physics and level reported
function handleEvents(events) {
  for (const e of events) {
    if (e.type === "jump") { SFX.jump(); dustPuff(e.pos, 0.5); }
    else if (e.type === "land") { SFX.land(e.impact); dustPuff(e.pos, Math.min(e.impact / 15, 1.5)); }
    else if (e.type === "bounce") { SFX.bounce(); hayBurst(e.pos, 25); }
    else if (e.type === "creak") SFX.creak();
    else if (e.type === "bark") SFX.bark();
    else if (e.type === "crumble") { SFX.crumble(); e.mat === MAT.bale ? hayBurst(e.pos, 40) : dustPuff(e.pos, 1.5); }
  }
  events.length = 0;
}


// ---------------------------------------------------------------------------
// Main loop: physics in fixed 1/120 s steps, rendering once per frame
// ---------------------------------------------------------------------------
const STEP = 1 / 120;
let lastTime = performance.now(), accumulator = 0;

function step(dt) {
  state.time += dt;
  updateLevel(state.time, dt);
  updateChickens(state.time, dt);
  updateDog(state.time, dt, state.mode === "ending");

  if (state.mode === "playing") {
    state.runTime += dt;
    updatePlayer(dt, readInput(), camera.yaw, level.events);
    checkGameplay(dt);
  } else if (state.mode === "ending" || state.mode === "won") {
    if (state.ending) runEnding(dt);
  } else if (state.mode === "dying") {
    state.deathTimer -= dt;
    if (state.deathTimer <= 0) {
      respawn();
      $("fade").classList.remove("show");
    }
  }

  animatePig(pig, {
    pos: player.pos, yaw: player.yaw, speed: Math.hypot(player.vel[0], player.vel[2]),
    vy: player.vel[1], onGround: player.onGround, squash: player.squash, time: state.time
  }, dt);
  if (settings.particles) ambientMotes(camera.target, 220);
  updateParticles(dt);
  handleEvents(level.events);
}

function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  resizeCanvas();

  if (state.mode !== "paused") {
    accumulator += dt;
    while (accumulator >= STEP) {
      step(STEP);
      accumulator -= STEP;
    }
  }

  // Q/E also turn the camera; on the title screen it slowly circles the pig
  const turn = (keys.has("KeyQ") ? 1 : 0) - (keys.has("KeyE") ? 1 : 0);
  if (state.mode === "title") lookYaw += dt * 0.15;
  if (state.ending && (state.mode === "ending" || state.mode === "won")) updateEndingCamera(dt);
  else updateCamera(dt, { yaw: lookYaw + turn * 2 * dt, pitch: lookPitch }, state.mode !== "title");
  lookYaw = lookPitch = 0;

  renderFrame();
  updateHUD(dt);
  requestAnimationFrame(frame);
}


// ---------------------------------------------------------------------------
// Rendering setup for one frame
// ---------------------------------------------------------------------------

// Orthographic sun "camera" over a 60x60 area around the pig. The view is snapped
// to whole shadow-map texels so shadow edges don't shimmer as the box follows the pig.
function sunShadowMatrix(center) {
  const R = 30;
  let view = lookAt(vadd(center, vscale(level.sunDir, 60)), center);
  const texel = 2 * R / sunMap.size;
  const o = transformPoint(view, [0, 0, 0]);
  view = multiply(translate(Math.round(o[0] / texel) * texel - o[0], Math.round(o[1] / texel) * texel - o[1], 0), view);
  return multiply(ortho(-R, R, -R, R, 1, 150), view);
}

function renderFrame() {
  for (const node of level.roof) node.castShadow = settings.roofShadows || node.alwaysShadow;
  const items = collectDrawItems(level.root, []);

  // Lantern positions come from each lantern body's world matrix (computed while
  // collecting), then the 8 closest to the camera target are sent to the shader
  let lights = [];
  if (settings.lights) {
    lights = level.lanterns.map(l => ({ pos: transformPoint(l.body.world, [0, -0.42, 0]), color: LANTERN_COLOR }));
    lights.sort((a, b) => vdist(a.pos, camera.target) - vdist(b.pos, camera.target));
  }

  if (settings.shadows) renderShadowMap(sunMap, sunShadowMatrix(camera.target), items);
  else sunMap.matrix = sunShadowMatrix(camera.target);

  const S = level.searchlight;
  let spot = null;
  if (S && vdist(camera.target, S.pos) < 50) {
    spot = { pos: S.pos, dir: S.dir, color: S.color, cos: Math.cos(S.cutoff) };
    const spotMatrix = multiply(perspective(S.cutoff * 2.6, 1, 1, 60), lookAt(S.pos, vadd(S.pos, S.dir)));
    if (settings.shadows) renderShadowMap(spotMap, spotMatrix, items);
    else spotMap.matrix = spotMatrix;
  }

  // Fog thickens or thins with the current section; outside it nearly clears
  const outside = !(player.pos[0] > -10.3 && player.pos[0] < 112.3 && Math.abs(player.pos[2]) < 14.3 && player.pos[1] < 20.6);
  const fogGoal = outside ? 0.004 : level.sections[level.checkpoints[state.checkpoint].section].fog;
  state.fog = damp(state.fog, fogGoal, 1.5, 1 / 60);

  const frameInfo = {
    viewProj: camera.viewProj, cameraPos: camera.pos, fov: camera.fov,
    sunDir: level.sunDir, sunColor: [2.1, 1.85, 1.5],
    skyAmbient: [0.2, 0.22, 0.28], groundAmbient: [0.14, 0.1, 0.07],
    lights, spot,
    fogColor: outside ? [0.55, 0.6, 0.7] : [0.11, 0.09, 0.07],
    fogDensity: settings.fog ? state.fog : 0,
    exposure: 1.0, toon: settings.toon, shadows: settings.shadows,
    textures: settings.textures, shafts: settings.shafts
  };
  renderScene(items, frameInfo, sunMap, spotMap);

  if (settings.particles) {
    const [blended, additive] = packParticles();
    renderParticles(particleData, blended, additive, frameInfo);
  }
  if (settings.showShadowMap) renderShadowDebug(sunMap);
}


// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function formatTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

function toast(text) {
  $("toast").textContent = text;
  state.toastTimer = 1.5;
}

function updateHUD(dt) {
  $("hud").classList.toggle("hidden", ["title", "ending", "won"].includes(state.mode));
  $("cornCount").textContent = state.cornCount;
  $("cornTotal").textContent = level.corn.length;
  $("timer").textContent = formatTime(state.runTime);
  $("deaths").textContent = state.deaths;

  state.bannerTimer -= dt;
  $("banner").style.opacity = clamp(state.bannerTimer, 0, 1);
  state.toastTimer -= dt;
  $("toast").style.opacity = clamp(state.toastTimer * 2, 0, 1);

  let text = "";
  if (state.mode === "playing") {
    const c = playerCenter();
    const h = level.hints.find(h => c.every((v, i) => v >= h.min[i] && v <= h.max[i]));
    if (h) text = h.text;
  }
  $("hint").textContent = text;
  $("hint").style.opacity = text ? 1 : 0;

  const exposure = level.searchlight ? level.searchlight.exposure : 0;
  $("alert").style.opacity = exposure > 0.02 ? 1 : 0;
  $("alertFill").style.width = (exposure * 100) + "%";
}

function syncSettingsUI() {
  for (const key in settings) {
    const box = $("opt-" + key);
    if (box) box.checked = settings[key];
  }
}
for (const key in settings) {
  const box = $("opt-" + key);
  if (box) box.addEventListener("change", () => settings[key] = box.checked);
}
syncSettingsUI();

$("startButton").addEventListener("click", startGame);
$("againButton").addEventListener("click", startGame);
$("resumeButton").addEventListener("click", togglePause);
$("restartButton").addEventListener("click", startGame);

// Title screen: pig waiting in the pen
respawn();
state.mode = "title";
camera.distance = 7.5;
requestAnimationFrame(frame);
