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
// raw-three orbit control; the drei one used in /sim needs a react-three-fiber
// tree, and this page renders itself
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Chromatic aberration — splits the channels radially from centre. Routed from
 * the matrix, so a snare can crack the image apart for a few frames without
 * anything in the scene moving.
 */
const ABERRATION = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, amount: { value: 0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - 0.5;
      float d = length(dir);
      float r = texture2D(tDiffuse, vUv - dir * amount * d).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv + dir * amount * d).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};
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

// ---------------------------------------------------------------------------
//  ROUTING MATRIX — which musical element drives which part of the feather.
//
//  Before this, every response was hardwired: markings answered the kick, the
//  vane answered the bass, and that was the instrument. The matrix makes the
//  patch the user's decision instead, and because the rows are ELEMENTS rather
//  than frequency bands, "vocal moves the fringe" is a thing that can now be
//  said at all.
//
//  A row's own dynamics carry the character — kick and snare arrive as decaying
//  transients, pad and vocal as sustained levels — so one gain per cell is
//  enough. Summing a spiky row into a smooth one gives a target that both
//  breathes and snaps, with no extra machinery.
// ---------------------------------------------------------------------------
const LOOK_KEY = 'f2.look';

/** Point-cloud appearance and camera behaviour — all per-browser, all saved. */
type Look = { size: number; soft: number; alpha: number; volume: number; bloom: number; dof: number; aberr: number; spin: boolean; ghost: boolean };
function loadLook(): Look {
  const look: Look = { size: 1, soft: 0.55, alpha: 0.92, volume: 1, bloom: 0.5, dof: 0.25, aberr: 0.5, spin: true, ghost: true };
  try {
    const saved = JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}') as Partial<Look>;
    for (const k of ['size', 'soft', 'alpha', 'volume', 'bloom', 'dof', 'aberr'] as const) {
      const v = Number(saved[k]);
      if (Number.isFinite(v)) look[k] = Math.max(0, Math.min(3, v));
    }
    if (typeof saved.spin === 'boolean') look.spin = saved.spin;
    if (typeof saved.ghost === 'boolean') look.ghost = saved.ghost;
  } catch { /* fresh defaults */ }
  return look;
}

const ROUTES_KEY = 'f2.routes';
/** Ceiling on any one column's summed drive — see the render loop. */
const DRIVE_MAX = 1.6;

/** Row order is roughly rhythm → pitch → texture, which reads top to bottom. */
const ELEMENTS = [
  { id: 'sub', label: 'Sub', hint: 'the floor you feel, 20–60 Hz' },
  { id: 'kick', label: 'Kick', hint: 'low-band transient' },
  { id: 'snare', label: 'Snare', hint: 'shell-band transient' },
  { id: 'hat', label: 'Hat', hint: 'top-band transient' },
  { id: 'perc', label: 'Perc', hint: 'everything percussive, drums or not' },
  { id: 'bass', label: 'Bass', hint: 'pitched low end, kick removed' },
  { id: 'lead', label: 'Lead', hint: 'the dominant melodic line' },
  { id: 'vocal', label: 'Vocal', hint: 'centre-extracted voice' },
  { id: 'pad', label: 'Pad', hint: 'sustained chordal bed' },
  { id: 'space', label: 'Space', hint: 'stereo sides: reverb, wideners' },
  { id: 'note', label: 'Note', hint: 'pulses when the lead changes note' },
  { id: 'vibrato', label: 'Vibrato', hint: 'how much the lead WOBBLES — the sung-line tell' },
  { id: 'bright', label: 'Bright', hint: 'spectral centroid: dark mix … brilliant one' },
] as const;
type ElementId = (typeof ELEMENTS)[number]['id'];

const TARGETS = [
  { id: 'eye', label: 'Markings', short: 'MRK' },
  { id: 'flex', label: 'Shaft flex', short: 'SHF' },
  { id: 'wave', label: 'Vane wave', short: 'VAN' },
  { id: 'fringe', label: 'Fringe', short: 'FRG' },
  { id: 'shimmer', label: 'Barb shimmer', short: 'SHM' },
  { id: 'color', label: 'Colour', short: 'COL' },
  { id: 'depth', label: 'Layer depth', short: 'DEP' },
  // targets the post-processing chain and the camera made possible
  { id: 'bloom', label: 'Bloom', short: 'BLM' },
  { id: 'focus', label: 'Focus pull', short: 'FOC' },
  { id: 'push', label: 'Camera push', short: 'PSH' },
  { id: 'shake', label: 'Shake', short: 'SHK' },
  { id: 'aberr', label: 'Aberration', short: 'ABR' },
] as const;
type TargetId = (typeof TARGETS)[number]['id'];

type Routes = Record<ElementId, Partial<Record<TargetId, number>>>;

