// Sound effects synthesized with the Web Audio API (no sound files needed).
// Browsers only allow audio after the player has clicked or pressed a key,
// so initAudio() is called from the first input.

const audio = { ctx: null, master: null, muted: false };

function initAudio() {
  if (!audio.ctx) {
    try {
      audio.ctx = new AudioContext();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.6;
      audio.master.connect(audio.ctx.destination);
    } catch (e) {
      return;
    }
  }
  if (audio.ctx.state === "suspended") audio.ctx.resume();
}

// A note that slides from `f0` to `f1` Hz with a quick attack and a decay
function tone(f0, f1, duration, type = "sine", volume = 0.2, delay = 0, filter = 0) {
  if (!audio.ctx || audio.muted) return;
  const t = audio.ctx.currentTime + delay;
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  let node = osc;
  if (filter) {
    const lp = audio.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = filter;
    osc.connect(lp);
    node = lp;
  }
  node.connect(gain);
  gain.connect(audio.master);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

// Filtered white noise: thumps, rustles, crumbles
function noise(duration, volume = 0.2, filter = 800, delay = 0) {
  if (!audio.ctx || audio.muted) return;
  const t = audio.ctx.currentTime + delay;
  const length = Math.floor(audio.ctx.sampleRate * duration);
  const buffer = audio.ctx.createBuffer(1, length, audio.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = audio.ctx.createBufferSource();
  src.buffer = buffer;
  const lp = audio.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = filter;
  const gain = audio.ctx.createGain();
  gain.gain.value = volume;
  src.connect(lp);
  lp.connect(gain);
  gain.connect(audio.master);
  src.start(t);
}

const SFX = {
  jump: () => tone(260, 520, 0.14, "square", 0.05, 0, 1800),
  land: impact => noise(0.12, Math.min(0.35, impact / 60), 500),
  bounce: () => tone(140, 520, 0.35, "sine", 0.25),
  corn: () => { tone(988, 988, 0.08, "triangle", 0.15); tone(1480, 1480, 0.18, "triangle", 0.15, 0.07); },
  oink: () => { tone(260, 170, 0.16, "sawtooth", 0.12, 0, 900); tone(280, 180, 0.2, "sawtooth", 0.12, 0.2, 900); },
  fall: () => tone(600, 90, 0.8, "sine", 0.2),
  caught: () => { for (let i = 0; i < 3; i++) tone(880, 880, 0.1, "square", 0.07, i * 0.15); },
  hurt: () => { tone(400, 120, 0.3, "sawtooth", 0.1, 0, 1200); noise(0.15, 0.2, 2000); },
  creak: () => tone(110, 70, 0.35, "sawtooth", 0.05, 0, 400),
  crumble: () => noise(0.5, 0.3, 350),
  bawk: () => { tone(650, 900, 0.07, "square", 0.06, 0, 2500); tone(520, 380, 0.16, "square", 0.06, 0.09, 2500); },
  bark: () => { tone(420, 260, 0.09, "sawtooth", 0.09, 0, 1400); tone(380, 240, 0.11, "sawtooth", 0.09, 0.14, 1400); },
  caw: () => { tone(900, 600, 0.18, "sawtooth", 0.07, 0, 1800); tone(850, 550, 0.2, "sawtooth", 0.07, 0.22, 1800); },
  clang: () => { tone(1200, 1100, 0.25, "triangle", 0.12); tone(1800, 1700, 0.2, "sine", 0.06); },
  splash: () => { noise(0.5, 0.35, 1500); tone(300, 120, 0.25, "sine", 0.1); },
  win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, f, 0.25, "triangle", 0.15, i * 0.13))
};
