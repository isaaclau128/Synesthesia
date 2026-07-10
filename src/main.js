import './styles.css';
import { DEFAULT_KEY_PALETTE, getKeyPalette, formatKeyName } from './palette/keyPalettes.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="shell">
    <canvas id="art" aria-hidden="true"></canvas>

    <section class="hero" id="menu" hidden>
      <div class="hero-head">
        <div class="badge-row">
          <span class="badge">Live mic</span>
          <span class="badge">Generative art</span>
          <span class="badge">Web Audio</span>
        </div>

        <button id="toggle-menu" class="menu-toggle" aria-expanded="true" aria-controls="menu-content">
          Minimize
        </button>
      </div>

      <div id="menu-content" class="hero-body">
        <h1>Turn sound into shifting light.</h1>
        <p>
          Synesthesia listens to your computer microphone and translates energy,
          rhythm, and texture into a reactive canvas of color, motion, and glow.
        </p>

        <div class="controls">
          <button id="toggle-mic" class="primary">Enable microphone</button>
          <button id="demo-mode" class="secondary">Use demo audio</button>
        </div>

        <div class="panel-grid">
          <label class="slider-card">
            <span>Sensitivity</span>
            <input id="sensitivity" type="range" min="0.5" max="2.5" step="0.01" value="1.25" />
          </label>

          <div class="meter-card">
            <span>Status</span>
            <strong id="status">Idle</strong>
          </div>

          <div class="meter-card">
            <span>Intensity</span>
            <strong id="intensity">0%</strong>
          </div>

          <div class="meter-card">
            <span>Pedal</span>
            <strong id="pedal">Off</strong>
          </div>

          <div class="meter-card">
            <span>Pitch</span>
            <strong id="pitch">--</strong>
          </div>

          <div class="meter-card">
            <span>Key</span>
            <strong id="key">--</strong>
          </div>

          <div class="meter-card">
            <span>Mode</span>
            <strong id="mode">Fugue</strong>
          </div>
        </div>
      </div>
    </section>
  </main>
