// ============================================================================
//  Projection — the audience-facing feather, modelled on real feather anatomy.
//
//  Built from the structure in the reference diagrams:
//
//      calamus   hollow bare quill at the base (embedded in the "skin")
//      rachis    the central shaft, tapering from calamus to tip, gently bowed
//      barbs     fine filaments branching off both sides of the rachis,
//                SWEPT toward the tip; their length follows a leaf profile so
//                the outline is the classic lanceolate vane
//      vane      the interlocked surface the barbs form (asymmetric: the
//                leading edge is narrower than the trailing edge — a flight
//                feather), rendered as a translucent membrane behind the barbs
//      downy     near the base the barbs are plumulaceous — long, loose, wavy,
//                NOT interlocked (no membrane), they splay and flutter
//
//  Wind (the loudest breath in the room, smoothed) drives it physically:
//    • the rachis bows and the whole feather sways, tip moving most
//    • barbs flutter and SEPARATE — gaps open in the vane, so the membrane
//      grows translucent and the individual barbs read more strongly
//    • the downy base ruffles
//
//  It reads the same WingbeatEngine as the operator map — two views, one brain.
// ============================================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { getScene } from '../engine/scenes.ts';
import { getFeather } from './feathers.ts';
import { SENSOR_CHANNELS, sideCode } from './channels.ts';
import { analyzeFeatherImage } from './analyzeFeather.ts';
import {
  rig,
  packRigUniforms,
  loadIntoRig,
  defaultPreset,
  combinedLayers,
  layerMembership,
  onLayersChange,
  particleSampleW,
  PART_W_REF,
  DEVICE_SIZE_SCALE,
  layerGen,
  layerRelease,
  MAX_LAYERS,
  DEFAULT_GLOBAL,
  type LayerDef,
} from './rig.ts';
import { recallLast, saveLast } from './presets.ts';
import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import type { AudioEngine } from '../engine/AudioEngine.ts';

// sensor id → channel index, for routing trigger impulses to the right group
const SENSOR_INDEX = new Map(SENSOR_CHANNELS.map((c, i) => [c.sensor, i]));

// smoothstep 0..1 between edges a and b — used for the phase gates.
function smooth01(x: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const NCH = SENSOR_CHANNELS.length; // number of sensor channels (5)
const RACHIS_I = SENSOR_CHANNELS.findIndex((c) => c.label === 'Rachis');
const TAIL_I = SENSOR_CHANNELS.findIndex((c) => c.label === 'Tail');

// Per-sensor energy with an ATTACK/RELEASE envelope: rises at the sensor's attack
// rate, falls at its release rate (the Envelope module). Shapes the "generation
// time" of each sensor's effect.
function readChannelEnergies(engine: WingbeatEngine, smooth: Float32Array): void {
  const byId = new Map(engine.getNodes().map((n) => [n.id, n.wind]));
  for (let i = 0; i < SENSOR_CHANNELS.length; i++) {
    const ch = SENSOR_CHANNELS[i];
    const target = byId.get(ch.sensor) ?? 0;
    const s = rig.sensors[ch.sensor];
    const env = s?.modules.release;
    const rate = target > smooth[i] ? (env ? s.attack : rig.global.attack) : env ? s.release : rig.global.release;
    smooth[i] += (target - smooth[i]) * rate;
  }
}

// ---- feather geometry constants (local space, feather points up +Y) --------
const SHAFT_BASE_Y = -3.6; // bottom of the calamus
const CAL_TOP_Y = -2.0; //    calamus → rachis transition
const VANE_START_Y = -1.7; //  vane begins just above the calamus
const TIP_Y = 4.4; //          feather tip
const N = 150; //              vane samples along the rachis
const DOWNY = 18; //           downy barbs per side near the base
const LEAD = 1.02; //          leading-edge max half-width (narrow side)
const TRAIL = 1.62; //         trailing-edge max half-width (wide side)
const SWEEP = 0.95; //         how hard barbs sweep toward the tip
const RACHIS_BASE_W = 0.07; //  shaft half-width at base
const RACHIS_TIP_W = 0.006; //  shaft half-width at tip

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// vane half-width profile along the vane (u: 0 at base of vane, 1 at tip)
function widthProfile(u: number) {
  // 0 at both ends, fullest around u≈0.4 — lanceolate leaf shape
  return Math.pow(Math.sin(Math.pow(u, 0.72) * Math.PI), 0.95);
}

// base (wind-free) x of the shaft at parameter p (0 base .. 1 tip): a gentle bow
function shaftBaseX(p: number) {
  return 0.24 * Math.sin(p * Math.PI) + 0.16 * Math.pow(p, 3);
}

// triangle index for a 2-wide vertex strip of `n` rungs (verts ordered rung0a,rung0b,rung1a,rung1b,…)
function stripIndex(n: number): number[] {
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return idx;
}

interface Built {
  group: THREE.Group;
  // base sample data
  yV: Float32Array; // local y of each vane sample
  pV: Float32Array; // shaft param p of each vane sample
  wL: Float32Array; // leading half-width per sample
  wR: Float32Array; // trailing half-width per sample
  yD: Float32Array; // downy sample y
  pD: Float32Array; // downy sample p
  // geometries we mutate each frame
  vaneL: THREE.BufferGeometry;
  vaneR: THREE.BufferGeometry;
  rachis: THREE.BufferGeometry;
  barbs: THREE.BufferGeometry; // LineSegments, both sides
  downy: THREE.BufferGeometry; // LineSegments, both sides
  calamus: THREE.BufferGeometry;
  // materials we tint each frame
  mats: {
    vaneL: THREE.MeshBasicMaterial;
    vaneR: THREE.MeshBasicMaterial;
    rachis: THREE.MeshBasicMaterial;
    barbs: THREE.LineBasicMaterial;
    downy: THREE.LineBasicMaterial;
  };
}

function buildFeather(): Built {
  const group = new THREE.Group();

  // ---- sample arrays ----
  const yV = new Float32Array(N);
  const pV = new Float32Array(N);
  const wL = new Float32Array(N);
  const wR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const y = lerp(VANE_START_Y, TIP_Y, u);
    yV[i] = y;
    pV[i] = (y - SHAFT_BASE_Y) / (TIP_Y - SHAFT_BASE_Y);
    const w = widthProfile(u);
    wL[i] = w * LEAD;
    wR[i] = w * TRAIL;
  }

  const yD = new Float32Array(DOWNY);
  const pD = new Float32Array(DOWNY);
  for (let i = 0; i < DOWNY; i++) {
    const u = i / (DOWNY - 1);
    const y = lerp(CAL_TOP_Y + 0.05, VANE_START_Y + 0.15, u);
    yD[i] = y;
    pD[i] = (y - SHAFT_BASE_Y) / (TIP_Y - SHAFT_BASE_Y);
  }

  // ---- vane membranes (left + right strips, 2*N verts each) ----
  const mkStrip = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * N * 3), 3));
    g.setIndex(stripIndex(N));
    return g;
  };
  const vaneL = mkStrip();
  const vaneR = mkStrip();
  const rachis = mkStrip();

  // ---- barbs: one straight segment per sample, per side ----
  const barbs = new THREE.BufferGeometry();
  barbs.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 2 * 3), 3));

  // ---- downy: two-segment wavy filament per sample, per side ----
  const downy = new THREE.BufferGeometry();
  downy.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DOWNY * 2 * 2 * 2 * 3), 3));

  // ---- calamus: a tapered quad ----
  const calamus = new THREE.BufferGeometry();
  calamus.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
  calamus.setIndex([0, 1, 2, 1, 3, 2]);

  // ---- materials ----
  const mats = {
    vaneL: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    vaneR: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    rachis: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
    barbs: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    downy: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
  };

  const calMat = new THREE.MeshBasicMaterial({ color: '#cfc6b2', transparent: true, opacity: 0.55, side: THREE.DoubleSide });

  group.add(new THREE.Mesh(vaneL, mats.vaneL));
  group.add(new THREE.Mesh(vaneR, mats.vaneR));
  group.add(new THREE.LineSegments(barbs, mats.barbs));
  group.add(new THREE.LineSegments(downy, mats.downy));
  group.add(new THREE.Mesh(rachis, mats.rachis));
  group.add(new THREE.Mesh(calamus, calMat));

  return { group, yV, pV, wL, wR, yD, pD, vaneL, vaneR, rachis, barbs, downy, calamus, mats };
}

