// ============================================================================
//  /feather2 — the anatomy engine.
//
//  Where the main projection treats a feather photo as one particle cloud with
//  color layers, this page recovers the feather's SKELETON (see anatomy.ts)
//  and animates each anatomical part on its own audio feature:
//
//    ocellus (the eye)  ← BEAT      concentric ring pulse out of the eye
//    color patterns     ← MELODY    the pattern groups shift hue
//    downy base         ← BASS      travelling wave, like the tail breathing
//    barbs              ← HIGHS     fine shimmer across the vane
//    whole feather                  slow sway anchored at the calamus
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
import { AudioFeed } from './audio2.ts';

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
  attribute vec2 aBarb;     // unit barb tangent (outward from rachis, toward tip)
  attribute vec4 aPatA;     // zone centre xy, phase, kind (0 none · 1 round · 2 stripe)
  attribute vec4 aPatB;     // zone axis xy, along -1..1, across 0..1.6

  uniform float uTime;
  uniform float uBeat;      // 0..1 pulse
  uniform float uMelody;
  uniform float uWave;
  uniform float uShimmer;
  uniform float uAmpEye;
  uniform float uAmpWave;
  uniform float uAmpShimmer;
  uniform float uPointScale;

  varying vec3 vColor;
  varying float vPart;
  varying float vGlow;
  varying vec2 vPatDbg;   // x = kind, y = phase

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 p = position.xy;
    float part = aPart;
    float glow = 0.0;

    // whole-feather sway, hinged at the calamus (y = -1); bass leans into it
    float hinge = (position.y + 1.0) * 0.5;
    float sway = sin(uTime * 0.5) * (0.012 + uWave * 0.03);
    p.x += sway * hinge * hinge;

    // VANE — one continuous model for the whole blade, weighted by how
    // PLUMULACEOUS (downy) each point is. Loose downy barbs at the base swing
    // freely; firm zipped pennaceous barbs above barely move. That ratio is
    // measured from the photo, so a down feather breathes all over while a
    // flight feather only stirs at its base.
    if (part == 2.0 || part == 3.0) {
      float downy = aDowny;

      // bass wave travelling up the vane, along the barbs
      float wv = sin(aUV.y * 8.0 + uTime * 2.3 + aUV.x * 1.8);
      float amp = uWave * uAmpWave * abs(aUV.x) * (0.014 + 0.075 * downy);
      p += aBarb * wv * amp;
      p.y += cos(aUV.y * 6.5 + uTime * 1.9) * amp * 0.3 * downy;

      // highs shimmer ALONG the barb, not as free noise — barbs vibrate in
      // the direction they run. Firm barbs ring; downy ones are already moving.
      float jit = hash(position.xy * 91.0) - 0.5;
      p += aBarb * jit * uShimmer * uAmpShimmer * (0.006 + 0.016 * (1.0 - downy));

      glow += uWave * 0.22 * downy + uShimmer * 0.28 * abs(jit) * 2.0 * (1.0 - downy);
    }

    // PATTERN PULSE — every marking reacts to the beat in the shape it is.
    // Round markings (an ocellus, a spot) ring outward from their centre.
    // Elongated ones (a chevron bar, a stripe) ripple ALONG their length and
    // displace across it, like a plucked string. Each marking carries its own
    // phase so a barred feather cascades instead of thumping in lockstep.
    float kind = aPatA.w;
    if (kind > 0.5) {
      float phase = aPatA.z * 6.2831;
      float across = aPatB.w;
      float falloff = smoothstep(1.5, 0.1, across);

      if (kind < 1.5) {
        vec2 dir = p - aPatA.xy;
        float len = max(0.0001, length(dir));
        float ring = sin(across * 10.0 - uTime * 7.0 + phase);
        p += (dir / len) * uBeat * uAmpEye * (0.030 + 0.026 * ring) * falloff;
      } else {
        vec2 axis = normalize(aPatB.xy + vec2(1e-5));
        vec2 nrm = vec2(-axis.y, axis.x);
        float travel = sin(aPatB.z * 4.5 - uTime * 6.0 + phase);
        p += nrm * uBeat * uAmpEye * 0.032 * travel * falloff;
      }
      glow += uBeat * falloff * (part == 4.0 ? 1.1 : 0.7);
    }

    // rachis + calamus stay rigid — they are the skeleton

    vColor = aColor;
    vPart = part;
    vGlow = glow;
    vPatDbg = vec2(aPatA.w, aPatA.z);
    vec4 mv = modelViewMatrix * vec4(p, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = uPointScale * (1.0 + glow * 0.6);
    if (part == 4.0) size *= 1.15;
    gl_PointSize = size / max(0.6, -mv.z);
  }
