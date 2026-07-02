// ============================================================================
//  Wing BEat — Browser App
//
//  Connects to MQTT broker over WebSockets, renders animated SVG feather
//  line-art driven by per-node sensor data, and plays a layered Tone.js
//  soundscape per cultural scene. Sends LED commands back to the nodes so
//  the physical feathers mirror what the soundscape does.
//
//  Tech:
//    - mqtt.js  (CDN)
//    - Tone.js  (CDN)
//    - vanilla JS, no build step
// ============================================================================

// ---------- Config ----------------------------------------------------------
const MQTT_URL = `ws://${location.hostname || 'localhost'}:9001`;
const MQTT_OPTIONS = {
  clientId: 'wingbeat-ui-' + Math.random().toString(16).slice(2, 8),
  reconnectPeriod: 2000,
  clean: true,
};

// Persisted UI prefs
const prefs = {
  scene: localStorage.getItem('wb_scene') || 'phoenix_anatolia',
  masterGain: parseFloat(localStorage.getItem('wb_master') ?? '0.7'),
  windSens: parseFloat(localStorage.getItem('wb_windsens') ?? '1.0'),
};

// ---------- Scene definitions ----------------------------------------------
// Each scene defines a Tone.js layer set + a default LED palette. The names
// match the cultural feather packs from the project brief.
const SCENES = {
  phoenix_anatolia: {
    label: 'Phoenix · Anatolia',
    led:   { r:200, g:120, b:60 },
    bedNotes:  ['A2','E3','C4','G3'],
    melodyScale: ['A3','B3','C4','D4','E4','F4','G4','A4'], // A natural minor
    melodyTempo: '6n',
    percRate: '4n',
  },
  crane_ghana: {
    label: 'Crowned Crane · Ghana',
    led:   { r:60, g:200, b:130 },
    bedNotes:  ['D2','A2','D3','F3'],
    melodyScale: ['D3','F3','G3','A3','C4','D4','F4','G4'], // D minor pentatonic-ish
    melodyTempo: '8n',
    percRate: '8n',
  },
  peacock_india: {
    label: 'Peacock · India',
    led:   { r:80, g:180, b:240 },
    bedNotes:  ['D2','D3','F3','A3'],
    melodyScale: ['D3','Eb3','F3','G3','A3','Bb3','C4','D4'], // raga-ish
    melodyTempo: '6n',
    percRate: '4n',
  },
  condor_andes: {
    label: 'Condor · Andes',
    led:   { r:240, g:200, b:120 },
    bedNotes:  ['G2','D3','G3','B3'],
    melodyScale: ['G3','A3','B3','D4','E4','G4','A4','B4'], // G major pentatonic
    melodyTempo: '4n',
    percRate: '4n',
  },
  eagle_plains: {
    label: 'Eagle · Plains',
    led:   { r:220, g:80, b:80 },
    bedNotes:  ['E2','B2','E3','G3'],
    melodyScale: ['E3','G3','A3','B3','D4','E4','G4','A4'], // E minor pentatonic
    melodyTempo: '4n',
    percRate: '2n',
  },
};

let currentScene = SCENES[prefs.scene] ? prefs.scene : 'phoenix_anatolia';

// ---------- Audio engine (Tone.js) -----------------------------------------
// Layers:
//   - bed:     slow detuned drone, pad-like
//   - wind:    filtered noise driven by wind value
//   - melody:  pluck triggered when wind crests a threshold
//   - perc:    membrane synth triggered when motion spikes
//   - accent:  bell triggered on presence onset

const audio = {
  ready: false,
  master: null,
  reverb: null,
  bed: null,
  bedLfo: null,
  noise: null,
  noiseFilter: null,
  noiseGain: null,
  pluck: null,
  perc: null,
  bell: null,
};