function ProceduralFeather({ engine }: { engine: WingbeatEngine }) {
  const built = useMemo(buildFeather, []);
  const driveRef = useRef(0);
  const bloomRef = useRef(0); // 0 = single rachis line, 1 = full feather form
  const energies = useRef(new Float32Array(NCH));

  // scratch arrays for the deformed shaft + normals (reused each frame)
  const scratch = useMemo(
    () => ({ px: new Float32Array(N), py: new Float32Array(N), nx: new Float32Array(N), ny: new Float32Array(N) }),
    [],
  );

  // give the engine a default palette so the operator legend has color swatches
  // even on the procedural feather (the photos override this with real colors).
  useEffect(() => {
    const s = getScene(engine.scene);
    engine.setFeatherPalette([
      [0.95, 0.93, 0.88],
      [s.led.r / 255, s.led.g / 255, s.led.b / 255],
      [0.6, 0.45, 0.25],
      [0.3, 0.28, 0.4],
    ]);
  }, [engine]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    let maxWind = 0;
    for (const n of engine.getNodes()) if (n.wind > maxWind) maxWind = n.wind;
    driveRef.current += (maxWind - driveRef.current) * 0.08;
    const drive = driveRef.current;

    // Bloom: the feather FORM appears only when the held feather is taken in
    // hand (feather_01 presence / breath). Idle → collapses to a single line.
    const fNode = engine.getNode('feather_01');
    const featherAct = Math.max(fNode?.present ? 0.9 : 0, fNode?.wind ?? 0);
    bloomRef.current += (featherAct - bloomRef.current) * 0.05; // slow, graceful
    const bloom = bloomRef.current;

    // per-sensor energies → each channel flutters its own band of the feather
    readChannelEnergies(engine, energies.current);
    const E = energies.current;
    const localE = (u: number, sign: number) => {
      let acc = 0;
      for (let c = 0; c < SENSOR_CHANNELS.length; c++) {
        const e = E[c];
        if (e <= 0.001) continue;
        const ch = SENSOR_CHANNELS[c];
        const d = (u - ch.bandY) / ch.bandHW;
        let m = Math.exp(-d * d);
        const sc = sideCode(ch.side);
        if (sc === -1 && sign > 0) m *= 0.15; // leading channel: weak on trailing side
        else if (sc === 1 && sign < 0) m *= 0.15;
        acc += e * m;
      }
      return acc;
    };

    const s = getScene(engine.scene);
    const col = new THREE.Color(s.led.r / 255, s.led.g / 255, s.led.b / 255);
    const bright = col.clone().lerp(new THREE.Color('#ffffff'), 0.35);

    // The rachis is the still SOURCE — it barely moves: a tiny, slow breath only,
    // independent of wind. All the motion lives in the barbs.
    const bend = (p: number) => Math.pow(p, 1.4) * Math.sin(t * 0.4 + p * 1.3) * 0.05;

    const { yV, pV, wL, wR } = built;

    // ---- deformed shaft points + normals for vane samples ----
    const { px, py, nx, ny } = scratch;
    for (let i = 0; i < N; i++) {
      px[i] = shaftBaseX(pV[i]) + bend(pV[i]);
      py[i] = yV[i];
    }
    for (let i = 0; i < N; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(N - 1, i + 1);
      let tx = px[i1] - px[i0];
      let ty = py[i1] - py[i0];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      nx[i] = -ty; // normal = tangent rotated 90°
      ny[i] = tx;
    }

    // ---- fill vane membranes + barbs ----
    const vL = built.vaneL.attributes.position.array as Float32Array;
    const vR = built.vaneR.attributes.position.array as Float32Array;
    const rA = built.rachis.attributes.position.array as Float32Array;
    const bA = built.barbs.attributes.position.array as Float32Array;
    let b = 0;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      // per-barb flutter + separation (grows with wind, ripples up the feather)
      const flutter = 1 + Math.sin(t * 3.0 + i * 0.35) * (0.015 + drive * 0.11);
      const sep = Math.sin(t * 2.2 + i * 0.22) * drive * 0.22; // along-shaft separation
      const swp = u * SWEEP; // sweep grows toward the tip

      // each sensor's channel adds extra splay/flutter to its own band + side
      const leL = localE(u, -1);
      const leR = localE(u, 1);
      const localAct = leL + leR;
      // barbs exist only as the form blooms; an active sensor also reveals its
      // own band locally (so interacting paints a pattern even before bloom).
      const bloomU = Math.min(1, bloom + localAct * 1.4);
      const effL = wL[i] * (flutter + leL * 0.6) * bloomU;
      const effR = wR[i] * (flutter + leR * 0.6) * bloomU;
      // travelling wave along the active band — the per-sensor "pattern"
      const patt = Math.sin(t * 6.0 + i * 0.8) * localAct * 0.6;
      const sepL = sep * bloomU + patt;
      const sepR = sep * bloomU + Math.sin(t * 6.0 + i * 0.8 + 1.2) * localAct * 0.6;

      // leading (left) tip — swept toward tip along +Y, plus separation
      const lTipX = px[i] - nx[i] * effL;
      const lTipY = py[i] - ny[i] * effL + effL * swp + sepL;
      // trailing (right) tip
      const rTipX = px[i] + nx[i] * effR;
      const rTipY = py[i] + ny[i] * effR + effR * swp + sepR;

      // rachis strip half-width (tapers to the tip)
      const rw = lerp(RACHIS_BASE_W, RACHIS_TIP_W, u);

      const o = i * 6;
      // vane left: [rachis pt, leading tip]
      vL[o] = px[i]; vL[o + 1] = py[i]; vL[o + 2] = 0;
      vL[o + 3] = lTipX; vL[o + 4] = lTipY; vL[o + 5] = -0.02;
      // vane right: [rachis pt, trailing tip]
      vR[o] = px[i]; vR[o + 1] = py[i]; vR[o + 2] = 0;
      vR[o + 3] = rTipX; vR[o + 4] = rTipY; vR[o + 5] = -0.02;
      // rachis strip: [pt - n*rw, pt + n*rw]
      rA[o] = px[i] - nx[i] * rw; rA[o + 1] = py[i] - ny[i] * rw; rA[o + 2] = 0.01;
      rA[o + 3] = px[i] + nx[i] * rw; rA[o + 4] = py[i] + ny[i] * rw; rA[o + 5] = 0.01;

      // barbs (skip the very base where the vane hasn't formed)
      // left barb segment
      bA[b++] = px[i]; bA[b++] = py[i]; bA[b++] = 0.02;
      bA[b++] = lTipX; bA[b++] = lTipY; bA[b++] = 0.02;
      // right barb segment
      bA[b++] = px[i]; bA[b++] = py[i]; bA[b++] = 0.02;
      bA[b++] = rTipX; bA[b++] = rTipY; bA[b++] = 0.02;
    }
    built.vaneL.attributes.position.needsUpdate = true;
    built.vaneR.attributes.position.needsUpdate = true;
    built.rachis.attributes.position.needsUpdate = true;
    built.barbs.attributes.position.needsUpdate = true;
    built.vaneL.computeBoundingSphere();
    built.vaneR.computeBoundingSphere();

    // ---- downy barbs (plumulaceous base): long, wavy, splayed, ruffling ----
    const dA = built.downy.attributes.position.array as Float32Array;
    let d = 0;
    for (let i = 0; i < built.yD.length; i++) {
      const p = built.pD[i];
      const baseX = shaftBaseX(p) + bend(p);
      const baseY = built.yD[i];
      const len = 0.7 + i * 0.06;
      for (const sign of [-1, 1]) {
        // mid + tip points, splayed downward (toward base) and waving
        const ang = sign * (0.7 + Math.sin(t * 2 + i) * 0.12 * (1 + drive * 2));
        const mx = baseX + Math.cos(ang) * len * 0.5 * sign * -1 + sign * 0.1;
        const my = baseY - 0.12 + Math.sin(t * 2.4 + i) * 0.04 * (1 + drive * 2);
        const tx = baseX + sign * len * (0.7 + drive * 0.3);
        const ty = baseY - 0.28 + Math.sin(t * 1.8 + i * 1.3) * (0.05 + drive * 0.12);
        // seg 1: base→mid
        dA[d++] = baseX; dA[d++] = baseY; dA[d++] = -0.03;
        dA[d++] = mx; dA[d++] = my; dA[d++] = -0.03;
        // seg 2: mid→tip
        dA[d++] = mx; dA[d++] = my; dA[d++] = -0.03;
        dA[d++] = tx; dA[d++] = ty; dA[d++] = -0.03;
      }
    }
    built.downy.attributes.position.needsUpdate = true;

    // ---- calamus (follows the base bend) ----
    const cA = built.calamus.attributes.position.array as Float32Array;
    const bx0 = shaftBaseX((SHAFT_BASE_Y - SHAFT_BASE_Y) / (TIP_Y - SHAFT_BASE_Y)) + bend(0);
    const bxTopP = (CAL_TOP_Y - SHAFT_BASE_Y) / (TIP_Y - SHAFT_BASE_Y);
    const bxTop = shaftBaseX(bxTopP) + bend(bxTopP);
    const wb = 0.085;
    const wt = 0.055;
    cA[0] = bx0 - wb; cA[1] = SHAFT_BASE_Y; cA[2] = 0;
    cA[3] = bx0 + wb; cA[4] = SHAFT_BASE_Y; cA[5] = 0;
    cA[6] = bxTop - wt; cA[7] = CAL_TOP_Y; cA[8] = 0;
    cA[9] = bxTop + wt; cA[10] = CAL_TOP_Y; cA[11] = 0;
    built.calamus.attributes.position.needsUpdate = true;

    // color channels (sensors 3/5/6/8) push the barbs toward their palette color
    const pal = engine.featherPalette;
    let cr = 0, cg = 0, cb = 0, cw = 0;
    for (let c = 0; c < SENSOR_CHANNELS.length; c++) {
      const ch = SENSOR_CHANNELS[c];
      if (ch.kind !== 'color' || ch.colorSlot == null) continue;
      const e = E[c];
      const pc = pal[ch.colorSlot];
      if (e > 0.01 && pc) {
        cr += pc[0] * e; cg += pc[1] * e; cb += pc[2] * e; cw += e;
      }
    }
    const colorEnergy = Math.min(1, cw);

    // ---- tinting: vane opens (more translucent) as the wind separates barbs --
    const m = built.mats;
    const vaneOp = (0.62 - drive * 0.4 + Math.sin(t * 1.5) * 0.02) * bloom; // fades in with the form
    m.vaneL.color.copy(col);
    m.vaneR.color.copy(col);
    m.vaneL.opacity = Math.max(0, vaneOp);
    m.vaneR.opacity = Math.max(0, vaneOp * 1.05);
    // The rachis is the SOURCE — colored by the chosen feather's palette ("reflect
    // the collection"), always present as the single line, brightening with wind.
    const pal0 = engine.featherPalette[0];
    if (pal0) m.rachis.color.setRGB(pal0[0], pal0[1], pal0[2]).lerp(new THREE.Color('#ffffff'), 0.18);
    else m.rachis.color.copy(bright);
    m.rachis.opacity = Math.min(1, 0.82 + (RACHIS_I >= 0 ? E[RACHIS_I] : 0) * 0.5);
    // barbs shift toward whichever color groups are being driven
    m.barbs.color.copy(col).lerp(bright, 0.3 + drive * 0.4);
    if (cw > 0) m.barbs.color.lerp(new THREE.Color(cr / cw, cg / cw, cb / cw), colorEnergy * 0.7);
    m.barbs.opacity = 0.4 + drive * 0.45 + colorEnergy * 0.3;
    // tail/down ruffles up when sensor_04 gets wind
    m.downy.color.copy(col).lerp(new THREE.Color('#bcae93'), 0.4);
    m.downy.opacity = (0.22 + drive * 0.25 + (TAIL_I >= 0 ? E[TAIL_I] : 0) * 0.4) * bloom;
  });

  return <primitive object={built.group} rotation={[0, 0, 0.06]} position={[0, -0.3, 0]} />;
}

