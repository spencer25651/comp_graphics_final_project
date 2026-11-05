// Procedural textures, painted with the 2D canvas API and uploaded to WebGL.
// Painting them in code lets the game run by double-clicking index.html:
// browsers refuse to hand image files from file:// URLs to WebGL, but a canvas
// we drew ourselves is always allowed. All textures tile seamlessly (REPEAT).

// Seeded random numbers (mulberry32), so every texture looks the same each run
function seededRandom(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uploadTexture(source) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // SRGB8_ALPHA8: the painted colors are sRGB, and the GPU converts them to
  // linear values when sampling, which is what the lighting math expects
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  // Mipmaps: pre-shrunk copies of the texture, so distant surfaces don't shimmer
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  // Anisotropic filtering keeps floors sharp when seen at a glancing angle
  if (anisotropyExt) {
    const max = gl.getParameter(anisotropyExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, anisotropyExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
  }
  return tex;
}

function paintTexture(size, seed, paint) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  paint(g, size, seededRandom(seed));
  return uploadTexture(c);
}

const css = (r, g, b, a = 1) => `rgba(${clamp(r | 0, 0, 255)},${clamp(g | 0, 0, 255)},${clamp(b | 0, 0, 255)},${a})`;
const tint = (c, k, a = 1) => css(c[0] * k, c[1] * k, c[2] * k, a);

// Calls draw(x, y) at (x, y) and at its copies across the edges, so a stroke
// that runs off one side comes back on the other and the texture tiles
function wrapped(s, x, y, r, draw) {
  for (const ox of [-s, 0, s])
    for (const oy of [-s, 0, s]) {
      if (x + ox + r < 0 || x + ox - r > s || y + oy + r < 0 || y + oy - r > s) continue;
      draw(x + ox, y + oy);
    }
}

function speckle(g, s, rand, count, colors, maxR) {
  for (let i = 0; i < count; i++) {
    const r = 0.5 + rand() * maxR;
    g.fillStyle = colors[Math.floor(rand() * colors.length)];
    wrapped(s, rand() * s, rand() * s, r, (x, y) => g.fillRect(x - r, y - r, r * 2, r * 2));
  }
}