async function initAudio() {
  if (audio.ready) return;
  await Tone.start();

  // Master bus → reverb → out
  audio.reverb = new Tone.Reverb({ decay: 6, wet: 0.35 }).toDestination();
  await audio.reverb.generate();
  audio.master = new Tone.Gain(prefs.masterGain).connect(audio.reverb);

  // Bed: slow polysynth pad
  audio.bed = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope:   { attack: 4, decay: 1, sustain: 0.9, release: 6 },
    volume: -14,
  }).connect(audio.master);
  audio.bedLfo = new Tone.LFO('0.05hz', -18, -10).connect(audio.bed.volume);
  audio.bedLfo.start();

  // Wind: filtered pink noise
  audio.noise = new Tone.Noise('pink').start();
  audio.noiseFilter = new Tone.Filter(400, 'bandpass', -24);
  audio.noiseGain = new Tone.Gain(0).connect(audio.master);
  audio.noise.chain(audio.noiseFilter, audio.noiseGain);

  // Melody: gentle pluck
  audio.pluck = new Tone.PluckSynth({
    attackNoise: 0.7, dampening: 3500, resonance: 0.85,
    volume: -8,
  }).connect(audio.master);

  // Perc: low membrane
  audio.perc = new Tone.MembraneSynth({
    pitchDecay: 0.06, octaves: 6,
    envelope: { attack: 0.001, decay: 0.5, sustain: 0 },
    volume: -10,
  }).connect(audio.master);

  // Accent: metallic bell
  audio.bell = new Tone.MetalSynth({
    frequency: 240,
    envelope: { attack: 0.001, decay: 1.4, release: 0.6 },
    harmonicity: 5.1, modulationIndex: 32,
    resonance: 4000, octaves: 1.5,
    volume: -22,
  }).connect(audio.master);

  // Start the bed — held chord, fades up
  startBed();
  audio.ready = true;
  document.getElementById('btnStart').textContent = '♪ live';
  document.getElementById('btnStart').disabled = true;
}

function startBed() {
  const scene = SCENES[currentScene];
  // hold the chord; releaseAll → triggerAttack handles scene swaps
  audio.bed.releaseAll();
  audio.bed.triggerAttack(scene.bedNotes);
}

function setMasterGain(g) {
  prefs.masterGain = g;
  localStorage.setItem('wb_master', String(g));
  if (audio.master) audio.master.gain.rampTo(g, 0.3);
}

// ---------- Sensor → audio mapping -----------------------------------------
const nodeRuntime = {};   // nodeId → { wind, motion, present, lastMelodyMs, lastPercMs, lastBellMs, hue }

function ensureRuntime(id) {
  if (!nodeRuntime[id]) {
    nodeRuntime[id] = {
      wind: 0, motion: 0, present: false,
      lastMelodyMs: 0, lastPercMs: 0, lastBellMs: 0,
      hue: Math.floor(Math.random() * 360),
      lastSeen: Date.now(),
      online: false,
    };
  }
  return nodeRuntime[id];
}

function onSensorWind(id, v) {
  const r = ensureRuntime(id);
  r.wind = Math.max(0, Math.min(1, v * prefs.windSens));
  r.lastSeen = Date.now();

  if (!audio.ready) return;

  // Drive noise gain across all wind values across all nodes (max wind wins)
  const maxWind = Math.max(...Object.values(nodeRuntime).map(n => n.wind));
  audio.noiseGain.gain.rampTo(maxWind * 0.18, 0.1);
  audio.noiseFilter.frequency.rampTo(300 + maxWind * 1800, 0.2);

  // Trigger melody on wind crest (threshold + cooldown)
  const now = Date.now();
  if (r.wind > 0.55 && now - r.lastMelodyMs > 800) {
    r.lastMelodyMs = now;
    const scene = SCENES[currentScene];
    const note = scene.melodyScale[Math.floor(Math.random() * scene.melodyScale.length)];
    audio.pluck.triggerAttackRelease(note, '2n', undefined, 0.4 + r.wind * 0.6);
    flashLed(id, 1.0);
  }
}

function onSensorMotion(id, mag) {
  const r = ensureRuntime(id);
  r.motion = Math.max(0, Math.min(1.5, mag));
  r.lastSeen = Date.now();
  if (!audio.ready) return;

  const now = Date.now();
  if (r.motion > 0.6 && now - r.lastPercMs > 250) {
    r.lastPercMs = now;
    const pitches = ['C2','D2','E2','G2','A2'];
    audio.perc.triggerAttackRelease(
        pitches[Math.floor(Math.random() * pitches.length)],
        '8n', undefined, 0.5 + Math.min(0.5, r.motion * 0.5));
  }
}