// ---- photographic feather → 3D PARTICLE CLOUD ------------------------------
// We sample the chosen photo into thousands of colored particles, each placed in
// 3D by its pixel position (black background dropped). The rachis column is ~80%
// stable; every sensor effect moves/swirls its color group (or band) through 3D
// space. At idle the cloud collapses to the rachis line; the feather form blooms
// when the held feather is taken in hand.
//
//   attrib aColor      pixel color
//   attrib aH          0 tail … 1 tip (for region bands)
//   attrib aU          0 left … 1 right (for side masks)
//   attrib aStability  1 on the rachis → barely moves
//   attrib aGroup      nearest palette index (which color channel drives it)
//   attrib aSeed       per-particle randomness
const PART_SAMPLE_W = 110; // sampling resolution → ~10–15k particles
const PART_WORLD_H = 7.6;
const PART_DARK = 0.12;

// Phases (per interaction, escalating with engagement):
//   uBloom    phase 1 — line → barbs (form appears when any sensor is active)
//   uPattern  phase 2 — barbs → visible color/pattern of the active sensor(s)
//   uAudioMix phase 3 — that pattern starts moving AUDIO-REACTIVELY (level·gate)
//   uDisperse phase 4 — all 5 active → the piece flies across the whole screen
const PART_VERT = /* glsl */ `
  uniform float uTime, uBase, uBloom, uSize, uPattern, uAudioMix, uDisperse;
  uniform float uSway, uDisperseDist, uAudioReact, uStability, uGravity, uMotion, uWingBend, uRelief, uFall, uAudioColor, uDensityScale, uAmbient;
  // per-sensor rig (routing + movement + color)
  uniform float uEnergy[${NCH}];
  uniform float uPump[${NCH}];    // accumulated "balloon" activation per sensor
  uniform float uAudioCh[${NCH}]; // per-sensor loop level → that layer's reactivity
  uniform vec4  uRouteA[${NCH}];  // routing weight for layers 0..3
  uniform vec4  uRouteB[${NCH}];  // routing weight for layers 4..7
  uniform float uReach[${NCH}];
  uniform float uSwirl[${NCH}];
  uniform float uLift[${NCH}];
  uniform float uMaxDist[${NCH}];
  uniform float uMotionType[${NCH}]; // 0 swirl 1 rise 2 scatter 3 wave 4 flutter 5 pulse 6 fall
  uniform float uColorOn[${NCH}];
  uniform vec3  uColorRGB[${NCH}];
  uniform vec4  uRevealA;         // per-layer generated reveal, layers 0..3
  uniform vec4  uRevealB;         // layers 4..7
  uniform vec4  uPulseA;          // per-layer beat-pulse phase 0..1.x (>1.15 = idle)
  uniform vec4  uPulseB;
  uniform vec3  uPulseColor;      // color of the beat-pulse wave
  attribute vec3 aColor;
  attribute vec4 aMember0;        // membership in layers 0..3 (0/1)
  attribute vec4 aMember1;        // membership in layers 4..7
  attribute float aStability;
  attribute float aSeed;
  attribute float aGrow;          // reveal order: 0 = calamus root, 1 = barb tips
  varying vec3 vColor;
  varying float vGlow;
  varying float vTrig;            // 0 = dim contour, 1 = layer fully triggered
  varying float vDissolve;        // how far this particle has scattered (fades it)

  void main(){
    vec3 tint = aColor;
    vec3 base = position;
    float act = 0.0;
    // PHASE 1 — growth from the root: particles emerge from the calamus and pulse
    // up the rachis, then the barbs fill in (calamus → rachis → barbs).
    float grown = smoothstep(aGrow * 0.85, aGrow * 0.85 + 0.16, uBloom); // image grows in with 'f'
    float baseLum = dot(aColor, vec3(0.299, 0.587, 0.114));
    vec3 home = mix(vec3(0.0, base.y, 0.0), base, grown); // barbs spread out from the rachis
    home.z += baseLum * uRelief * grown;                  // 3D RELIEF: bright pixels toward the viewer
    float mob = (1.0 - aStability * uStability) * grown;
    float glow = 0.0;
    vec3 disp = vec3(0.0);
    disp.x += sin(uTime*0.8 + base.y*0.6) * (0.02 + uBase*0.2) * uSway;
    float patt = 0.35 + uPattern * 0.9;
    for(int i=0;i<${NCH};i++){
      float e = uEnergy[i] + uPump[i];
      if(e <= 0.001 && uAudioCh[i] <= 0.001) continue; // active OR its loop has sound
      // routing: does this particle belong to a layer this sensor drives?
      float route = clamp(dot(uRouteA[i], aMember0) + dot(uRouteB[i], aMember1), 0.0, 1.0);
      if(route <= 0.001) continue;
      // each sensor reacts to ITS OWN loop's level (uAudioCh) plus the global mic
      float audI = 1.0 + (uAudioMix + uAudioCh[i] * 1.6) * uAudioReact;
      // PHASE 2 → 3: low air settles the layer at its HOME (0) position (pattern
      // visible, no motion); motion only ramps in once it's pumped past the gate.
      float moveGate = smoothstep(0.55, 1.15, e);
      float infl = e * route * patt * audI;
      float ph = aSeed*6.2831 + uTime*2.5 + float(i)*1.7;
      float sw = uSwirl[i], lf = uLift[i];
      // direction away from the rachis (for radial / rise / pulse shapes)
      vec3 outward = normalize(vec3(base.x, 0.0, base.z) + vec3(0.0001, 0.0, 0.00007));
      int mt = int(uMotionType[i] + 0.5);
      vec3 di;
      if(mt == 1){               // RISE — drift up + bloom outward along the barbs
        di = outward * (0.4 + 0.6 * (0.5 + 0.5*sin(ph))) * sw
           + vec3(0.0, 0.7 + 0.3*sin(uTime*1.8 + aSeed*9.0), 0.0) * lf;
      } else if(mt == 2){        // SCATTER — radial burst from the rachis + grain
        di = outward * (0.5 + 0.7*sin(ph)) * sw
           + vec3(sin(ph*3.1), cos(ph*2.7), sin(ph*3.7)) * 0.35 * (sw + lf);
      } else if(mt == 3){        // WAVE — a sine wave travelling up the shaft
        float w = uTime*3.0 + base.y*2.4;
        di = vec3(sin(w), 0.0, cos(w*0.9)*0.6) * sw + vec3(0.0, sin(w*1.3)*0.25, 0.0) * lf;
      } else if(mt == 4){        // FLUTTER — fast fine jitter, like ruffled barbs
        float f = uTime*9.0 + aSeed*50.0;
        di = vec3(sin(f), cos(f*1.27), sin(f*0.73)) * 0.5 * sw + vec3(0.0, 0.0, sin(f*1.1)) * 0.4 * lf;
      } else if(mt == 5){        // PULSE — breathe out and in from the rachis
        float b = sin(uTime*2.2 + aSeed*3.0);
        di = outward * b * sw + vec3(0.0, b*0.4, 0.0) * lf;
      } else if(mt == 6){        // FALL — sink downward + sideways drift
        di = vec3(sin(ph)*0.3, -(0.6 + 0.4*fract(aSeed*7.0)), cos(ph)*0.2) * sw + vec3(0.0,0.0,0.0)*lf;
      } else if(mt == 7){        // PULSE FRONT/BACK — push toward & away from the screen (Z)
        float zp = sin(uTime*2.4 + aSeed*3.0);
        di = vec3(0.0, lf * 0.2 * sin(ph), sw * (0.6 + 0.4*zp) * sign(zp));
      } else {                   // SWIRL (default) — circular orbit
        di = vec3(cos(ph)*sw, sin(ph*1.3)*sw*0.5, sin(ph)*lf);
      }
      di *= infl * uReach[i] * moveGate;           // gated: no motion until pumped past phase 2
      float L = length(di);
      if(L > uMaxDist[i]) di *= uMaxDist[i] / L;   // per-sensor distance clamp
      disp += di;
      // COLOR module: recolor this layer toward the chosen colour as the sensor drives it
      if(uColorOn[i] > 0.5) tint = mix(tint, uColorRGB[i], clamp(e * route * 2.0, 0.0, 1.0));
      // AUDIO → COLOUR: this layer's loop level shifts its colour toward the pulse
      // colour and brightens it, so you SEE the sound on the feather.
      float ac = clamp(uAudioCh[i] * route * uAudioColor, 0.0, 1.0);
      tint = mix(tint, uPulseColor, ac * 0.7);
      glow += infl + ac;
    }
    // AMBIENT — a small always-on drift so the point cloud breathes even at
    // rest instead of freezing solid; each particle gets its own slow phase
    // from aSeed so the cloud feels alive rather than pulsing in lockstep.
    disp += vec3(
      sin(uTime*0.35 + aSeed*17.0),
      sin(uTime*0.27 + aSeed*23.0 + 1.7),
      sin(uTime*0.31 + aSeed*11.0 + 3.1)
    ) * uAmbient * 0.35;
    // per-layer PULSE: lrev is the layer's charge level (ramps in JS at the
    // layer's gen speed and restarts on every trigger). The charge FRONT travels
    // calamus → rachis → barbs along aGrow, so each wing-beat is a wave that
    // climbs the shaft and spreads out into the barbs.
    float lrev = max(dot(aMember0, uRevealA), dot(aMember1, uRevealB));
    float gpos = aGrow * 0.8;                       // front position along the shaft
    act = smoothstep(gpos, gpos + 0.2, lrev);       // steady colour: charged once front passes
    // BEAT PULSE: a wave (per-layer phase 0→1.x) sweeps up the shaft on each trigger.
    // The layer KEEPS its colour; the wave shows uPulseColor — no black de-charge.
    float pph = dot(aMember0, uPulseA) + dot(aMember1, uPulseB);
    float memb = clamp(dot(aMember0, vec4(1.0)) + dot(aMember1, vec4(1.0)), 0.0, 1.0);
    float flash = exp(-pow((gpos - pph) * 7.0, 2.0)) * step(pph, 1.15) * memb;
    // GRAVITY-SAND: only past the phase-3 gate (so phase-2 patterns stay settled).
    float moveP = smoothstep(0.55, 1.15, lrev);
    float sand = act * uGravity * (0.6 + uAudioMix * 1.2 * uAudioReact) * moveP;
    disp.y -= sand * (0.4 + 0.5 * fract(uTime * 0.25 + aSeed));
    disp += vec3(sin(uTime*3.1 + aSeed*30.0), cos(uTime*2.4 + aSeed*21.0), sin(uTime*2.7 + aSeed*15.0)) * sand * 0.15;
    // master Motion scales ALL displacement — at 0 every particle sits exactly on
    // the image (a perfect still), even with all sensors triggered + fully coloured.
    vec3 p = home + disp * mob * uMotion;
    if(uDisperse > 0.001){
      float t2 = uTime*0.5 + aSeed*40.0;
      vec3 flow = vec3(sin(t2)*6.0, cos(t2*0.8)*4.5, sin(t2*1.3)*3.0) * (0.6 + uAudioMix*1.4) * uDisperseDist * uMotion;
      p = mix(p, p + flow, uDisperse);
    }
    // IDLE SAND-FALL: when untouched, the feather crumbles DOWNWARD layer by layer
    // (barb tips first → calamus last) like little grains of sand falling away.
    float fdelay = (1.0 - aGrow) * 0.55;            // tips fall first, the shaft last
    float fp = clamp((uFall - fdelay) / 0.45, 0.0, 1.0);
    float fall = fp * fp;                           // accelerate like gravity
    p.y -= fall * 7.0;
    p.x += sin(uTime * 2.5 + aSeed * 40.0) * fall * 0.45;
    p.z += cos(uTime * 2.1 + aSeed * 31.0) * fall * 0.25;
    // the particles ARE the image: full colour, with the beat-pulse wave on top
    vColor = mix(tint, uPulseColor, clamp(flash, 0.0, 1.0));
    vTrig = grown * (1.0 - fp);                     // present, fading as it falls away
    glow += flash;
    vDissolve = clamp((length(p - home) - 0.45) * 0.5, 0.0, 1.0); // scatter → fade
    vGlow = glow * (0.6 + uPattern);
    // WING-BEAT: the whole feather swings forward/back, anchored at the calamus
    // (bottom fixed, tip moves most) — amplitude grows with activation.
    float hf = clamp((base.y + ${(PART_WORLD_H * 0.5).toFixed(2)}) / ${PART_WORLD_H.toFixed(2)}, 0.0, 1.0);
    float swing = sin(uTime * 2.2) * uWingBend * hf * hf;
    p.x += swing; p.z += swing * 0.4;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // point size auto-scales DOWN as particle density rises, so high-res builds
    // stay crisp (tile, not mush) instead of bloating into blobs.
    gl_PointSize = clamp(uSize * uDensityScale * grown / -mv.z, 0.0, 12.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const PART_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vGlow;
  varying float vTrig;
  varying float vDissolve;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c);
    if(d2 > 0.25) discard;                         // round soft point
    float a = smoothstep(0.25, 0.06, d2);
    a *= clamp(vTrig, 0.0, 1.0);                    // invisible at rest (photo shows) → appears when triggered/moving
    a *= 1.0 - vDissolve * 0.62;                    // scattered particles dissolve (sand)
    if(a < 0.004) discard;
    gl_FragColor = vec4(vColor * (1.0 + vGlow*0.4), a);
  }
`;

