# Hog Wild: Escape from the Barn

A 3D platformer written from scratch in JavaScript and WebGL 2 (no libraries).
A pig escapes an old barn: it jumps over stall dividers, rides a rope swing, bounces on
loose hay, hides from the farmer's floodlight and balances on rafters past angry chickens.
Then it climbs out the hayloft door onto the roof, runs the ridge past crows and a spinning
weathervane, works its way down the outside of the silo, and outruns the farm dog to the
open gate.

This document explains how the game works and where each computer graphics technique
from the course lives in the code. File references look like `js/shaders.js:128`.

---

## 1. Running the game

Double-click `index.html`. It works straight from the file system because:

- the scripts are plain `<script>` tags, not ES modules (browsers block modules on `file://`), and
- every texture is painted in JavaScript on a canvas, so no image files have to be loaded.

Chrome, Edge and Firefox all work. WebGL 2 is required.

### Controls

| Key | Action |
| --- | --- |
| W A S D / arrow keys | Move (relative to the camera) |
| Space | Jump. Hold for a full jump, tap for a short hop |
| Shift | Sprint (needed for the longer jumps) |
| Mouse (click to lock) or drag, Q / E | Turn the camera |
| Esc or P | Pause menu with all graphics options |
| Enter, Space or click | Skip the ending cutscene |
| M | Mute |

### Graphics toggles (good for the presentation)

Each one switches a single technique on or off while you play, so you can show what it adds.

| Key | Toggle | What to point out |
| --- | --- | --- |
| T | Phong / toon shading | banded lighting and ink outlines |
| 1 | Shadow maps | pig's shadow, crate shadows in the floodlight |
| 2 | Textures | everything falls back to flat material colors |
| 3 | Fog | depth and atmosphere, darker cellar |
| 4 | Lantern point lights | warm pools of light that swing with the lanterns |
| 5 | Particles | dust motes, landing puffs, hay bursts, sparkles |
| 6 | Light shafts | additive sunbeams under the roof holes |
| 7 | Roof casts shadows | the whole barn goes dark except under the holes |
| 8 | Show sun shadow map | the depth texture itself, drawn in the corner |

---

## 2. Code map

Scripts load in this order (`index.html`), and each one can use everything loaded before it.