`;

const canvas = document.querySelector('#art');
const ctx = canvas.getContext('2d', { alpha: true });
const menuPanel = document.querySelector('#menu');
const menuContent = document.querySelector('#menu-content');
const toggleMenuButton = document.querySelector('#toggle-menu');
const toggleMicButton = document.querySelector('#toggle-mic');
const demoButton = document.querySelector('#demo-mode');
const statusLabel = document.querySelector('#status');
const intensityLabel = document.querySelector('#intensity');
const pedalLabel = document.querySelector('#pedal');
const pitchLabel = document.querySelector('#pitch');
const keyLabel = document.querySelector('#key');
const modeLabel = document.querySelector('#mode');
const sensitivitySlider = document.querySelector('#sensitivity');

const state = {
  audioContext: null,
  analyser: null,
  sourceNode: null,
  mediaStream: null,
  oscillator: null,
  demoGain: null,
  animationFrame: 0,
  active: false,
  demo: false,
  menuCollapsed: false,
  sensitivity: Number(sensitivitySlider.value),
  frequencyData: new Uint8Array(1024),
  timeData: new Uint8Array(1024),
  paintEvents: [],
  noiseSeed: Math.random() * 1000,
  lastEnergy: 0,
  lastAttackSpawn: 0,
  accentSeed: Math.random() * Math.PI * 2,
  keyHistogram: new Array(12).fill(0),
  metrics: {
    energy: 0,
    previousEnergy: 0,
    attack: 0,
    sustain: 0,
    signalLevel: 0,
    pedal: 0,
    pitchHz: 0,
    pitchConfidence: 0,
    texture: 0,
    mode: 'Fugue',
    noteName: '--',
    keyName: '--',
    keyConfidence: 0,
    spectralEntropy: 0,
    bass: 0,
    mid: 0,
    treble: 0,
  },
  pitchTrail: [],
};

let currentPalette = DEFAULT_KEY_PALETTE;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function rgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function lerpColor(a, b, t) {
  return [
    Math.round(mix(a[0], b[0], t)),
    Math.round(mix(a[1], b[1], t)),
    Math.round(mix(a[2], b[2], t)),
  ];
}

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function rotateProfile(profile, rotation) {
  return profile.map((_, index) => profile[(index + rotation) % profile.length]);
}

function scoreKey(histogram, profile) {
  let dot = 0;
  let histogramEnergy = 0;
  let profileEnergy = 0;

  for (let index = 0; index < 12; index += 1) {
    dot += histogram[index] * profile[index];
    histogramEnergy += histogram[index] * histogram[index];
    profileEnergy += profile[index] * profile[index];
  }

  if (histogramEnergy === 0 || profileEnergy === 0) {
    return 0;
  }

  return dot / Math.sqrt(histogramEnergy * profileEnergy);
}

function estimateKey(pitchTrail) {
  const histogram = new Array(12).fill(0);
  let totalWeight = 0;

  for (let index = 0; index < pitchTrail.length; index += 1) {
    const point = pitchTrail[index];
    if (!point.frequency || !point.confidence) {
      continue;
    }

    const midi = Math.round(69 + 12 * Math.log2(point.frequency / 440));
    const pitchClass = ((midi % 12) + 12) % 12;
    const recency = (index + 1) / pitchTrail.length;
    const weight = point.confidence * mix(0.55, 1.3, recency);
    histogram[pitchClass] += weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return { keyName: '--', keyConfidence: 0 };
  }

  for (let index = 0; index < histogram.length; index += 1) {
    histogram[index] /= totalWeight;
  }

  let bestScore = -Infinity;
  let secondBestScore = -Infinity;
  let bestKeyName = '--';

  for (let tonic = 0; tonic < 12; tonic += 1) {
    const majorScore = scoreKey(histogram, rotateProfile(MAJOR_PROFILE, tonic));
    const minorScore = scoreKey(histogram, rotateProfile(MINOR_PROFILE, tonic));
    const majorName = formatKeyName(tonic, 'major');
    const minorName = formatKeyName(tonic, 'minor');

    for (const [score, name] of [[majorScore, majorName], [minorScore, minorName]]) {
      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestKeyName = name;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }
  }

  const confidence = clamp((bestScore - secondBestScore) / 0.18, 0, 1);
  return { keyName: bestKeyName, keyConfidence: confidence };
}

function chooseHue(metrics) {
  const { bass, treble, mid, pitchConfidence, texture, sustain, keyConfidence } = metrics;
  const roll = Math.random();
  const keyBias = clamp(keyConfidence * 0.75 + pitchConfidence * 0.25, 0, 1);

  if (bass > 0.34 && roll < 0.42) {
    return randomPick(currentPalette.blues.concat(currentPalette.violets));
  }

  if (treble > 0.34 || pitchConfidence > 0.7) {
    return roll < 0.5 ? randomPick(currentPalette.cyans) : randomPick(currentPalette.magentas.concat([currentPalette.white]));
  }

  if (texture > 0.55 || sustain > 0.45) {
    return roll < 0.55 ? randomPick(currentPalette.violets.concat(currentPalette.magentas)) : randomPick(currentPalette.warms);
  }

  if (mid > 0.32) {
    return roll < 0.55 + keyBias * 0.1 ? randomPick(currentPalette.violets) : randomPick(currentPalette.cyans);
  }

  return roll < 0.7 ? randomPick(currentPalette.blues) : randomPick(currentPalette.violets);
}

function chooseCompositionAnchor(width, height, metrics, eventType) {
  const pitchMix = metrics.pitchHz ? clamp((Math.log2(metrics.pitchHz / 55)) / 4.5, 0, 1) : Math.random();
  const energyBias = clamp(metrics.energy * 0.72 + metrics.attack * 1.1 + metrics.pedal * 0.25, 0, 1);
  const edgeBias = clamp(metrics.texture * 0.75 + metrics.spectralEntropy * 0.5 + (eventType === 'splatter' ? 0.2 : 0), 0, 1);
  const edgeChoice = Math.random();

  let x = mix(width * 0.14, width * 0.86, pitchMix);
  let y = mix(height * 0.82, height * 0.18, 1 - pitchMix * 0.85);

  x += mix(-width * 0.18, width * 0.18, Math.random()) * energyBias;
  y += mix(-height * 0.14, height * 0.14, Math.random()) * (0.4 + energyBias * 0.6);

  if (edgeChoice < edgeBias * 0.28) {
    x = mix(width * 0.06, width * 0.94, Math.random());
    y = Math.random() < 0.5 ? height * (0.08 + Math.random() * 0.12) : height * (0.82 + Math.random() * 0.12);
  } else if (edgeChoice < edgeBias * 0.56) {
    x = Math.random() < 0.5 ? width * (0.06 + Math.random() * 0.12) : width * (0.82 + Math.random() * 0.12);
    y = mix(height * 0.12, height * 0.88, Math.random());
  }

  return {
    x: clamp(x, width * 0.03, width * 0.97),
    y: clamp(y, height * 0.03, height * 0.97),
  };
}

function noiseValue(x, y, time) {
  const waves = Math.sin(x * 0.012 + time * 0.00035 + state.noiseSeed)
    + Math.cos(y * 0.018 - time * 0.00042 + state.noiseSeed * 1.7)
    + Math.sin((x + y) * 0.006 + time * 0.0002 + state.noiseSeed * 0.47);

  return (waves + 3) / 6;
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const { innerWidth, innerHeight } = window;

  canvas.width = Math.floor(innerWidth * ratio);
  canvas.height = Math.floor(innerHeight * ratio);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function setMenuCollapsed(collapsed) {
  state.menuCollapsed = collapsed;
  menuContent.hidden = collapsed;
  menuPanel.hidden = collapsed;
  menuPanel.classList.toggle('is-collapsed', collapsed);
  toggleMenuButton.textContent = collapsed ? 'Show menu' : 'Minimize';
  toggleMenuButton.setAttribute('aria-expanded', String(!collapsed));
}

function ensureAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = 0.84;
    state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
    state.timeData = new Uint8Array(state.analyser.fftSize);
  }

  return state.audioContext;
}

function setStatus(text) {
  statusLabel.textContent = text;
}

function updateSensitivity(value) {
  state.sensitivity = Number(value);
  document.documentElement.style.setProperty('--sensitivity', String(state.sensitivity));
}

function frequencyToNoteName(frequency) {
  if (!frequency || !Number.isFinite(frequency)) {
    return '--';
  }

  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const noteName = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;

  return `${noteName}${octave}`;
}

function pitchClassFromFrequency(frequency) {
  if (!frequency || !Number.isFinite(frequency)) {
    return null;
  }

  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  return ((midi % 12) + 12) % 12;
}

function estimatePitch(timeData, sampleRate) {
  const sampleCount = Math.min(timeData.length, 1024);
  const buffer = new Float32Array(sampleCount);

  let mean = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const value = (timeData[index] - 128) / 128;
    buffer[index] = value;
    mean += value;
  }

  mean /= sampleCount;

  let rms = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const centered = buffer[index] - mean;
    buffer[index] = centered;
    rms += centered * centered;
  }

  rms = Math.sqrt(rms / sampleCount);
  if (rms < 0.012) {
    return { frequency: 0, confidence: 0, rms };
  }

  const minLag = Math.floor(sampleRate / 1100);
  const maxLag = Math.floor(sampleRate / 80);
  let bestLag = 0;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let norm = 0;

    for (let index = 0; index < sampleCount - lag; index += 1) {
      const a = buffer[index];
      const b = buffer[index + lag];
      correlation += a * b;
      norm += a * a + b * b;
    }

    if (norm <= 0) {
      continue;
    }

    const normalizedCorrelation = correlation / Math.sqrt(norm);
    if (normalizedCorrelation > bestCorr) {
      bestCorr = normalizedCorrelation;
      bestLag = lag;
    }
  }

  if (!bestLag || bestCorr < 0.18) {
    return { frequency: 0, confidence: 0, rms };
  }

  return {
    frequency: sampleRate / bestLag,
    confidence: clamp((bestCorr - 0.18) / 0.52, 0, 1),
    rms,
  };
}

function estimateTexture(frequencyData, pitchConfidence) {
  let entropy = 0;
  let flatnessLog = 0;
  let flux = 0;
  let previous = 0;
  let total = 0;

  for (let index = 0; index < frequencyData.length; index += 1) {
    const value = frequencyData[index] / 255;
    total += value;
    if (value > 0) {
      flatnessLog += Math.log(value + 1e-6);
    }

    if (index > 0) {
      flux += Math.abs(value - previous);
    }

    previous = value;
  }

  const binCount = frequencyData.length || 1;
  const normalizedTotal = total || 1;

  for (let index = 0; index < frequencyData.length; index += 1) {
    const value = frequencyData[index] / 255;
    const probability = value / normalizedTotal;
    if (probability > 0) {
      entropy -= probability * Math.log2(probability);
    }
  }

  const entropyNorm = entropy / Math.log2(binCount);
  const flatness = Math.exp(flatnessLog / binCount) / ((total / binCount) + 1e-6);
  const fluxNorm = flux / binCount;

  return {
    entropyNorm,
    density: clamp(entropyNorm * 0.5 + flatness * 0.18 + fluxNorm * 0.35 + (1 - pitchConfidence) * 0.42, 0, 1),
  };
}

function createPaintEvent(width, height, metrics, trigger) {
  const behaviors = ['splash', 'smear', 'drip', 'streak', 'cloud', 'splatter'];
  const type = trigger === 'attack' && Math.random() < 0.5 ? randomPick(['splash', 'splatter', 'streak']) : randomPick(behaviors);
  const anchor = chooseCompositionAnchor(width, height, metrics, type);
  const color = chooseHue(metrics);
  const pitchMix = metrics.pitchHz ? clamp((Math.log2(metrics.pitchHz / 55)) / 4.5, 0, 1) : 0.5;
  const directionAngle = mix(Math.PI * 0.18, Math.PI * 1.82, pitchMix) + mix(-0.65, 0.65, Math.random());
  const density = clamp(metrics.energy * 1.5 + metrics.attack * 3.4 + metrics.texture * 0.9 + (trigger === 'attack' ? 0.4 : 0), 0.26, 1.9);
  const radius = mix(32, Math.min(width, height) * 0.18, density) * mix(0.72, 1.18, Math.random());
  const spread = mix(0.45, 1.85, metrics.texture + Math.random() * 0.45);
  const drift = mix(0.012, 0.092, metrics.pedal + metrics.sustain * 0.9 + Math.random() * 0.25);

  return {
    type,
    x: anchor.x,
    y: anchor.y,
    baseX: anchor.x,
    baseY: anchor.y,
    vx: Math.cos(directionAngle) * mix(0.04, 1.18, density),
    vy: Math.sin(directionAngle) * mix(0.04, 1.18, density),
    color,
    life: Math.round(mix(64, 220, clamp(metrics.sustain * 0.95 + metrics.pedal * 0.35 + density * 0.24, 0, 1))),
    age: 0,
    radius,
    spread,
    drift,
    blur: mix(6, 26, density),
    opacity: mix(0.2, 0.95, density),
    width: mix(1.4, 11, density),
    roughness: mix(0.08, 0.84, metrics.texture + metrics.spectralEntropy * 0.5 + Math.random() * 0.35),
    sparkle: metrics.treble > 0.34 || Math.random() < 0.25,
    streakiness: type === 'streak' ? 1 : type === 'smear' ? 0.72 : type === 'drip' ? 0.58 : 0.36,
    fallSpeed: type === 'drip' ? mix(0.4, 2.2, density) : mix(0.06, 0.48, density),
    layered: metrics.texture > 0.48 || metrics.attack > 0.09,
    rotation: Math.random() * Math.PI * 2,
    wobble: mix(0.1, 0.9, metrics.texture),
  };
}

function spawnPaintEvents(width, height, metrics, trigger) {
  const countBase = trigger === 'attack'
    ? mix(1.5, 5.5, metrics.attack * 2.8 + metrics.energy * 0.6)
    : mix(0.4, 2.3, metrics.sustain + metrics.texture * 0.4);
  const count = Math.max(1, Math.round(countBase + (metrics.texture > 0.52 ? 1 : 0)));

  for (let index = 0; index < count; index += 1) {
    state.paintEvents.push(createPaintEvent(width, height, metrics, trigger));
  }

  if (state.paintEvents.length > 160) {
    state.paintEvents.splice(0, state.paintEvents.length - 160);
  }
}

function analyzeFrequencyBands() {
  const { frequencyData, timeData } = state;
  const bassEnd = Math.floor(frequencyData.length * 0.08);
  const midEnd = Math.floor(frequencyData.length * 0.33);

  let bass = 0;
  let mid = 0;
  let treble = 0;
  let total = 0;

  for (let index = 0; index < frequencyData.length; index += 1) {
    const sample = frequencyData[index] / 255;
    total += sample;

    if (index < bassEnd) {
      bass += sample;
    } else if (index < midEnd) {
      mid += sample;
    } else {
      treble += sample;
    }
  }

  const bassWeight = bassEnd || 1;
  const midWeight = Math.max(midEnd - bassEnd, 1);
  const trebleWeight = Math.max(frequencyData.length - midEnd, 1);

  const nextEnergy = total / frequencyData.length;
  const energyRise = Math.max(0, nextEnergy - state.metrics.energy);
  const pitch = estimatePitch(timeData, state.audioContext.sampleRate);
  const texture = estimateTexture(frequencyData, pitch.confidence);

  state.metrics.previousEnergy = state.metrics.energy;
  state.metrics.attack = energyRise;
  state.metrics.sustain = clamp(nextEnergy - energyRise * 0.65, 0, 1);
  state.metrics.pedal = clamp(Math.max(state.metrics.pedal * 0.955, state.metrics.sustain * 0.85 + state.metrics.attack * 1.25), 0, 1);
  state.metrics.energy = nextEnergy;
  state.metrics.bass = bass / bassWeight;
  state.metrics.mid = mid / midWeight;
  state.metrics.treble = treble / trebleWeight;
  state.metrics.pitchHz = pitch.frequency;
  state.metrics.pitchConfidence = pitch.confidence;
  state.metrics.texture = texture.density;
  state.metrics.spectralEntropy = texture.entropyNorm;
  state.metrics.mode = texture.density > 0.5 || pitch.confidence < 0.35 ? 'Impressionism' : 'Fugue';
  state.metrics.noteName = pitch.frequency ? frequencyToNoteName(pitch.frequency) : '--';
  state.metrics.keyName = '--';
  state.metrics.keyConfidence = 0;
  state.metrics.energy = clamp(state.metrics.energy, 0, 1);

  if (pitch.frequency && pitch.confidence > 0.25) {
    state.pitchTrail.push({ frequency: pitch.frequency, confidence: pitch.confidence, pitchClass: pitchClassFromFrequency(pitch.frequency) });
    if (state.pitchTrail.length > 48) {
      state.pitchTrail.shift();
    }
  } else if (state.pitchTrail.length > 0) {
    state.pitchTrail.shift();
  }

  const keyEstimate = estimateKey(state.pitchTrail);
  state.metrics.keyName = keyEstimate.keyName;
  state.metrics.keyConfidence = keyEstimate.keyConfidence;
  state.metrics.signalLevel = pitch.rms;
}
function drawBackground(width, height, time) {
  const { attack, sustain, pedal, bass, mid, treble, pitchHz, pitchConfidence, texture, spectralEntropy } = state.metrics;

  const pitchMix = pitchHz ? clamp((Math.log2(pitchHz / 55)) / 4.5, 0, 1) : 0.5;
  const anchorX = mix(width * 0.18, width * 0.8, pitchMix);
  const anchorY = mix(height * 0.78, height * 0.24, pitchMix * 0.75 + texture * 0.15);
  const driftX = Math.sin(time * 0.00012 + state.accentSeed) * width * (0.02 + texture * 0.012) + mid * width * 0.12;
  const driftY = Math.cos(time * 0.00015 + state.accentSeed * 0.7) * height * (0.014 + sustain * 0.014) - bass * height * 0.08;
  const tintPulse = clamp(0.16 + sustain * 0.86 + attack * 1.42 + pedal * 0.32 + texture * 0.44, 0.16, 1.8);

  const core = ctx.createRadialGradient(anchorX + driftX, anchorY + driftY, 0, anchorX + driftX, anchorY + driftY, Math.max(width, height) * 0.9);
  core.addColorStop(0, rgba(lerpColor(currentPalette.bgB, chooseHue(state.metrics), 0.25), 0.55 * tintPulse));
  core.addColorStop(0.34, rgba(lerpColor(currentPalette.bgB, currentPalette.violets[1], 0.6), 0.28 * tintPulse));
  core.addColorStop(0.68, rgba(lerpColor(currentPalette.bgA, currentPalette.blues[0], 0.5), 0.82));
  core.addColorStop(1, rgba(currentPalette.bgA, 0.98));

  ctx.fillStyle = core;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let y = 0; y < height; y += 16) {
    const bandAlpha = 0.018 + noiseValue(width * 0.5, y, time) * 0.028 + spectralEntropy * 0.01;
    ctx.fillStyle = `rgba(255, 255, 255, ${bandAlpha})`;
    ctx.fillRect(0, y, width, 1);
  }

  const noiseStep = Math.max(20, Math.round(30 - texture * 8));
  for (let y = 0; y < height; y += noiseStep) {
    for (let x = 0; x < width; x += noiseStep) {
      const grain = noiseValue(x + driftX * 0.5, y + driftY * 0.5, time);
      if (grain < 0.62) {
        continue;
      }

      const alpha = (grain - 0.62) * 0.06 + 0.014;
      const tint = grain > 0.9 ? palette.white : grain > 0.76 ? palette.cyans[1] : palette.violets[0];
      ctx.fillStyle = rgba(tint, alpha);
      ctx.fillRect(x + (grain - 0.5) * 3, y + (grain - 0.5) * 3, 1, 1);
    }
  }

  ctx.restore();
}

function drawAmbientFields(width, height, time) {
  const { bass, mid, treble, sustain, attack, pitchHz, pitchConfidence, texture } = state.metrics;
  const pitchMix = pitchHz ? clamp((Math.log2(pitchHz / 55)) / 4.5, 0, 1) : 0.5;
  const focalX = mix(width * 0.2, width * 0.82, pitchMix);
  const focalY = mix(height * 0.78, height * 0.22, clamp(treble * 0.8 + pitchConfidence * 0.2, 0, 1));
  const glowCount = 3 + Math.round(texture * 4 + attack * 2);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let index = 0; index < glowCount; index += 1) {
    const angle = time * 0.00016 + index * 1.34 + state.accentSeed;
    const offsetX = Math.cos(angle) * (width * (0.08 + index * 0.012) + mid * width * 0.08);
    const offsetY = Math.sin(angle * 1.1) * (height * (0.04 + index * 0.015) + bass * height * 0.05);
    const radius = Math.min(width, height) * (0.11 + sustain * 0.14 + index * 0.04 + texture * 0.06);
    const grad = ctx.createRadialGradient(focalX + offsetX, focalY + offsetY, 0, focalX + offsetX, focalY + offsetY, radius);
    const base = index % 3 === 0 ? currentPalette.violets[1] : index % 3 === 1 ? currentPalette.cyans[1] : currentPalette.magentas[1];
    grad.addColorStop(0, rgba(base, 0.18 + attack * 0.12));
    grad.addColorStop(0.36, rgba(lerpColor(base, currentPalette.white, 0.45), 0.07 + sustain * 0.1));
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(focalX + offsetX, focalY + offsetY, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawPaintEvents(width, height, time) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let index = state.paintEvents.length - 1; index >= 0; index -= 1) {
    const event = state.paintEvents[index];
    event.age += 1;

    const progress = event.age / event.life;
    const fade = Math.max(0, 1 - progress);
    const motion = 1 + state.metrics.texture * 0.45 + state.metrics.pedal * 0.2;
    const jitter = Math.sin(time * 0.0012 + event.rotation) * event.wobble;

    event.vx *= 0.989;
    event.vy *= 0.986;
    event.vx += Math.cos(event.rotation + event.age * 0.03) * event.drift * 0.18;
    event.vy += event.fallSpeed * 0.08 + Math.sin(event.rotation * 0.7 + event.age * 0.025) * event.drift * 0.08;
    event.x += event.vx * motion;
    event.y += event.vy * motion;
    event.rotation += 0.015 + event.roughness * 0.012;

    const smearLength = event.radius * (0.55 + event.streakiness * 1.4 + state.metrics.attack * 0.5);
    const alpha = fade * event.opacity * (event.type === 'cloud' ? 0.54 : 0.82);
    const baseColor = event.color;
    const spread = event.radius * (0.18 + progress * event.spread + state.metrics.texture * 0.1);
    const widthScale = event.width * (1 + state.metrics.attack * 1.6 + state.metrics.sustain * 0.5);

    ctx.shadowBlur = event.blur * (0.8 + fade * 0.9);
    ctx.shadowColor = rgba(baseColor, alpha * 0.9);

    if (event.type === 'cloud') {
      const cloudRadius = event.radius * (0.45 + progress * 1.2 + event.spread * 0.6);
      const gradient = ctx.createRadialGradient(event.x, event.y, 0, event.x, event.y, cloudRadius);
      gradient.addColorStop(0, rgba(lerpColor(baseColor, currentPalette.white, 0.35), alpha * 0.9));
      gradient.addColorStop(0.36, rgba(baseColor, alpha * 0.4));
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(event.x, event.y, cloudRadius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const segments = event.type === 'splatter' ? 9 : event.type === 'splash' ? 7 : event.type === 'smear' ? 8 : 6;

      for (let fragment = 0; fragment < segments; fragment += 1) {
        const fragmentT = segments === 1 ? 0 : fragment / (segments - 1);
        const arm = event.type === 'drip'
          ? fragmentT * smearLength
          : fragmentT * event.radius * (0.45 + event.spread);
        const angle = event.rotation + fragmentT * Math.PI * 2 + jitter * 0.15;
        const fx = event.x + Math.cos(angle) * arm + Math.sin(angle * 2.4 + jitter) * spread * 0.7;
        const fy = event.y + Math.sin(angle) * arm * 0.42 + fragmentT * smearLength * 0.3 + Math.cos(angle * 1.6) * spread * 0.35;
        const fragmentRadius = Math.max(0.8, widthScale * (0.35 + Math.sin(fragmentT * Math.PI) * 0.9 + event.roughness * 0.3));

        ctx.fillStyle = rgba(baseColor, alpha * (0.22 + fragmentT * 0.78));
        ctx.beginPath();
        ctx.arc(fx, fy, fragmentRadius, 0, Math.PI * 2);
        ctx.fill();

        if (event.type === 'smear' || event.type === 'streak') {
          ctx.strokeStyle = rgba(lerpColor(baseColor, currentPalette.white, 0.2), alpha * 0.25);
          ctx.lineWidth = Math.max(0.8, widthScale * 0.16);
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx - Math.cos(angle) * smearLength * 0.32, fy - Math.sin(angle) * smearLength * 0.18);
          ctx.stroke();
        }
      }

      if (event.type === 'drip') {
        const dripCount = 2 + Math.round(event.roughness * 4);
        for (let drip = 0; drip < dripCount; drip += 1) {
          const dripX = event.x + Math.sin(event.rotation + drip * 0.7) * event.radius * 0.18;
          const dripY = event.y + progress * event.life * 0.22 + drip * event.radius * 0.14;
          ctx.fillStyle = rgba(lerpColor(baseColor, currentPalette.white, 0.12), alpha * 0.28);
          ctx.fillRect(dripX, dripY, Math.max(1, widthScale * 0.14), smearLength * 0.26);
        }
      }

      if (event.sparkle && progress < 0.72) {
        ctx.fillStyle = rgba(currentPalette.white, alpha * 0.5);
        ctx.beginPath();
        ctx.arc(event.x + Math.sin(time * 0.002 + event.rotation) * 5, event.y + Math.cos(time * 0.0021 + event.rotation) * 5, Math.max(0.9, widthScale * 0.28), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (progress >= 1) {
      state.paintEvents.splice(index, 1);
    }
  }

  ctx.restore();
}

function drawBrushTrail(width, height, time) {
  const { pitchHz, pitchConfidence, sustain, texture } = state.metrics;
  if (!pitchHz || pitchConfidence < 0.18) {
    return;
  }

  const pitchMix = clamp((Math.log2(pitchHz / 55)) / 4.5, 0, 1);
  const pathCount = 8 + Math.round(texture * 4);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  ctx.beginPath();
  for (let index = 0; index < pathCount; index += 1) {
    const t = pathCount === 1 ? 0 : index / (pathCount - 1);
    const x = mix(width * 0.08, width * 0.92, t);
    const y = mix(height * 0.76, height * 0.24, pitchMix) + Math.sin(time * 0.00045 + index * 0.9) * (10 + sustain * 26);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = rgba(currentPalette.white, 0.06 + pitchConfidence * 0.14);
  ctx.lineWidth = 1.2 + sustain * 1.8;
  ctx.stroke();

  const noteX = mix(width * 0.14, width * 0.86, pitchMix);
  const noteY = mix(height * 0.74, height * 0.22, pitchMix);
  ctx.fillStyle = rgba(currentPalette.cyans[2], 0.12 + pitchConfidence * 0.24);
  ctx.shadowBlur = 12 + pitchConfidence * 12;
  ctx.shadowColor = rgba(currentPalette.cyans[1], 0.8);
  ctx.beginPath();
  ctx.arc(noteX, noteY, 8 + pitchConfidence * 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function render(time) {
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (state.analyser && (state.active || state.demo)) {
    state.analyser.getByteFrequencyData(state.frequencyData);
    state.analyser.getByteTimeDomainData(state.timeData);
    analyzeFrequencyBands();

    const energy = clamp((state.metrics.sustain * 0.85 + state.metrics.attack * 1.25) * state.sensitivity * 1.15, 0, 1);
    intensityLabel.textContent = `${Math.round(energy * 100)}%`;
    pedalLabel.textContent = `${Math.round(state.metrics.pedal * 100)}%`;
    pitchLabel.textContent = state.metrics.noteName === '--' ? '--' : `${state.metrics.noteName} · ${Math.round(state.metrics.pitchHz)} Hz`;
    keyLabel.textContent = `${state.metrics.keyName} ${state.metrics.keyConfidence > 0 ? `· ${Math.round(state.metrics.keyConfidence * 100)}%` : ''}`.trim();
    modeLabel.textContent = state.metrics.mode;
    setStatus(`${state.demo ? 'Demo audio' : 'Listening'} · ${state.metrics.mode}`);

    currentPalette = getKeyPalette(state.metrics.keyName);

    const liveLevel = clamp(state.metrics.signalLevel * 12, 0, 1);
    if (!state.micPrimed) {
      spawnPaintEvents(width, height, {
        ...state.metrics,
        energy: Math.max(state.metrics.energy, 0.12),
        attack: 0.12,
        sustain: 0.35,
        texture: Math.max(state.metrics.texture, 0.28),
      }, 'attack');
      state.micPrimed = true;
    }

    const attackReady = state.metrics.attack > 0.035 && (energy - state.lastEnergy > 0.01 || time - state.lastAttackSpawn > 120);
    if (attackReady) {
      spawnPaintEvents(width, height, state.metrics, 'attack');
      state.lastAttackSpawn = time;
    }

    if (state.metrics.sustain > 0.12 && Math.random() < 0.03 + state.metrics.texture * 0.035) {
      spawnPaintEvents(width, height, state.metrics, 'sustain');
    }

    if (state.metrics.texture > 0.6 && Math.random() < 0.02 + state.metrics.texture * 0.025) {
      spawnPaintEvents(width, height, state.metrics, 'texture');
    }

    if (liveLevel > 0.08 && Math.random() < liveLevel * 0.35) {
      spawnPaintEvents(width, height, {
        ...state.metrics,
        energy: Math.max(state.metrics.energy, liveLevel * 0.55),
        sustain: Math.max(state.metrics.sustain, liveLevel * 0.45),
        texture: Math.max(state.metrics.texture, liveLevel * 0.5),
      }, 'sustain');
    }
    state.lastEnergy = energy;
  } else if (!state.demo) {
    state.metrics.energy *= 0.97;
    state.metrics.previousEnergy *= 0.97;
    state.metrics.attack *= 0.9;
    state.metrics.sustain *= 0.95;
    state.metrics.pedal *= 0.94;
    state.metrics.pitchHz = 0;
    state.metrics.pitchConfidence = 0;
    state.metrics.texture *= 0.95;
    state.metrics.signalLevel *= 0.9;
    state.metrics.mode = 'Fugue';
    state.metrics.noteName = '--';
    state.metrics.bass *= 0.95;
    state.metrics.mid *= 0.95;
    state.metrics.treble *= 0.95;
    intensityLabel.textContent = `${Math.round(state.metrics.energy * 100)}%`;
    pedalLabel.textContent = `${Math.round(state.metrics.pedal * 100)}%`;
    pitchLabel.textContent = '--';
    keyLabel.textContent = '--';
    modeLabel.textContent = 'Fugue';
    setStatus('Idle');
    currentPalette = DEFAULT_KEY_PALETTE;
    state.micPrimed = false;
  }

  drawBackground(width, height, time);
  drawAmbientFields(width, height, time);
  drawPaintEvents(width, height, time);
  drawBrushTrail(width, height, time);

  state.animationFrame = requestAnimationFrame(render);
}

async function startMic() {
  if (state.active) {
    return;
  }

  state.demo = false;
  state.micPrimed = false;
  ensureAudioContext();
  await state.audioContext.resume();

  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    if (state.sourceNode) {
      state.sourceNode.disconnect();
    }

    state.sourceNode = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.sourceNode.connect(state.analyser);
    state.active = true;
    setStatus('Listening');
    toggleMicButton.textContent = 'Stop microphone';
    demoButton.textContent = 'Demo off';
  } catch (error) {
    setStatus('Mic blocked');
    console.error('Microphone access failed:', error);
  }
}

function stopMic() {
  if (state.mediaStream) {
    for (const track of state.mediaStream.getTracks()) {
      track.stop();
    }
  }

  if (state.sourceNode) {
    state.sourceNode.disconnect();
    state.sourceNode = null;
  }

  if (state.analyser) {
    state.analyser.disconnect();
  }

  state.mediaStream = null;
  state.active = false;
  setStatus(state.demo ? 'Demo audio' : 'Idle');
  toggleMicButton.textContent = 'Enable microphone';
}

async function enableDemoAudio() {
  ensureAudioContext();

  if (state.active) {
    stopMic();
  }

  if (state.oscillator) {
    state.oscillator.stop();
    state.oscillator.disconnect();
    state.demoGain.disconnect();
  }

  state.demo = true;
  state.oscillator = state.audioContext.createOscillator();
  state.demoGain = state.audioContext.createGain();
  const modOscillator = state.audioContext.createOscillator();
  const modGain = state.audioContext.createGain();

  state.oscillator.type = 'sawtooth';
  state.oscillator.frequency.value = 96;
  modOscillator.frequency.value = 0.4;
  modGain.gain.value = 64;
  state.demoGain.gain.value = 0.045;

  modOscillator.connect(modGain);
  modGain.connect(state.oscillator.frequency);
  state.oscillator.connect(state.demoGain);
  state.demoGain.connect(state.analyser);

  await state.audioContext.resume();
  state.oscillator.start();
  modOscillator.start();
  setStatus('Demo audio');
  toggleMicButton.textContent = 'Enable microphone';
  demoButton.textContent = 'Demo active';

  const wobble = () => {
    if (!state.demo || !state.oscillator) {
      return;
    }

    const now = state.audioContext.currentTime;
    state.oscillator.frequency.setTargetAtTime(88 + Math.random() * 120, now, 0.08);
    state.demoGain.gain.setTargetAtTime(0.03 + Math.random() * 0.06, now, 0.05);
    window.setTimeout(wobble, 450 + Math.random() * 420);
  };

  wobble();
}

toggleMicButton.addEventListener('click', async () => {
  if (state.demo) {
    state.demo = false;
    if (state.oscillator) {
      state.oscillator.stop();
      state.oscillator.disconnect();
      state.oscillator = null;
    }
    if (state.demoGain) {
      state.demoGain.disconnect();
      state.demoGain = null;
    }
    setStatus('Idle');
    demoButton.textContent = 'Use demo audio';
  }

  if (state.active) {
    stopMic();
  } else {
    await startMic();
  }
});

demoButton.addEventListener('click', async () => {
  if (state.demo) {
    state.demo = false;
    if (state.oscillator) {
      state.oscillator.stop();
      state.oscillator.disconnect();
      state.oscillator = null;
    }
    if (state.demoGain) {
      state.demoGain.disconnect();
      state.demoGain = null;
    }
    setStatus('Idle');
    demoButton.textContent = 'Use demo audio';
    return;
  }

  await enableDemoAudio();
});

sensitivitySlider.addEventListener('input', (event) => {
  updateSensitivity(event.target.value);
});

toggleMenuButton.addEventListener('click', () => {
  setMenuCollapsed(!state.menuCollapsed);
});

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const isTypingField = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);

  if (isTypingField) {
    return;
  }

  if (event.key === 'o' || event.key === 'O') {
    setMenuCollapsed(false);
  }

  if (event.key === 'h' || event.key === 'H') {
    setMenuCollapsed(true);
  }
});

window.addEventListener('resize', resizeCanvas);

updateSensitivity(sensitivitySlider.value);
resizeCanvas();
setMenuCollapsed(true);
setStatus('Idle');
render(performance.now());