function buildParticles(img: HTMLImageElement, palette: number[][], layers: LayerDef[]): THREE.Points {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const aspect = ih ? iw / ih : 0.3;
  const w = particleSampleW(); // particle amount → sampling resolution (GPU-capped)
  const h = Math.max(1, Math.round(w / (aspect || 0.3)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // horizontal centre of the feather (so the rachis ends up at x = 0)
  let minU = 1;
  let maxU = 0;
  let any = false;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      if (lum < PART_DARK) continue;
      const u = x / (w - 1);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      any = true;
    }
  const centerU = any ? (minU + maxU) / 2 : 0.5;
  const worldW = PART_WORLD_H * aspect;

  const pos: number[] = [];
  const col: number[] = [];
  const aStab: number[] = [];
  const aSeed: number[] = [];
  const aGrow: number[] = []; // reveal order: 0 = calamus root → 1 = barb tips
  const aMem0: number[] = []; // membership in layers 0..3
  const aMem1: number[] = []; // membership in layers 4..7
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      if (0.299 * r + 0.587 * g + 0.114 * b < PART_DARK) continue;
      const u = x / (w - 1);
      const v = y / (h - 1);
      const px = (u - centerU) * worldW;
      pos.push(px, (0.5 - v) * PART_WORLD_H, 0);
      col.push(r, g, b);
      const stab = Math.max(0, 1 - Math.abs(px) / (worldW * 0.16));
      aStab.push(stab);
      aSeed.push(Math.random());
      // grows bottom-up (calamus v=1 first → tip last); rachis reveals before barbs
      aGrow.push(Math.min(1, (1 - v) * 0.55 + (1 - stab) * 0.45));
      // nearest auto cluster (for 'auto' layer membership) — uses the layer's
      // color SOURCE (which may be a user override from the matrix), so editing a
      // matrix colour re-assigns which pixels belong to that layer.
      let gi = 0;
      let gd = Infinity;
      for (let k = 0; k < layers.length; k++) {
        const L = layers[k];
        if (L.kind !== 'auto' || !L.rgb) continue;
        const d = (r - L.rgb[0]) ** 2 + (g - L.rgb[1]) ** 2 + (b - L.rgb[2]) ** 2;
        if (d < gd) {
          gd = d;
          gi = k;
        }
      }
      // membership across all combined layers (auto + custom color/area)
      const m = layerMembership(layers, r, g, b, 1 - v, gi);
      aMem0.push(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0);
      aMem1.push(m[4] ?? 0, m[5] ?? 0, m[6] ?? 0, m[7] ?? 0);
    }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aStability', new THREE.Float32BufferAttribute(aStab, 1));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(aSeed, 1));
  geo.setAttribute('aGrow', new THREE.Float32BufferAttribute(aGrow, 1));
  geo.setAttribute('aMember0', new THREE.Float32BufferAttribute(aMem0, 4));
  geo.setAttribute('aMember1', new THREE.Float32BufferAttribute(aMem1, 4));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uBase: { value: 0 },
      uBloom: { value: 0 },
      uSize: { value: DEFAULT_GLOBAL.size * DEVICE_SIZE_SCALE },
      uPattern: { value: 0 },
      uAudioMix: { value: 0 },
      uAudioCh: { value: new Array(NCH).fill(0) },
      uDisperse: { value: 0 },
      uSway: { value: DEFAULT_GLOBAL.sway },
      uDisperseDist: { value: DEFAULT_GLOBAL.disperse },
      uAudioReact: { value: DEFAULT_GLOBAL.audioReact },
      uStability: { value: DEFAULT_GLOBAL.stability },
      uGravity: { value: DEFAULT_GLOBAL.gravity },
      uMotion: { value: DEFAULT_GLOBAL.motion },
      uAmbient: { value: DEFAULT_GLOBAL.ambient },
      uWingBend: { value: 0 },
      uRelief: { value: DEFAULT_GLOBAL.relief },
      uFall: { value: 0 },
      uAudioColor: { value: DEFAULT_GLOBAL.audioColor },
      uDensityScale: { value: PART_W_REF / w }, // smaller points at higher density
      // per-sensor rig
      uEnergy: { value: new Array(NCH).fill(0) },
      uPump: { value: new Array(NCH).fill(0) },
      uRouteA: { value: SENSOR_CHANNELS.map(() => new THREE.Vector4()) },
      uRouteB: { value: SENSOR_CHANNELS.map(() => new THREE.Vector4()) },
      uReach: { value: new Array(NCH).fill(0.5) },
      uSwirl: { value: new Array(NCH).fill(0.6) },
      uLift: { value: new Array(NCH).fill(0.6) },
      uMaxDist: { value: new Array(NCH).fill(1.1) },
      uMotionType: { value: new Array(NCH).fill(0) },
      uColorOn: { value: new Array(NCH).fill(0) },
      uColorRGB: { value: SENSOR_CHANNELS.map(() => new THREE.Vector3(1, 1, 1)) },
      uRevealA: { value: new THREE.Vector4() },
      uRevealB: { value: new THREE.Vector4() },
      uPulseA: { value: new THREE.Vector4(2, 2, 2, 2) },
      uPulseB: { value: new THREE.Vector4(2, 2, 2, 2) },
      uPulseColor: { value: new THREE.Vector3(1, 0.85, 0.5) },
    },
    vertexShader: PART_VERT,
    fragmentShader: PART_FRAG,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return points;
}