| File | What it contains |
| --- | --- |
| `js/math.js` | 4x4 matrices (from HW5's `transforms.js`), `lookAt`, `ortho`, vectors, frustum planes, ray-box test |
| `js/geometry.js` | Cube, cylinder, sphere, cone, torus, prism generators with normals **and texture coordinates** |
| `js/shaders.js` | All GLSL: lit surface shader, depth (shadow) shader, particle shader, debug quad |
| `js/renderer.js` | WebGL setup, programs, meshes (VAOs), shadow-map framebuffers, the render passes |
| `js/textures.js` | ~19 procedural textures painted with the canvas 2D API |
| `js/scene.js` | Scene graph nodes, shared meshes, the material list |
| `js/models.js` | Hierarchical models: pig, chicken, lantern, corn, horseshoe, props |
| `js/level.js` | The barn, all nine sections, moving platforms, per-frame level animation |
| `js/physics.js` | Pig movement, gravity, jumping, box collisions |
| `js/camera.js` | Third-person orbit camera with wall and roof collision |
| `js/particles.js` | CPU particle system |
| `js/audio.js` | Synthesized sound effects (Web Audio) |
| `js/game.js` | Game state, input, checkpoints, main loop, per-frame render setup, HUD |

### One frame, start to finish

`frame()` in `js/game.js:411`:

1. **Physics in fixed steps.** `step()` runs at exactly 1/120 s per step (`js/game.js:418`) no matter
   the frame rate, so jumps are the same height on a 60 Hz or a 144 Hz monitor. Each step it
   animates the level, moves the pig, checks pickups/hazards/checkpoints, animates the pig's
   joints and updates particles.
2. **Camera.** `updateCamera()` builds the view and projection matrices.
3. **Render** (`renderFrame()`, `js/game.js:452`):
   1. walk the scene graph once to get every object's world matrix (`collectDrawItems`)
   2. render the **sun shadow map** and the **floodlight shadow map**
   3. main pass: sky, then every lit object, then toon outlines, then light shafts
   4. particles
4. **HUD** (plain HTML on top of the canvas).

---

## 3. Course techniques

### 3.1 Transformations and matrices

`js/math.js` holds the same column-major `multiply`, `translate`, `scale` and `rotateX/Y/Z` as HW5,
plus:

- `chain(a, b, c, ...)` (`js/math.js:17`) multiplies a list of matrices left to right. A shape like
  `chain(rotateX(π/2), scale(0.14, 0.07, 0.11))` scales first, then rotates. The matrix closest to
  the vertex is applied first.
- `lookAt(eye, target, up)` (`js/math.js:62`) builds a view matrix. Its rows are the camera's
  right, up and backward axes, followed by a translation by -eye.
- `ortho(...)` (`js/math.js:51`) is an orthographic projection, used for the sun's shadow map.
- `alignY(dir)` (`js/math.js:75`) builds a rotation whose +y axis points along `dir`. It aims the
  floodlight and the sunbeams.
- **Normal matrix.** In the vertex shader, normals are transformed by `transpose(inverse(mat3(uModel)))`
  (`js/shaders.js:33`) so they stay perpendicular to surfaces that were scaled non-uniformly.
  Almost every object here is a stretched cube or sphere, so this matters everywhere.

### 3.2 Hierarchical modeling (scene graph)

`js/scene.js` uses HW5's idea of two matrices per node:

- `joint`: where the node sits in its **parent's** frame (this is what gets animated)
- `shape`: how the node's own mesh is sized. It is **not** passed on to the children.

`world = parentWorld * joint`, and the mesh is drawn with `world * shape`. `collectDrawItems()`
(`js/scene.js:31`) walks the tree with a stack, computing each world matrix once per frame.

**The pig** (`createPig`, `js/models.js:31`):

```
root (position + facing)
└─ body pivot (bob, squash & stretch: scales everything below it)
   ├─ body
   ├─ head pivot (looks up when jumping)
   │  ├─ head, snout ─ nostrils, eyes ─ eye shine
   │  └─ ear pivots x2 (flop) ─ ear
   ├─ hip joints x4 (walk cycle) ─ leg, hoof
   └─ tail segment ─ tail segment ─ ... (x6)
```

`animatePig()` (`js/models.js:79`) sets the joints every frame:
- **Walk cycle:** diagonal leg pairs swing with `sin(phase)` and `sin(phase + π)`, which makes a trot.
- **Squash and stretch:** the body pivot is scaled by `(1/√s, s, 1/√s)`. Volume stays about the same,
  and because the legs are children of the pivot they squash too.
- **Tail:** every segment's joint is the same small twist and bend relative to the previous
  segment. Repeating that one transform down the chain winds it into a corkscrew. Only the first
  joint is animated (the wag), and the rest follow.
- **Ears** flop with walking speed and vertical velocity. **Legs** tuck in mid-air.

Other hierarchies:
- **Chickens** (`js/models.js:141`): body, then head pivot (pecking), wings (flapping), legs (walking).
- **Lanterns** (`js/models.js:115`): hook, then swing pivot, then chain and body, then cap, glass and wires.
  The lantern's **point light position is read from the body's world matrix** (`js/game.js:460`),
  so the light swings with the lantern, just like the HW5 lamp's spotlight.
- **Rope swings** (`js/level.js:134`): pivot, then arm (rotates by a pendulum angle θ), then ropes and seat.
  The seat's joint counter-rotates by -θ so the board stays level. The seat's **collision box** is
  read from its world matrix: `transformPoint(worldMatrix(seat), [0,0,0])` (`js/level.js:145`).
  So gameplay physics depends directly on the hierarchy.
- **Trolley** (`js/level.js:151`): carriage, then spinning wheels, ropes and the hanging crate you ride.
- **Pulley hoist** (`js/level.js:172`): the wheel turns by `distance / radius` (`js/level.js:194`) so
  the rope looks like it doesn't slip.
- Wagon wheels, the tool cart's wheels, the floodlight, and the conveyor rollers.

### 3.3 Viewing and projection: the camera

`js/camera.js` is a third-person orbit camera. It sits on a sphere around a point above the pig:

```
offset = distance * (sin(yaw) cos(pitch), sin(pitch), cos(yaw) cos(pitch))
```

- `perspective()` gives the projection, and `lookAt()` gives the view.
- **Smoothing:** the target follows the pig with `damp()` (exponential smoothing that doesn't depend
  on frame rate, `js/math.js:130`). It is fast sideways and slower vertically, so jumps don't jerk the view.
- **Camera collision:** a ray is cast from the pig toward the camera and tested against every big
  box with the **slab method** (`rayBox`, `js/math.js:175`). The roof slopes are tested as planes by
  solving `dot(n, target + t·dir) = c` for `t` (`js/camera.js:47`), from below inside the barn and
  from above on the roof. The silo has an invisible camera-only box. The camera stops just in
  front of whatever it hits.
- Movement is **camera-relative:** W moves the pig toward wherever the camera is looking (`js/physics.js:42`).

### 3.4 Lighting

All lighting happens in the fragment shader `LIT_FS` (`js/shaders.js:68`), in world space.

| Light | Type | Notes |
| --- | --- | --- |
| Sun | directional | shadow-mapped; direction `level.sunDir` |
| Sky/ground | hemisphere ambient | blends a sky color and a ground bounce color by `N.y` (`js/shaders.js:211`) |
| Lanterns (19 in the level) | point lights | the 8 nearest are sent each frame (`js/game.js:461`) |
| Farmer's floodlight | spotlight | shadow-mapped, sweeps back and forth |

**Blinn-Phong** (`shade()`, `js/shaders.js:140`): diffuse is `max(N·L, 0)`, and specular is
`(N·H)^shininess` with the half vector `H = normalize(L + V)` (`js/shaders.js:142`). Each material
sets its own `specular` and `shininess`. Wet mud, water and metal are shiny, while hay and burlap
are almost matte.

**Point light attenuation** (`js/shaders.js:226`): `1 / (1 + k·d²)`, multiplied by a smooth window
`(1 - (d/range)⁴)²` that reaches exactly 0 at the light's range. Because of that window, a lantern
can drop out of the "nearest 8" list without its light visibly popping off. This is a simple form
of **light culling**: the shader loops over 8 lights instead of all 19.

**Spotlight** (`js/shaders.js:236`): a fragment is inside the cone when `dot(-L, spotDir) > cos(cutoff)`.
`smoothstep` softens the edge.

**Two-sided lighting:** open shapes flip their normal on back faces (`gl_FrontFacing`, `js/shaders.js:209`).

### 3.5 Shading modes: Phong vs. toon

Press **T**. In toon mode (`uToon`):
- diffuse is quantized into 3 bands, and specular becomes a hard on/off highlight (`js/shaders.js:140`)
- shadows become hard-edged (`step(0.5, lit)`)
- **Ink outlines** use the **inverted hull** method (`js/renderer.js:256`). Each object is drawn a
  second time, pushed outward a little along `aOutline`, in black, with **front faces culled**.
  Only the back of the inflated shell survives, and it peeks out around the silhouette.
  - `aOutline` is the vertex position for convex shapes. A cube corner (1,1,1) therefore moves out
    equally on all three axes, and the shell stays closed at sharp edges.
  - Only the rotation part of the model matrix is applied to it (`js/shaders.js:40`), so the outline
    is equally thick on all sides of a stretched box.
  - The width grows with distance, so lines stay a similar thickness on screen.

### 3.6 Texture mapping

**Texture coordinates** come from the shape generators (`js/geometry.js`):
- sphere: longitude/latitude `(u, v) = (j/slices, 1 - i/stacks)`
- cylinder: angle around for u, height for v; caps use `(x, z)` mapped to [0, 1]
- torus: the two angles; cube: [0, 1] per face

**Box projection** (`js/shaders.js:50`): most of the level is stretched cubes, and stretching one
texture across a 20-unit wall would smear it. So for `texMode 1` the vertex shader computes uvs from
the object-space position: on each face it uses the two axes that lie in that face, scaled by the
box's size divided by the material's `tile` size (`boxTexScale`, `js/level.js:52`). A 20-unit beam
therefore repeats the wood texture instead of stretching it. Hay bales use a non-square tile
(`[1.3, 0.6, 1.3]`), so a big hay stack reads as a pile of individual bales.

**Procedural textures** (`js/textures.js`): each texture is painted on a 2D canvas with seeded random
numbers, so it looks identical every run.
- *Planks* (`paintPlanks`, `js/textures.js:80`): boards of varied color, wavy grain lines, knots
  (radial gradients), seams and dark gaps.
- *Hay*: thousands of short curved strokes.
- *Bale*: straw strokes plus twine bands and darkened edges.
- *Stone, corn, tin*: drawn shape by shape (cobbles, kernels, corrugation ridges).
- **Seamless tiling:** strokes near an edge are also drawn on the opposite edge (`wrapped()`,
  `js/textures.js:49`), and grain lines use `sin(y / size · 2π · n)`, which lines up at the top and
  bottom. With `REPEAT` wrapping, no seams show.

**Texture setup** (`uploadTexture`, `js/textures.js:16`):
- `SRGB8_ALPHA8` internal format: the painted colors are sRGB, and the GPU converts them to linear
  values when sampling, so lighting math happens in linear space (see 3.8).
- **Mipmaps** (`generateMipmap`) plus `LINEAR_MIPMAP_LINEAR` filtering stop distant floors from shimmering.
- **Anisotropic filtering** (when available) keeps floors sharp at grazing angles.

**Texture animation:** water and the conveyor belt scroll their uvs over time with `uUVOffset`
(`js/level.js:912`). The belt scrolls at exactly the speed it pushes the pig, so the texture matches the motion.

**Textures modulate lighting:** `albedo = materialColor * texture(...)`. That's how a nearly-white
pig-skin texture with brown splotches becomes a pink, muddy pig.

### 3.7 Shadow mapping

Two shadow maps (`createShadowMap`, `js/renderer.js:103`). Each is a depth texture attached to a
framebuffer that has no color buffer.

1. **Depth pass** (`renderShadowMap`, `js/renderer.js:127`): render every shadow caster from the
   light's point of view with the tiny `DEPTH_VS`/`DEPTH_FS` shaders. Only depth is written.
2. **Lookup:** in the main pass, each fragment is transformed by the same light matrix
   (`vSunCoord`), and its depth is compared with the stored depth. If something nearer to the light
   was stored, the fragment is in shadow.

Details:
- **Sun:** a directional light, so the projection is **orthographic**. It covers a 60x60 area
  centered on the pig (`sunShadowMatrix`, `js/game.js:443`). That gives about 3 cm per shadow-map
  texel, instead of spreading 2048 texels over the whole 120-unit barn.
- **Texel snapping** (`js/game.js:448`): the light view is shifted by a fraction of a texel so the
  shadow-map grid stays fixed in the world while the box follows the pig. Without this, shadow edges
  crawl and shimmer as you move.
- **Floodlight:** a spotlight, so it uses a **perspective** projection. It is rendered only when the
  pig is near the Tool Corner. Hiding behind a crate works because the crate's shadow and the
  gameplay's line-of-sight ray agree (3.10).
- **Hardware comparison:** the texture uses `TEXTURE_COMPARE_MODE` (`js/renderer.js:111`) and the
  shader samples it with a `sampler2DShadow`, which returns the lit fraction directly, with free 2x2 filtering.
- **PCF** (percentage-closer filtering, `js/shaders.js:128`): average a 3x3 block of comparisons
  for soft edges.
- **Shadow acne:** surfaces wrongly shadowing themselves because of limited depth precision. It is
  fixed with `polygonOffset` in the depth pass (`js/renderer.js:135`) plus a **slope-scaled bias**
  in the shader (more bias where light hits at a grazing angle).
- **Roof shadows:** most of the roof doesn't cast shadows, so sunlight reaches the platforms (as if
  through the rotting roof). The roof above the Tool Corner always casts them, so that corner is dim
  and the floodlight stands out. Key **7** turns on shadows for the whole roof.