function onSensorPresence(id, present) {
  const r = ensureRuntime(id);
  r.present = !!present;
  r.lastSeen = Date.now();
  if (!audio.ready) return;
  const now = Date.now();
  if (present && now - r.lastBellMs > 1500) {
    r.lastBellMs = now;
    audio.bell.triggerAttackRelease('A5', '2n', undefined, 0.5);
    // also paint the LED with the scene tint
    const scene = SCENES[currentScene];
    publishLed(id, { mode: 'shimmer', ...scene.led, intensity: 0.6 });
  }
  if (!present) {
    publishLed(id, { mode: 'pulse', r: 30, g: 30, b: 50, intensity: 0.3 });
  }
}

// ---------- LED publishing back to nodes -----------------------------------
function publishLed(nodeId, payload) {
  if (!mqttClient || !mqttClient.connected) return;
  const topic = `wingbeat/node/${nodeId}/cmd/led`;
  mqttClient.publish(topic, JSON.stringify(payload), { qos: 1, retain: false });
}

function flashLed(nodeId, intensity) {
  const scene = SCENES[currentScene];
  publishLed(nodeId, { mode: 'wind', ...scene.led, intensity });
  setTimeout(() => {
    publishLed(nodeId, { mode: 'shimmer', ...scene.led, intensity: 0.4 });
  }, 300);
}

// ---------- SVG feather rendering ------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';
const featherEls = {};   // nodeId → { group, stem, barbsLeft, barbsRight, label }
let layoutDirty = true;

function buildFeatherSvg(nodeId, idx, total) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'feather');
  g.dataset.nodeId = nodeId;

  // Stem path — gets transformed by wind value
  const stem = document.createElementNS(SVG_NS, 'path');
  stem.setAttribute('class', 'feather-stem');
  stem.setAttribute('fill', 'none');
  stem.setAttribute('stroke', '#d4a85a');
  stem.setAttribute('stroke-width', '1.6');
  stem.setAttribute('opacity', '0.75');
  g.appendChild(stem);

  // Barbs — small lines branching off the stem, left and right
  const barbsLeft  = [];
  const barbsRight = [];
  const N_BARBS = 28;
  for (let i = 0; i < N_BARBS; i++) {
    const bl = document.createElementNS(SVG_NS, 'line');
    const br = document.createElementNS(SVG_NS, 'line');
    bl.setAttribute('class', 'feather-barb');
    br.setAttribute('class', 'feather-barb');
    bl.setAttribute('stroke', '#d4a85a');
    br.setAttribute('stroke', '#d4a85a');
    bl.setAttribute('stroke-width', '1');
    br.setAttribute('stroke-width', '1');
    bl.setAttribute('opacity', '0.55');
    br.setAttribute('opacity', '0.55');
    g.appendChild(bl); g.appendChild(br);
    barbsLeft.push(bl); barbsRight.push(br);
  }

  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('class', 'feather-label');
  label.setAttribute('text-anchor', 'middle');
  label.textContent = nodeId;
  g.appendChild(label);

  document.getElementById('feathers').appendChild(g);
  featherEls[nodeId] = { g, stem, barbsLeft, barbsRight, label, idx };
  return featherEls[nodeId];
}

function removeFeatherSvg(nodeId) {
  const f = featherEls[nodeId];
  if (f && f.g.parentNode) f.g.parentNode.removeChild(f.g);
  delete featherEls[nodeId];
}