function ImageFeather({
  engine,
  audio,
  src,
  featherId,
}: {
  engine: WingbeatEngine;
  audio: AudioEngine;
  src: string;
  featherId: string;
}) {
  const energies = useRef(new Float32Array(NCH));
  const pumps = useRef(new Float32Array(NCH));
  const reveals = useRef(new Float32Array(MAX_LAYERS));   // per-layer charge level
  const revealTgt = useRef(new Float32Array(MAX_LAYERS)); // scratch: charge targets
  const pulses = useRef(new Float32Array(MAX_LAYERS).fill(2)); // per-layer beat wave (2 = idle)
  const floatHold = useRef(new Float32Array(NCH)); // seconds left of "float" before air sinks
  const lastT = useRef(0);
  const wingRef = useRef(0); // smoothed wing-beat swing amplitude
  const idleRef = useRef(0); // seconds since last interaction (→ sand-fall)
  const fallRef = useRef(0); // smoothed sand-fall amount 0..1
  const baseRef = useRef(0);
  const bloomRef = useRef(0);
  const engageRef = useRef(0);
  const disperseRef = useRef(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<THREE.Points | null>(null);

  // Each triggered sound (melody/perc/accent) PUMPS that sensor's channel — like
  // inflating a balloon: more triggers → more activation. Deflates by release.
  useEffect(() => {
    const kick = (e: { id: string; velocity: number }) => {
      const idx = SENSOR_INDEX.get(e.id);
      if (idx == null) return;
      pumps.current[idx] = Math.min(1.8, pumps.current[idx] + 0.3 * (0.4 + e.velocity * 0.6));
      floatHold.current[idx] = rig.global.floatTime; // a pump refreshes the float window
      // launch a beat WAVE on this sensor's routed layers — it sweeps the pulse
      // color up calamus→rachis→barbs WITHOUT de-charging the layer (no black).
      const s = rig.sensors[e.id];
      if (s) for (const li of s.layers) if (li < MAX_LAYERS) pulses.current[li] = 0;
    };
    const offs = [engine.on('melody', kick), engine.on('perc', kick), engine.on('accent', kick)];
    return () => offs.forEach((o) => o());
  }, [engine]);

  // (Re)analyze with the current layer count + build the particle cloud.
  const rebuild = useRef((image: HTMLImageElement) => {
    try {
      const { palette, counts } = analyzeFeatherImage(image, rig.autoK);
      engine.setFeatherPalette(palette, counts);
      const pts = buildParticles(image, palette, combinedLayers(palette));
      setPoints((prev) => {
        prev?.geometry.dispose();
        (prev?.material as THREE.Material | undefined)?.dispose();
        return pts;
      });
    } catch (err) {
      console.error('[wingbeat] particle build failed', err);
    }
  });

  // Rebuild when the user edits layers (auto count / custom color or area layers).
  useEffect(() => onLayersChange(() => imgRef.current && rebuild.current(imgRef.current)), []);

  // Build the particle cloud when the feather changes.
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return;
      imgRef.current = image;
      // auto-save the OUTGOING feather's settings, then auto-load THIS feather's
      // settings (its 'last', else defaults) — settings follow each feather.
      if (rig.feather && rig.feather !== featherId) saveLast(rig.feather);
      if (!recallLast(featherId)) loadIntoRig(defaultPreset(featherId));
      rig.feather = featherId;
      rebuild.current(image);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, engine, featherId]);

  useFrame((state) => {
    if (!points) return;
    readChannelEnergies(engine, energies.current);
    const E = energies.current;
    let maxW = 0;
    for (const n of engine.getNodes()) if (n.wind > maxW) maxW = n.wind;
    // per-sensor activation = held wind + accumulated pump
    let maxE = 0;
    let maxAct = 0;
    let minAct = Infinity;
    let totalAir = 0;
    let active = 0;
    for (let i = 0; i < NCH; i++) {
      const e = E[i];
      const act = e + pumps.current[i];
      if (e > maxE) maxE = e;
      if (act > maxAct) maxAct = act;
      if (act < minAct) minAct = act;
      totalAir += Math.min(1.2, act);
      if (act > 0.12) active++;
    }
    baseRef.current += (maxW - baseRef.current) * 0.08;

    // PHASE 1 — pressing 'f' (feather in hand) GROWS the 3D contour in from the
    // rachis (calamus→rachis→barbs) as a dim grey silhouette. Sensor pulses then
    // reveal the coloured layers on top. No 'f' and no activity → it collapses away.
    const f = engine.getNode('feather_01');
    const featherAct = f?.present ? 1.15 : (f?.wind ?? 0) * 1.1;
    // auto-audio keeps the feather present so its layers can dance to the loops
    const bloomTarget = Math.min(1.15, Math.max(featherAct, maxAct, rig.global.autoAudio ? 0.7 : 0));
    bloomRef.current += (bloomTarget - bloomRef.current) * 0.05;

    // engagement → phase gates 2 (pattern visible) and 3 (audio-reactive)
    engageRef.current += (maxAct - engageRef.current) * 0.07;
    const eng = engageRef.current;
    const p2 = smooth01(eng, 0.12, 0.5);
    const p3 = smooth01(eng, 0.4, 0.85);
    const audioLevel = audio.getLevel();

    // PHASE 4 — disperse only when ALL sensors are pumped HARD (not just lightly
    // active), so a gentle all-5 press keeps the settled image instead of noise.
    const allHard = active >= NCH ? smooth01(minAct, 0.7, 1.4) : 0;
    disperseRef.current += (allHard - disperseRef.current) * 0.025;

    const u = (points.material as THREE.ShaderMaterial).uniforms;
    const tNow = state.clock.getElapsedTime();
    const dt = Math.min(0.05, Math.max(0, tNow - lastT.current));
    lastT.current = tNow;
    u.uTime.value = tNow;
    u.uBase.value = baseRef.current;
    u.uBloom.value = bloomRef.current;
    u.uPattern.value = p2;
    u.uAudioMix.value = p3 * audioLevel;
    u.uDisperse.value = disperseRef.current;
    // global rig + per-sensor rig (panel edits apply every frame)
    const g = rig.global;
    u.uSway.value = g.sway;
    u.uDisperseDist.value = g.disperse;
    u.uAudioReact.value = g.audioReact;
    u.uStability.value = g.stability;
    u.uGravity.value = g.gravity;
    u.uMotion.value = g.motion;
    u.uAmbient.value = g.ambient;
    u.uSize.value = g.size * DEVICE_SIZE_SCALE;
    // WING-BEAT swing amplitude grows with total activation (all-5 → rachis swings most)
    const wingTarget = Math.min(1, totalAir / 4) * g.wingBeat;
    wingRef.current += (wingTarget - wingRef.current) * 0.05;
    u.uWingBend.value = wingRef.current;
    u.uRelief.value = g.relief;
    u.uAudioColor.value = g.audioColor;
    // IDLE SAND-FALL: after `idleFall` seconds with no interaction, the feather
    // crumbles down like sand; any interaction resets it and it reassembles.
    if (maxAct > 0.1) idleRef.current = 0;
    else idleRef.current += dt;
    const falling = idleRef.current > g.idleFall && bloomRef.current > 0.05;
    fallRef.current += ((falling ? 1 : 0) - fallRef.current) * (falling ? 0.015 : 0.1);
    u.uFall.value = fallRef.current;
    const ru = packRigUniforms();
    const arr = u.uEnergy.value as number[];
    const pmp = u.uPump.value as number[];
    const audioCh = u.uAudioCh.value as number[];
    const reach = u.uReach.value as number[];
    const swirl = u.uSwirl.value as number[];
    const lift = u.uLift.value as number[];
    const maxd = u.uMaxDist.value as number[];
    const motionType = u.uMotionType.value as number[];
    const colorOn = u.uColorOn.value as number[];
    const routeA = u.uRouteA.value as THREE.Vector4[];
    const routeB = u.uRouteB.value as THREE.Vector4[];
    const crgb = u.uColorRGB.value as THREE.Vector3[];
    for (let i = 0; i < NCH; i++) {
      reach[i] = ru.uReach[i];
      swirl[i] = ru.uSwirl[i];
      lift[i] = ru.uLift[i];
      maxd[i] = ru.uMaxDist[i];
      motionType[i] = ru.uMotionType[i];
      colorOn[i] = ru.uColorOn[i];
      routeA[i].set(ru.uRouteA[i * 4], ru.uRouteA[i * 4 + 1], ru.uRouteA[i * 4 + 2], ru.uRouteA[i * 4 + 3]);
      routeB[i].set(ru.uRouteB[i * 4], ru.uRouteB[i * 4 + 1], ru.uRouteB[i * 4 + 2], ru.uRouteB[i * 4 + 3]);
      crgb[i].set(ru.uColorRGB[i * 3], ru.uColorRGB[i * 3 + 1], ru.uColorRGB[i * 3 + 2]);
      arr[i] = E[i];
      // AIR PUMP: while the sensor is held, air pumps IN at the attack rate; when
      // released it leaks OUT at the release rate — attack/release shape how the
      // pixels inflate and settle. Trigger events add an extra puff (see kick).
      // BALLOON / FLIGHT physics: pumping (held wind or a trigger) adds air and
      // refreshes the float window; while floating the air HOLDS; once the float
      // window runs out with no pumping it slowly sinks (loses height).
      if (E[i] > 0.08) {
        pumps.current[i] += (1.5 - pumps.current[i]) * ru.attack[i] * 0.7;
        floatHold.current[i] = rig.global.floatTime;
      } else if (floatHold.current[i] > 0) {
        floatHold.current[i] -= dt;                 // floating — keep height
      } else {
        pumps.current[i] *= 1 - ru.release[i] * 0.5; // sinking — lose height
      }
      // each layer reacts to ITS OWN loop, on the EQ band it's routed to
      const sid = SENSOR_CHANNELS[i].sensor;
      const sr = rig.sensors[sid];
      const band = sr?.audioBand ?? 'full';
      const rawBand = band === 'custom' && sr?.audioBandRange
        ? audio.getLoopBandRange(sid, sr.audioBandRange[0], sr.audioBandRange[1])
        : audio.getLoopBand(sid, band === 'custom' ? 'full' : band);
      // Share ONE input gain with the motion path (App.tsx applies the same
      // sensitivity to holdWind), so Sensitivity scales the audio-reactive glow
      // and the EQ band together instead of them drifting as independent gains.
      audioCh[i] = Math.min(1, rawBand * (sr?.sensitivity ?? 1));
      // AUTO-AUDIO: loops play on their own and DRIVE their layer (charge / colour /
      // motion) without any sensor trigger — each loop animates a different layer.
      if (g.autoAudio && audio.hasLoop(sid)) {
        audio.setLoopGain(sid, 0.9);
        pumps.current[i] = Math.max(pumps.current[i], audioCh[i] * 1.4);
      }
      pmp[i] = pumps.current[i];
    }

    // per-layer CHARGE: each layer's reveal ramps toward its routed activation at
    // the layer's gen speed (restarted to ~0 on each trigger). As it rises 0→1 the
    // charge front climbs the shaft (calamus→rachis→barbs), revealing colour.
    const tgt = revealTgt.current;
    tgt.fill(0);
    for (let i = 0; i < NCH; i++) {
      const a = Math.min(1, E[i] + pumps.current[i]);
      const s = rig.sensors[SENSOR_CHANNELS[i].sensor];
      if (!s) continue;
      for (const li of s.layers) if (li < MAX_LAYERS && a > tgt[li]) tgt[li] = a;
    }
    const rv = reveals.current;
    const hold = Math.max(0, Math.min(1, g.hold)); // 1 = latch layers visible
    for (let L = 0; L < MAX_LAYERS; L++) {
      // per-layer ATTACK climbs the charge; RELEASE decays it, but the global
      // Layer-hold fader slows/freezes the decay so layers stay visible.
      const rate = tgt[L] > rv[L] ? layerGen(L) : layerRelease(L) * (1 - hold);
      rv[L] += (tgt[L] - rv[L]) * rate;
    }
    (u.uRevealA.value as THREE.Vector4).set(rv[0], rv[1], rv[2], rv[3]);
    (u.uRevealB.value as THREE.Vector4).set(rv[4], rv[5], rv[6], rv[7]);

    // advance each layer's beat wave up the shaft (at its attack speed); >1.2 = done
    const pl = pulses.current;
    for (let L = 0; L < MAX_LAYERS; L++) if (pl[L] <= 1.2) pl[L] += 0.04 + layerGen(L);
    (u.uPulseA.value as THREE.Vector4).set(pl[0], pl[1], pl[2], pl[3]);
    (u.uPulseB.value as THREE.Vector4).set(pl[4], pl[5], pl[6], pl[7]);
    const pc = rig.global.pulseColor;
    (u.uPulseColor.value as THREE.Vector3).set(pc[0], pc[1], pc[2]);

  });

  return points ? <primitive object={points} position={[0, -0.1, 0]} /> : null;
}

