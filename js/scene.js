// Scene graph, shared meshes and materials.
//
// Like HW5, every object is a node with two matrices:
//   joint - where the node sits in its PARENT's frame (animated: rotations at joints)
//   shape - how the node's own mesh is sized/placed (NOT passed on to children)
// A node's world frame = parent's world frame * joint, and the mesh is drawn
// with world frame * shape. Moving a parent therefore moves all its children.

function createNode(name, mesh = null, mat = null, shape = IDENTITY) {
  return {
    name, mesh, material: mat, shape,
    joint: IDENTITY, children: [], parent: null,
    world: IDENTITY, visible: true, castShadow: true, texScale: [1, 1, 1]
  };
}

function addChild(parent, child) {
  parent.children.push(child);
  child.parent = parent;
  return child;
}

// World matrix of one node, found by multiplying the joints up the tree.
// Used when gameplay needs a single node's position (a platform hanging from a rope).
function worldMatrix(node) {
  return node.parent ? multiply(worldMatrix(node.parent), node.joint) : node.joint;
}

// Walks the tree once, storing every node's world frame and collecting the
// visible meshes as draw items. An invisible node hides its whole subtree.
function collectDrawItems(root, out) {
  const stack = [[root, IDENTITY]];
  while (stack.length > 0) {
    const [node, parentFrame] = stack.pop();
    if (!node.visible) continue;
    const frame = multiply(parentFrame, node.joint);
    node.world = frame;
    if (node.mesh) {
      const model = multiply(frame, node.shape);
      out.push({
        mesh: node.mesh, material: node.material, model, texScale: node.texScale,
        castShadow: node.castShadow && node.material.mode === 0,
        center: [model[12], model[13], model[14]],
        radius: node.mesh.radius * maxScale(model)
      });
    }
    for (const child of node.children) stack.push([child, frame]);
  }
  return out;
}


// ---------------------------------------------------------------------------
// Meshes (uploaded once, shared by every node that uses them)
// ---------------------------------------------------------------------------
const MESH = {
  cube: createMesh(createCube()),
  sphere: createMesh(createSphere(16, 24)),
  cylinder: createMesh(createCylinder(20)),
  cone: createMesh(createCone(20)),
  openCone: createMesh(createCone(32, false)),
  torus: createMesh(createTorus(1, 0.3, 32, 12)),
  horseshoe: createMesh(createTorus(1, 0.22, 28, 10, Math.PI * 1.6)),
  prism: createMesh(createPrism())
};


// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
// mode:    0 lit, 1 glowing (unlit), 2 sky, 3 additive light shaft
// texMode: 0 = the mesh's own uvs times `uv`, 1 = box projection, `tile` world units per repeat
function material(opts) {
  return {
    color: [1, 1, 1], texture: null, texMode: 1, tile: 2, uv: [1, 1],
    specular: 0.08, shininess: 16, emissive: 0, mode: 0, alpha: 1,
    uvOffset: [0, 0], outline: true, ...opts
  };
}

const MAT = {
  barnWall: material({ texture: TEX.barnRed, tile: 5 }),
  floor: material({ texture: TEX.straw, tile: 4 }),
  planks: material({ texture: TEX.floorPlanks, tile: 3, color: [0.9, 0.9, 0.9] }),
  beam: material({ texture: TEX.beam, tile: 1.6 }),
  darkBeam: material({ texture: TEX.beam, tile: 1.6, color: [0.55, 0.5, 0.45] }),
  bale: material({ texture: TEX.bale, tile: [1.3, 0.6, 1.3], specular: 0.02, color: [0.85, 0.82, 0.78] }),
  looseHay: material({ texture: TEX.hay, texMode: 0, uv: [3, 2], specular: 0.02 }),
  hayStrip: material({ texture: TEX.hay, tile: 2, specular: 0.02 }),
  crate: material({ texture: TEX.crate, tile: 1.5 }),
  metal: material({ texture: TEX.metal, tile: 2, specular: 0.7, shininess: 60 }),
  darkMetal: material({ texture: TEX.metal, tile: 1, color: [0.3, 0.3, 0.32], specular: 0.6, shininess: 50 }),
  mud: material({ texture: TEX.mud, tile: 3, specular: 0.5, shininess: 40 }),
  water: material({ texture: TEX.water, tile: 2, specular: 1.0, shininess: 90 }),
  stone: material({ texture: TEX.stone, tile: 5, color: [0.8, 0.8, 0.8] }),
  roof: material({ texture: TEX.tin, tile: 3, specular: 0.35, shininess: 30 }),
  grass: material({ texture: TEX.grass, tile: 6 }),
  belt: material({ texture: TEX.belt, tile: 2, specular: 0.2 }),
  burlap: material({ texture: TEX.burlap, texMode: 0, uv: [2, 2], specular: 0.02 }),
  leaves: material({ texture: TEX.leaves, texMode: 0, uv: [3, 2], specular: 0.05 }),
  bark: material({ texture: TEX.bark, texMode: 0, uv: [2, 2] }),
  rope: material({ color: rgb("#b49a6a"), texture: TEX.hay, texMode: 0, uv: [1, 8], specular: 0.02 }),
  redPaint: material({ texture: TEX.barnRed, tile: 2, color: [1.1, 0.9, 0.9] }),

  pigSkin: material({ color: rgb("#f4a7b0"), texture: TEX.pigSkin, texMode: 0, uv: [2, 1], specular: 0.25, shininess: 20 }),
  pigSnout: material({ color: rgb("#e98b98"), specular: 0.35, shininess: 30 }),
  hoof: material({ color: rgb("#4a3328"), specular: 0.4, shininess: 40 }),
  eye: material({ color: rgb("#141010"), specular: 1.2, shininess: 120, outline: false }),
  nostril: material({ color: rgb("#7a3c48"), outline: false }),

  chicken: material({ color: rgb("#f3efe6"), specular: 0.1 }),
  beak: material({ color: rgb("#f0a020"), specular: 0.3 }),
  comb: material({ color: rgb("#d42a20"), specular: 0.3 }),

  crow: material({ color: rgb("#1c1b22"), specular: 0.6, shininess: 40 }),
  crowBeak: material({ color: rgb("#5a5652"), specular: 0.4 }),
  dogFur: material({ color: rgb("#9a6236"), texture: TEX.burlap, texMode: 0, uv: [3, 3], specular: 0.1 }),
  dogDark: material({ color: rgb("#3b2416"), specular: 0.3 }),
  silo: material({ color: [0.85, 0.87, 0.9], texture: TEX.tin, texMode: 0, uv: [10, 6], specular: 0.6, shininess: 40 }),

  corn: material({ texture: TEX.corn, texMode: 0, uv: [2, 2], emissive: 0.35, specular: 0.5, shininess: 40 }),
  husk: material({ color: rgb("#7fae3e"), specular: 0.1 }),
  iron: material({ color: rgb("#5b5e63"), specular: 0.9, shininess: 70 }),
  gold: material({ color: rgb("#ffc93c"), specular: 1.2, shininess: 90, emissive: 0.35 }),

  lanternGlass: material({ mode: 1, color: rgb("#ffcf7a"), emissive: 4, outline: false }),
  spotGlass: material({ mode: 1, color: rgb("#fff4d8"), emissive: 8, outline: false }),
  shaft: material({ mode: 3, color: [0.55, 0.45, 0.3], alpha: 0.35, outline: false }),
  spotBeam: material({ mode: 3, color: [0.8, 0.9, 1.0], alpha: 0.9, outline: false })
};
