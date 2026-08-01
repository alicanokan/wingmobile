// ============================================================================
//  /feather2 — the anatomy engine.
//
//  Where the main projection treats a feather photo as one particle cloud with
//  color layers, this page recovers the feather's SKELETON (see anatomy.ts)
//  and animates each anatomical layer on its own audio feature:
//
//    rachis + calamus   ← SUB       cantilever flex; the whole blade rides it
//    markings           ← KICK      each marking pulses as a shape, in order
//                                   up the feather when the tempo is locked
//    vane               ← BASS      wave travelling along the real barb lines
//    fringe             ← SNARE/HAT the outer barbs flick and briefly unzip
//    barbs              ← AIR       fine ring along each barb's own length
//    colour groups      ← PITCH     the dominant note picks the hue
//    depth              ← LAYERS    parts separate in z and the cloud turns,
//                                   so the anatomy reads as stacked layers
//
//  Audio in: drop a music file (played out loud) or use the mic. Rendered as
//  a point cloud in a single draw call; every particle knows its part, so all
//  motion lives in the vertex shader.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import '../sim/ui.css';
import './feather2.css';
import * as THREE from 'three';
import { FEATHERS } from '../sim/feathers.ts';
import { analyzeAnatomy, loadImage, type Anatomy, PART } from './anatomy.ts';
import { AudioFeed, type AudioFeatures } from './audio2.ts';

// scan + response settings survive reloads, so a tuned analysis is kept
const SENS_KEY = 'f2.sensitivity';
const AMPS_KEY = 'f2.amps';