- Key **8** shows the sun's depth map in the corner of the screen. Raw depth can't be sampled in
  comparison mode, so the debug view temporarily switches the comparison off (`renderShadowDebug`).

### 3.8 Color pipeline: fog, tone mapping, gamma

At the end of the fragment shader (`finalColor`, `js/shaders.js:164`):

1. **Exponential-squared fog:** `mix(fogColor, color, exp(-(density·dist)²))`. Density changes per
   section (dustier in the hay storage and loft) and nearly clears outside.
2. **Height fog** darkens everything below the barn floor (`js/shaders.js:166`), so the cellar reads
   as a dark pit.
3. **Tone mapping** (ACES filmic fit, `js/shaders.js:153`): lanterns and sunlight produce values
   above 1. Tone mapping rolls them off smoothly instead of clipping to flat white.
4. **Gamma:** `pow(color, 1/2.2)` converts linear light back to sRGB for the monitor.

Material colors are written as hex sRGB colors and converted to linear by `rgb()` (`js/math.js:143`).

### 3.9 Blending, particles and light shafts

- **Light shafts** (`lightShaft`, `js/level.js:247`) and the **floodlight beam** are cylinder/cone
  meshes aimed along the light with `alignY`. They are drawn with **additive blending**
  (`gl.blendFunc(ONE, ONE)`, `js/renderer.js:272`) and no depth writes. Their brightness fades along
  the beam and toward the silhouette (`|N·V|`), which looks like glowing dusty air. This is the same
  trick as the HW5 lamp beam.