function blotches(g, s, rand, count, color, minR, maxR, alpha) {
  for (let i = 0; i < count; i++) {
    const r = minR + rand() * (maxR - minR);
    wrapped(s, rand() * s, rand() * s, r, (x, y) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, css(...color, alpha));
      grad.addColorStop(1, css(...color, 0));
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
}

// Vertical wooden boards with wavy grain, knots and dark gaps between boards.
// Grain lines use sin(y / s * 2*PI * n) so they line up at the top and bottom edge.
function paintPlanks(g, s, rand, { base, count, gap = 3, knots = 0.6, seams = true, horizontal = false }) {
  if (horizontal) { g.translate(s, 0); g.rotate(Math.PI / 2); }
  const w = s / count;
  for (let i = 0; i < count; i++) {
    const k = 0.78 + rand() * 0.4;
    g.save();
    g.beginPath();
    g.rect(i * w, 0, w, s);
    g.clip();
    g.fillStyle = tint(base, k);
    g.fillRect(i * w, 0, w, s);
    for (let j = 0; j < 16; j++) {
      const x0 = i * w + rand() * w, amp = rand() * w * 0.15, ph = rand() * 6.283, freq = 1 + Math.floor(rand() * 3);
      const d = 0.55 + rand() * 0.35;
      g.strokeStyle = tint(base, k * d, 0.3 + rand() * 0.35);
      g.lineWidth = 0.6 + rand() * 1.8;
      g.beginPath();
      for (let y = 0; y <= s; y += 4) {
        const x = x0 + amp * Math.sin((y / s) * 6.283 * freq + ph);
        if (y === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    if (rand() < knots) {
      const kx = i * w + w * (0.3 + rand() * 0.4), ky = rand() * s, r = 3 + rand() * w * 0.15;
      wrapped(s, kx, ky, r * 2, (x, y) => {
        const grad = g.createRadialGradient(x, y, 0, x, y, r * 2);
        grad.addColorStop(0, tint(base, 0.3, 0.9));
        grad.addColorStop(0.4, tint(base, 0.6, 0.5));
        grad.addColorStop(1, tint(base, 0.8, 0));
        g.fillStyle = grad;
        g.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
      });
    }
    if (seams) {
      const sy = rand() * s;
      g.fillStyle = tint(base, 0.3);
      g.fillRect(i * w, sy, w, 2);
      g.fillStyle = tint(base, 1.2, 0.5);
      g.fillRect(i * w, sy + 2, w, 1);
    }
    g.restore();
    g.fillStyle = tint(base, 0.22);
    g.fillRect(i * w, 0, gap, s);
    g.fillStyle = tint(base, 1.25, 0.4);
    g.fillRect(i * w + gap, 0, 1, s);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

function paintStrands(g, s, rand, count, palette, len, angle, spread) {
  for (let i = 0; i < count; i++) {
    const l = len[0] + rand() * (len[1] - len[0]);
    const a = angle + (rand() - 0.5) * spread;
    const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    g.strokeStyle = palette[Math.floor(rand() * palette.length)];
    g.lineWidth = 0.8 + rand() * 1.6;
    wrapped(s, rand() * s, rand() * s, l, (x, y) => {
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + dx * 0.5 + (rand() - 0.5) * 4, y + dy * 0.5 + (rand() - 0.5) * 4, x + dx, y + dy);
      g.stroke();
    });
  }
}

const HAY_PALETTE = ["#e8c565", "#d9b04e", "#c99a3c", "#f2d98a", "#b8862f", "#e0bb5a", "#a87a2a"];

const TEX = {
  // Weathered red barn boards with paint worn off in streaks
  barnRed: paintTexture(512, 1, (g, s, rand) => {
    paintPlanks(g, s, rand, { base: [150, 42, 32], count: 6, gap: 4 });
    for (let i = 0; i < 90; i++) {
      const x = rand() * s, y = rand() * s, h = 10 + rand() * 60;
      g.fillStyle = css(190, 160, 130, 0.08 + rand() * 0.12);
      wrapped(s, x, y, h, (px, py) => g.fillRect(px, py, 1 + rand() * 3, h));
    }
    speckle(g, s, rand, 1500, ["rgba(60,15,10,0.25)", "rgba(220,170,150,0.12)"], 1.5);
  }),

  floorPlanks: paintTexture(512, 2, (g, s, rand) => {
    paintPlanks(g, s, rand, { base: [150, 112, 72], count: 5, gap: 3, horizontal: true });
    speckle(g, s, rand, 1200, ["rgba(40,25,10,0.25)", "rgba(230,200,150,0.1)"], 1.5);
  }),

  beam: paintTexture(256, 3, (g, s, rand) => {
    paintPlanks(g, s, rand, { base: [118, 82, 52], count: 2, gap: 2, knots: 0.9, seams: false });
  }),

  hay: paintTexture(512, 4, (g, s, rand) => {
    g.fillStyle = "#c79a42";
    g.fillRect(0, 0, s, s);
    paintStrands(g, s, rand, 5000, HAY_PALETTE, [8, 26], 0, Math.PI * 2);
  }),

  // A bale's face: tightly packed horizontal straw, two twine bands, and dark
  // edges so stacked bales read as separate blocks
  bale: paintTexture(512, 5, (g, s, rand) => {
    g.fillStyle = "#c99d45";
    g.fillRect(0, 0, s, s);
    paintStrands(g, s, rand, 6000, HAY_PALETTE, [10, 30], 0, 0.5);
    for (const x of [0.3, 0.7]) {
      g.fillStyle = "rgba(90,60,30,0.9)";
      g.fillRect(x * s - 3, 0, 6, s);
      g.fillStyle = "rgba(180,140,80,0.6)";
      g.fillRect(x * s - 1, 0, 2, s);
    }
    const edge = g.createLinearGradient(0, 0, 0, s);
    edge.addColorStop(0, "rgba(60,40,15,0.55)");
    edge.addColorStop(0.08, "rgba(60,40,15,0)");
    edge.addColorStop(0.92, "rgba(60,40,15,0)");
    edge.addColorStop(1, "rgba(60,40,15,0.55)");
    g.fillStyle = edge;
    g.fillRect(0, 0, s, s);
    const side = g.createLinearGradient(0, 0, s, 0);
    side.addColorStop(0, "rgba(60,40,15,0.45)");
    side.addColorStop(0.06, "rgba(60,40,15,0)");
    side.addColorStop(0.94, "rgba(60,40,15,0)");
    side.addColorStop(1, "rgba(60,40,15,0.45)");
    g.fillStyle = side;
    g.fillRect(0, 0, s, s);
  }),

  // Wooden crate: horizontal boards inside a frame, with a diagonal brace
  crate: paintTexture(256, 6, (g, s, rand) => {
    paintPlanks(g, s, rand, { base: [176, 132, 80], count: 4, gap: 3, horizontal: true, knots: 0.3, seams: false });
    const b = s * 0.12, base = [140, 98, 55];
    g.fillStyle = tint(base, 1);
    g.fillRect(0, 0, s, b); g.fillRect(0, s - b, s, b); g.fillRect(0, 0, b, s); g.fillRect(s - b, 0, b, s);
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(-Math.PI / 4);
    g.fillStyle = tint(base, 0.95);
    g.fillRect(-s * 0.7, -b / 2, s * 1.4, b);
    g.strokeStyle = tint(base, 0.4);
    g.lineWidth = 2;
    g.strokeRect(-s * 0.7, -b / 2, s * 1.4, b);
    g.restore();
    g.strokeStyle = tint(base, 0.4);
    g.lineWidth = 3;
    g.strokeRect(b, b, s - 2 * b, s - 2 * b);
    g.strokeRect(1, 1, s - 2, s - 2);
    g.fillStyle = "#3a3a3a";
    for (const [x, y] of [[b / 2, b / 2], [s - b / 2, b / 2], [b / 2, s - b / 2], [s - b / 2, s - b / 2]]) {
      g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
    }
  }),

  // Galvanized steel with streaks, rivets and rust
  metal: paintTexture(256, 7, (g, s, rand) => {
    g.fillStyle = "#9da3a8";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
      g.fillRect(rand() * s, 0, 1 + rand() * 3, s);
    }
    speckle(g, s, rand, 1500, ["rgba(255,255,255,0.15)", "rgba(40,40,40,0.15)"], 1.2);
    blotches(g, s, rand, 14, [140, 70, 30], 6, 26, 0.55);
    for (let x = 12; x < s; x += 40) {
      for (const y of [10, s - 10]) {
        g.fillStyle = "#5c6064"; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
        g.fillStyle = "#d9dde0"; g.beginPath(); g.arc(x - 1, y - 1, 1.6, 0, 7); g.fill();
      }
    }
  }),

  mud: paintTexture(256, 8, (g, s, rand) => {
    g.fillStyle = "#4a3220";
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 60, [30, 20, 12], 8, 40, 0.6);
    blotches(g, s, rand, 40, [110, 80, 50], 5, 25, 0.35);
    speckle(g, s, rand, 300, ["rgba(255,240,220,0.25)"], 1.2);
  }),

  // Packed dirt with loose straw: the pig pen floor
  straw: paintTexture(512, 9, (g, s, rand) => {
    g.fillStyle = "#7a5a3a";
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 80, [60, 42, 25], 10, 50, 0.4);
    speckle(g, s, rand, 2500, ["rgba(40,25,15,0.4)", "rgba(160,130,90,0.3)"], 1.5);
    paintStrands(g, s, rand, 1800, HAY_PALETTE, [8, 22], 0, Math.PI * 2);
  }),

  stone: paintTexture(512, 10, (g, s, rand) => {
    g.fillStyle = "#2a241e";
    g.fillRect(0, 0, s, s);
    const rows = 8, h = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * h * 0.6;
      while (x < s + h) {
        const w = h * (0.9 + rand() * 0.8), k = 0.7 + rand() * 0.5;
        const cx = x + w / 2, cy = r * h + h / 2;
        wrapped(s, cx, cy, w, (px, py) => {
          const grad = g.createRadialGradient(px - w * 0.15, py - h * 0.2, 2, px, py, w * 0.6);
          grad.addColorStop(0, css(120 * k, 110 * k, 98 * k));
          grad.addColorStop(1, css(70 * k, 62 * k, 55 * k));
          g.fillStyle = grad;
          g.beginPath();
          g.ellipse(px, py, w / 2 - 3, h / 2 - 3, 0, 0, 7);
          g.fill();
        });
        x += w;
      }
    }
    speckle(g, s, rand, 1500, ["rgba(0,0,0,0.25)", "rgba(255,255,255,0.08)"], 1.5);
  }),

  grass: paintTexture(512, 11, (g, s, rand) => {
    g.fillStyle = "#4f7a2c";
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 50, [70, 110, 40], 20, 70, 0.5);
    paintStrands(g, s, rand, 6000, ["#3e6b22", "#5b8c32", "#6f9e3c", "#4a7a28", "#86b04c"], [5, 12], -Math.PI / 2, 0.8);
  }),

  // Corrugated tin roof: repeating light/dark ridges plus rust runs
  tin: paintTexture(256, 12, (g, s, rand) => {
    const ridges = 8;
    for (let x = 0; x < s; x++) {
      const v = 0.5 + 0.5 * Math.sin((x / s) * ridges * Math.PI * 2);
      g.fillStyle = css(95 + v * 70, 95 + v * 68, 98 + v * 66);
      g.fillRect(x, 0, 1, s);
    }
    for (let i = 0; i < 40; i++) {
      const x = rand() * s, y = rand() * s, h = 20 + rand() * 90;
      g.fillStyle = css(130, 65, 30, 0.15 + rand() * 0.3);
      wrapped(s, x, y, h, (px, py) => g.fillRect(px, py, 2 + rand() * 5, h));
    }
    blotches(g, s, rand, 10, [120, 55, 25], 8, 30, 0.45);
  }),

  // Nearly white so the material color sets the pink; brown mud splotches survive the tint
  pigSkin: paintTexture(256, 13, (g, s, rand) => {
    g.fillStyle = "#fff6f4";
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 40, [235, 200, 200], 6, 22, 0.5);
    blotches(g, s, rand, 7, [110, 70, 40], 8, 24, 0.75);
    speckle(g, s, rand, 400, ["rgba(200,150,150,0.35)"], 0.8);
  }),

  corn: paintTexture(256, 14, (g, s, rand) => {
    g.fillStyle = "#8a6a10";
    g.fillRect(0, 0, s, s);
    const cols = 12, rows = 16, w = s / cols, h = s / rows;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = c * w + (r % 2) * w * 0.5, y = r * h, k = 0.85 + rand() * 0.25;
        wrapped(s, x + w / 2, y + h / 2, w, (px, py) => {
          const grad = g.createRadialGradient(px - w * 0.15, py - h * 0.2, 1, px, py, w * 0.6);
          grad.addColorStop(0, css(255 * k, 240 * k, 140 * k));
          grad.addColorStop(1, css(220 * k, 160 * k, 30 * k));
          g.fillStyle = grad;
          g.beginPath();
          g.ellipse(px, py, w * 0.44, h * 0.44, 0, 0, 7);
          g.fill();
        });
      }
  }),

  // Rubber conveyor belt; its ribs scroll when uvOffset changes
  belt: paintTexture(256, 15, (g, s, rand) => {
    g.fillStyle = "#2c2a28";
    g.fillRect(0, 0, s, s);
    speckle(g, s, rand, 800, ["rgba(255,255,255,0.05)", "rgba(0,0,0,0.3)"], 1.2);
    for (let x = 0; x < s; x += s / 8) {
      g.fillStyle = "#4a4643";
      g.fillRect(x, 0, 10, s);
      g.fillStyle = "#151413";
      g.fillRect(x + 10, 0, 3, s);
    }
  }),

  water: paintTexture(256, 16, (g, s, rand) => {
    g.fillStyle = "#2c5a5e";
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 30, [60, 110, 110], 10, 40, 0.5);
    for (let i = 0; i < 26; i++) {
      const y0 = rand() * s, amp = 4 + rand() * 10, ph = rand() * 6.28, f = 1 + Math.floor(rand() * 3);
      g.strokeStyle = `rgba(190,235,230,${0.15 + rand() * 0.3})`;
      g.lineWidth = 1 + rand() * 2;
      g.beginPath();
      for (let x = 0; x <= s; x += 4) {
        const y = y0 + amp * Math.sin((x / s) * 6.283 * f + ph);
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }),

  burlap: paintTexture(128, 17, (g, s, rand) => {
    g.fillStyle = "#a88a5c";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 4) {
      g.fillStyle = `rgba(80,60,30,${0.2 + rand() * 0.2})`;
      g.fillRect(i, 0, 1.5, s);
      g.fillRect(0, i, s, 1.5);
    }
    speckle(g, s, rand, 300, ["rgba(60,40,20,0.3)", "rgba(230,210,170,0.2)"], 1);
  }),

  leaves: paintTexture(256, 18, (g, s, rand) => {
    g.fillStyle = "#2f5a1e";
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 200, [80, 140, 50], 4, 14, 0.7);
    blotches(g, s, rand, 120, [20, 45, 15], 4, 12, 0.6);
  }),

  bark: paintTexture(256, 19, (g, s, rand) => {
    paintPlanks(g, s, rand, { base: [90, 66, 46], count: 3, gap: 1, knots: 0.3, seams: false });
    speckle(g, s, rand, 800, ["rgba(20,12,6,0.4)"], 2);
  })
};