function layoutFeathers() {
  const ids = Object.keys(featherEls);
  const total = ids.length;
  if (total === 0) return;
  const cx = 800, cy = 480;
  const ringR = total === 1 ? 0 : 280;
  ids.forEach((id, i) => {
    const f = featherEls[id];
    f.idx = i;
    const angle = (i / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
    f.cx = cx + Math.cos(angle) * ringR;
    f.cy = cy + Math.sin(angle) * ringR;
    f.angleDeg = angle * 180 / Math.PI + 90; // feather points outward
  });
  layoutDirty = false;
}

// Build a curved path that bends with `bend` (-1..1) and `windPhase`
function stemPath(cx, cy, length, angleDeg, bend, windPhase) {
  // local coords: stem grows along +Y in the feather's local frame, then we
  // rotate to angleDeg around (cx,cy).
  const tip = { x: 0, y: -length };
  // control point pulled sideways by bend + small breathing wave
  const c1 = { x: bend * 30, y: -length * 0.4 };
  const c2 = { x: bend * 60 + Math.sin(windPhase) * 10, y: -length * 0.75 };

  // rotate
  const rad = angleDeg * Math.PI / 180;
  const rot = (p) => ({
    x: cx + p.x * Math.cos(rad) - p.y * Math.sin(rad),
    y: cy + p.x * Math.sin(rad) + p.y * Math.cos(rad),
  });
  const p0 = { x: cx, y: cy };
  const pTip = rot(tip);
  const pc1  = rot(c1);
  const pc2  = rot(c2);
  return {
    d: `M ${p0.x} ${p0.y} C ${pc1.x} ${pc1.y}, ${pc2.x} ${pc2.y}, ${pTip.x} ${pTip.y}`,
    p0, pTip, rot,
  };
}

function renderFeathers(now) {
  if (layoutDirty) layoutFeathers();

  for (const id of Object.keys(featherEls)) {
    const f = featherEls[id];
    const r = nodeRuntime[id] || { wind: 0, motion: 0, present: false };
    const length = 220 + (r.present ? 30 : 0);
    const bend = (r.wind - 0.0) * 1.0 * (f.idx % 2 ? 1 : -1);
    const windPhase = now * 0.001 + f.idx * 0.7;
    const path = stemPath(f.cx, f.cy, length, f.angleDeg + Math.sin(windPhase) * (5 + 25 * r.wind),
                          bend, windPhase);
    f.stem.setAttribute('d', path.d);

    // color tint by current scene + wind
    const scene = SCENES[currentScene];
    const baseHue = (scene.led.r << 16) | (scene.led.g << 8) | scene.led.b;
    const stemColor = mixColor(scene.led, { r: 80, g: 80, b: 120 }, 1 - Math.min(1, r.wind + (r.present ? 0.2 : 0)));
    f.stem.setAttribute('stroke', rgbStr(stemColor));
    f.stem.setAttribute('opacity', String(0.55 + 0.4 * (r.present ? 1 : 0.4) + r.wind * 0.2));

    // Barbs: sample along the stem and draw small branches perpendicular
    const N = f.barbsLeft.length;
    for (let i = 0; i < N; i++) {
      const t = (i + 1) / (N + 1);                // 0..1 along stem
      const localY = -length * t;
      const breathing = Math.sin(now * 0.003 + i * 0.4 + f.idx) * 2;
      const barbLen = (28 + breathing + r.wind * 12) * (1 - t * 0.4);
      // Each barb is a line at a slight angle to the stem
      const angleSlant = -25 - (r.wind * 15) - Math.sin(now * 0.004 + i) * 2;
      const angleRad = angleSlant * Math.PI / 180;

      // local point
      const baseLocal = { x: bend * 30 * t, y: localY };
      // local barb direction (left side — flipped on right)
      const dxL =  Math.cos(angleRad);
      const dyL =  Math.sin(angleRad);

      // rotate from local to world
      const rad = (f.angleDeg + Math.sin(windPhase) * (5 + 25 * r.wind)) * Math.PI / 180;
      const sin = Math.sin(rad), cos = Math.cos(rad);
      const rot = (p) => ({
        x: f.cx + p.x * cos - p.y * sin,
        y: f.cy + p.x * sin + p.y * cos,
      });

      // motion shake — random tiny jitter when motion is high
      const shake = r.motion * 4;
      const jx = (Math.random() - 0.5) * shake;
      const jy = (Math.random() - 0.5) * shake;

      const baseWorld = rot(baseLocal);
      const tipL_local = { x: baseLocal.x - barbLen * dxL, y: baseLocal.y + barbLen * dyL };
      const tipR_local = { x: baseLocal.x + barbLen * dxL, y: baseLocal.y + barbLen * dyL };
      const tipL = rot(tipL_local);
      const tipR = rot(tipR_local);

      f.barbsLeft[i].setAttribute('x1', baseWorld.x + jx);
      f.barbsLeft[i].setAttribute('y1', baseWorld.y + jy);
      f.barbsLeft[i].setAttribute('x2', tipL.x + jx);
      f.barbsLeft[i].setAttribute('y2', tipL.y + jy);
      f.barbsLeft[i].setAttribute('stroke', rgbStr(stemColor));
      f.barbsLeft[i].setAttribute('opacity', String(0.25 + 0.45 * (1 - t) + r.wind * 0.3));

      f.barbsRight[i].setAttribute('x1', baseWorld.x + jx);
      f.barbsRight[i].setAttribute('y1', baseWorld.y + jy);
      f.barbsRight[i].setAttribute('x2', tipR.x + jx);
      f.barbsRight[i].setAttribute('y2', tipR.y + jy);
      f.barbsRight[i].setAttribute('stroke', rgbStr(stemColor));
      f.barbsRight[i].setAttribute('opacity', String(0.25 + 0.45 * (1 - t) + r.wind * 0.3));
    }

    // Label position — at base of feather, offset outward
    const labelOffset = 22;
    const rad = f.angleDeg * Math.PI / 180;
    f.label.setAttribute('x', f.cx - Math.sin(rad) * labelOffset);
    f.label.setAttribute('y', f.cy + Math.cos(rad) * labelOffset);
  }
}

function mixColor(a, b, t) {
  return {
    r: Math.round(a.r * (1 - t) + b.r * t),
    g: Math.round(a.g * (1 - t) + b.g * t),
    b: Math.round(a.b * (1 - t) + b.b * t),
  };
}
function rgbStr(c) { return `rgb(${c.r},${c.g},${c.b})`; }

// Animation loop
function tick() {
  renderFeathers(performance.now());
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- MQTT -----------------------------------------------------------
let mqttClient = null;

function connectMqtt() {
  const brokerStatus = document.getElementById('brokerStatus');
  brokerStatus.textContent = 'connecting…';
  document.querySelector('.brand').classList.remove('connected');

  mqttClient = mqtt.connect(MQTT_URL, MQTT_OPTIONS);

  mqttClient.on('connect', () => {
    brokerStatus.textContent = MQTT_URL;
    document.querySelector('.brand').classList.add('connected');
    mqttClient.subscribe('wingbeat/node/+/sensor/+', { qos: 0 });
    mqttClient.subscribe('wingbeat/node/+/status',    { qos: 1 });
    // Publish current scene as retained so late joiners pick it up
    mqttClient.publish('wingbeat/global/scene',
      JSON.stringify({ scene: currentScene, fade_ms: 2000 }),
      { qos: 1, retain: true });
  });

  mqttClient.on('reconnect', () => {
    brokerStatus.textContent = 'reconnecting…';
    document.querySelector('.brand').classList.remove('connected');
  });

  mqttClient.on('close', () => {
    brokerStatus.textContent = 'broker offline';
    document.querySelector('.brand').classList.remove('connected');
  });

  mqttClient.on('message', (topic, msg) => {
    const parts = topic.split('/');
    // wingbeat / node / <id> / status
    // wingbeat / node / <id> / sensor / <kind>
    if (parts[0] !== 'wingbeat' || parts[1] !== 'node') return;
    const id = parts[2];
    const kind = parts[3];

    let payload;
    try { payload = JSON.parse(msg.toString()); } catch { return; }

    if (kind === 'status') {
      const r = ensureRuntime(id);
      r.online = !!payload.online;
      r.role = payload.role;
      r.rssi = payload.rssi;
      r.fw = payload.fw;
      // ensure feather exists in SVG (only for feather role and audio role too)
      if (!featherEls[id] && payload.online) {
        buildFeatherSvg(id, Object.keys(featherEls).length, 0);
        layoutDirty = true;
      } else if (featherEls[id] && !payload.online) {
        // keep it on screen but dim — don't remove
      }
      renderNodeList();
    } else if (kind === 'sensor') {
      const sub = parts[4];
      ensureRuntime(id);
      if (!featherEls[id]) { buildFeatherSvg(id, Object.keys(featherEls).length, 0); layoutDirty = true; }
      if (sub === 'wind')     onSensorWind(id, payload.v ?? 0);
      else if (sub === 'motion')   onSensorMotion(id, payload.mag ?? 0);
      else if (sub === 'presence') onSensorPresence(id, payload.present);
    }
  });
}

function publishGlobalScene(name) {
  if (!mqttClient || !mqttClient.connected) return;
  mqttClient.publish('wingbeat/global/scene',
    JSON.stringify({ scene: name, fade_ms: 2500 }),
    { qos: 1, retain: true });
}

function publishGlobalCmd(action) {
  if (!mqttClient || !mqttClient.connected) return;
  mqttClient.publish('wingbeat/global/cmd/all',
    JSON.stringify({ action }),
    { qos: 1, retain: false });
}

// ---------- Scene UI -------------------------------------------------------
function renderSceneBar() {
  const bar = document.getElementById('sceneBar');
  bar.innerHTML = '';
  for (const [key, scene] of Object.entries(SCENES)) {
    const b = document.createElement('button');
    b.textContent = scene.label;
    if (key === currentScene) b.classList.add('active');
    b.onclick = () => switchScene(key);
    bar.appendChild(b);
  }
}

function switchScene(key) {
  if (!SCENES[key]) return;
  currentScene = key;
  prefs.scene = key;
  localStorage.setItem('wb_scene', key);
  renderSceneBar();
  publishGlobalScene(key);
  if (audio.ready) startBed();   // re-pad with new chord
  // tint all feather LEDs
  const scene = SCENES[key];
  for (const id of Object.keys(featherEls)) {
    publishLed(id, { mode: 'shimmer', ...scene.led, intensity: 0.5 });
  }
}

// ---------- Operator panel -------------------------------------------------
function renderNodeList() {
  const el = document.getElementById('nodeList');
  const ids = Object.keys(nodeRuntime);
  if (ids.length === 0) { el.textContent = '— waiting for nodes —'; return; }
  el.innerHTML = '';
  for (const id of ids.sort()) {
    const r = nodeRuntime[id];
    const row = document.createElement('div');
    row.className = 'node-row';
    row.innerHTML = `
      <span class="${r.online ? 'alive' : 'dead'}"></span>
      <span class="id">${id}</span>
      <span class="meta">${r.role || '?'} · rssi ${r.rssi ?? '—'} · w ${(r.wind||0).toFixed(2)}</span>
    `;
    el.appendChild(row);
  }
}
setInterval(renderNodeList, 1000);

document.getElementById('btnPanel').onclick = () => {
  document.getElementById('panel').classList.toggle('hidden');
};
document.getElementById('btnStart').onclick = () => initAudio();
document.getElementById('masterGain').value = prefs.masterGain;
document.getElementById('masterGain').oninput = e => setMasterGain(parseFloat(e.target.value));
document.getElementById('windSens').value = prefs.windSens;
document.getElementById('windSens').oninput = e => {
  prefs.windSens = parseFloat(e.target.value);
  localStorage.setItem('wb_windsens', String(prefs.windSens));
};

document.querySelectorAll('.panel button[data-cmd]').forEach(b => {
  b.onclick = () => publishGlobalCmd(b.dataset.cmd);
});

// ---------- Test / demo --------------------------------------------------
let fakeIdx = 0;
document.getElementById('btnFakeNode').onclick = () => {
  fakeIdx++;
  const id = `demo_${String(fakeIdx).padStart(2,'0')}`;
  ensureRuntime(id);
  nodeRuntime[id].online = true;
  nodeRuntime[id].role = 'feather';
  if (!featherEls[id]) {
    buildFeatherSvg(id, Object.keys(featherEls).length, 0);
    layoutDirty = true;
  }
  // periodically inject sensor events
  setInterval(() => {
    onSensorWind(id, Math.random() * Math.random()); // mostly low, occasional gust
  }, 100);
  setInterval(() => {
    onSensorMotion(id, Math.random() < 0.1 ? Math.random() * 1.2 : Math.random() * 0.2);
  }, 200);
  setInterval(() => {
    onSensorPresence(id, Math.random() < 0.5);
  }, 4000);
  renderNodeList();
};

// ---------- Boot ----------------------------------------------------------
renderSceneBar();
connectMqtt();
