import './styles.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="shell">
    <canvas id="art" aria-hidden="true"></canvas>

    <section class="hero">
      <div class="badge-row">
        <span class="badge">Live mic</span>
        <span class="badge">Generative art</span>
        <span class="badge">Web Audio</span>
      </div>

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
          <span>Mode</span>
          <strong id="mode">Fugue</strong>
        </div>
      </div>
    </section>
  </main>
`;

const canvas = document.querySelector('#art');
const ctx = canvas.getContext('2d', { alpha: true });
const toggleMicButton = document.querySelector('#toggle-mic');
const demoButton = document.querySelector('#demo-mode');
const statusLabel = document.querySelector('#status');
const intensityLabel = document.querySelector('#intensity');
const pedalLabel = document.querySelector('#pedal');
const pitchLabel = document.querySelector('#pitch');
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
  sensitivity: Number(sensitivitySlider.value),
  frequencyData: new Uint8Array(1024),
  timeData: new Uint8Array(1024),
  particles: [],
  stars: [],
  metrics: {
    energy: 0,
    previousEnergy: 0,
    attack: 0,
    sustain: 0,
    pedal: 0,
    pitchHz: 0,
    pitchConfidence: 0,
    texture: 0,
    mode: 'Fugue',
    noteName: '--',
    spectralEntropy: 0,
    bass: 0,
    mid: 0,
    treble: 0,
  },
  pitchTrail: [],
};

const palette = {
  bgA: [10, 12, 24],
  bgB: [18, 36, 62],
  accentA: [255, 140, 92],
  accentB: [84, 233, 205],
  accentC: [255, 211, 104],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function rgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const { innerWidth, innerHeight } = window;

  canvas.width = Math.floor(innerWidth * ratio);
  canvas.height = Math.floor(innerHeight * ratio);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  if (state.stars.length === 0) {
    state.stars = Array.from({ length: 160 }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: mix(0.5, 1.8, Math.random()),
      twinkle: Math.random() * Math.PI * 2,
    }));
  }
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

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const noteName = noteNames[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;

  return `${noteName}${octave}`;
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

  if (pitch.frequency && pitch.confidence > 0.25) {
    state.pitchTrail.push({ frequency: pitch.frequency, confidence: pitch.confidence });
    if (state.pitchTrail.length > 48) {
      state.pitchTrail.shift();
    }
  } else if (state.pitchTrail.length > 0) {
    state.pitchTrail.shift();
  }
}

function spawnParticles(amount, centerX, centerY, burst, hueMix, intensity = 1) {
  const nextParticles = Array.from({ length: amount }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = mix(0.18, 2.8, Math.random()) * burst * mix(0.85, 1.1, intensity);
    const size = mix(1.1, 3.8, Math.random()) * (0.55 + burst * 0.45) * mix(0.9, 1.2, intensity);
    const tone = Math.random();
    return {
      x: centerX + Math.cos(angle) * mix(0, 24, Math.random()),
      y: centerY + Math.sin(angle) * mix(0, 24, Math.random()),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: mix(90, 180, Math.random()) * mix(0.9, 1.15, intensity),
      age: 0,
      size,
      color: tone < 0.5 ? palette.accentA : tone < 0.8 ? palette.accentB : palette.accentC,
      hueMix,
      intensity,
    };
  });

  state.particles.push(...nextParticles);
  if (state.particles.length > 280) {
    state.particles.splice(0, state.particles.length - 280);
  }
}

function drawBackground(width, height, time) {
  const { attack, sustain, pedal, bass, mid, treble, pitchHz, pitchConfidence, texture } = state.metrics;

  const pitchMix = pitchHz ? clamp((Math.log2(pitchHz / 55)) / 4.5, 0, 1) : 0.5;
  const pitchX = mix(width * 0.18, width * 0.82, pitchMix);
  const pitchY = mix(height * 0.76, height * 0.22, pitchMix);
  const pulseX = mix(width * (0.25 + mid * 0.35), pitchX, pitchConfidence * 0.65);
  const pulseY = mix(height * (0.35 + treble * 0.25), pitchY, pitchConfidence * 0.65);
  const bloom = clamp(0.28 + sustain * 1.05 + attack * 1.5 + pedal * 0.55 + texture * 0.35, 0.28, 1.95);
  const hueLift = clamp((bass * 180) + (treble * 90), 0, 240);

  const gradient = ctx.createRadialGradient(pulseX, pulseY, 20, pulseX, pulseY, Math.max(width, height) * 0.85);
  gradient.addColorStop(0, rgba(palette.accentA, 0.14 * bloom));
  gradient.addColorStop(0.35, rgba(palette.accentB, 0.1 * bloom));
  gradient.addColorStop(0.72, rgba(palette.accentC, 0.06 * bloom));
  gradient.addColorStop(1, rgba(palette.bgA, 0.94));

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (const star of state.stars) {
    star.twinkle += 0.004 + sustain * 0.01 + attack * 0.02 + pedal * 0.006 + texture * 0.003;
    const twinkle = (Math.sin(star.twinkle + time * 0.001) + 1) / 2;
    ctx.fillStyle = `rgba(${hueLift}, ${180 + treble * 50}, ${220 - bass * 40}, ${0.08 + twinkle * 0.16})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r + twinkle * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawWaveRing(width, height) {
  const { frequencyData } = state;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.28;
  const modeFactor = state.metrics.mode === 'Impressionism' ? 1.28 : 0.94;
  const baseRadius = maxRadius * (0.72 + state.metrics.sustain * 0.82 + state.metrics.attack * 0.6 + state.metrics.pedal * 0.35) * modeFactor;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.globalCompositeOperation = 'screen';
  ctx.lineWidth = 2;

  for (let ring = 0; ring < 3; ring += 1) {
    const radius = baseRadius + ring * 34;
    ctx.beginPath();
    for (let index = 0; index < frequencyData.length; index += 10) {
      const angle = (index / frequencyData.length) * Math.PI * 2;
      const sample = frequencyData[index] / 255;
      const wobble = sample * (11 + ring * 6) * state.sensitivity * modeFactor;
      const x = Math.cos(angle) * (radius + wobble);
      const y = Math.sin(angle) * (radius + wobble);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.strokeStyle = ring === 0 ? rgba(palette.accentA, state.metrics.mode === 'Impressionism' ? 0.18 : 0.24) : ring === 1 ? rgba(palette.accentB, state.metrics.mode === 'Impressionism' ? 0.16 : 0.2) : rgba(palette.accentC, state.metrics.mode === 'Impressionism' ? 0.14 : 0.16);
    ctx.shadowBlur = 18 + state.metrics.sustain * 12 + state.metrics.pedal * 10 + (state.metrics.mode === 'Impressionism' ? 8 : 0);
    ctx.shadowColor = ring === 0 ? rgba(palette.accentA, 0.8) : ring === 1 ? rgba(palette.accentB, 0.75) : rgba(palette.accentC, 0.7);
    ctx.stroke();
  }

  ctx.restore();
}

function drawParticles(width, height, time) {
  const centerX = width / 2;
  const centerY = height / 2;
  const gravity = 0.006 + state.metrics.bass * 0.02 - state.metrics.pedal * 0.003;
  const modeFactor = state.metrics.mode === 'Impressionism' ? 1.1 : 0.92;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let index = state.particles.length - 1; index >= 0; index -= 1) {
    const particle = state.particles[index];
    particle.age += 1;
    particle.vx *= 0.9925;
    particle.vy *= 0.9925;
    particle.vy += gravity * 0.5;
    particle.x += particle.vx;
    particle.y += particle.vy;

    const progress = particle.age / particle.life;
    const alpha = Math.max(0, 1 - progress);
    const size = particle.size * (1 + state.metrics.sustain * 0.65 + state.metrics.pedal * 0.25 + particle.intensity * 0.35) * modeFactor;

    ctx.fillStyle = rgba(particle.color, alpha * (state.metrics.mode === 'Impressionism' ? 0.56 : 0.72));
    ctx.shadowBlur = 14 + size * 2.2 + state.metrics.pedal * 6;
    ctx.shadowColor = rgba(particle.color, alpha * 0.85);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
    ctx.fill();

    if (progress > 0.35) {
      ctx.strokeStyle = rgba(particle.color, alpha * 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(particle.x - particle.vx * 4, particle.y - particle.vy * 4);
      ctx.stroke();
    }

    if (particle.age >= particle.life) {
      state.particles.splice(index, 1);
    }
  }

  const orbitRadius = Math.min(width, height) * 0.18;
  const orbitCount = 8;
  const orbitAlpha = 0.12 + state.metrics.treble * 0.14;

  for (let index = 0; index < orbitCount; index += 1) {
    const angle = (index / orbitCount) * Math.PI * 2 + time * 0.0005;
    const pulse = state.metrics.sustain * 16 + state.metrics.attack * 24 + state.metrics.pedal * 10 + Math.sin(time * 0.001 + index) * 3;
    const x = centerX + Math.cos(angle) * (orbitRadius + pulse);
    const y = centerY + Math.sin(angle) * (orbitRadius + pulse * 0.42);

    ctx.fillStyle = rgba(index % 2 === 0 ? palette.accentB : palette.accentA, orbitAlpha);
    ctx.beginPath();
    ctx.arc(x, y, 3 + state.metrics.mid * 7 + state.metrics.attack * 2 + state.metrics.pedal * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawFugueMode(width, height, time) {
  const { pitchHz, pitchConfidence, sustain } = state.metrics;
  if (!pitchHz || pitchConfidence < 0.25) {
    return;
  }

  const pitchMix = clamp((Math.log2(pitchHz / 55)) / 4.5, 0, 1);
  const noteY = mix(height * 0.78, height * 0.2, pitchMix);
  const staffTop = height * 0.2;
  const staffSpacing = Math.max(12, height * 0.022);
  const staffLeft = width * 0.08;
  const staffRight = width * 0.92;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let line = 0; line < 5; line += 1) {
    const y = staffTop + line * staffSpacing;
    ctx.beginPath();
    ctx.moveTo(staffLeft, y);
    ctx.lineTo(staffRight, y + Math.sin(time * 0.0003 + line) * (1.5 + sustain * 2));
    ctx.strokeStyle = rgba(palette.accentB, 0.07 + pitchConfidence * 0.12);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (state.pitchTrail.length > 1) {
    ctx.beginPath();
    state.pitchTrail.forEach((point, index) => {
      const trailX = mix(staffLeft, staffRight, index / Math.max(state.pitchTrail.length - 1, 1));
      const trailPitchMix = clamp((Math.log2(point.frequency / 55)) / 4.5, 0, 1);
      const trailY = mix(height * 0.78, height * 0.2, trailPitchMix);
      if (index === 0) {
        ctx.moveTo(trailX, trailY);
      } else {
        ctx.lineTo(trailX, trailY);
      }
    });
    ctx.strokeStyle = rgba(palette.accentA, 0.16 + pitchConfidence * 0.28);
    ctx.lineWidth = 2 + sustain * 2.2;
    ctx.stroke();
  }

  ctx.fillStyle = rgba(palette.accentC, 0.18 + pitchConfidence * 0.35);
  ctx.shadowBlur = 16 + pitchConfidence * 18;
  ctx.shadowColor = rgba(palette.accentC, 0.7);
  ctx.beginPath();
  ctx.arc(width * 0.5, noteY, 10 + pitchConfidence * 16 + state.metrics.pedal * 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawImpressionismMode(width, height, time) {
  const { pitchHz, pitchConfidence, texture, sustain, pedal, bass, treble } = state.metrics;
  const pitchMix = pitchHz ? clamp((Math.log2(pitchHz / 55)) / 4.5, 0, 1) : 0.5;
  const centerX = mix(width * 0.24, width * 0.76, pitchMix);
  const centerY = mix(height * 0.72, height * 0.25, 1 - pitchMix * 0.7);
  const radius = Math.min(width, height) * (0.16 + texture * 0.18 + pedal * 0.08);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let layer = 0; layer < 6; layer += 1) {
    const layerAngle = time * 0.0002 + layer * 1.12;
    const offsetX = Math.cos(layerAngle) * radius * (0.45 + layer * 0.08);
    const offsetY = Math.sin(layerAngle * 1.17) * radius * (0.28 + layer * 0.07);
    const cloudRadius = radius * (0.7 + layer * 0.18 + sustain * 0.2);
    const gradient = ctx.createRadialGradient(centerX + offsetX, centerY + offsetY, 0, centerX + offsetX, centerY + offsetY, cloudRadius);
    gradient.addColorStop(0, rgba(palette.accentA, 0.14 + texture * 0.12));
    gradient.addColorStop(0.34, rgba(palette.accentB, 0.11 + pitchConfidence * 0.1));
    gradient.addColorStop(0.68, rgba(palette.accentC, 0.08 + treble * 0.08));
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX + offsetX, centerY + offsetY, cloudRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  const washCount = 5 + Math.round(texture * 5);
  for (let index = 0; index < washCount; index += 1) {
    const angle = (index / Math.max(washCount, 1)) * Math.PI * 2 + time * 0.0001;
    const washRadius = radius * (0.6 + (index % 3) * 0.18 + bass * 0.12);
    const x = centerX + Math.cos(angle) * washRadius;
    const y = centerY + Math.sin(angle) * washRadius;
    ctx.fillStyle = rgba(index % 2 === 0 ? palette.accentB : palette.accentA, 0.03 + texture * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, 18 + texture * 38 + pedal * 10, 0, Math.PI * 2);
    ctx.fill();
  }

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
    modeLabel.textContent = state.metrics.mode;
    setStatus(`${state.demo ? 'Demo audio' : 'Listening'} · ${state.metrics.mode}`);

    if (state.metrics.attack > 0.04) {
      const attackBurst = clamp(state.metrics.attack * 6, 0.8, 5.5);
      spawnParticles(Math.max(1, Math.round(attackBurst)), width / 2, height / 2, attackBurst, state.metrics.treble, 1 + state.metrics.pedal * 0.2);
    } else if (state.metrics.sustain > 0.12) {
      const sustainBurst = clamp(state.metrics.sustain * 3, 0.5, 3);
      spawnParticles(1, width / 2, height / 2, sustainBurst, state.metrics.mid, 0.7 + state.metrics.pedal * 0.15);
    }
  } else if (!state.demo) {
    state.metrics.energy *= 0.97;
    state.metrics.previousEnergy *= 0.97;
    state.metrics.attack *= 0.9;
    state.metrics.sustain *= 0.95;
    state.metrics.pedal *= 0.94;
    state.metrics.pitchHz = 0;
    state.metrics.pitchConfidence = 0;
    state.metrics.texture *= 0.95;
    state.metrics.mode = 'Fugue';
    state.metrics.noteName = '--';
    state.metrics.bass *= 0.95;
    state.metrics.mid *= 0.95;
    state.metrics.treble *= 0.95;
    intensityLabel.textContent = `${Math.round(state.metrics.energy * 100)}%`;
    pedalLabel.textContent = `${Math.round(state.metrics.pedal * 100)}%`;
    pitchLabel.textContent = '--';
    modeLabel.textContent = 'Fugue';
    setStatus('Idle');
  }

  drawBackground(width, height, time);
  drawWaveRing(width, height);
  drawParticles(width, height, time);
  if (state.metrics.mode === 'Fugue') {
    drawFugueMode(width, height, time);
  } else {
    drawImpressionismMode(width, height, time);
  }

  state.animationFrame = requestAnimationFrame(render);
}

async function startMic() {
  if (state.active) {
    return;
  }

  state.demo = false;
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
  state.analyser.connect(state.audioContext.destination);

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

window.addEventListener('resize', resizeCanvas);

updateSensitivity(sensitivitySlider.value);
resizeCanvas();
setStatus('Idle');
render(performance.now());