// Memoized: the 3D scene reads the engine live in its frame loop, so it must NOT
// re-render on the App's 30fps snapshot updates (that would re-run the build
// effect every frame and reset the rig). Only re-render when the feather changes.
export const Projection = memo(function Projection({
  engine,
  audio,
  featherId,
  paused = false,
}: {
  engine: WingbeatEngine;
  audio: AudioEngine;
  featherId: string;
  /** When true the render loop stops (frameloop="never") — used while the
   *  /feather display window is open so the GPU only renders one feather. */
  paused?: boolean;
}) {
  const item = getFeather(featherId);
  return (
    <Canvas
      frameloop={paused ? 'never' : 'always'}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      dpr={[1, 2]}
      camera={{ position: [0, 0.4, 11], fov: 48 }}
    >
      <color attach="background" args={['#050507']} />
      {/* drag to spin around · scroll/pinch to zoom into the high-res detail */}
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        target={[0, -0.1, 0]}
        minDistance={2.5}
        maxDistance={22}
        rotateSpeed={0.6}
        zoomSpeed={0.9}
      />
      {item.procedural ? (
        <ProceduralFeather engine={engine} />
      ) : (
        <ImageFeather engine={engine} audio={audio} src={item.src} featherId={item.id} key={item.src} />
      )}
    </Canvas>
  );
});