- **Particles** (`js/particles.js`): a CPU system with velocity, gravity, drag and lifetime, using
  Euler integration. All live particles are packed into one buffer (`packParticles`) and drawn as
  `GL_POINTS`:
  - `gl_PointSize = size · scale / w` makes far particles smaller (perspective, `js/shaders.js:280`)
  - the fragment shader uses `gl_PointCoord` to cut a soft round sprite out of the square point (`js/shaders.js:291`)
  - dust and hay use normal alpha blending, while sparkles and dust motes are **additive**
    (`js/renderer.js:317`). Particles skip depth writes, so they don't block each other.
  - Effects: floating dust motes, landing puffs scaled by impact speed, hay bursts from bounces and
    crumbling bales, corn sparkles, feathers from chickens, and confetti when you win.

### 3.10 Collision detection and ray casting

- **Pig vs. world** (`js/physics.js`): the pig is an axis-aligned box. `moveAxis()` (`js/physics.js:130`)
  moves along x, then z, then y. After each move it pushes the pig out of any overlapping platform.
  Resolving one axis at a time tells you *which side* you hit: landing on top, a wall, or a ceiling.
  - **Moving platforms:** each platform records how far it moved this step (`delta`), and the pig
    standing on it is moved by the same amount. That's how you ride the swing, tray, cart, trolley and hoist.
  - **Step-up:** ledges up to 0.35 high are climbed automatically (`js/physics.js:160`).