function loadSens(): number {
  const raw = localStorage.getItem(SENS_KEY);
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

type Amps = {
  eye: number;
  color: number;
  wave: number;
  shimmer: number;
  flex: number;
  fringe: number;
  depth: number;
};
function loadAmps(): Amps {
  const amps: Amps = { eye: 1, color: 1, wave: 1, shimmer: 1, flex: 1, fringe: 1, depth: 0.6 };
  try {
    const saved = JSON.parse(localStorage.getItem(AMPS_KEY) ?? '{}') as Partial<Amps>;
    for (const k of Object.keys(amps) as (keyof Amps)[]) {
      const v = Number(saved[k]);
      if (Number.isFinite(v)) amps[k] = Math.max(0, Math.min(2, v));
    }
  } catch { /* fresh defaults */ }
  return amps;
}

type Dbg = 0 | 1 | 2 | 3;

const PART_NAMES: Record<number, string> = {
  [PART.calamus]: 'Calamus',
  [PART.rachis]: 'Rachis',
  [PART.barbs]: 'Pennaceous',
  [PART.down]: 'Plumulaceous',
  [PART.eye]: 'Ocellus',
};

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute vec2 aUV;       // u -1..1 across, v 0..1 along
  attribute float aPart;    // 0 calamus · 1 rachis · 2 barbs · 3 down · 4 eye
  attribute float aDowny;   // 0 firm pennaceous … 1 loose plumulaceous
  attribute vec2 aBarb;     // unit barb tangent (outward from shaft, toward tip)
  attribute vec4 aSurf;     // core, loose, flow, spine — all measured per point
  attribute vec4 aPatA;     // zone centre xy, phase, kind (0 none · 1 round · 2 stripe)
  attribute vec4 aPatB;     // zone axis xy, along -1..1, across 0..1.6
  attribute vec2 aPatC;     // marking strength 0..1, marking order base→tip 0..1

  uniform float uTime;
  uniform float uBeat;      // 0..1 pulse
  uniform float uMelody;
  uniform float uWave;
  uniform float uShimmer;
  uniform float uSub;
  uniform float uKick;
  uniform float uSnare;
  uniform float uHat;
  uniform float uPhase;     // 0..1 within the beat, from the tempo tracker
  uniform float uLock;      // how much to trust that phase
  uniform float uIdle;      // 1 when nothing is playing
  uniform float uAmpEye;
  uniform float uAmpWave;
  uniform float uAmpShimmer;
  uniform float uAmpFlex;
  uniform float uAmpFringe;
  uniform float uAmpDepth;
  uniform float uPointScale;

  varying vec3 vColor;
  varying float vPart;
  varying float vGlow;
  varying float vRim;
  varying float vLoose;
  varying float vFlow;
  varying float vSpine;
  varying vec2 vPatDbg;   // x = kind, y = phase

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 P = vec3(position.xy, 0.0);
    float part = aPart;
    float core  = aSurf.x;   // 1 deep inside the vane
    float loose = aSurf.y;   // 1 open fluff
    float flow  = aSurf.z;   // 1 barb direction read off the photo
    float spine = aSurf.w;   // 1 on the shaft
    float rim = 1.0 - core;
    float seed = hash(position.xy * 91.0);
    float glow = 0.0;

    // a feather is never still: with no audio it breathes on its own, and the
    // music takes the wheel the moment it arrives
    float alive = 1.0 - uIdle * 0.7;

    // ---- 1. SPINE — the rachis is a CANTILEVER hinged at the calamus, and
    // everything else hangs off it. Bending the shaft and letting the whole
    // blade ride along is what makes this one body instead of four effects.
    float s = clamp((position.y + 1.0) * 0.5, 0.0, 1.0);
    float cant = s * s * (0.55 + 0.45 * s);
    float drive = uSub * 0.55 + uWave * 0.45;
    float swing = sin(uTime * 0.62 + uPhase * 6.2831 * 0.5);
    float flex = (0.010 + 0.10 * drive * uAmpFlex) * swing * (0.30 + 0.70 * alive);
    flex += uKick * uAmpFlex * 0.05 * sin(uTime * 26.0);   // the kick whips it
    P.x += flex * cant;
    P.y -= abs(flex) * cant * 0.22;   // a bent shaft is shorter along its axis

    // ---- 2. VANE — the bass wave travels along the REAL barb direction, and
    // is scaled by two measured fields instead of one guessed band: how loose
    // the strands are here, and how close to the fringe they sit.
    if (part != 0.0 && part != 1.0) {
      float travel = aUV.y * 7.0 - uTime * 2.1 - uPhase * 6.2831;
      float wv = sin(travel + aUV.x * 1.5);
      float amp = uWave * uAmpWave * abs(aUV.x)
                * (0.008 + 0.070 * loose)
                * (0.30 + 0.90 * rim);
      P.xy += aBarb * wv * amp;
      P.y += cos(aUV.y * 6.0 + uTime * 1.8) * amp * 0.28 * loose;
      // idle breathing, so a silent feather still lives
      P.xy += aBarb * sin(aUV.y * 3.0 + uTime * 0.8) * uIdle * 0.006 * (0.2 + loose) * abs(aUV.x);
      glow += uWave * 0.18 * loose;
    }

    // ---- 3. FRINGE — snare and hat flick the OUTER barbs and briefly unzip
    // them, sliding neighbours apart along their own length. Only the rim can
    // do this; the core of the vane is a sheet and stays a sheet.
    vec2 nrm = vec2(-aBarb.y, aBarb.x);
    float trans = (uSnare * 0.7 + uHat * 0.5) * uAmpFringe;
    float fringe = rim * rim * (0.25 + 0.75 * loose) * (1.0 - spine);
    P.xy += aBarb * trans * fringe * (0.012 + 0.045 * seed);
    P.xy += nrm * trans * fringe * 0.028 * (seed - 0.5);
    glow += trans * fringe * 0.9;

    // ---- 4. SHIMMER — the top end rings the FIRM barbs along their length.
    // Trusted only where the striations were actually legible (flow), so a
    // blurred photo shimmers gently instead of buzzing in random directions.
    float jit = seed - 0.5;
    float ring = uShimmer * uAmpShimmer * (0.004 + 0.014 * (1.0 - loose)) * (0.35 + 0.65 * flow);
    P.xy += aBarb * jit * ring * (1.0 - spine);
    glow += uShimmer * 0.24 * abs(jit) * 2.0 * (1.0 - loose);

    // ---- 5. MARKINGS — the beat moves the MARKINGS THEMSELVES, not rings
    // drawn over them. A spot swells about its own centre keeping its outline;
    // a bar stretches along its length and shoves across it. With a tempo lock
    // the kick becomes a wave of permission sweeping base → tip, so a barred
    // feather plays its bars in order rather than thumping in lockstep, and
    // bolder markings answer harder than faint ones.
    float kind = aPatA.w;
    if (kind > 0.5) {
      float phase = aPatA.z * 6.2831;
      float acr = aPatB.w;
      float str = aPatC.x;
      float sweep = fract(uPhase - aPatC.y * 0.75);
      float gate = 0.45 + 0.85 * (1.0 - smoothstep(0.0, 0.30, sweep)) * uLock;
      float kick = (uBeat * 0.75 + uKick * 0.45) * uAmpEye * (0.40 + 0.90 * str) * gate;

      if (kind < 1.5) {
        vec2 fromC = P.xy - aPatA.xy;
        P.xy += fromC * kick * 0.30 * (1.0 - smoothstep(1.0, 1.6, acr));
      } else {
        vec2 axis = normalize(aPatB.xy + vec2(1e-5));
        vec2 an = vec2(-axis.y, axis.x);
        float falloff = 1.0 - smoothstep(0.1, 1.5, acr);
        P.xy += axis * aPatB.z * kick * 0.045 * falloff;
        P.xy += an * kick * 0.026 * cos(phase * 3.0) * falloff;
      }
      glow += (uBeat * 0.6 + uKick * 0.4) * (1.0 - smoothstep(0.1, 1.5, acr))
            * (part == 4.0 ? 1.1 : 0.7) * (0.4 + 0.8 * str);
    }

    // ---- 6. DEPTH — the anatomical layers pull APART in z: the shaft stands
    // proud, the markings float above the vane, the down hangs behind it. The
    // cloud turns slowly (see the render loop) so that reads as parallax and
    // not merely as scale, and every hit pushes the layers further apart.
    float layer = part == 0.0 ? -0.15 : part == 1.0 ? 0.25 : part == 3.0 ? -0.60 : 0.0;
    layer += rim * 0.22 - loose * 0.35;
    if (kind > 0.5) layer += 0.45 + 0.35 * aPatC.x;
    float spread = 0.55 + 0.45 * (uBeat * 0.6 + uSnare * 0.4);
    P.z = layer * 0.30 * uAmpDepth * spread;

    vColor = aColor;
    vPart = part;
    vGlow = glow;
    vRim = rim;
    vLoose = loose;
    vFlow = flow;
    vSpine = spine;
    vPatDbg = vec2(aPatA.w, aPatA.z);
    vec4 mv = modelViewMatrix * vec4(P, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = uPointScale * (1.0 + glow * 0.6) * (0.82 + 0.30 * core);
    if (part == 4.0) size *= 1.15;
    gl_PointSize = size / max(0.6, -mv.z);
  }
`;

const FRAG_REAL = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vPart;
  varying float vGlow;
  varying float vRim;
  varying float vLoose;
  varying float vFlow;
  varying float vSpine;
  varying float vHuePhase;
  varying vec2 vPatDbg;

  uniform float uMelody;
  uniform float uHue;
  uniform float uBright;
  uniform float uAmpColor;
  uniform float uDebugParts;

  // hue rotation in YIQ — cheap and stable
  vec3 hueShift(vec3 c, float a) {
    const vec3 W = vec3(0.299, 0.587, 0.114);
    float Y = dot(c, W);
    vec3 d = c - Y;
    float cs = cos(a), sn = sin(a);
    return vec3(Y) + vec3(
      d.r * cs - d.g * sn * 0.6,
      d.g * cs + d.r * sn * 0.6,
      d.b * cs + (d.r - d.g) * sn * 0.25
    );
  }

  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.18, r);

    vec3 col = vColor;
    // MELODY — rotate each pattern group's hue by its own phase, so the
    // patterns of the feather trade colors instead of tinting uniformly. The
    // angle now follows the dominant PITCH, so the feather changes colour on
    // the note rather than on mid-band loudness.
    float shift = uHue * (0.4 + vHuePhase);
    col = mix(col, hueShift(col, shift), clamp(uMelody * uAmpColor, 0.0, 1.0));
    // brightness of the mix lifts the fringe first — the rim is where a real
    // feather catches the light
    col *= 1.0 + vGlow * 0.8 + uBright * vRim * 0.30 * clamp(uAmpColor, 0.0, 1.0);

    if (uDebugParts > 2.5) {
      // surface view: what the engine actually measured, per particle
      col = vec3(vLoose, vFlow, vSpine) * (0.30 + 0.70 * (1.0 - vRim));
    } else if (uDebugParts > 1.5) {
      // pattern view: each marking its own hue, plain vane stays dim
      if (vPatDbg.x < 0.5) {
        col = vec3(0.10, 0.11, 0.14);
      } else {
        float hh = fract(vPatDbg.y * 3.0);
        vec3 zc = 0.5 + 0.5 * cos(6.2831 * (hh + vec3(0.0, 0.33, 0.67)));
        col = mix(zc, vec3(1.0), vPatDbg.x > 1.5 ? 0.0 : 0.35);
      }
    } else if (uDebugParts > 0.5) {
      vec3 tint =
        vPart == 0.0 ? vec3(0.55, 0.45, 0.3) :
        vPart == 1.0 ? vec3(0.95, 0.85, 0.5) :
        vPart == 2.0 ? vec3(0.35, 0.55, 0.95) :
        vPart == 3.0 ? vec3(0.35, 0.9, 0.55) :
                       vec3(0.95, 0.4, 0.75);
      col = mix(col * 0.35, tint, 0.75);
    }

    gl_FragColor = vec4(col, soft * 0.92);
  }
`;

const VERT_HUE = VERT.replace(
  'varying float vGlow;',
  'varying float vGlow;\n  varying float vHuePhase;\n  attribute float aCluster;',
).replace('vColor = aColor;', 'vColor = aColor;\n    vHuePhase = fract(aCluster * 0.618);');

export default function Feather2() {
  const [anatomy, setAnatomy] = useState<Anatomy | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [debugMode, setDebugMode] = useState<Dbg>(0); // off · anatomy · patterns · surface
  const [audioTick, setAudioTick] = useState(0); // rerender for audio buttons
  const feed = useMemo(() => new AudioFeed(), []);
  useEffect(() => () => feed.dispose(), [feed]);

  const amps = useRef<Amps>(loadAmps());
  const [, setAmpTick] = useState(0);
  const [sens, setSens] = useState(loadSens);
  const sensRef = useRef(sens);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const featherFile = useRef<HTMLInputElement | null>(null);
  const audioFile = useRef<HTMLInputElement | null>(null);
  // the decoded photo stays around so a sensitivity change can re-scan it
  const srcImg = useRef<HTMLImageElement | null>(null);
  // debug tint, toggled without rebuilding the scene
  const debugRef = useRef<Dbg>(0);
  const dbgRef = useRef<() => void>(() => {});
  // the render loop pushes audio features straight into the meter DOM, so the
  // readout is live without re-rendering React 60 times a second
  const meter = useRef<((f: AudioFeatures) => void) | null>(null);

  const pick = async (src: string, label: string) => {
    setBusy('reading the feather…');
    setError('');
    try {
      const img = await loadImage(src);
      srcImg.current = img;
      setAnatomy(analyzeAnatomy(img, { sensitivity: sensRef.current }));
      setSourceName(label);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy('');
    }
  };

  // sensitivity changed: save it, then re-scan the current feather (debounced,
  // and after a paint so the "rescanning" note shows before analysis blocks)
  useEffect(() => {
    if (sens === sensRef.current) return; // mount — nothing to redo
    sensRef.current = sens;
    localStorage.setItem(SENS_KEY, String(sens));
    if (!srcImg.current) return;
    const t = setTimeout(() => {
      setBusy('rescanning…');
      requestAnimationFrame(() => {
        try {
          setAnatomy(analyzeAnatomy(srcImg.current!, { sensitivity: sens }));
        } catch (e) {
          setError(String((e as Error)?.message ?? e));
        } finally {
          setBusy('');
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [sens]);

  // ---- three.js scene -----------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !anatomy) return;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x040406);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    camera.position.set(0, 0, 3.4);

    const geo = new THREE.BufferGeometry();
    const pos3 = new Float32Array(anatomy.count * 3);
    for (let i = 0; i < anatomy.count; i++) {
      pos3[i * 3] = anatomy.pos[i * 2];
      pos3[i * 3 + 1] = anatomy.pos[i * 2 + 1];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos3, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(anatomy.rgb, 3));
    geo.setAttribute('aUV', new THREE.BufferAttribute(anatomy.uv, 2));
    geo.setAttribute('aPart', new THREE.BufferAttribute(anatomy.part, 1));
    geo.setAttribute('aDowny', new THREE.BufferAttribute(anatomy.downy, 1));
    geo.setAttribute('aBarb', new THREE.BufferAttribute(anatomy.barb, 2));
    geo.setAttribute('aCluster', new THREE.BufferAttribute(anatomy.cluster, 1));
    geo.setAttribute('aSurf', new THREE.BufferAttribute(anatomy.surf, 4));
    geo.setAttribute('aPatA', new THREE.BufferAttribute(anatomy.patA, 4));
    geo.setAttribute('aPatB', new THREE.BufferAttribute(anatomy.patB, 4));
    geo.setAttribute('aPatC', new THREE.BufferAttribute(anatomy.patC, 2));

    const uniforms = {
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uMelody: { value: 0 },
      uHue: { value: 0 },
      uWave: { value: 0 },
      uShimmer: { value: 0 },
      uSub: { value: 0 },
      uKick: { value: 0 },
      uSnare: { value: 0 },
      uHat: { value: 0 },
      uPhase: { value: 0 },
      uLock: { value: 0 },
      uIdle: { value: 1 },
      uBright: { value: 0 },
      uAmpEye: { value: 1 },
      uAmpColor: { value: 1 },
      uAmpWave: { value: 1 },
      uAmpShimmer: { value: 1 },
      uAmpFlex: { value: 1 },
      uAmpFringe: { value: 1 },
      uAmpDepth: { value: 0.6 },
      uDebugParts: { value: debugRef.current },
      uPointScale: { value: 7 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT_HUE,
      fragmentShader: FRAG_REAL,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const cloud = new THREE.Points(geo, mat);
    scene.add(cloud);

    const fit = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // frame the feather: its cloud spans y -1..1, x ±aspect
      const need = Math.max(1.15, (anatomy.aspect * 1.25) / camera.aspect);
      camera.position.z = need / Math.tan((camera.fov * Math.PI) / 360);
      camera.updateProjectionMatrix();
      // finer grain now the cloud is ~3× denser
      uniforms.uPointScale.value = (h / 240) * 3.0;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(mount);

    let raf = 0;
    let frame = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const f = feed.read(t);
      const a = amps.current;
      uniforms.uTime.value = t / 1000;
      uniforms.uBeat.value = f.beat;
      uniforms.uMelody.value = f.melody;
      uniforms.uHue.value = f.hue;
      uniforms.uWave.value = f.wave;
      uniforms.uShimmer.value = f.shimmer;
      uniforms.uSub.value = f.sub;
      uniforms.uKick.value = f.kick;
      uniforms.uSnare.value = f.snare;
      uniforms.uHat.value = f.hat;
      uniforms.uPhase.value = f.phase;
      uniforms.uLock.value = f.lock;
      uniforms.uIdle.value = f.idle;
      uniforms.uBright.value = f.bright;
      uniforms.uAmpEye.value = a.eye;
      uniforms.uAmpColor.value = a.color;
      uniforms.uAmpWave.value = a.wave;
      uniforms.uAmpShimmer.value = a.shimmer;
      uniforms.uAmpFlex.value = a.flex;
      uniforms.uAmpFringe.value = a.fringe;
      uniforms.uAmpDepth.value = a.depth;

      // turn the cloud slowly, and lean it a little on the bar — without this
      // the depth separation would only read as a change of scale
      const s = t / 1000;
      cloud.rotation.y = (Math.sin(s * 0.17) * 0.30 + (f.bar - 0.5) * 0.16 * f.lock) * a.depth;
      cloud.rotation.x = Math.sin(s * 0.11) * 0.10 * a.depth;

      renderer.render(scene, camera);
      if (++frame % 3 === 0) meter.current?.(f);
    };
    raf = requestAnimationFrame(loop);

    const dbg = () => {
      uniforms.uDebugParts.value = debugRef.current;
    };
    dbgRef.current = dbg;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anatomy, feed]);

  useEffect(() => {
    debugRef.current = debugMode;
    dbgRef.current();
  }, [debugMode]);

  const partCounts = useMemo(() => {
    if (!anatomy) return null;
    const m = new Map<number, number>();
    for (let i = 0; i < anatomy.count; i++) m.set(anatomy.part[i], (m.get(anatomy.part[i]) ?? 0) + 1);
    return m;
  }, [anatomy]);

  const setAmp = (key: keyof Amps, v: number) => {
    amps.current[key] = v;
    localStorage.setItem(AMPS_KEY, JSON.stringify(amps.current));
    setAmpTick((x) => x + 1);
  };

  return (
    <div className="f2">
      {/* hidden pickers */}
      <input
        ref={featherFile}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(URL.createObjectURL(f), f.name);
        }}
      />
      <input
        ref={audioFile}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            feed
              .useFile(f)
              .then(() => setAudioTick((x) => x + 1))
              .catch((err) => setError(String(err?.message ?? err)));
        }}
      />

      <header className="f2-mark">
        <h1>
          Feather Lab
          <small>anatomy engine{sourceName ? ` · ${sourceName}` : ''}</small>
        </h1>
        <a className="f2-back" href="/" title="back to the console">✕</a>
      </header>

      {!anatomy && (
        <div className="f2-hero">
          <p className="f2-tag">
            Every feather shares one skeleton — calamus, rachis, barbs, down, and sometimes an eye.
            <br />
            This engine finds those parts in a photo and lets the music move each one.
          </p>
          <button className="f2-cta" onClick={() => featherFile.current?.click()} disabled={!!busy}>
            {busy || 'Upload a feather'}
          </button>
          {error && <div className="f2-error">{error}</div>}
          <div className="f2-gallery">
            {FEATHERS.filter((f) => !f.procedural).map((f) => (
              <button key={f.id} className="f2-thumb" title={f.label} onClick={() => void pick(f.src, f.label)}>
                <img src={f.src.replace('/feathers/', '/feathers/thumbs/')} alt={f.label} loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        </div>
      )}

      {anatomy && (
        <>
          <div ref={mountRef} className="f2-stage" />

          <aside className="f2-panel">
            <div className="f2-sec">Audio</div>
            <div className="f2-row">
              <button className="f2-btn" onClick={() => audioFile.current?.click()}>
                music file
              </button>
              <button
                className={`f2-btn ${feed.micOn ? 'on' : ''}`}
                onClick={() => {
                  (feed.micOn ? (feed.stopMic(), Promise.resolve()) : feed.useMic())
                    .then(() => setAudioTick((x) => x + 1))
                    .catch((err) => setError(String((err as Error)?.message ?? err)));
                }}
              >
                {feed.micOn ? 'mic on' : 'mic'}
              </button>
              {feed.sourceLabel && feed.sourceLabel !== 'microphone' && (
                <button
                  className="f2-btn"
                  onClick={() => {
                    (feed.filePlaying ? (feed.pauseFile(), Promise.resolve()) : feed.resumeFile())
                      .then(() => setAudioTick((x) => x + 1))
                      .catch(() => {});
                  }}
                >
                  {feed.filePlaying ? '❚❚' : '▶'}
                </button>
              )}
            </div>
            <div className="f2-srcname">{feed.sourceLabel || 'no audio yet — drop a track or open the mic'}</div>
            <F2Meters register={meter} />

            <div className="f2-sec">Scan</div>
            <F2Amp label="Image scan sensitivity" min={0} max={1} step={0.02} value={sens} onChange={setSens} />
            <div className="f2-srcname">
              {busy || `${Math.round(sens * 100)}% — saved · re-scans this feather`}
            </div>

            <div className="f2-sec">Responses</div>
            <F2Amp label="Markings · kick" value={amps.current.eye} onChange={(v) => setAmp('eye', v)} disabled={anatomy.zones.length === 0} />
            <F2Amp label="Shaft flex · sub" value={amps.current.flex} onChange={(v) => setAmp('flex', v)} />
            <F2Amp label="Vane wave · bass" value={amps.current.wave} onChange={(v) => setAmp('wave', v)} />
            <F2Amp label="Fringe · snare + hat" value={amps.current.fringe} onChange={(v) => setAmp('fringe', v)} />
            <F2Amp label="Barb shimmer · air" value={amps.current.shimmer} onChange={(v) => setAmp('shimmer', v)} />
            <F2Amp label="Color · pitch" value={amps.current.color} onChange={(v) => setAmp('color', v)} />
            <F2Amp label="Layer depth" min={0} max={1} step={0.02} value={amps.current.depth} onChange={(v) => setAmp('depth', v)} />

            <div className="f2-sec">Anatomy</div>
            <div className="f2-kind">
              {anatomy.kind}
              <i>{Math.round(anatomy.plumFrac * 100)}% plumulaceous</i>
            </div>
            <div className="f2-zones">
              {anatomy.zones.length} pattern zone{anatomy.zones.length === 1 ? '' : 's'} · {anatomy.count.toLocaleString()} particles
            </div>
            <div className="f2-parts">
              {[PART.eye, PART.rachis, PART.barbs, PART.down, PART.calamus].map((p) => (
                <span key={p} className={`f2-part p${p} ${partCounts?.get(p) ? '' : 'off'}`}>
                  {PART_NAMES[p]}
                  {p === PART.eye && !anatomy.eyeCenter && ' — none found'}
                </span>
              ))}
            </div>
            <div className="f2-row f2-debug">
              {(['off', 'parts', 'patterns', 'surface'] as const).map((label, i) => (
                <button
                  key={label}
                  className={`f2-btn ${debugMode === i ? 'on' : ''}`}
                  onClick={() => setDebugMode(i as Dbg)}
                >
                  {label}
                </button>
              ))}
            </div>
            {debugMode === 3 && (
              <div className="f2-srcname">red = loose fluff · green = barbs read · blue = shaft</div>
            )}

            <div className="f2-sec">Feather</div>
            <div className="f2-row">
              <button className="f2-btn" onClick={() => featherFile.current?.click()}>
                upload another
              </button>
              <button
                className="f2-btn"
                onClick={() => {
                  srcImg.current = null; // don't let a sens change re-open the old scan
                  setAnatomy(null);
                }}
              >
                gallery
              </button>
            </div>
            {error && <div className="f2-error">{error}</div>}
          </aside>
        </>
      )}
      <span style={{ display: 'none' }}>{audioTick}</span>
    </div>
  );
}

/**
 * Live readout of what the analyser hears: six auto-gained bands, the three
 * onset detectors, and the tempo tracker's verdict. Without this the audio
 * engine is a black box — when the feather doesn't move you can't tell whether
 * the track is quiet, the band is empty or the beat wasn't found.
 */
const BAND_LABELS = ['sub', 'bass', 'body', 'mid', 'high', 'air'];
const HIT_LABELS = ['kick', 'snare', 'hat'];

function F2Meters({ register }: { register: React.RefObject<((f: AudioFeatures) => void) | null> }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const hits = useRef<(HTMLSpanElement | null)[]>([]);
  const txt = useRef<HTMLDivElement | null>(null);
  const dot = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    register.current = (f) => {
      const vals = [f.sub, f.bass, f.body, f.mid, f.high, f.air];
      for (let i = 0; i < vals.length; i++) {
        const el = bars.current[i];
        if (el) el.style.height = `${Math.max(2, vals[i] * 100).toFixed(0)}%`;
      }
      const h = [f.kick, f.snare, f.hat];
      for (let i = 0; i < h.length; i++) {
        const el = hits.current[i];
        if (el) el.style.opacity = (0.15 + 0.85 * h[i]).toFixed(2);
      }
      if (dot.current) dot.current.style.transform = `scale(${(0.5 + 0.9 * (1 - Math.abs(f.phase * 2 - 1))).toFixed(2)})`;
      if (txt.current) {
        txt.current.textContent = !f.playing
          ? 'silent'
          : f.bpm
            ? `${Math.round(f.bpm)} bpm · lock ${Math.round(f.lock * 100)}%`
            : 'finding the tempo…';
      }
    };
    return () => {
      register.current = null;
    };
  }, [register]);

  return (
    <div className="f2-meters">
      <div className="f2-bars">
        {BAND_LABELS.map((l, i) => (
          <label key={l} title={l}>
            <span ref={(e) => { bars.current[i] = e; }} />
          </label>
        ))}
      </div>
      <div className="f2-hits">
        {HIT_LABELS.map((l, i) => (
          <em key={l} ref={(e) => { hits.current[i] = e; }}>{l}</em>
        ))}
        <span className="f2-phase" ref={dot} />
      </div>
      <div className="f2-srcname" ref={txt}>silent</div>
    </div>
  );
}

function F2Amp({
  label, value, onChange, disabled, min = 0, max = 2, step = 0.05,
}: {
  label: string; value: number; onChange: (v: number) => void;
  disabled?: boolean; min?: number; max?: number; step?: number;
}) {
  return (
    <label className={`f2-amp ${disabled ? 'off' : ''}`}>
      <span>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