/** The hardwired patch this replaced, so an existing feather behaves the same. */
function defaultRoutes(): Routes {
  const r = {} as Routes;
  for (const e of ELEMENTS) r[e.id] = {};
  r.kick.eye = 1;
  r.snare.eye = 0.4;
  r.kick.flex = 0.5;
  r.sub.flex = 0.8;
  r.bass.flex = 0.5;
  r.bass.wave = 0.7;
  r.pad.wave = 0.4;
  r.snare.fringe = 0.8;
  r.hat.fringe = 0.5;
  r.hat.shimmer = 0.5;
  r.space.shimmer = 0.8;
  r.lead.color = 0.7;
  r.vocal.color = 0.6;
  r.perc.depth = 0.5;
  r.pad.depth = 0.4;
  // the new columns, patched conservatively — audible but not gaudy
  r.kick.bloom = 0.6;
  r.pad.bloom = 0.3;
  r.note.focus = 0.7;   // rack-focus on every melodic change
  r.sub.push = 0.4;
  r.kick.shake = 0.35;
  r.snare.aberr = 0.5;
  r.vibrato.shimmer = 0.5;
  r.bright.color = 0.35;
  return r;
}

function loadRoutes(): Routes {
  const base = defaultRoutes();
  try {
    const saved = JSON.parse(localStorage.getItem(ROUTES_KEY) ?? 'null') as Routes | null;
    if (!saved) return base;
    // A saved patch is only authoritative if it is COMPLETE — every write puts
    // all rows down, so a missing row means an older or truncated value. Taking
    // a partial one at face value would silently wipe every default and leave
    // a feather that just never responds to audio, with nothing on screen to
    // say why. Same defensive shape as loadAmps.
    if (ELEMENTS.some((e) => !saved[e.id] || typeof saved[e.id] !== 'object')) return base;
    const out = {} as Routes;
    for (const e of ELEMENTS) {
      out[e.id] = {};
      for (const t of TARGETS) {
        const v = Number(saved[e.id]?.[t.id]);
        if (Number.isFinite(v) && v > 0) out[e.id][t.id] = Math.min(1, v);
      }
    }
    return out;
  } catch {
    return base;
  }
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
  uniform float uPhase;     // 0..1 within the beat, from the tempo tracker
  uniform float uLock;      // how much to trust that phase
  uniform float uIdle;      // 1 when nothing is playing
  // One routed drive per target: the matrix sum for that column, already
  // scaled by the column's amount slider. What used to be a hardwired band is
  // now whatever the user patched into it.
  uniform float uDrvEye;
  uniform float uDrvWave;
  uniform float uDrvShimmer;
  uniform float uDrvFlex;
  uniform float uDrvFlexHit;  // just the RISE of the flex column
  uniform float uDrvFringe;
  uniform float uAmpDepth;   // static depth SCALE, not routed
  uniform float uDrvDepth;   // routed depth animation
  uniform float uVolume;     // how much real 3D shape the feather has
  uniform float uHalfW;      // the feather's half-width in world units
  uniform float uSize;       // user point-size multiplier
  uniform float uFocus;      // camera distance to the orbit target
  uniform float uDof;        // 0 off … 1 shallow
  uniform float uAntic;      // signed: winds NEGATIVE before a beat, snaps back after
  uniform float uShed;       // 0..1 transient that throws loose barbs off the vane
  uniform float uLeadNote;   // 0..1 pitch class of the lead, -1 when untracked
  uniform float uNoteLight;  // how brightly the played note lights its band
  uniform float uRate;       // idle motion speed, locked to the track's tempo
  uniform float uPointScale;

  varying vec3 vColor;
  varying float vPart;
  varying float vGlow;
  varying float vRim;
  varying float vLoose;
  varying float vFlow;
  varying float vSpine;
  varying float vCoc;
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
    // the resting sway runs at the TRACK's tempo rather than a fixed rate, so
    // a slow song breathes slowly and a fast one does not feel becalmed
    float swing = sin(uTime * 0.62 * uRate + uPhase * 6.2831 * 0.5);
    float flex = (0.010 + 0.10 * uDrvFlex) * swing * (0.30 + 0.70 * alive);
    // The whip has to ride the RISE of the column, not its level: driven by a
    // sustained row like Sub it became a permanent 4 Hz buzz instead of a snap
    // on each hit.
    flex += uDrvFlexHit * 0.16 * sin(uTime * 26.0);
    // ANTICIPATION. The tempo tracker knows where the beat WILL land, so the
    // shaft winds up against the coming hit and is already travelling when it
    // arrives. Reacting only after the transient is what makes a visualiser
    // look like a meter; leaning in first is what makes it look like it is
    // playing along. Scaled by lock, so an untracked passage just doesn't.
    flex += uAntic * 0.055;
    P.x += flex * cant;
    P.y -= abs(flex) * cant * 0.22;   // a bent shaft is shorter along its axis

    // ---- 2. VANE — the bass wave travels along the REAL barb direction, and
    // is scaled by two measured fields instead of one guessed band: how loose
    // the strands are here, and how close to the fringe they sit.
    if (part != 0.0 && part != 1.0) {
      float travel = aUV.y * 7.0 - uTime * 2.1 - uPhase * 6.2831;
      float wv = sin(travel + aUV.x * 1.5);
      float amp = uDrvWave * abs(aUV.x)
                * (0.008 + 0.070 * loose)
                * (0.30 + 0.90 * rim);
      P.xy += aBarb * wv * amp;
      P.y += cos(aUV.y * 6.0 + uTime * 1.8) * amp * 0.28 * loose;
      // idle breathing, so a silent feather still lives
      P.xy += aBarb * sin(aUV.y * 3.0 + uTime * 0.8) * uIdle * 0.006 * (0.2 + loose) * abs(aUV.x);
      glow += uDrvWave * 0.18 * loose;
    }

    // ---- 3. FRINGE — snare and hat flick the OUTER barbs and briefly unzip
    // them, sliding neighbours apart along their own length. Only the rim can
    // do this; the core of the vane is a sheet and stays a sheet.
    vec2 nrm = vec2(-aBarb.y, aBarb.x);
    float trans = uDrvFringe;
    float fringe = rim * rim * (0.25 + 0.75 * loose) * (1.0 - spine);
    P.xy += aBarb * trans * fringe * (0.012 + 0.045 * seed);
    P.xy += nrm * trans * fringe * 0.028 * (seed - 0.5);
    glow += trans * fringe * 0.9;

    // ---- 4. SHIMMER — the top end rings the FIRM barbs along their length.
    // Trusted only where the striations were actually legible (flow), so a
    // blurred photo shimmers gently instead of buzzing in random directions.
    float jit = seed - 0.5;
    float ring = uDrvShimmer * (0.004 + 0.014 * (1.0 - loose)) * (0.35 + 0.65 * flow);
    P.xy += aBarb * jit * ring * (1.0 - spine);
    glow += uDrvShimmer * 0.24 * abs(jit) * 2.0 * (1.0 - loose);

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
      float kick = uDrvEye * (0.40 + 0.90 * str) * gate;

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
      glow += uDrvEye * (1.0 - smoothstep(0.1, 1.5, acr))
            * (part == 4.0 ? 1.1 : 0.7) * (0.4 + 0.8 * str);
    }

    // ---- 6. DEPTH — the anatomical layers pull APART in z: the shaft stands
    // proud, the markings float above the vane, the down hangs behind it. The
    // cloud turns slowly (see the render loop) so that reads as parallax and
    // not merely as scale, and every hit pushes the layers further apart.
    float layer = part == 0.0 ? -0.15 : part == 1.0 ? 0.25 : part == 3.0 ? -0.60 : 0.0;
    layer += rim * 0.22 - loose * 0.35;
    if (kind > 0.5) layer += 0.45 + 0.35 * aPatC.x;
    float spread = 0.55 + 0.45 * uDrvDepth;
    P.z = layer * 0.30 * uAmpDepth * spread;

    // ---- 6b. SHED AND RETURN. On a hard transient the loosest barbs let go,
    // drift off the vane and are drawn back as the envelope decays. No
    // per-particle state is needed: uShed is a decaying pulse and each barb
    // has a fixed random direction, so the return is the decay itself.
    if (uShed > 0.001 && loose > 0.15) {
      float grab = loose * uShed * (0.35 + 0.65 * seed);
      vec3 away = normalize(vec3(seed - 0.5, hash(position.yx * 37.0) - 0.5, hash(position.xy * 13.0) - 0.5) + 1e-5);
      P += away * grab * 0.16;
    }

    // ---- 7. VOLUME — a feather is not a sheet of paper.
    // Until now every particle sat at z = 0 and the only depth was the layer
    // offset above, so turning the cloud edge-on showed almost nothing. These
    // are the four things that actually give a real feather its body:
    //   camber  the vane dishes away from the shaft toward both edges
    //   ridge   the rachis is a rounded shaft standing proud of the vane
    //   twist   the blade rotates along its length, edge rising toward the tip
    //   puff    down is a cloud, not a surface, so it scatters through z
    // Every term is scaled by the feather's own half-width. Written in absolute
    // world units these overshot badly: a feather is only ~0.25 wide, so a
    // camber of 0.30 made the cloud DEEPER than it is broad and turned the
    // silhouette into a blob when you spun it. Depth has to stay a fraction of
    // width or it stops being a feather.
    float hw = max(0.05, uHalfW);
    float uu = aUV.x;
    float camber = -(uu * uu) * hw * 0.55;
    float ridge  = spine * hw * 0.40 * sqrt(max(0.0, 1.0 - min(1.0, abs(uu) * 3.0)));
    float twist  = uu * (aUV.y - 0.35) * hw * 0.45;
    float puff   = (seed - 0.5) * 2.0 * loose * hw * 0.70;
    P.z += (camber + ridge + twist + puff) * uVolume;

    // THE MELODY PLAYS THE FEATHER. The lead's pitch class maps to a band along
    // the shaft, so a rising line walks a bright zone from calamus to tip and
    // the feather is read like a fretboard rather than a level meter.
    if (uLeadNote >= 0.0 && uNoteLight > 0.001) {
      float band = 1.0 - smoothstep(0.0, 0.13, abs(aUV.y - uLeadNote));
      glow += band * uNoteLight * (0.35 + 0.65 * (1.0 - loose));
    }

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
    float size = uPointScale * uSize * (1.0 + glow * 0.6) * (0.82 + 0.30 * core);
    if (part == 4.0) size *= 1.15;
    // DEPTH OF FIELD, done per particle rather than as a screen pass. A Bokeh
    // pass needs a depth buffer, and this cloud writes no depth and sizes its
    // points in the vertex shader, so an override-material depth pass would be
    // flat and wrong. Circle of confusion straight from view depth is both
    // cheaper and exact: out-of-focus points grow and fade, which under
    // additive blending is what a defocused highlight actually does.
    float coc = abs(-mv.z - uFocus) * uDof * 2.2;
    coc = min(coc, 3.0);
    size *= 1.0 + coc * 1.6;
    vCoc = coc;

    // Clamped: the divisor bottoms out at 0.6, so without an upper bound
    // zooming in turns every particle into a huge additive quad and the frame
    // washes out to white. /sim's cloud caps at 12 for the same reason.
    gl_PointSize = clamp(size / max(0.6, -mv.z), 0.0, 28.0);
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
  varying float vCoc;
  varying float vHuePhase;
  varying vec2 vPatDbg;

  uniform float uHue;
  uniform float uBright;
  uniform float uDrvColor;
  uniform float uDebugParts;
  uniform float uSoft;    // 0 crisp dot … 1 wide soft haze
  uniform float uAlpha;   // per-particle opacity

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
    float soft = smoothstep(0.5, mix(0.44, 0.0, uSoft), r);

    vec3 col = vColor;
    // MELODY — rotate each pattern group's hue by its own phase, so the
    // patterns of the feather trade colors instead of tinting uniformly. The
    // angle now follows the dominant PITCH, so the feather changes colour on
    // the note rather than on mid-band loudness.
    float shift = uHue * (0.4 + vHuePhase);
    col = mix(col, hueShift(col, shift), clamp(uDrvColor, 0.0, 1.0));
    // brightness of the mix lifts the fringe first — the rim is where a real
    // feather catches the light
    col *= 1.0 + vGlow * 0.8 + uBright * vRim * 0.30 * clamp(uDrvColor, 0.0, 1.0);

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

    // a defocused point covers more area, so it must be dimmer per pixel or
    // the blur would brighten the frame instead of softening it
    gl_FragColor = vec4(col, soft * uAlpha / (1.0 + vCoc * 2.0));
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
  const routes = useRef<Routes>(loadRoutes());
  const look = useRef<Look>(loadLook());
  const resetView = useRef<(() => void) | null>(null);
  // reused every frame so the render loop never allocates
  const elemVals = useMemo(() => {
    const o = {} as Record<ElementId, number>;
    for (const e of ELEMENTS) o[e.id] = 0;
    return o;
  }, []);
  const drive = useMemo(() => {
    const o = {} as Record<TargetId, number>;
    for (const t of TARGETS) o[t.id] = 0;
    return o;
  }, []);
  const elemMeter = useRef<((v: Record<ElementId, number>) => void) | null>(null);
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
    // An additive cloud stacks light: on a pale, dense feather the rachis
    // saturates and clips to a flat white bar, taking the markings with it.
    // ACES rolls the highlights off instead of clipping, so a hot core stays
    // readable as a hot core. OutputPass below applies this at the end of the
    // chain, which is why it must be the last pass.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    // near pulled in and far pushed out: at max 3D volume the puffed particles
    // reach ~1.25 world units toward the camera, and a squarish feather on a
    // portrait phone can frame at a distance whose zoom-out crosses far=20
    const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 60);
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
      uHue: { value: 0 },
      uPhase: { value: 0 },
      uLock: { value: 0 },
      uIdle: { value: 1 },
      uBright: { value: 0 },
      uDrvEye: { value: 0 },
      uDrvColor: { value: 0 },
      uDrvWave: { value: 0 },
      uDrvShimmer: { value: 0 },
      uDrvFlex: { value: 0 },
      uDrvFlexHit: { value: 0 },
      uDrvFringe: { value: 0 },
      uDrvDepth: { value: 0 },
      uAmpDepth: { value: 0.6 },
      uDebugParts: { value: debugRef.current },
      uPointScale: { value: 7 },
      uVolume: { value: 1 },
      uHalfW: { value: Math.max(0.05, anatomy.aspect) },
      uSize: { value: 1 },
      uFocus: { value: 3.4 },
      uDof: { value: 0 },
      uAntic: { value: 0 },
      uShed: { value: 0 },
      uLeadNote: { value: -1 },
      uNoteLight: { value: 0 },
      uRate: { value: 1 },
      uSoft: { value: 0.55 },
      uAlpha: { value: 0.92 },
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

    // THE GHOST — the same cloud, one beat behind, like a delay send on the
    // visuals. It shares the geometry and every static uniform (one buffer, no
    // duplicated attributes); only the audio-derived uniforms get their own
    // slots, fed from a ring buffer of what the feather was doing a beat ago.
    // On a locked track the echo lands exactly on the offbeat.
    const GHOST_KEYS = [
      'uDrvEye', 'uDrvFlex', 'uDrvWave', 'uDrvFringe', 'uDrvShimmer', 'uDrvColor',
      'uDrvDepth', 'uDrvFlexHit', 'uAntic', 'uShed', 'uNoteLight', 'uLeadNote',
    ] as const;
    const ghostUniforms: Record<string, { value: number }> = { ...uniforms };
    for (const k of GHOST_KEYS) ghostUniforms[k] = { value: 0 };
    ghostUniforms.uAlpha = { value: 0 };
    const ghostMat = new THREE.ShaderMaterial({
      vertexShader: VERT_HUE,
      fragmentShader: FRAG_REAL,
      uniforms: ghostUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ghost = new THREE.Points(geo, ghostMat);
    ghost.frustumCulled = false;
    ghost.position.z = -0.12;
    // every particle is displaced in the vertex shader, so the CPU-side bounds
    // are wrong by construction — culling against them can pop the whole cloud
    cloud.frustumCulled = false;
    scene.add(cloud);
    scene.add(ghost);

    // BLOOM. An additive cloud on a near-black field is exactly what bloom is
    // for: the dense bright core of the shaft blooms, the sparse fringe does
    // not, and the difference is what makes a flat scatter of dots read as
    // luminous. OutputPass is required on r152+ — it does the tone-map and
    // colour-space conversion the renderer would normally do itself, and
    // without it everything through a composer comes out washed out.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.72);
    composer.addPass(bloomPass);
    const aberrPass = new ShaderPass(ABERRATION);
    composer.addPass(aberrPass);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.8;
    controls.enablePan = false; // the feather is the subject; panning only loses it
    controls.target.set(0, 0, 0);

    // the distance at which the feather exactly fills the frame
    let framed = 0;
    let lastTouch = -1e9;
    const fit = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      // A zero-sized measurement (detached node, display:none, a ResizeObserver
      // firing mid-teardown) makes aspect 0 or NaN, which poisons `framed` and
      // then camera.position permanently — setLength on a NaN vector stays NaN
      // forever, so the canvas stays blank until a reload.
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // frame the feather: its cloud spans y -1..1, x ±aspect
      const need = Math.max(1.15, (anatomy.aspect * 1.25) / camera.aspect);
      const dist = need / Math.tan((camera.fov * Math.PI) / 360);
      // Preserve the user's zoom RELATIVE to the framing distance. Setting
      // position.z outright — as this did before there was a camera to move —
      // would yank the view back to default every time the window resized.
      const ratio = framed > 0 ? camera.position.length() / framed : 1;
      framed = dist;
      camera.position.setLength(dist * ratio);
      controls.minDistance = dist * 0.22;
      controls.maxDistance = dist * 2.6;
      camera.updateProjectionMatrix();
      composer.setSize(w, h);
      controls.update();
      // controls.update() dispatches `change`, which would otherwise register as
      // the user grabbing the feather and mute the drift for two seconds after
      // every resize — and after mount, since ResizeObserver fires immediately
      lastTouch = -1e9;
      // finer grain now the cloud is ~3× denser
      uniforms.uPointScale.value = (h / 240) * 3.0;
    };
    fit();

    // Auto-drift and hand-orbit fight each other, so the drift yields: it fades
    // out the moment the user grabs the feather and only creeps back after they
    // have let go and stopped for a couple of seconds.
    const touched = () => { lastTouch = performance.now(); };
    controls.addEventListener('start', touched);
    controls.addEventListener('change', touched);

    resetView.current = () => {
      camera.position.set(0, 0, framed);
      controls.target.set(0, 0, 0);
      controls.update();
      lastTouch = -1e9;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(mount);

    let raf = 0;
    let frame = 0;
    let drift = 1;
    let lastT = 0;
    let flexSm = 0;
    let shedEnv = 0;
    // ~2 s of history at 60 fps, enough for one beat down to 30 bpm
    const RING = 120;
    const ringT = new Float32Array(RING);
    const ringV = new Float32Array(RING * 12);
    let ringAt = 0;
    let ringFill = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const f = feed.read(t);
      const a = amps.current;
      uniforms.uTime.value = t / 1000;
      uniforms.uHue.value = f.hue;
      uniforms.uPhase.value = f.phase;
      uniforms.uLock.value = f.lock;
      uniforms.uIdle.value = f.idle;
      uniforms.uBright.value = f.bright;
      // ---- routing matrix: one weighted sum per target --------------------
      // Element values live on `f`; the matrix says how much of each reaches
      // each target; the column's amount slider scales the result. Doing this
      // on the CPU keeps it to seven uniforms instead of pushing the whole
      // patch to the GPU every frame.
      elemVals.sub = f.sub;
      elemVals.kick = f.kick;
      elemVals.snare = f.snare;
      elemVals.hat = f.hat;
      elemVals.perc = f.perc;
      elemVals.bass = f.bassline;
      elemVals.lead = f.lead;
      elemVals.vocal = f.vocal;
      elemVals.pad = f.pad;
      elemVals.space = f.space;
      elemVals.note = f.noteOn;

      const R = routes.current;
      for (const t of TARGETS) drive[t.id] = 0;
      for (const e of ELEMENTS) {
        const row = R[e.id];
        const v = elemVals[e.id];
        if (!v) continue;
        for (const t of TARGETS) {
          const g = row[t.id];
          if (g) drive[t.id] += g * v;
        }
      }
      // Every column is capped. Eleven rows can all be routed to one target, so
      // an unclamped sum reaches ~11 and the shader terms it feeds are written
      // for 0..1: the shaft would swing clear out of frame, the fringe glow
      // would wash the frame white, and markings would turn inside out. The
      // ceiling sits above the defaults (which peak ~1.4) so the stock patch is
      // untouched and only genuinely extreme patches are held back.
      const cap = (x: number) => (x > DRIVE_MAX ? DRIVE_MAX : x);
      uniforms.uDrvEye.value = cap(drive.eye) * a.eye;
      uniforms.uDrvColor.value = cap(drive.color) * a.color;
      uniforms.uDrvWave.value = cap(drive.wave) * a.wave;
      uniforms.uDrvShimmer.value = cap(drive.shimmer) * a.shimmer;
      const flexNow = cap(drive.flex) * a.flex;
      uniforms.uDrvFlex.value = flexNow;
      uniforms.uDrvFringe.value = cap(drive.fringe) * a.fringe;
      uniforms.uDrvDepth.value = Math.min(1, drive.depth);
      uniforms.uAmpDepth.value = a.depth;

      // the whip rides the RISE of the flex column, so a sustained row drives
      // the slow bend while only an actual hit snaps it
      const dtf = Math.min(0.1, (t - lastT) / 1000) || 1 / 60;
      flexSm += (flexNow - flexSm) * Math.min(1, dtf * 5);
      uniforms.uDrvFlexHit.value = Math.max(0, flexNow - flexSm);

      const L = look.current;
      uniforms.uVolume.value = L.volume;
      uniforms.uSize.value = L.size;
      uniforms.uSoft.value = L.soft;
      uniforms.uAlpha.value = L.alpha;

      // turn the cloud slowly, and lean it a little on the bar — without this
      // the depth separation would only read as a change of scale
      const s = t / 1000;
      const want = L.spin && performance.now() - lastTouch > 2000 ? 1 : 0;
      lastT = t;
      drift += (want - drift) * Math.min(1, dtf * 1.5);
      cloud.rotation.y = (Math.sin(s * 0.17) * 0.30 + (f.bar - 0.5) * 0.16 * f.lock) * a.depth * drift;
      cloud.rotation.x = Math.sin(s * 0.11) * 0.10 * a.depth * drift;

      controls.update();
      // focus rides the orbit distance, so the feather stays sharp and only
      // the depth in FRONT of and BEHIND it softens
      // ---- the post/camera columns -----------------------------------------
      // Focus PULLS: the routed amount drags the focal plane in front of the
      // feather, so a note change throws the shaft sharp and the down soft.
      uniforms.uFocus.value = camera.position.length() * (1 - cap(drive.focus) * 0.22);
      uniforms.uDof.value = L.dof;
      bloomPass.strength = L.bloom * (1 + cap(drive.bloom) * 1.6);
      aberrPass.uniforms.amount.value = L.aberr * cap(drive.aberr) * 0.05;

      // Camera push runs on zoom rather than position: OrbitControls derives
      // its spherical from camera.position every frame, so moving the camera
      // here would feed back into the orbit state and drift.
      const push = 1 + cap(drive.push) * 0.12;
      if (Math.abs(camera.zoom - push) > 1e-4) {
        camera.zoom = push;
        camera.updateProjectionMatrix();
      }
      // Shake displaces the CLOUD for the same reason.
      const sh = cap(drive.shake) * 0.035;
      cloud.position.x = sh * Math.sin(t * 0.11);
      cloud.position.y = sh * Math.sin(t * 0.157 + 1.3);

      // ---- anticipation, shed, and the played note --------------------------
      // phase 0 is the beat. Winding starts about a quarter-beat out and is
      // released the instant the beat lands.
      const ph = f.phase;
      const wind = ph > 0.74 ? -(ph - 0.74) / 0.26 : 0;
      uniforms.uAntic.value = wind * f.lock * a.flex;
      shedEnv = Math.max(shedEnv * Math.exp(-dtf / 0.42), Math.min(1, f.perc * 0.55 + f.snare * 0.8));
      uniforms.uShed.value = shedEnv * a.fringe;
      uniforms.uLeadNote.value = f.leadNote;
      uniforms.uNoteLight.value = Math.min(1, cap(drive.eye) * 0.35 + f.noteOn * 0.5) * a.eye;
      uniforms.uRate.value = f.bpm > 0 ? Math.max(0.5, Math.min(2, f.bpm / 110)) : 1;

      // record this frame, then play back the frame from one beat ago
      const gk = [
        uniforms.uDrvEye.value, uniforms.uDrvFlex.value, uniforms.uDrvWave.value,
        uniforms.uDrvFringe.value, uniforms.uDrvShimmer.value, uniforms.uDrvColor.value,
        uniforms.uDrvDepth.value, uniforms.uDrvFlexHit.value, uniforms.uAntic.value,
        uniforms.uShed.value, uniforms.uNoteLight.value, uniforms.uLeadNote.value,
      ];
      ringT[ringAt] = t;
      for (let i = 0; i < 12; i++) ringV[ringAt * 12 + i] = gk[i];
      ringAt = (ringAt + 1) % RING;
      ringFill = Math.min(RING, ringFill + 1);

      ghost.visible = L.ghost && f.lock > 0.15;
      if (ghost.visible) {
        const beatMs = f.bpm > 0 ? 60000 / f.bpm : 500;
        const want = t - beatMs;
        let best = -1, bestD = Infinity;
        for (let i = 0; i < ringFill; i++) {
          const d = Math.abs(ringT[i] - want);
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0) {
          for (let i = 0; i < 12; i++) ghostUniforms[GHOST_KEYS[i]].value = ringV[best * 12 + i];
          // dim, and fading with how sure we are of the beat we are echoing
          ghostUniforms.uAlpha.value = L.alpha * 0.3 * f.lock;
        }
      }

      composer.render();
      if (++frame % 3 === 0) {
        meter.current?.(f);
        // same throttle as the band meters: 11 style writes a frame restarted a
        // 50 ms width transition every 16 ms, which could never finish
        elemMeter.current?.(elemVals);
      }
    };
    raf = requestAnimationFrame(loop);

    // dev-only diagnostic: lets the audio-driven paths be exercised without a
    // user gesture to start playback. Stripped from production by the guard.
    if (location.hostname === 'localhost') {
      (window as unknown as { __f2?: unknown }).__f2 = {
        feed,
        bloom: () => bloomPass.strength,
        aberr: () => aberrPass.uniforms.amount.value,
        zoom: () => camera.zoom,
        ghostOn: () => ghost.visible,
        ghostAlpha: () => ghostUniforms.uAlpha.value,
        antic: () => uniforms.uAntic.value,
        shed: () => uniforms.uShed.value,
        note: () => uniforms.uLeadNote.value,
        rate: () => uniforms.uRate.value,
        shake: () => cloud.position.x,
      };
    }

    const dbg = () => {
      uniforms.uDebugParts.value = debugRef.current;
    };
    dbgRef.current = dbg;

    return () => {
      cancelAnimationFrame(raf);
      controls.removeEventListener('start', touched);
      controls.removeEventListener('change', touched);
      controls.dispose();
      resetView.current = null;
      ro.disconnect();
      geo.dispose();
      mat.dispose();
      ghostMat.dispose();
      composer.dispose();
      renderer.dispose();
      // dispose() frees GPU objects but keeps the CONTEXT. Every re-scan builds
      // a new renderer, and browsers cap at ~16 live contexts, so a dozen
      // sensitivity nudges would silently black out the canvas.
      renderer.forceContextLoss();
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

  const setLook = <K extends keyof Look>(key: K, v: Look[K]) => {
    look.current[key] = v;
    localStorage.setItem(LOOK_KEY, JSON.stringify(look.current));
    setAmpTick((x) => x + 1);
  };

  /** Cells cycle 0 → ½ → 1 → 0; shift-click clears a whole row. */
  const bumpRoute = (e: ElementId, t: TargetId, clear: boolean) => {
    const row = routes.current[e];
    if (clear) {
      for (const k of TARGETS) delete row[k.id];
    } else {
      const cur = row[t] ?? 0;
      const next = cur === 0 ? 0.5 : cur < 1 ? 1 : 0;
      if (next === 0) delete row[t];
      else row[t] = next;
    }
    localStorage.setItem(ROUTES_KEY, JSON.stringify(routes.current));
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

            <div className="f2-sec">Look</div>
            <F2Amp label="Particle size" min={0.25} max={3} step={0.05} value={look.current.size} onChange={(v) => setLook('size', v)} />
            <F2Amp label="Softness" min={0} max={1} step={0.02} value={look.current.soft} onChange={(v) => setLook('soft', v)} />
            <F2Amp label="Opacity" min={0.15} max={1} step={0.02} value={look.current.alpha} onChange={(v) => setLook('alpha', v)} />
            <F2Amp label="3D volume" min={0} max={2.5} step={0.05} value={look.current.volume} onChange={(v) => setLook('volume', v)} />
            <F2Amp label="Bloom" min={0} max={2} step={0.05} value={look.current.bloom} onChange={(v) => setLook('bloom', v)} />
            <F2Amp label="Depth of field" min={0} max={1} step={0.02} value={look.current.dof} onChange={(v) => setLook('dof', v)} />
            <F2Amp label="Aberration" min={0} max={1.5} step={0.05} value={look.current.aberr} onChange={(v) => setLook('aberr', v)} />
            <div className="f2-row" style={{ marginTop: 8 }}>
              <button className={`f2-btn ${look.current.spin ? 'on' : ''}`} onClick={() => setLook('spin', !look.current.spin)}>
                Auto-spin
              </button>
              <button className={`f2-btn ${look.current.ghost ? 'on' : ''}`} onClick={() => setLook('ghost', !look.current.ghost)} title="a second cloud one beat behind">
                Ghost
              </button>
              <button className="f2-btn" onClick={() => resetView.current?.()}>
                Reset view
              </button>
            </div>
            <div className="f2-hintline">drag to orbit · scroll or pinch to zoom</div>

            <div className="f2-sec">Routing · element → part</div>
            <F2Matrix routes={routes.current} onCell={bumpRoute} register={elemMeter} />

            <div className="f2-sec">Amount</div>
            <F2Amp label="Markings" value={amps.current.eye} onChange={(v) => setAmp('eye', v)} disabled={anatomy.zones.length === 0} />
            <F2Amp label="Shaft flex" value={amps.current.flex} onChange={(v) => setAmp('flex', v)} />
            <F2Amp label="Vane wave" value={amps.current.wave} onChange={(v) => setAmp('wave', v)} />
            <F2Amp label="Fringe" value={amps.current.fringe} onChange={(v) => setAmp('fringe', v)} />
            <F2Amp label="Barb shimmer" value={amps.current.shimmer} onChange={(v) => setAmp('shimmer', v)} />
            <F2Amp label="Colour" value={amps.current.color} onChange={(v) => setAmp('color', v)} />
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

/**
 * The patch bay. Rows are musical elements, columns are the parts of the
 * feather they can move. Each row carries its own live level so you can see
 * WHY something moved — a cell that is lit but whose row meter is flat means
 * the element simply is not present in this track.
 */
function F2Matrix({
  routes,
  onCell,
  register,
}: {
  routes: Routes;
  onCell: (e: ElementId, t: TargetId, clear: boolean) => void;
  register: React.RefObject<((v: Record<ElementId, number>) => void) | null>;
}) {
  const bars = useRef<Partial<Record<ElementId, HTMLElement | null>>>({});

  useEffect(() => {
    // written straight to the DOM: this updates every frame and must never
    // go through React
    register.current = (v) => {
      for (const e of ELEMENTS) {
        const el = bars.current[e.id];
        if (el) el.style.width = `${Math.round(Math.min(1, v[e.id]) * 100)}%`;
      }
    };
    return () => {
      register.current = null;
    };
  }, [register]);

  return (
    <table className="f2-mx">
      <thead>
        <tr>
          <th />
          {TARGETS.map((t) => (
            <th key={t.id} title={t.label}>
              {t.short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ELEMENTS.map((e) => (
          <tr key={e.id}>
            <td className="f2-mx-name" title={e.hint} onClick={(ev) => ev.shiftKey && onCell(e.id, 'eye', true)}>
              <span>{e.label}</span>
              <i>
                <b ref={(n) => { bars.current[e.id] = n; }} />
              </i>
            </td>
            {TARGETS.map((t) => {
              const g = routes[e.id]?.[t.id] ?? 0;
              return (
                <td key={t.id}>
                  <button
                    className={`f2-mx-cell ${g >= 1 ? 'full' : g > 0 ? 'half' : ''}`}
                    // brightness tracks the actual gain, so a 0.4 and a 0.8
                    // don't look identical just because both are "on"
                    style={g > 0 && g < 1 ? { opacity: 0.4 + 0.6 * g } : undefined}
                    aria-label={`${e.label} → ${t.label}`}
                    title={`${e.label} → ${t.label}${g ? ` · ${g.toFixed(2)}` : ''}`}
                    onClick={(ev) => onCell(e.id, t.id, ev.shiftKey)}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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