- **Ray casting:** `rayBox()` (slab method) is used for the camera collision and for the
  **floodlight's line of sight** (`js/game.js:346`). The pig is "seen" when it is inside the cone and
  the ray from the light to the pig hits no box first. This is the same ray-object intersection used
  in ray tracing, applied to gameplay. The ray-tracing assignment's ray-box and ray-plane code could
  replace or extend these functions.
- **Frustum culling** (`js/math.js:154`): the six clip planes are pulled from the view-projection
  matrix (Gribb/Hartmann), and objects whose bounding sphere is fully outside are skipped. The same
  test culls shadow casters against the light's frustum.

### 3.11 Creatures and the outdoor sections

- **Crows** (`createCrow`, `js/models.js:186`) follow a path function `pos = path(t)`: back and
  forth along the ridge, or around a circle for the silo (`at(angle, height)`). Each crow faces
  the way it flies: its heading is the difference between `path(t + 0.05)` and `path(t)`, turned
  into a yaw with `atan2`. A hit knocks the pig along that heading.
- **Weathervane** (`createWeathervane`, `js/models.js:266`): a hierarchy (post, then spinning
  arm, then arrowhead and tail fin, with a rooster on top). The hit test (`js/game.js:315`) treats
  the arm as a line segment at one height. With `d` = the arm's direction and `r` = the pig
  relative to the post, `|d × r|` is the pig's distance from the arm, and `d · r` is how far
  along the arm it is.
- **Farm dog** (`createDog`, `js/models.js:216`; behavior in `updateDog`, `js/level.js:919`):
  a hierarchical model with a trotting gait, flopping ears and a wagging tail. It chases the pig
  while the pig is on the ground, and waits underneath, barking, when the pig climbs onto
  something. It moves with `slideBox()` (`js/physics.js:114`), the same axis-at-a-time box
  collision as the pig, so it runs around the bales and tractor instead of through them.
- **Round collision** (`pushOutOfCylinders`, `js/physics.js:100`): the silo is a cylinder, so a
  box would be a poor fit. If the pig's center is closer to the silo's axis than radius + half
  the pig's width, it is pushed straight out along the radius.
- **Falling off the roof** (`js/game.js:265`): the roof slopes are the planes
  `y = 30.25 - (10/14)|z|`. Once the pig drops just below that surface, it has slid off.

### 3.12 The ending cutscene and score

When the pig steps through the farm gate, `win()` (`js/game.js:174`) switches the game into an
`"ending"` mode:

- **The pig runs by itself, with the same physics as normal play.** `runEnding()`
  (`js/game.js:193`) calls `updatePlayer` with made-up input: "forward" held, and a
  camera yaw that points at the forest (`atan2(-dx, -dz)`), plus two scheduled hops. Collisions,
  the walk cycle, squash and stretch and the dust puffs all keep working with no extra code.