`;

const FRAG_REAL = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vPart;
  varying float vGlow;
  varying float vHuePhase;
  varying vec2 vPatDbg;

  uniform float uMelody;
  uniform float uHue;
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
    // patterns of the feather trade colors instead of tinting uniformly
    float shift = uHue * (0.4 + vHuePhase);
    col = mix(col, hueShift(col, shift), clamp(uMelody * uAmpColor, 0.0, 1.0));
    col *= 1.0 + vGlow * 0.8;

    if (uDebugParts > 1.5) {
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
  const [debugMode, setDebugMode] = useState<0 | 1 | 2>(0); // off · anatomy · patterns
  const [audioTick, setAudioTick] = useState(0); // rerender for audio buttons
  const feed = useMemo(() => new AudioFeed(), []);
  useEffect(() => () => feed.dispose(), [feed]);

  const amps = useRef({ eye: 1, color: 1, wave: 1, shimmer: 1 });
  const [, setAmpTick] = useState(0);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const featherFile = useRef<HTMLInputElement | null>(null);
  const audioFile = useRef<HTMLInputElement | null>(null);
  // debug tint, toggled without rebuilding the scene
  const debugRef = useRef<0 | 1 | 2>(0);
  const dbgRef = useRef<() => void>(() => {});

  const pick = async (src: string, label: string) => {
    setBusy('reading the feather…');
    setError('');
    try {
      const img = await loadImage(src);
      setAnatomy(analyzeAnatomy(img));
      setSourceName(label);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy('');
    }
  };

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
    geo.setAttribute('aPatA', new THREE.BufferAttribute(anatomy.patA, 4));
    geo.setAttribute('aPatB', new THREE.BufferAttribute(anatomy.patB, 4));

    const uniforms = {
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uMelody: { value: 0 },
      uHue: { value: 0 },
      uWave: { value: 0 },
      uShimmer: { value: 0 },
      uAmpEye: { value: 1 },
      uAmpColor: { value: 1 },
      uAmpWave: { value: 1 },
      uAmpShimmer: { value: 1 },
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
    scene.add(new THREE.Points(geo, mat));

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
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const f = feed.read(t);
      uniforms.uTime.value = t / 1000;
      uniforms.uBeat.value = f.beat;
      uniforms.uMelody.value = f.melody;
      uniforms.uHue.value = f.hue;
      uniforms.uWave.value = f.wave;
      uniforms.uShimmer.value = f.shimmer;
      uniforms.uAmpEye.value = amps.current.eye;
      uniforms.uAmpColor.value = amps.current.color;
      uniforms.uAmpWave.value = amps.current.wave;
      uniforms.uAmpShimmer.value = amps.current.shimmer;
      renderer.render(scene, camera);
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

  const setAmp = (key: keyof typeof amps.current, v: number) => {
    amps.current[key] = v;
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

            <div className="f2-sec">Responses</div>
            <F2Amp label="Pulse · beat" value={amps.current.eye} onChange={(v) => setAmp('eye', v)} disabled={anatomy.zones.length === 0} />
            <F2Amp label="Color · melody" value={amps.current.color} onChange={(v) => setAmp('color', v)} />
            <F2Amp label="Down wave · bass" value={amps.current.wave} onChange={(v) => setAmp('wave', v)} />
            <F2Amp label="Barb shimmer · highs" value={amps.current.shimmer} onChange={(v) => setAmp('shimmer', v)} />

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
              {(['off', 'anatomy', 'patterns'] as const).map((label, i) => (
                <button
                  key={label}
                  className={`f2-btn ${debugMode === i ? 'on' : ''}`}
                  onClick={() => setDebugMode(i as 0 | 1 | 2)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="f2-sec">Feather</div>
            <div className="f2-row">
              <button className="f2-btn" onClick={() => featherFile.current?.click()}>
                upload another
              </button>
              <button className="f2-btn" onClick={() => setAnatomy(null)}>
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

function F2Amp({
  label, value, onChange, disabled,
}: {
  label: string; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <label className={`f2-amp ${disabled ? 'off' : ''}`}>
      <span>{label}</span>
      <input
        type="range" min={0} max={2} step={0.05} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