- **The camera shot** (`updateEndingCamera`, `js/game.js:207`): the orbit
  camera is replaced by a fixed shot (`setCameraShot`, `js/camera.js:14`). Its position is
  interpolated from a low spot beside the gate to a high spot above the yard, eased with
  smoothstep `s = 3k² - 2k³` so the crane starts and stops gently. Its aim follows the pig with
  `damp`, so the pig stays framed as it shrinks into the forest.
- **Letterbox bars** are two HTML bars whose height animates (CSS transition) while the body has the
  `cinematic` class. The HUD hides, a "FREE!" banner shows, and the dog runs to the gate and barks.
- **Results** (`showResults`, `js/game.js:215`): after 6.5 s (or right away with
  Enter, Space or a click) the results card appears over the forest:

  | Part | Points |
  | --- | --- |
  | Corn | +100 per cob |
  | Time bonus | +5 per second under 15:00 |
  | Falls | −50 each |

  The total counts up from 0 with an ease-out curve. The rating and stars depend on the share of
  corn collected: Golden Hog (95%+), Prize Pig (60%+), Happy Hog (25%+), Runaway Piglet. The best
  time and high score are saved in `localStorage`.

### 3.13 Game feel

These aren't graphics topics, but they are worth a sentence in the report:
- **Coyote time** (`js/physics.js:70`): you can still jump 0.1 s after walking off a ledge.
- **Jump buffering** (`js/physics.js:71`): a jump pressed just before landing still counts.
- **Variable jump height:** releasing Space early applies extra gravity, giving a short hop.

---

## 4. The level

The barn spans x = -10..112. The ground route runs along the south side heading +x. The hoist lifts
the pig into the rafters, and the loft route runs back along the north side toward the hayloft door,
directly above where you started. Past the pig pen the floorboards have rotted away, and falling into
the cellar sends you back to the last horseshoe (checkpoint). From the hayloft door the route climbs
onto the roof, runs east along the ridge to the silo beyond the far gable, spirals down the silo to
the duck pond, and finishes across the farmyard.

| # | Section | Barn features used |
| --- | --- | --- |
| 1 | The Pig Pen | fence to jump, water trough, hay bales to climb over the gate |
| 2 | Stable Row | stall-divider caps as stepping stones, raised trough, rope swing, saddle shelf, sliding feed tray |
| 3 | Hay Storage | crumbling old bales, bouncy loose-hay pile, conveyor belt that pushes you back |
| 4 | The Tool Corner | farmer's floodlight sweeps through the window: hide behind crates and barrels; a rolling tool cart; rake tines; pulley hay hoist |
| 5 | The Rafters | narrow beams with pacing chickens (jump over or bounce on them), hanging trolley crate, cross rafters |
| 6 | The Hayloft | rotten floorboards that collapse, hay bounce up to a catwalk, two swinging hay-hook planks, the loft door |
| 7 | Up on the Roof | hay-hook pallet lift, boards nailed up the gable, the ridge walk with rotted gaps, cupolas, crows, a spinning weathervane |
| 8 | The Silo | grain-chute bridge, a spiral of brackets down the outside of the silo (missing, crumbling and orbiting ones), circling crows, the duck pond below |
| 9 | The Farmyard | the farm dog chases you on the ground; escape across bales, the tractor and the hay wagon to the open gate, then watch the pig run off into the forest |

There are 12 checkpoints and 70 corn cobs, some off the main path. The HUD shows corn, time
and falls, and the win screen keeps your best time (browser `localStorage`).

**Length.** A scripted run that knows every jump and never falls takes about 3–4 minutes. A
first play-through, with falls, waiting on moving platforms and hunting corn, should take roughly
8–12 minutes (an estimate; it hasn't been timed with real players yet). Every section was checked with scripted physics runs: each one drives
the real `updatePlayer` and `checkGameplay` from one checkpoint to the next.

---

## 5. Changing things

- **Level layout:** every platform is one line in a `build...()` function in `js/level.js`.
  `platform(center, halfSize, material)` makes a solid box, and `mover`, `crumbling`, `swing`,
  `trolley`, `hoist` and `hayPile` make the special ones.
- **Jump physics:** `MOVE` in `js/physics.js:10`. Jump height is `jump² / (2·gravity)` = 2.25 units.
- **Lighting:** sun color and ambient values are in `renderFrame()` (`js/game.js:452`), and
  per-section fog density is in `level.sections`.
- **New texture:** add an entry to `TEX` (`js/textures.js:148`) and a material to `MAT` (`js/scene.js:81`)
