import { MusicLoopPanel } from './MusicLoopPanel';
import { MusicLoopPlayer, LOOP_STYLES } from './musicLoops';
import { MotionBlurPass } from './MotionBlurPass';
import { SimpleControls } from './SimpleControls';
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
import './feather2.css';
import { createPhotoSurface } from './photoSurface';
import { maskVisibility } from './maskVisibility';
import { resolveLife, LAYER_LIFE_GLSL } from './layerLife';
import { layerMotion } from './layerMotion';
import { ORGANIC_MOTION } from './organicMotion';
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
import { PART, type Anatomy } from './anatomy.ts';
import { useFeatherScan, type Specimen } from './useFeatherScan.ts';
import { RESPONSE_PRESETS, followEnvelope, demoSignal, type ResponseSettings, type ResponsePreset } from './response.ts';
import { AnalysisPanel, LayerMixer, LabIcon, emptyLayerRoutes, type LayerControl, type LayerControls, type LayerGroup, type LayerKind, type LayerTarget } from './LabPanels.tsx';
import { AudioFeed, type AudioFeatures } from './audio2.ts';
import { ledService } from '../led/ledService.ts';
import type { FeatherPart, PartColor } from '../led/types.ts';
import { ELEMENTS, type ElementId } from '../led/elements.ts';
import type { MasterEffectConfig } from './masterEffects.ts';
import { InteractionZonesPanel } from './InteractionZonesPanel.tsx';
import { defaultInteractionZones, initialInteractionZoneState, mixRoutedInteractionZones, stepInteractionZone, type InteractionZone, type InteractionZoneDocument, type InteractionZoneState } from './interactionZones.ts';
import { defaultAnalysisMasters, groupIdForLayer, restoreAnalysisMasters, seedMasterRoutes } from './zoneMasters.ts';
import { EncounterModel } from '../engine/encounter.ts';
import { playPartMatches, type FeatherPlay } from './play.ts';
import { deleteFeatherPreset, loadFeatherPresets, newPresetId, onFeatherPresetsChange, upsertFeatherPreset, type FeatherPreset, type FeatherView } from './presets.ts';
import { PresetsPanel } from './PresetsPanel.tsx';

// scan + response settings survive reloads, so a tuned analysis is kept
const SENS_KEY = 'f2.sensitivity';
const AMPS_KEY = 'f2.amps';
const PARTICLE_KEY = 'f2.particles';
const LAYERS_KEY = 'f2.layers';
const LAYERS_VERSION_KEY = 'f2.layers.version';
const LAYERS_VERSION = 4;
const ZONES_KEY = 'f2.interaction-zones';
function loadParticleCount() {
  const n = Number(readPreference(PARTICLE_KEY) ?? 140_000);
  return Number.isFinite(n) ? Math.max(24_000, Math.min(500_000, Math.round(n))) : 140_000;
}
function loadLayers(raw: string | null = readPreference(LAYERS_KEY)): LayerControls {
  try {
    const saved = JSON.parse(raw ?? '{}') as Partial<LayerControls>;
    if (Array.isArray(saved.layers)) {
      const groups = Array.isArray(saved.groups) && saved.groups.length ? saved.groups.map((group) => ({
        ...group,
        audioEnabled: group.audioEnabled !== false,
        effect: sanitizeMasterEffect(group.effect),
        routes: { ...emptyLayerRoutes(), ...group.routes },
      })) : makeDefaultGroups();
      return {
        source: typeof saved.source === 'string' ? saved.source : '',
        selectedId: typeof saved.selectedId === 'string' ? saved.selectedId : groups[0]?.id ?? '',
        groups,
        layers: saved.layers.map((layer) => ({
          ...layer,
          groupId: typeof layer.groupId === 'string' ? layer.groupId : groupIdForLayer(layer.kind, layer.index),
          audioEnabled: layer.audioEnabled !== false,
          assignedZoneId: typeof layer.assignedZoneId === 'string' ? layer.assignedZoneId : undefined,
          routes: { ...emptyLayerRoutes(), ...layer.routes },
        })),
      };
    }
  } catch { /* defaults */ }
  return { source: '', selectedId: '', layers: [], groups: [] };
}

const PART_NAMES = ['Calamus', 'Rachis', 'Firm vane', 'Down', 'Markings'];
const newLayerId = () => `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
function makeGroup(id: string, name: string): LayerGroup {
  return {
    id, name, brightness: 1, size: 1, movement: 1, depth: 1, visible: true, audioEnabled: true, expanded: false,
    effect: { preset: 'none', trigger: 'kick', mode: 'toggle', amount: 1 },
    routes: emptyLayerRoutes(),
  };
}
function sanitizeMasterEffect(value: Partial<MasterEffectConfig> | undefined): MasterEffectConfig {
  const presets = ['none', 'pulse', 'flutter', 'shimmer', 'lift', 'blackout'];
  const modes = ['toggle', 'gate', 'oneshot'];
  return {
    preset: presets.includes(value?.preset ?? '') ? value!.preset! : 'none',
    trigger: ELEMENTS.some((element) => element.id === value?.trigger) ? value!.trigger! : 'kick',
    mode: modes.includes(value?.mode ?? '') ? value!.mode! : 'toggle',
    amount: Number.isFinite(value?.amount) ? Math.max(0, Math.min(2, value!.amount!)) : 1,
  };
}
function makeDefaultGroups() {
  return defaultAnalysisMasters();
}
function makeLayer(kind: LayerKind, index: number, name: string, groupId = groupIdForLayer(kind, index)): LayerControl {
  return { id: newLayerId(), groupId, name, kind, index, brightness: 1, size: 1, movement: 1, depth: 1, visible: true, audioEnabled: true, routes: emptyLayerRoutes() };
}
function detectedLayers(anatomy: Anatomy, source: string): LayerControls {
  const groups = makeDefaultGroups();
  const colourCounts = Array.from({ length: anatomy.palette.length }, () => 0);
  for (let i = 0; i < anatomy.count; i++) colourCounts[Math.max(0, Math.min(colourCounts.length - 1, Math.round(anatomy.cluster[i])))]++;
  const dominantColours = new Set(colourCounts.map((count, index) => ({ count, index })).sort((a, b) => b.count - a.count).slice(0, 2).map((entry) => entry.index));
  const layers = [
    ...PART_NAMES.map((name, index) => makeLayer('parts', index, name)),
    ...anatomy.palette.map((_, index) => makeLayer('colors', index, `Colour ${String.fromCharCode(65 + index)}`, dominantColours.has(index) ? 'master-colour-primary' : 'master-colour-accent')),
    ...anatomy.zones.slice(0, 12).map((_, index) => makeLayer('patterns', index, `Pattern ${String(index + 1).padStart(2, '0')}`)),
  ];
  return { source, selectedId: groups[0]?.id ?? '', layers, groups };
}

function loadInteractionZones(raw: string | null = readPreference(ZONES_KEY)): InteractionZoneDocument {
  const defaults = defaultInteractionZones();
  try {
    const saved = JSON.parse(raw ?? '{}') as Partial<InteractionZoneDocument>;
    if (Array.isArray(saved.zones) && saved.zones.length) return {
      selectedId: typeof saved.selectedId === 'string' ? saved.selectedId : saved.zones[0].id,
      zones: saved.zones.map((zone, index) => {
        const legacy = zone as Partial<InteractionZone> & { brightness?: number; movement?: number };
        const inferred = legacy.id?.includes('flutter') ? 'flutter'
          : legacy.id?.includes('lift') ? 'lift'
            : legacy.id?.includes('cut') ? 'blackout'
              : legacy.id?.includes('shimmer') ? 'shimmer' : 'pulse';
        return {
          ...defaults[index % defaults.length],
          ...zone,
          behaviour: ['pulse', 'flutter', 'shimmer', 'lift', 'blackout'].includes(legacy.behaviour ?? '') ? legacy.behaviour! : inferred,
          axis: ['z', 'x', 'xy'].includes(legacy.axis ?? '') ? legacy.axis! : 'z',
          amount: Number.isFinite(legacy.amount) ? Math.max(0, Math.min(1.5, legacy.amount!))
            : Math.max(0.25, Math.min(1.5, Math.abs(legacy.movement ?? legacy.brightness ?? 0.7))),
          layerDepth: Number.isFinite(legacy.layerDepth) ? Math.max(0, Math.min(2.5, legacy.layerDepth!)) : 0,
        };
      }),
      routes: saved.routes && typeof saved.routes === 'object' ? saved.routes : {},
    };
  } catch { /* defaults */ }
  return { selectedId: defaults[0].id, zones: defaults, routes: {} };
}

function migrateLegacyMasterEffects(layers: LayerControls, document: InteractionZoneDocument): boolean {
  let changed = false;
  for (const master of layers.groups) {
    if (master.effect.preset === 'none') continue;
    const id = `zone-legacy-${master.id}`;
    let zone = document.zones.find((candidate) => candidate.id === id);
    if (!zone) {
      const template = defaultInteractionZones().find((candidate) => candidate.behaviour === master.effect.preset) ?? defaultInteractionZones()[0];
      zone = {
        ...template,
        id,
        name: `${master.name} · ${master.effect.preset}`,
        behaviour: master.effect.preset,
        trigger: master.effect.trigger,
        mode: master.effect.mode,
        amount: Math.min(1.5, master.effect.amount),
      };
      document.zones.push(zone);
    }
    (document.routes[master.id] ??= {})[zone.id] = 1;
    master.effect = { ...master.effect, preset: 'none' };
    changed = true;
  }
  return changed;
}

function loadSens(): number {
  const raw = readPreference(SENS_KEY);
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function savePreference(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is optional */ }
}

function loadResponse(raw: string | null = readPreference('f2.response')): ResponseSettings {
  const base = { ...RESPONSE_PRESETS.organic };
  try {
    const saved = JSON.parse(raw ?? '{}');
    for (const [key, min, max] of [['gain', 0, 2], ['attack', 5, 400], ['release', 50, 1500], ['wind', 0, 2]] as const) {
      if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) base[key] = Math.max(min, Math.min(max, saved[key]));
    }
  } catch { /* fresh defaults */ }
  return base;
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
function loadAmps(raw: string | null = readPreference(AMPS_KEY)): Amps {
  const amps: Amps = { eye: 1, color: 1, wave: 1, shimmer: 1, flex: 1, fringe: 1, depth: 0.6 };
  try {
    const saved = JSON.parse(raw ?? '{}') as Partial<Amps>;
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
type Look = { size: number; soft: number; alpha: number; volume: number; thickness: number; particleShape: number; connection: number; radiance: number; tail: number; blendMode: number; taper: number; centreSize: number; tipSize: number; motionBlur: number; roughness: number; reflection: number; metalness: number; bloom: number; dof: number; aberr: number; spin: boolean; ghost: boolean };
function loadLook(raw: string | null = readPreference(LOOK_KEY)): Look {
  const look: Look = { size: 0.85, soft: 0.65, alpha: 0.92, volume: 0.8, thickness: 0, particleShape: 2, connection: 0.45, radiance: 1, tail: 0, blendMode: 0, taper: 1, centreSize: 1.32, tipSize: 0.10, motionBlur: 0.25, roughness: 0.35, reflection: 0.25, metalness: 0, bloom: 0.3, dof: 0.15, aberr: 0.25, spin: false, ghost: false };
  try {
    const saved = JSON.parse(raw ?? '{}') as Partial<Look>;
    for (const k of ['size', 'soft', 'alpha', 'volume', 'thickness', 'particleShape', 'connection', 'radiance', 'tail', 'blendMode', 'taper', 'centreSize', 'tipSize', 'motionBlur', 'roughness', 'reflection', 'metalness', 'bloom', 'dof', 'aberr'] as const) {
      const v = Number(saved[k]);
      if (Number.isFinite(v)) look[k] = Math.max(0, Math.min(k === 'particleShape' ? 10 : k === 'radiance' ? 8 : 3, v));
    }
    if (typeof saved.spin === 'boolean') look.spin = saved.spin;
    if (typeof saved.ghost === 'boolean') look.ghost = saved.ghost;
  } catch { /* fresh defaults */ }
  return look;
}

const ROUTES_KEY = 'f2.routes';
const ROUTES_VERSION_KEY = 'f2.routes.version';
const ROUTES_VERSION = 2;
/** Ceiling on any one column's summed drive — see the render loop. */
const DRIVE_MAX = 1.6;


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
  return r;
}

function loadRoutes(): Routes {
  const base = defaultRoutes();
  try {
    // Versioning clears the pre-matrix hardwired patch once. An empty grid is
    // now a true bypass: audio only moves targets the user explicitly routes.
    if (Number(readPreference(ROUTES_VERSION_KEY)) !== ROUTES_VERSION) {
      savePreference(ROUTES_VERSION_KEY, ROUTES_VERSION);
      return base;
    }
    const saved = JSON.parse(readPreference(ROUTES_KEY) ?? 'null') as Routes | null;
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

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute vec2 aUV;       // u -1..1 across, v 0..1 along
  // Pack scalar anatomy into one attribute to stay within GPU input limits.
  attribute vec3 aAnatomy;
  #define aPart aAnatomy.x
  #define aDowny aAnatomy.y
  #define aShaftX aAnatomy.z
  attribute vec2 aBarb;     // unit barb tangent (outward from shaft, toward tip)
  attribute vec4 aSurf;     // core, loose, flow, spine — all measured per point
  attribute vec4 aPatA;     // zone centre xy, phase, kind (0 none · 1 round · 2 stripe)
  attribute vec4 aPatB;     // zone axis xy, along -1..1, across 0..1.6
  attribute vec2 aPatC;     // marking strength 0..1, marking order base→tip 0..1
  attribute float aPattern; // stable marking index, -1 for plain vane

  uniform float uScatter;
  uniform float uFlowMode;
  uniform float uAnchor;
  uniform float uPhotoAvailable;
  uniform float uBlend;
  varying float vBlend;
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
  uniform float uThickness;
  uniform float uVolume;     // how much real 3D shape the feather has
  uniform float uHalfW;      // the feather's half-width in world units
  uniform float uStemTest;
  uniform float uStemLevels[5];
  uniform float uTaper;
  uniform float uCentreSize;
  uniform float uTipSize;
  uniform float uSize;       // user point-size multiplier
  uniform float uFocus;      // camera distance to the orbit target
  uniform float uDof;        // 0 off … 1 shallow
  uniform float uAntic;      // signed: winds NEGATIVE before a beat, snaps back after
  uniform float uShed;       // 0..1 transient that throws loose barbs off the vane
  uniform float uLeadNote;   // 0..1 pitch class of the lead, -1 when untracked
  uniform float uNoteLight;  // how brightly the played note lights its band
  uniform float uRate;       // idle motion speed, locked to the track's tempo
  uniform float uPointScale;
  uniform vec2 uPointer;
  uniform vec2 uWindDirection;
  uniform float uWind;
  uniform float uGroupMovement[6];
  uniform float uGroupSize[6];
  uniform float uGroupDepth[6];
  uniform float uPatternMovement[12];
  uniform float uPatternSize[12];
  uniform float uPatternDepth[12];
  uniform float uPartMovement[5];
  uniform float uPartDepth[5];
  uniform float uPartSize[5];
  uniform vec3 uGroupAxis[6];
  uniform vec3 uPatternAxis[12];
  uniform vec3 uPartAxis[5];
  uniform float uBehaviourTravel;
  uniform float uBehaviourTravelPosition;

  varying vec3 vColor;
  varying float vPart;
  varying float vGlow;
  varying float vRim;
  varying float vLoose;
  varying float vFlow;
  varying float vSpine;
  varying float vCoc;
  varying vec2 vPatDbg;   // x = kind, y = phase
  varying float vGroup;
  varying float vPattern;

${LAYER_LIFE_GLSL}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
${ORGANIC_MOTION}
    vLifeGlow = 0.0;
    vLifeHue = 0.0;
    P = layerLife(P, uGroupLife[groupIndex], uGroupLifeLight[groupIndex], protectedCore * uAnchor);
    P = layerLife(P, uPartLife[partIndex], uPartLifeLight[partIndex], protectedCore * uAnchor);
    if (aPattern >= 0.0) P = layerLife(P, uPatternLife[patternIndex], uPatternLifeLight[patternIndex], protectedCore * uAnchor);
    // A permanent shared centreline: layer offsets, release, and life modes
    // cannot separate calamus (0) from rachis (1). Keep their light effects.
    if (uStemTest > 0.5) {
      // Add stem response to the existing pose. Resetting to shaftPose here
      // erased flight, root attachment, depth, wind and per-layer movement.
      float targetLevel = part == 3.0 ? uStemLevels[2] : part > 1.5 ? uStemLevels[1] : uStemLevels[0];
      if (part > 1.5) {
        float fibre = part == 3.0 ? 0.08 : 0.035;
        P.xy += aBarb * sin(uTime * 4.0 - s * 7.0) * targetLevel * fibre * attachment;
        P.z += sin(uTime * 3.0 - s * 6.0) * targetLevel * fibre * attachment;
        if (aPattern >= 0.0 || part == 4.0) P.z += sin(uTime * 3.5 + aPattern) * uStemLevels[3] * attachment * 0.045;
        vLifeHue = uStemLevels[4] * 1.5;
      }
      vLifeGlow = targetLevel * 0.45;
    }
    float shaftAttachment = max(aSurf.w, smoothstep(0.15, 0.75, spine));
    P = mix(P, shaftPose, part < 1.5 ? 1.0 : shaftAttachment);
    vColor = aColor;
    vPart = part;
    vGlow = glow;
    vRim = rim;
    vLoose = loose;
    vFlow = flow;
    vSpine = spine;
    vPatDbg = vec2(aPatA.w, aPatA.z);
    vGroup = float(groupIndex);
    vPattern = aPattern;
    vec4 mv = modelViewMatrix * vec4(P, 1.0);
    gl_Position = projectionMatrix * mv;
    // Source coordinates measure each vane half independently, so both
    // asymmetric edges taper equally and particles retain their size in flight.
    float edgeDistance = part < 1.5 ? 0.0 : clamp(abs(aUV.x), 0.0, 1.0);
    float taperedSize = mix(uCentreSize, uTipSize, smoothstep(0.0, 1.0, edgeDistance));
    float localSize = mix(uSize, taperedSize, uTaper);
    float size = uPointScale * localSize * groupSize * patternSize * partSize * (1.0 + glow * 0.6) * (0.82 + 0.30 * core);
    if (part == 4.0) size *= 1.15;
    if (part == 0.0 || part == 1.0) size *= 1.22;
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
  varying float vLifeGlow;
  varying float vLifeHue;
  varying float vBlend;
  precision highp float;
  uniform float uPatternOnly;
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
  varying float vGroup;
  varying float vPattern;

  uniform float uHue;
  uniform float uBright;
  uniform float uDrvColor;
  uniform float uDebugParts;
  uniform float uSoft;    // 0 crisp dot … 1 wide soft haze
  uniform float uRadiance;
  uniform float uAlpha;   // per-particle opacity
  uniform float uGroupBrightness[6];
  uniform float uPatternBrightness[12];
  uniform float uPartVisible[5];
  uniform float uPartBrightness[5];

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
    if (uPatternOnly > 0.5 && vPattern < 0.0) discard;
    if (uPartVisible[int(clamp(floor(vPart + 0.5), 0.0, 4.0))] < 0.5) discard;
    vec2 q = gl_PointCoord - 0.5;
    float r = length(q);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, mix(0.44, 0.0, uSoft), r);

    vec3 col = pow(max(vColor, vec3(0.0)), vec3(2.2));
    // MELODY — rotate each pattern group's hue by its own phase, so the
    // patterns of the feather trade colors instead of tinting uniformly. The
    // angle now follows the dominant PITCH, so the feather changes colour on
    // the note rather than on mid-band loudness.
    float shift = uHue * (0.4 + vHuePhase);
    col = mix(col, hueShift(col, shift), clamp(uDrvColor, 0.0, 1.0));
    col = hueShift(col, vLifeHue);
    col *= 1.0 + min(3.0, vLifeGlow);
    // brightness of the mix lifts the fringe first — the rim is where a real
    // feather catches the light
    int partIndex = int(clamp(floor(vPart + 0.5), 0.0, 4.0));
    float layerBrightness = uGroupBrightness[int(clamp(floor(vGroup + 0.5), 0.0, 5.0))] * uPartBrightness[partIndex];
    if (vPattern >= 0.0) layerBrightness *= uPatternBrightness[int(clamp(floor(vPattern + 0.5), 0.0, 11.0))];
    col *= layerBrightness * (1.0 + vGlow * 0.8 + uBright * vRim * 0.30 * clamp(uDrvColor, 0.0, 1.0));

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
    col *= uRadiance;
    gl_FragColor = vec4(col, soft * uAlpha * vBlend / (1.0 + vCoc * 2.0));
  }
`;

const VERT_HUE = VERT.replace(
  'varying float vGlow;',
  'varying float vGlow;\n  varying float vHuePhase;\n  attribute float aCluster;',
).replace('vColor = aColor;', 'vColor = aColor;\n    vHuePhase = fract(aCluster * 0.618);');

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenNode = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function activeFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function enterFullscreen(el: HTMLElement | null) {
  if (!el || activeFullscreenElement()) return;
  const request = el.requestFullscreen ?? (el as FullscreenNode).webkitRequestFullscreen;
  try { void request?.call(el); } catch { /* unsupported or blocked */ }
}

function leaveFullscreen() {
  if (!activeFullscreenElement()) return;
  const doc = document as FullscreenDocument;
  const exit = document.exitFullscreen ?? doc.webkitExitFullscreen;
  try { void exit?.call(document); } catch { /* already left */ }
}

export interface Feather2Props {
  /** Full-bleed renderer without the studio chrome, for /experience. */
  embedded?: boolean;
  /** Feather id from FEATHERS to show; procedural ids are ignored. */
  featherId?: string;
  /** Live play contract: per-channel trigger levels and the part/movement each drives. */
  play?: FeatherPlay;
  /** A saved studio look to recall (applied whenever its id changes). */
  preset?: FeatherPreset | null;
}

export default function Feather2({ embedded = false, featherId, play, preset }: Feather2Props = {}) {
  const [source, setSource] = useState<Specimen>(() => FEATHERS.find((f) => !f.procedural)!);
  // The render loop reads these through refs, so a host can change them
  // without rebuilding the scene.
  const playRef = useRef<FeatherPlay | undefined>(play);
  playRef.current = play;
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;
  // Saved looks (see presets.ts). The camera lives inside the scene effect, so
  // it is reached through viewRef; a view that arrives before the scene exists
  // (or while a new feather is being analysed) waits in pendingView.
  const [presets, setPresets] = useState<FeatherPreset[]>(loadFeatherPresets);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  useEffect(() => onFeatherPresetsChange(() => setPresets(loadFeatherPresets())), []);
  const viewRef = useRef<{ get: () => FeatherView | null; set: (view: FeatherView) => void } | null>(null);
  const pendingView = useRef<FeatherView | null>(null);
  const [error, setError] = useState('');
  const [showShaftTrace, setShowShaftTrace] = useState(false);
  const [advancedControls, setAdvancedControls] = useState(false);
  const [tab, setTab] = useState<'look' | 'react' | 'analysis' | 'layers' | 'zones'>('react');
  const [reference, setReference] = useState(false);
  const [surfaceBlend, setSurfaceBlend] = useState(() => {
    const saved = Number(readPreference('f2.surfaceBlend') ?? '0.32');
    return Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 0.32;
  });
  const blendRef = useRef(surfaceBlend);
  blendRef.current = surfaceBlend;
  useEffect(() => savePreference('f2.surfaceBlend', surfaceBlend), [surfaceBlend]);
  const [flight, setFlight] = useState(() => {
    try {
      const saved = JSON.parse(readPreference('f2.flight') ?? '{}');
      const clamp = (v: unknown, fallback: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : fallback;
      return { scatter: clamp(saved.scatter, 0, 2), mode: Math.round(clamp(saved.mode, 0, 3)), anchor: clamp(saved.anchor, 0.9, 1) };
    } catch { return { scatter: 0, mode: 0, anchor: 0.9 }; }
  });
  useEffect(() => savePreference('f2.flight', flight), [flight]);
  const flightRef = useRef(flight);
  flightRef.current = flight;
  const [focused, setFocused] = useState(false);
  const [inspection, setInspection] = useState('Whole');
  const inspectView = useRef<((region: string) => void) | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [demo, setDemo] = useState(false);
  const [windTool, setWindTool] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [breathHeld, setBreathHeld] = useState(false);
  const [sceneSaved, setSceneSaved] = useState(false);
  const [particleCount, setParticleCount] = useState(loadParticleCount);
  const layerControls = useRef<LayerControls>(loadLayers());
  const interactionZones = useRef<InteractionZoneDocument>(loadInteractionZones());
  const legacyEffectsMigrated = useRef(false);
  if (!legacyEffectsMigrated.current) {
    legacyEffectsMigrated.current = true;
    const migrated = migrateLegacyMasterEffects(layerControls.current, interactionZones.current);
    const restored = restoreAnalysisMasters(layerControls.current, interactionZones.current);
    const routed = seedMasterRoutes(interactionZones.current, layerControls.current.groups);
    if (migrated || restored || routed) {
      savePreference(LAYERS_KEY, layerControls.current);
      savePreference(ZONES_KEY, interactionZones.current);
    }
  }
  const response = useRef(loadResponse());
  const live = useRef({ demo: false, wind: false, breath: false });
  live.current = { demo, wind: windTool && !reference, breath: breathHeld };
  const uploads = useRef<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => uploads.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const enterPresentation = () => {
    enterFullscreen(rootRef.current);
    setPresenting(true);
  };
  const exitPresentation = () => {
    leaveFullscreen();
    setPresenting(false);
  };
  const nativeFullscreen = useRef(false);
  useEffect(() => {
    const sync = () => {
      if (activeFullscreenElement()) {
        nativeFullscreen.current = true;
        return;
      }
      if (!nativeFullscreen.current) return;
      nativeFullscreen.current = false;
      setPresenting(false);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitPresentation();
      if (event.code === 'Space' && !(event.target as HTMLElement)?.closest('input,button,select,textarea')) {
        event.preventDefault();
        setBreathHeld(true);
      }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setBreathHeld(false); };
    const release = () => setBreathHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, []);
  const [debugMode, setDebugMode] = useState<Dbg>(0); // off · anatomy · patterns · surface
  const [audioTick, setAudioTick] = useState(0); // rerender for audio buttons
  const feed = useMemo(() => new AudioFeed(), []);
  const musicPlayer = useMemo(() => new MusicLoopPlayer(), []);
  useEffect(() => () => musicPlayer.dispose(), [musicPlayer]);
  const encounter = useMemo(() => new EncounterModel(), []);
  const encounterMeter = useRef<((phase: string, state: { energy: number; residue: number; recall: number }) => void) | null>(null);
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
  const { result, busy, error: scanError } = useFeatherScan(source, sens, particleCount);
  const anatomy = result?.anatomy ?? null;
  const sourceName = result?.source.label ?? source.label;
  useEffect(() => setInspection('Whole'), [anatomy]);
  useEffect(() => savePreference(SENS_KEY, sens), [sens]);
  useEffect(() => savePreference(PARTICLE_KEY, particleCount), [particleCount]);
  useEffect(() => {
    if (!anatomy || (layerControls.current.source === source.src && Number(readPreference(LAYERS_VERSION_KEY)) === LAYERS_VERSION)) return;
    layerControls.current = detectedLayers(anatomy, source.src);
    seedMasterRoutes(interactionZones.current, layerControls.current.groups);
    savePreference(LAYERS_KEY, layerControls.current);
    savePreference(LAYERS_VERSION_KEY, LAYERS_VERSION);
    savePreference(ZONES_KEY, interactionZones.current);
    setAmpTick((tick) => tick + 1);
  }, [anatomy, source.src]);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const featherFile = useRef<HTMLInputElement | null>(null);
  const audioFile = useRef<HTMLInputElement | null>(null);
  // debug tint, toggled without rebuilding the scene
  const debugRef = useRef<Dbg>(0);
  const dbgRef = useRef<() => void>(() => {});
  // the render loop pushes audio features straight into the meter DOM, so the
  // readout is live without re-rendering React 60 times a second
  const meter = useRef<((f: AudioFeatures) => void) | null>(null);

  const pick = (src: string, label: string) => {
    musicPlayer.stop();
    setSource({ src, label });
    setError('');
    setReference(false);
  };
  const importFile = async (file: File) => {
    musicPlayer.stop();
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      uploads.current.push(url);
      pick(url, file.name.replace(/\.[^.]+$/, ''));
    } else if (file.type.startsWith('audio/')) {
      if (audioBusy) return;
      setAudioBusy(true);
      setDemo(false);
      setError('');
      try { await feed.useFile(file); setAudioTick((x) => x + 1); }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not play this audio file.'); }
      finally { setAudioBusy(false); setAudioTick((x) => x + 1); }
    } else setError('Choose a feather image or an audio file.');
  };

  // Host-chosen feather (embedded use): follow it whenever it changes.
  useEffect(() => {
    if (!featherId) return;
    const item = FEATHERS.find((f) => f.id === featherId && !f.procedural && f.src);
    if (item && item.src !== source.src) pick(item.src, item.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featherId]);

  // ---- feather presets ----------------------------------------------------
  const capturePreset = (name: string): FeatherPreset => ({
    id: newPresetId(),
    name,
    feather: FEATHERS.find((f) => !f.procedural && f.src === source.src)?.id ?? null,
    source: source.src.startsWith('blob:') ? null : source.src,
    label: sourceName,
    savedAt: Date.now(),
    scene: {
      layers: layerControls.current,
      behaviours: interactionZones.current,
      response: response.current,
      amplitudes: amps.current,
      appearance: look.current,
      particleCount,
      sensitivity: sens,
      surfaceBlend,
      flight,
      view: viewRef.current?.get() ?? null,
    },
  });
  // Everything goes through the same validation as a page load. Embedded in
  // /experience the studio's own working state is left untouched.
  const applyPreset = (p: FeatherPreset) => {
    const json = (v: unknown) => (v == null ? null : JSON.stringify(v));
    layerControls.current = loadLayers(json(p.scene.layers));
    interactionZones.current = loadInteractionZones(json(p.scene.behaviours));
    response.current = loadResponse(json(p.scene.response));
    amps.current = loadAmps(json(p.scene.amplitudes));
    look.current = loadLook(json(p.scene.appearance));
    seedMasterRoutes(interactionZones.current, layerControls.current.groups);
    if (!embedded) {
      savePreference(LAYERS_KEY, layerControls.current);
      savePreference(ZONES_KEY, interactionZones.current);
      savePreference('f2.response', response.current);
      savePreference(AMPS_KEY, amps.current);
      savePreference(LOOK_KEY, look.current);
    }
    // the layers effect keeps these masks only while the version marker matches
    savePreference(LAYERS_VERSION_KEY, LAYERS_VERSION);
    const sameScan = (!p.source || p.source === source.src) && p.scene.particleCount === particleCount && p.scene.sensitivity === sens;
    setParticleCount(p.scene.particleCount);
    setSens(p.scene.sensitivity);
    setSurfaceBlend(p.scene.surfaceBlend);
    setFlight({ ...p.scene.flight });
    pendingView.current = p.scene.view;
    if (p.source && p.source !== source.src) pick(p.source, p.label);
    else if (sameScan && p.scene.view && viewRef.current) {
      viewRef.current.set(p.scene.view);
      pendingView.current = null;
    }
    setActivePreset(p.id);
    setAmpTick((tick) => tick + 1);
  };
  useEffect(() => {
    if (preset) applyPreset(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.id]);

  // ---- three.js scene -----------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !anatomy) return;

    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { setError('3D rendering is unavailable in this browser. The photograph and analysis are still available.'); setReference(true); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x000000);
    // Normal alpha blending preserves the measured pixel colours. Additive
    // blending made dense pale regions converge to white, so the reconstruction
    // no longer matched the photograph even when the analysis was correct.
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
      pos3[i * 3 + 2] = anatomy.formZ[i];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos3, 3));
    const anatomyData = new Float32Array(anatomy.count * 3);
    for (let i = 0; i < anatomy.count; i++) {
      anatomyData[i * 3] = anatomy.part[i];
      anatomyData[i * 3 + 1] = anatomy.downy[i];
      anatomyData[i * 3 + 2] = anatomy.shaftX?.[i] ?? 0;
    }
    geo.setAttribute('aAnatomy', new THREE.BufferAttribute(anatomyData, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(anatomy.rgb, 3));
    geo.setAttribute('aUV', new THREE.BufferAttribute(anatomy.uv, 2));
    geo.setAttribute('aBarb', new THREE.BufferAttribute(anatomy.barb, 2));
    geo.setAttribute('aCluster', new THREE.BufferAttribute(anatomy.cluster, 1));
    geo.setAttribute('aSurf', new THREE.BufferAttribute(anatomy.surf, 4));
    geo.setAttribute('aPatA', new THREE.BufferAttribute(anatomy.patA, 4));
    geo.setAttribute('aPatB', new THREE.BufferAttribute(anatomy.patB, 4));
    geo.setAttribute('aPatC', new THREE.BufferAttribute(anatomy.patC, 2));
    geo.setAttribute('aPattern', new THREE.BufferAttribute(anatomy.pattern, 1));

    const uniforms = {
      uGroupLife: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
      uPatternLife: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) },
      uPartLife: { value: Array.from({ length: 5 }, () => new THREE.Vector4()) },
      uGroupLifeLight: { value: Array.from({ length: 6 }, () => new THREE.Vector2()) },
      uPatternLifeLight: { value: Array.from({ length: 12 }, () => new THREE.Vector2()) },
      uPartLifeLight: { value: Array.from({ length: 5 }, () => new THREE.Vector2()) },
      uPatternOnly: { value: 0 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uScatter: { value: 0 },
      uFlowMode: { value: 0 },
      uAnchor: { value: 0.9 },
      uBlend: { value: surfaceBlend },
      uPhotoAvailable: { value: 0 },
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
      uThickness: { value: 0 },
      uParticleShape: { value: 2 },
      uConnection: { value: 0.45 },
      uRadiance: { value: 1 },
      uTail: { value: 0 },
      uRoughness: { value: .35 },
      uReflection: { value: .25 },
      uMetalness: { value: 0 },
      uDichroic: { value: 0 },
      uHalfW: { value: Math.max(0.05, anatomy.aspect) },
      uSize: { value: 1 },
      uTaper: { value: 1 },
      uStemTest: { value: 0 },
      uStemLevels: { value: [0, 0, 0, 0, 0] },
      uCentreSize: { value: 1.32 },
      uTipSize: { value: 0.1 },
      uFocus: { value: 3.4 },
      uDof: { value: 0 },
      uAntic: { value: 0 },
      uShed: { value: 0 },
      uLeadNote: { value: -1 },
      uNoteLight: { value: 0 },
      uRate: { value: 1 },
      uSoft: { value: 0.55 },
      uAlpha: { value: 0.92 },
      uPointer: { value: new THREE.Vector2() },
      uWindDirection: { value: new THREE.Vector2(1, 0.3).normalize() },
      uWind: { value: 0 },
      uGroupBrightness: { value: Array(6).fill(1) },
      uGroupSize: { value: Array(6).fill(1) },
      uGroupMovement: { value: Array(6).fill(1) },
      uGroupDepth: { value: Array(6).fill(1) },
      uPatternBrightness: { value: Array(12).fill(1) },
      uPatternSize: { value: Array(12).fill(1) },
      uPatternMovement: { value: Array(12).fill(1) },
      uPatternDepth: { value: Array(12).fill(1) },
      uPartMovement: { value: Array(5).fill(1) },
      uPartDepth: { value: Array(5).fill(1) },
      uPartSize: { value: Array(5).fill(1) },
      uGroupAxis: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
      uPatternAxis: { value: Array.from({ length: 12 }, () => new THREE.Vector3()) },
      uPartAxis: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
      uPartVisible: { value: Array(5).fill(1) },
      uPartBrightness: { value: Array(5).fill(1) },
      uBehaviourTravel: { value: 0 },
      uBehaviourTravelPosition: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT_HUE,
      fragmentShader: FRAG_REAL,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    // Mean colour of each anatomical part, for LED "mirror" mode. The shader
    // colours particles on the GPU, so the CPU has no per-part colour to send
    // a strip — but the source data does, and it never changes for a given
    // feather, so it is worth exactly one pass at load.
    const PART_OF: Record<number, FeatherPart> = {
      [PART.calamus]: 'calamus', [PART.rachis]: 'rachis', [PART.barbs]: 'vane',
      [PART.down]: 'down', [PART.eye]: 'markings',
    };
    const partMean: Partial<Record<FeatherPart, PartColor>> = {};
    {
      const acc: Record<string, { r: number; g: number; b: number; n: number }> = {};
      for (let i = 0; i < anatomy.count; i++) {
        const key = PART_OF[anatomy.part[i]];
        if (!key) continue;
        const a = (acc[key] ??= { r: 0, g: 0, b: 0, n: 0 });
        a.r += anatomy.rgb[i * 3];
        a.g += anatomy.rgb[i * 3 + 1];
        a.b += anatomy.rgb[i * 3 + 2];
        a.n++;
      }
      for (const key in acc) {
        const a = acc[key];
        // normalise to the brightest channel: a strip has its own brightness
        // control, and a dim photo should still give a saturated light
        const peak = Math.max(a.r, a.g, a.b) / a.n || 1;
        partMean[key as FeatherPart] = {
          r: a.r / a.n / peak, g: a.g / a.n / peak, b: a.b / a.n / peak, level: 0,
        };
      }
    }

    const cloud = new THREE.Points(geo, mat);
    cloud.renderOrder = 2;
    const photo = createPhotoSurface(anatomy, result!.source.src, geo, uniforms, VERT_HUE, FRAG_REAL,
      renderer.capabilities.getMaxAnisotropy(), () => setError('The detailed surface could not load. The measured point view is still available.'));
    if (photo) scene.add(photo.mesh);

    // THE GHOST — the same cloud, one beat behind, like a delay send on the
    // visuals. It shares the geometry and every static uniform (one buffer, no
    // duplicated attributes); only the audio-derived uniforms get their own
    // slots, fed from a ring buffer of what the feather was doing a beat ago.
    // On a locked track the echo lands exactly on the offbeat.
    const GHOST_KEYS = [
      'uDrvEye', 'uDrvFlex', 'uDrvWave', 'uDrvFringe', 'uDrvShimmer', 'uDrvColor',
      'uDrvDepth', 'uDrvFlexHit', 'uAntic', 'uShed', 'uNoteLight', 'uLeadNote',
    ] as const;
    const ghostUniforms = { ...uniforms };
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
    const echoMaterial = photo ? (photo.mesh.material as THREE.ShaderMaterial).clone() : null;
    if (echoMaterial && photo) echoMaterial.uniforms = { ...(photo.mesh.material as THREE.ShaderMaterial).uniforms, ...ghostUniforms };
    const photoEcho = photo && echoMaterial ? new THREE.Mesh(photo.mesh.geometry, echoMaterial) : null;
    if (photoEcho) { photoEcho.frustumCulled = false; scene.add(photoEcho); }
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
    const motionBlurPass = new MotionBlurPass();
    composer.addPass(motionBlurPass);
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
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.panSpeed = 0.65;
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
      uniforms.uViewport.value.set(w, h);
      camera.aspect = w / h;
      // frame the feather: its cloud spans y -1..1, x ±aspect
      const need = Math.max(1.15, (anatomy.aspect * 1.25) / camera.aspect);
      const dist = need / Math.tan((camera.fov * Math.PI) / 360);
      // Preserve the user's zoom RELATIVE to the framing distance. Setting
      // position.z outright — as this did before there was a camera to move —
      // would yank the view back to default every time the window resized.
      const offset = camera.position.clone().sub(controls.target);
      const ratio = framed > 0 ? offset.length() / framed : 1;
      framed = dist;
      camera.position.copy(controls.target).add(offset.setLength(dist * ratio));
      controls.minDistance = dist * 0.08;
      controls.maxDistance = dist * 2.6;
      camera.updateProjectionMatrix();
      composer.setSize(w, h);
      controls.update();
      // controls.update() dispatches `change`, which would otherwise register as
      // the user grabbing the feather and mute the drift for two seconds after
      // every resize — and after mount, since ResizeObserver fires immediately
      lastTouch = -1e9;
      if (pendingView.current && viewRef.current) {
        const view = pendingView.current;
        pendingView.current = null;
        viewRef.current.set(view);
      }
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
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const mouse = new THREE.Vector2();
    const hit = new THREE.Vector3();
    let gustTarget = 0;
    let pointerId: number | null = null;
    let previousX = 0, previousY = 0;
    const point = (event: PointerEvent) => {
      if (!live.current.wind || pointerId !== event.pointerId) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(mouse, camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        cloud.worldToLocal(hit);
        uniforms.uPointer.value.set(hit.x, hit.y);
      }
      const dx = event.clientX - previousX, dy = previousY - event.clientY;
      if (Math.hypot(dx, dy) > 1) uniforms.uWindDirection.value.set(dx, dy).normalize();
      previousX = event.clientX; previousY = event.clientY;
      gustTarget = 1;
    };
    const down = (event: PointerEvent) => {
      if (!live.current.wind) return;
      pointerId = event.pointerId;
      previousX = event.clientX; previousY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      point(event);
    };
    const up = () => { gustTarget = 0; pointerId = null; };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', point);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    renderer.domElement.addEventListener('lostpointercapture', up);
    window.addEventListener('blur', up);


    resetView.current = () => {
      camera.position.set(0, 0, framed);
      controls.target.set(0, 0, 0);
      controls.update();
      lastTouch = -1e9;
    };
    inspectView.current = (region) => {
      const targetY = region === 'Tip' ? 0.72 : region === 'Down' ? -0.65 : region === 'Vane' ? 0.12 : 0;
      const scale = region === 'Whole' ? 1 : region === 'Detail' ? 0.14 : 0.32;
      controls.target.set(0, targetY, 0);
      camera.position.set(0, targetY, framed * scale);
      controls.update();
      lastTouch = performance.now();
    };
    // Camera in framing-relative units, so a saved angle and zoom read the same
    // on a phone and a projector.
    viewRef.current = {
      get: () => framed > 0 ? { position: [camera.position.x / framed, camera.position.y / framed, camera.position.z / framed], target: [controls.target.x, controls.target.y, controls.target.z] } : null,
      set: (view) => {
        if (!(framed > 0)) { pendingView.current = view; return; }
        camera.position.set(view.position[0] * framed, view.position[1] * framed, view.position[2] * framed);
        controls.target.set(view.target[0], view.target[1], view.target[2]);
        controls.update();
        lastTouch = performance.now();
      },
    };
    const ro = new ResizeObserver(fit);
    ro.observe(mount);

    let raf = 0;
    let frame = 0;
    let drift = 1;
    let lastT = 0;
    let flexSm = 0;
    let shedEnv = 0;
    const interactionZoneStates = new Map<string, InteractionZoneState>();
    // smoothed trigger level per play channel (see play.ts)
    const playEnvelope = new Float32Array(16);
    const smoothed = Object.fromEntries(TARGETS.map((target) => [target.id, 0])) as Record<TargetId, number>;
    // ~2 s of history at 60 fps, enough for one beat down to 30 bpm
    const RING = 120;
    const ringT = new Float32Array(RING);
    const ringV = new Float32Array(RING * 12);
    let ringAt = 0;
    let ringFill = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const raw = feed.read(t);
      const f = live.current.demo ? Object.assign({}, raw, demoSignal(t)) : raw;
      if (musicPlayer.active) {
        for (const key of Object.keys(f)) if (typeof f[key as keyof typeof f] === 'number') (f as unknown as Record<string, number>)[key] = 0;
        f.playing = true; f.sourceLabel = LOOP_STYLES[musicPlayer.selected].name;
      }
      const dtf = Math.min(0.1, (t - lastT) / 1000) || 1 / 60;
      const responseNow = response.current;
      const encounterSignal = Math.max(f.level, live.current.breath ? 0.65 : 0);
      encounter.ingest({
        version: 1,
        source: live.current.breath ? 'touch' : feed.micOn ? 'microphone' : 'simulation',
        nodeId: 'feather2',
        kind: 'wind',
        value: encounterSignal,
        timestamp: t,
        valid: true,
        unit: 'normalized',
      });
      const encounterState = encounter.advanceTo(t).state;
      encounterMeter.current?.(encounterState.phase, encounterState);
      controls.enabled = !live.current.wind && !live.current.breath;
      if (live.current.breath) {
        gustTarget = 0.65;
        uniforms.uPointer.value.set(0, -0.12);
        uniforms.uWindDirection.value.set(0.92, 0.38).normalize();
      } else if (!live.current.wind) gustTarget = 0;
      uniforms.uWind.value = followEnvelope(uniforms.uWind.value, gustTarget * responseNow.wind, dtf, 55, 420);
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
      elemVals.vibrato = f.vibrato;
      elemVals.bright = f.bright;

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
      for (const target of TARGETS) {
        const id = target.id;
        smoothed[id] = followEnvelope(smoothed[id], Math.min(DRIVE_MAX, drive[id] * responseNow.gain), dtf, responseNow.attack, responseNow.release);
        drive[id] = smoothed[id];
      }
      const routed = TARGETS.reduce((sum, target) => sum + drive[target.id], 0);
      // A cleared matrix is a real bypass. Beat phase and pitch no longer
      // leak into the baseline motion when no column has a route.
      uniforms.uPhase.value = routed > 0.001 ? f.phase : 0;
      const cap = (x: number) => (x > DRIVE_MAX ? DRIVE_MAX : x);
      uniforms.uDrvEye.value = cap(drive.eye) * a.eye;
      uniforms.uDrvColor.value = cap(drive.color) * a.color;
      uniforms.uDrvWave.value = cap(drive.wave) * a.wave;
      uniforms.uDrvShimmer.value = cap(drive.shimmer) * a.shimmer;
      const flexNow = cap(drive.flex) * a.flex;
      uniforms.uDrvFlex.value = flexNow;
      uniforms.uDrvFringe.value = cap(drive.fringe) * a.fringe;
      uniforms.uDrvDepth.value = Math.min(1, drive.depth);
      // Appearance sets the physical depth budget; reactivity scales it.
      // This keeps sculptural depth and reactive separation in lockstep.
      uniforms.uAmpDepth.value = look.current.volume * a.depth;

      // the whip rides the RISE of the flex column, so a sustained row drives
      // the slow bend while only an actual hit snaps it
      flexSm += (flexNow - flexSm) * Math.min(1, dtf * 5);
      uniforms.uDrvFlexHit.value = Math.max(0, flexNow - flexSm);

      const L = look.current;
      const editorLayers = layerControls.current.layers;
      const masterLayers = layerControls.current.groups;
      const zoneDocument = interactionZones.current;
      const zoneModifiers = new Map<string, ReturnType<typeof stepInteractionZone>>();
      for (const zone of zoneDocument.zones) {
        let state = interactionZoneStates.get(zone.id);
        if (!state) {
          state = initialInteractionZoneState();
          interactionZoneStates.set(zone.id, state);
        }
        zoneModifiers.set(zone.id, stepInteractionZone(zone, state, elemVals[zone.trigger as ElementId] ?? 0, t / 1000, dtf));
      }
      const masterZoneEffects = new Map<string, ReturnType<typeof mixRoutedInteractionZones>>();
      let behaviourShaft = 0;
      let behaviourVane = 0;
      let behaviourFringe = 0;
      let behaviourTravel = 0;
      let behaviourTravelPosition = 0;
      for (const master of masterLayers) {
        const effect = mixRoutedInteractionZones(zoneDocument.zones, zoneModifiers, zoneDocument.routes[master.id] ?? {});
        masterZoneEffects.set(master.id, effect);
        const ownedParts = editorLayers.filter((layer) => layer.groupId === master.id && layer.kind === 'parts').map((layer) => layer.index);
        if (ownedParts.includes(1)) behaviourShaft = Math.max(behaviourShaft, effect.shaft);
        if (ownedParts.includes(2)) {
          behaviourVane = Math.max(behaviourVane, effect.vane);
          if (effect.travel > behaviourTravel) {
            behaviourTravel = effect.travel;
            behaviourTravelPosition = effect.travelPosition;
          }
        }
        if (ownedParts.includes(3)) behaviourFringe = Math.max(behaviourFringe, effect.fringe);
      }
      // All anatomical motion is combined once before the shader. Behaviour
      // fields and the advanced matrix no longer displace the same region
      // through parallel uniform paths.
      uniforms.uDrvFlex.value = Math.min(DRIVE_MAX, flexNow + behaviourShaft);
      uniforms.uDrvWave.value = Math.min(DRIVE_MAX, cap(drive.wave) * a.wave + behaviourVane);
      uniforms.uDrvFringe.value = Math.min(1, cap(drive.fringe) * a.fringe + behaviourFringe);
      uniforms.uBehaviourTravel.value = behaviourTravel;
      uniforms.uBehaviourTravelPosition.value = behaviourTravelPosition;
      for (const values of [uniforms.uGroupLife.value, uniforms.uPatternLife.value, uniforms.uPartLife.value]) for (const value of values) value.set(0, 0, 0, 0);
      for (const values of [uniforms.uGroupLifeLight.value, uniforms.uPatternLifeLight.value, uniforms.uPartLifeLight.value]) for (const value of values) value.set(0, 0);
      const groupActive = Array(6).fill(false);
      const patternActive = Array(12).fill(false);
      const partActive = Array(5).fill(false);
      uniforms.uGroupBrightness.value.fill(0);
      uniforms.uGroupSize.value.fill(0);
      uniforms.uGroupMovement.value.fill(0);
      uniforms.uGroupDepth.value.fill(0);
      uniforms.uPatternBrightness.value.fill(0);
      uniforms.uPatternSize.value.fill(0);
      uniforms.uPatternMovement.value.fill(0);
      uniforms.uPatternDepth.value.fill(0);
      uniforms.uPartBrightness.value.fill(0);
      uniforms.uPartSize.value.fill(0);
      uniforms.uPartMovement.value.fill(0);
      uniforms.uPartDepth.value.fill(0);
      for (const axis of uniforms.uGroupAxis.value as THREE.Vector3[]) axis.set(0, 0, 0);
      for (const axis of uniforms.uPatternAxis.value as THREE.Vector3[]) axis.set(0, 0, 0);
      for (const axis of uniforms.uPartAxis.value as THREE.Vector3[]) axis.set(0, 0, 0);
      const applyAxis = (target: THREE.Vector3, effect: ReturnType<typeof mixRoutedInteractionZones>) => {
        const nextStrength = Math.abs(effect.axisX) + Math.abs(effect.axisY) + Math.abs(effect.axisZ);
        if (nextStrength >= Math.abs(target.x) + Math.abs(target.y) + Math.abs(target.z)) {
          target.set(effect.axisX, effect.axisY, effect.axisZ);
        }
      };
      const routeDrive = (routes: LayerControl['routes'], target: LayerTarget) => {
        let amount = 0;
        for (const element of ELEMENTS) amount += elemVals[element.id] * (routes[element.id]?.[target] ?? 0);
        return Math.min(DRIVE_MAX, amount);
      };
      // ---- live play: a trigger becomes the movement amount of its part ----
      const playNow = playRef.current;
      if (playNow) {
        for (let i = 0; i < playNow.channels.length && i < playEnvelope.length; i++) {
          const channel = playNow.channels[i];
          const level = playNow.levels[i];
          const target = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
          playEnvelope[i] = playNow.enveloped ? target : followEnvelope(playEnvelope[i], target, dtf, channel.attack, channel.release);
        }
      }
      for (const layer of editorLayers) {
        const master = masterLayers.find((group) => group.id === layer.groupId);
        if (!layer.visible || !master?.visible) continue;
        const life = resolveLife(layer, master, `${master.id}:${layer.kind}:${layer.index}`);
        const lifeValues = layer.kind === 'colors' ? uniforms.uGroupLife.value : layer.kind === 'patterns' ? uniforms.uPatternLife.value : uniforms.uPartLife.value;
        const lightValues = layer.kind === 'colors' ? uniforms.uGroupLifeLight.value : layer.kind === 'patterns' ? uniforms.uPatternLifeLight.value : uniforms.uPartLifeLight.value;
        if (lifeValues[layer.index]) {
          lifeValues[layer.index].set(life.mode, life.amount, life.speed, life.phase);
          lightValues[layer.index].set(life.glow, life.hue);
          if (playNow) {
            // The strongest channel aimed at this part wins; Still channels abstain.
            let bestAmount = -1;
            let best: FeatherPlay['channels'][number] | null = null;
            for (let i = 0; i < playNow.channels.length && i < playEnvelope.length; i++) {
              const channel = playNow.channels[i];
              if (channel.mode <= 0 || !playPartMatches(channel.part, layer)) continue;
              const amount = channel.strength * playEnvelope[i];
              if (amount > bestAmount) { bestAmount = amount; best = channel; }
            }
            if (best) {
              lifeValues[layer.index].set(best.mode, Math.min(2, bestAmount), best.speed, life.phase);
              lightValues[layer.index].set(Math.min(2, life.glow + bestAmount * 0.35), life.hue);
            }
          }
        }
        const effect = masterZoneEffects.get(master.id)!;
        const routes = layer.assignedZoneId && zoneDocument.zones.some((zone) => zone.id === layer.assignedZoneId)
          ? { [layer.assignedZoneId]: 1 }
          : zoneDocument.routes[master.id] ?? {};
        const routed = layer.assignedZoneId ? mixRoutedInteractionZones(zoneDocument.zones, zoneModifiers, routes) : effect;
        const brightnessDrive = (layer.audioEnabled ? routeDrive(layer.routes, 'brightness') : 0) + (master.audioEnabled ? routeDrive(master.routes, 'brightness') : 0);
        const sizeDrive = (layer.audioEnabled ? routeDrive(layer.routes, 'size') : 0) + (master.audioEnabled ? routeDrive(master.routes, 'size') : 0);
        const brightness = layer.brightness * master.brightness * routed.brightness * (1 + Math.min(DRIVE_MAX, brightnessDrive) * 0.75);
        const size = layer.size * master.size * routed.size * (1 + Math.min(DRIVE_MAX, sizeDrive) * 0.5);
        const movementDrive = (layer.audioEnabled ? routeDrive(layer.routes, 'movement') : 0) + (master.audioEnabled ? routeDrive(master.routes, 'movement') : 0);
        const depthDrive = (layer.audioEnabled ? routeDrive(layer.routes, 'depth') : 0) + (master.audioEnabled ? routeDrive(master.routes, 'depth') : 0);
        const { movement, depth } = layerMotion(layer, master, routed, movementDrive, depthDrive);
        if (layer.kind === 'colors' && layer.index < 6) {
          groupActive[layer.index] = true;
          uniforms.uGroupBrightness.value[layer.index] = Math.max(uniforms.uGroupBrightness.value[layer.index], brightness);
          uniforms.uGroupSize.value[layer.index] = Math.max(uniforms.uGroupSize.value[layer.index], size);
          uniforms.uGroupMovement.value[layer.index] = Math.max(uniforms.uGroupMovement.value[layer.index], movement);
          uniforms.uGroupDepth.value[layer.index] = Math.max(uniforms.uGroupDepth.value[layer.index], depth);
          applyAxis(uniforms.uGroupAxis.value[layer.index], routed);
        } else if (layer.kind === 'patterns' && layer.index < 12) {
          patternActive[layer.index] = true;
          uniforms.uPatternBrightness.value[layer.index] = Math.max(uniforms.uPatternBrightness.value[layer.index], brightness);
          uniforms.uPatternSize.value[layer.index] = Math.max(uniforms.uPatternSize.value[layer.index], size);
          uniforms.uPatternMovement.value[layer.index] = Math.max(uniforms.uPatternMovement.value[layer.index], movement);
          uniforms.uPatternDepth.value[layer.index] = Math.max(uniforms.uPatternDepth.value[layer.index], depth);
          applyAxis(uniforms.uPatternAxis.value[layer.index], routed);
        } else if (layer.kind === 'parts' && layer.index < 5) {
          partActive[layer.index] = true;
          uniforms.uPartBrightness.value[layer.index] = Math.max(uniforms.uPartBrightness.value[layer.index], brightness);
          uniforms.uPartSize.value[layer.index] = Math.max(uniforms.uPartSize.value[layer.index], size);
          uniforms.uPartMovement.value[layer.index] = Math.max(uniforms.uPartMovement.value[layer.index], movement);
          uniforms.uPartDepth.value[layer.index] = Math.max(uniforms.uPartDepth.value[layer.index], depth);
          applyAxis(uniforms.uPartAxis.value[layer.index], routed);
        }
      }
      for (let i = 0; i < 6; i++) if (!groupActive[i]) {
        uniforms.uGroupSize.value[i] = 1; uniforms.uGroupMovement.value[i] = 1; uniforms.uGroupDepth.value[i] = 1;
      }
      for (let i = 0; i < 12; i++) if (!patternActive[i]) {
        uniforms.uPatternSize.value[i] = 1; uniforms.uPatternMovement.value[i] = 1; uniforms.uPatternDepth.value[i] = 1;
      }
      for (let i = 0; i < 5; i++) {
        uniforms.uPartVisible.value[i] = partActive[i] ? 1 : 0;
        if (!partActive[i]) {
          uniforms.uPartSize.value[i] = 1; uniforms.uPartMovement.value[i] = 1; uniforms.uPartDepth.value[i] = 1;
        }
      }
      const visibility = maskVisibility(groupActive, patternActive, partActive);
      if (visibility.neutralColours) uniforms.uGroupBrightness.value.fill(1);
      if (visibility.neutralPatterns) uniforms.uPatternBrightness.value.fill(1);
      if (visibility.any && visibility.neutralParts) {
        uniforms.uPartVisible.value.fill(1);
        uniforms.uPartBrightness.value.fill(1);
      }
      if (!visibility.any) uniforms.uPartVisible.value.fill(0);
      uniforms.uPatternOnly.value = visibility.patternOnly ? 1 : 0;
      uniforms.uVolume.value = L.volume;
      uniforms.uThickness.value = L.thickness;
      uniforms.uParticleShape.value = Math.round(Math.min(10, L.particleShape));
      uniforms.uConnection.value = Math.min(1, L.connection);
      uniforms.uRadiance.value = Math.min(8, L.radiance);
      uniforms.uTail.value = Math.min(1, L.tail);
      uniforms.uRoughness.value = Math.min(1, L.roughness);
      uniforms.uReflection.value = Math.min(1, L.reflection);
      uniforms.uMetalness.value = Math.min(1, L.metalness);
      motionBlurPass.amount = Math.min(1, L.motionBlur);
      uniforms.uDichroic.value = L.blendMode > 1.5 ? 1 : 0;
      const particleBlending = L.blendMode > 0.5 ? THREE.AdditiveBlending : THREE.NormalBlending;
      mat.blending = particleBlending;
      uniforms.uSize.value = L.size;
      uniforms.uTaper.value = L.taper > 0.5 ? 1 : 0;
      uniforms.uCentreSize.value = Math.max(0.01, L.centreSize);
      uniforms.uTipSize.value = Math.max(0.01, L.tipSize);
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
      uniforms.uAntic.value = wind * f.lock * a.flex * responseNow.gain * (routed > 0.001 ? 1 : 0);
      shedEnv = Math.max(shedEnv * Math.exp(-dtf / 0.42), Math.min(1, cap(drive.fringe) * 0.55));
      uniforms.uShed.value = shedEnv * a.fringe * responseNow.gain;
      uniforms.uLeadNote.value = f.leadNote;
      uniforms.uNoteLight.value = Math.min(1, cap(drive.eye) * 0.35) * a.eye;
      uniforms.uRate.value = f.bpm > 0 ? Math.max(0.5, Math.min(2, f.bpm / 110)) : 1;

      // ---- feed the light rig ------------------------------------------------
      // The router rate-gates internally, so calling this every frame is cheap:
      // most frames it does the comparison and returns nothing.
      for (const k in partMean) {
        const pm = partMean[k as FeatherPart]!;
        pm.level =
          k === 'rachis' ? Math.min(1, uniforms.uDrvFlex.value)
          : k === 'vane' ? Math.min(1, uniforms.uDrvWave.value)
          : k === 'down' ? Math.min(1, uniforms.uDrvFringe.value)
          : k === 'markings' ? Math.min(1, uniforms.uDrvEye.value)
          : Math.min(1, uniforms.uDrvFlex.value * 0.5);
      }
      // Embedded in /experience the console owns the strips; only the studio pushes.
      if (!embeddedRef.current && !live.current.demo && !musicPlayer.active) ledService.push({ elements: elemVals, leadNote: f.leadNote, parts: partMean });

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

      ghost.rotation.copy(cloud.rotation);
      ghost.position.x = cloud.position.x;
      ghost.position.y = cloud.position.y;
      ghost.visible = L.ghost && f.lock > 0.15 && responseNow.gain > 0;
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

      const usePhoto = !!photo?.ready();
      uniforms.uScatter.value += (flightRef.current.scatter - uniforms.uScatter.value) * (1 - Math.exp(-dtf / 0.65));
      uniforms.uFlowMode.value = flightRef.current.mode;
      uniforms.uAnchor.value = flightRef.current.anchor;
      uniforms.uPhotoAvailable.value = usePhoto ? 1 : 0;
      uniforms.uBlend.value = usePhoto ? blendRef.current : 1;
      cloud.visible = !usePhoto;
      if (photo) {
        (photo.mesh.material as THREE.ShaderMaterial).blending = particleBlending;
        if (echoMaterial) echoMaterial.blending = particleBlending;
        photo.mesh.visible = usePhoto;
        photo.mesh.rotation.copy(cloud.rotation);
        photo.mesh.position.copy(cloud.position);
      }
      // The photograph retains its own light; bloom otherwise washes out fine fibres.
      if (photoEcho) {
        photoEcho.visible = usePhoto && ghost.visible;
        photoEcho.rotation.copy(ghost.rotation);
        photoEcho.position.copy(ghost.position);
      }
      if (usePhoto) { bloomPass.strength *= 0.12; ghost.visible = false; }
      uniforms.uStemTest.value = musicPlayer.active ? 1 : 0;
      uniforms.uStemLevels.value.fill(0);
      if (musicPlayer.active) musicPlayer.read().forEach((level, i) => { uniforms.uStemLevels.value[musicPlayer.targets[i]] = level; });
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
        led: ledService,
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
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointermove', point);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', up);
      renderer.domElement.removeEventListener('lostpointercapture', up);
      window.removeEventListener('blur', up);
      resetView.current = null;
      viewRef.current = null;
      ro.disconnect();
      inspectView.current = null;
      photo?.dispose();
      geo.dispose();
      mat.dispose();
      ghostMat.dispose();
      echoMaterial?.dispose();
      for (const pass of composer.passes) pass.dispose();
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

  const setAmp = (key: keyof Amps, v: number) => {
    amps.current[key] = v;
    savePreference(AMPS_KEY, amps.current);
    setAmpTick((x) => x + 1);
  };

  const setLook = <K extends keyof Look>(key: K, v: Look[K]) => {
    look.current[key] = v;
    savePreference(LOOK_KEY, look.current);
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
    savePreference(ROUTES_KEY, routes.current);
    savePreference(ROUTES_VERSION_KEY, ROUTES_VERSION);
    setAmpTick((x) => x + 1);
  };

  const commitLayers = () => {
    savePreference(LAYERS_KEY, layerControls.current);
    savePreference(LAYERS_VERSION_KEY, LAYERS_VERSION);
    setAmpTick((tick) => tick + 1);
  };
  const selectLayer = (id: string) => {
    layerControls.current.selectedId = id;
    commitLayers();
  };
  const addLayer = () => {
    const selected = layerControls.current.layers.find((layer) => layer.id === layerControls.current.selectedId);
    const selectedGroup = layerControls.current.groups.find((group) => group.id === layerControls.current.selectedId);
    const layer = selected
      ? { ...selected, id: newLayerId(), name: `${selected.name} copy`, routes: Object.fromEntries(ELEMENTS.map((element) => [element.id, { ...selected.routes[element.id] }])) as LayerControl['routes'] }
      : makeLayer('colors', 0, 'New image mask', selectedGroup?.id ?? layerControls.current.groups[0]?.id);
    layerControls.current.layers.push(layer);
    layerControls.current.selectedId = layer.id;
    commitLayers();
  };
  const addGroup = () => {
    const group = makeGroup(`master-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, `Master ${layerControls.current.groups.length + 1}`);
    layerControls.current.groups.push(group);
    layerControls.current.selectedId = group.id;
    seedMasterRoutes(interactionZones.current, layerControls.current.groups);
    savePreference(ZONES_KEY, interactionZones.current);
    commitLayers();
  };
  const autoSeparateLayers = () => {
    if (!anatomy) return;
    layerControls.current = detectedLayers(anatomy, source.src);
    seedMasterRoutes(interactionZones.current, layerControls.current.groups);
    savePreference(ZONES_KEY, interactionZones.current);
    commitLayers();
  };
  const removeLayer = (id: string) => {
    const groups = layerControls.current.groups;
    const groupIndex = groups.findIndex((group) => group.id === id);
    if (groupIndex >= 0) {
      if (groups.length <= 1) return;
      const fallback = groups[groupIndex === 0 ? 1 : 0].id;
      for (const layer of layerControls.current.layers) {
        if (layer.groupId === id) layer.groupId = fallback;
      }
      delete interactionZones.current.routes[id];
      groups.splice(groupIndex, 1);
      layerControls.current.selectedId = groups[Math.max(0, groupIndex - 1)]?.id ?? groups[0].id;
      savePreference(ZONES_KEY, interactionZones.current);
      commitLayers();
      return;
    }
    const layers = layerControls.current.layers;
    if (layers.length <= 1) return;
    const index = layers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    layers.splice(index, 1);
    layerControls.current.selectedId = layers[Math.max(0, index - 1)]?.id ?? layers[0].id;
    commitLayers();
  };
  const changeSimpleLayers = (updates: Array<{ id: string; values: Record<string, number> }>) => {
    for (const { id, values } of updates) {
      const layer = layerControls.current.layers.find(item => item.id === id);
      if (!layer) continue;
      const bounds: Record<string, number> = { lifeMode: 6, lifeAmount: 2, lifeSpeed: 3, lifeGlow: 2, lifeHue: 1, depth: 4 };
      for (const [field, value] of Object.entries(values)) {
        if (field in bounds && Number.isFinite(value)) {
          (layer as unknown as Record<string, number>)[field] = Math.max(0, Math.min(bounds[field], field === 'lifeMode' ? Math.round(value) : value));
        }
      }
    }
    commitLayers();
  };
  const changeLayer = (id: string, field: string, value: string | number | boolean) => {
    const layer = layerControls.current.layers.find((candidate) => candidate.id === id);
    const group = layerControls.current.groups.find((candidate) => candidate.id === id);
    const editable = layer ?? group;
    if (!editable) return;
    if (layer && field === 'kind' && typeof value === 'string' && value.includes(':')) {
      const [kind, rawIndex] = value.split(':') as [LayerKind, string];
      layer.kind = kind;
      layer.index = Number(rawIndex);
    } else if (field === 'name' && typeof value === 'string') {
      editable.name = value.slice(0, 48);
    } else if (layer && field === 'assignedZoneId' && typeof value === 'string') {
      layer.assignedZoneId = value || undefined;
    } else if (field === 'visible' && typeof value === 'boolean') {
      editable.visible = value;
    } else if (field === 'audioEnabled' && typeof value === 'boolean') {
      editable.audioEnabled = value;
    } else if (group && field === 'expanded' && typeof value === 'boolean') {
      group.expanded = value;
    } else if (group && field === 'effectPreset' && typeof value === 'string') {
      group.effect.preset = value as MasterEffectConfig['preset'];
    } else if (group && field === 'effectTrigger' && typeof value === 'string' && ELEMENTS.some((element) => element.id === value)) {
      group.effect.trigger = value;
    } else if (group && field === 'effectMode' && typeof value === 'string') {
      group.effect.mode = value as MasterEffectConfig['mode'];
    } else if (group && field === 'effectAmount' && typeof value === 'number') {
      group.effect.amount = Math.max(0, Math.min(2, value));
    } else if (typeof value === 'number' && Number.isFinite(value) && field.startsWith('life')) {
      const bounds: Record<string, [number, number]> = { lifeMode: [layer ? -1 : 0, 6], lifeAmount: [0, 2], lifeSpeed: [0, 3], lifeGlow: [0, 2], lifeHue: [0, 1] };
      if (bounds[field]) (editable as unknown as Record<string, number>)[field] = Math.max(bounds[field][0], Math.min(bounds[field][1], field === 'lifeMode' ? Math.round(value) : value));
    } else if (typeof value === 'number' && ['brightness', 'size', 'movement', 'depth'].includes(field)) {
      (editable as unknown as Record<string, number>)[field] = Math.max(0, Math.min(field === 'movement' || field === 'depth' ? 4 : 2, value));
    }
    commitLayers();
  };
  const moveLayer = (id: string, groupId: string) => {
    const layer = layerControls.current.layers.find((candidate) => candidate.id === id);
    if (!layer || !layerControls.current.groups.some((group) => group.id === groupId)) return;
    layer.groupId = groupId;
    const group = layerControls.current.groups.find((candidate) => candidate.id === groupId);
    if (group) group.expanded = true;
    commitLayers();
  };
  const soloLayer = (id: string) => {
    const layers = layerControls.current.layers;
    const groups = layerControls.current.groups;
    const group = groups.find((candidate) => candidate.id === id);
    if (group) {
      const alreadySolo = groups.every((candidate) => candidate.id === id ? candidate.visible : !candidate.visible);
      groups.forEach((candidate) => { candidate.visible = alreadySolo || candidate.id === id; });
    } else {
      const layer = layers.find((candidate) => candidate.id === id);
      if (!layer) return;
      const alreadySolo = layers.every((candidate) => candidate.id === id ? candidate.visible : !candidate.visible);
      groups.forEach((candidate) => { candidate.visible = alreadySolo || candidate.id === layer.groupId; });
      layers.forEach((candidate) => { candidate.visible = alreadySolo || candidate.id === id; });
    }
    commitLayers();
  };
  const bumpLayerRoute = (id: string, element: ElementId, target: LayerTarget, clear: boolean) => {
    const editable = layerControls.current.layers.find((candidate) => candidate.id === id) ?? layerControls.current.groups.find((candidate) => candidate.id === id);
    if (!editable) return;
    if (clear) editable.routes[element] = {};
    else {
      const current = editable.routes[element]?.[target] ?? 0;
      const next = current === 0 ? 0.5 : current < 1 ? 1 : 0;
      if (next === 0) delete editable.routes[element][target];
      else editable.routes[element][target] = next;
    }
    commitLayers();
  };
  const commitInteractionZones = () => {
    savePreference(ZONES_KEY, interactionZones.current);
    setAmpTick((tick) => tick + 1);
  };
  const selectInteractionZone = (id: string) => {
    interactionZones.current.selectedId = id;
    commitInteractionZones();
  };
  const detectInteractionZones = () => {
    seedMasterRoutes(interactionZones.current, layerControls.current.groups, true);
    commitInteractionZones();
  };
  const addInteractionZone = () => {
    const template = defaultInteractionZones()[interactionZones.current.zones.length % defaultInteractionZones().length];
    const zone: InteractionZone = { ...template, id: `zone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: `Zone ${interactionZones.current.zones.length + 1}` };
    interactionZones.current.zones.push(zone);
    interactionZones.current.selectedId = zone.id;
    commitInteractionZones();
  };
  const removeInteractionZone = (id: string) => {
    const document = interactionZones.current;
    if (document.zones.length <= 1) return;
    const index = document.zones.findIndex((zone) => zone.id === id);
    if (index < 0) return;
    document.zones.splice(index, 1);
    for (const masterId of Object.keys(document.routes)) delete document.routes[masterId][id];
    document.selectedId = document.zones[Math.max(0, index - 1)].id;
    commitInteractionZones();
  };
  const changeInteractionZone = (id: string, field: keyof InteractionZone, value: string | number | boolean) => {
    const zone = interactionZones.current.zones.find((candidate) => candidate.id === id);
    if (!zone) return;
    if (field === 'name' && typeof value === 'string') {
      zone.name = value.slice(0, 40);
    }
    else if (field === 'enabled' && typeof value === 'boolean') zone.enabled = value;
    else if (field === 'trigger' && typeof value === 'string' && ELEMENTS.some((element) => element.id === value)) zone.trigger = value;
    else if (field === 'mode' && typeof value === 'string' && ['toggle', 'gate', 'oneshot'].includes(value)) zone.mode = value as InteractionZone['mode'];
    else if (field === 'behaviour' && typeof value === 'string' && ['pulse', 'flutter', 'shimmer', 'lift', 'blackout'].includes(value)) zone.behaviour = value as InteractionZone['behaviour'];
    else if (field === 'axis' && typeof value === 'string' && ['z', 'x', 'xy'].includes(value)) zone.axis = value as InteractionZone['axis'];
    else if (typeof value === 'number') {
      const limits: Partial<Record<keyof InteractionZone, [number, number]>> = {
        speed: [0.1, 10], attack: [5, 1000], release: [50, 3000],
        amount: [0, 1.5],
        layerDepth: [0, 2.5],
      };
      const limit = limits[field];
      if (limit) (zone as unknown as Record<string, number>)[field] = Math.max(limit[0], Math.min(limit[1], value));
    }
    commitInteractionZones();
  };
  const bumpInteractionRoute = (masterId: string, zoneId: string, clear: boolean) => {
    const document = interactionZones.current;
    const row = (document.routes[masterId] ??= {});
    if (clear) {
      for (const zone of document.zones) delete row[zone.id];
    } else {
      const current = row[zoneId] ?? 0;
      const next = current === 0 ? 0.5 : current < 1 ? 1 : 0;
      if (next === 0) delete row[zoneId];
      else row[zoneId] = next;
    }
    commitInteractionZones();
  };

  const setResponse = (key: keyof ResponseSettings, value: number) => {
    response.current[key] = value;
    savePreference('f2.response', response.current);
    setAmpTick((x) => x + 1);
  };
  const applyResponse = (preset: ResponsePreset) => {
    response.current = { ...RESPONSE_PRESETS[preset] };
    savePreference('f2.response', response.current);
    setAmpTick((x) => x + 1);
  };
  const currentPreset = (Object.keys(RESPONSE_PRESETS) as ResponsePreset[]).find((key) =>
    (Object.keys(response.current) as (keyof ResponseSettings)[]).every((field) => response.current[field] === RESPONSE_PRESETS[key][field]));
  const saveScene = () => {
    savePreference(LAYERS_KEY, layerControls.current);
    savePreference(ZONES_KEY, interactionZones.current);
    savePreference('f2.response', response.current);
    savePreference(AMPS_KEY, amps.current);
    savePreference(LOOK_KEY, look.current);
    setSceneSaved(true);
    window.setTimeout(() => setSceneSaved(false), 1800);
  };
  const exportScene = () => {
    const document = {
      format: 'wingbeat-feather2-scene',
      version: 1,
      name: sourceName,
      source: source.src.startsWith('blob:') ? null : source.src,
      layers: layerControls.current,
      behaviours: interactionZones.current,
      response: response.current,
      amplitudes: amps.current,
      appearance: look.current,
      particleCount,
      sensitivity: sens,
      renderer: 'hybrid',
      surfaceBlend,
      flight,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'feather'}.wingbeat.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div ref={rootRef} className={`f2 ${presenting || embedded ? 'f2-presenting' : ''} ${embedded ? 'f2-embedded' : ''} ${dragging ? 'f2-dragging' : ''} ${focused ? 'f2-focused' : ''}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void importFile(file); }}>
      <input aria-label="Import feather image" ref={featherFile} type="file" accept="image/*" hidden onChange={(event) => {
        const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '';
      }} />
      <input aria-label="Import audio file" ref={audioFile} type="file" accept="audio/*" hidden onChange={(event) => {
        const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '';
      }} />

      <header className="f2-header">
        <a className="f2-brand" href="/" aria-label="Wing Beat console"><span className="f2-brand-mark"><LabIcon name="feather" size={18} /></span><span><b>Wing Beat</b><small>Studio</small></span></a>
        <div className="f2-mode-switch" aria-label="Workspace mode"><button aria-pressed={!presenting} onClick={exitPresentation}>Design</button><button aria-pressed={presenting} onClick={enterPresentation} disabled={!anatomy}>Perform</button></div>
        <div className="f2-header-right"><button className="f2-save-control" onClick={saveScene}>▣ <span>{sceneSaved ? 'Saved' : 'Save scene'}</span></button><button className="f2-export-control" onClick={exportScene}>⇩ <span>Export</span></button><a className="f2-console" href="/" aria-label="Open console">?</a></div>
      </header>

      <aside className="f2-library" aria-label="Feather collection">
        <div className="f2-library-title"><span>Collection</span><LabIcon name="feather" size={17} /></div>
        <button className="f2-create" onClick={() => pick(FEATHERS.find((feather) => !feather.procedural)!.src, 'Untitled feather')}>＋ <span>Create feather</span></button>
        <button className="f2-upload" aria-label="Import feather" onClick={() => featherFile.current?.click()}><LabIcon name="upload" /><span>Import photo</span></button>
        <div className="f2-library-subhead"><span>Specimens</span><b>{String(FEATHERS.length - 1).padStart(2, '0')}</b></div>
        <div className="f2-gallery">{FEATHERS.filter((f) => !f.procedural).map((f, i) => (
          <button key={f.id} className={`f2-specimen ${source.src === f.src ? 'selected' : ''}`} onClick={() => pick(f.src, f.label)} aria-pressed={source.src === f.src} title={f.label}>
            <span className="f2-specimen-number">{String(i + 1).padStart(2, '0')}</span>
            <img src={f.src.replace('/feathers/', '/feathers/thumbs/')} alt={f.label} loading="lazy" decoding="async" />
            <span className="f2-specimen-label">{f.label}</span>
          </button>
        ))}</div>
        <div className="f2-library-foot">Your feather archive</div>
      </aside>

      <main className={`f2-workspace ${windTool && !reference ? 'wind-tool' : ''}`} aria-label="Interactive feather">
        <div className="f2-stage-top"><div><span className="f2-eyebrow">SPECIMEN / {anatomy?.kind.toUpperCase() ?? 'ANALYSING'}</span><h1>{sourceName}</h1></div><span className="f2-live-label"><i />{musicPlayer.active ? 'Five-channel loop' : demo ? 'Demo signal' : feed.active ? 'Audio reactive' : 'At rest'}</span></div>
        <div className="f2-stage-area">
          <div className="f2-inspect-bar" aria-label="Inspect feather region">
            <label className="f2-blend-control">Photo <input aria-label="Photo detail to fibres blend" type="range" min="0" max="1" step="0.01" value={surfaceBlend} onChange={event => setSurfaceBlend(Number(event.target.value))} /> Fibres</label><span>Inspect</span>{['Whole', 'Vane', 'Tip', 'Down', 'Detail'].map(region => <button key={region} aria-pressed={inspection === region && !reference} onClick={() => { setReference(false); setInspection(region); inspectView.current?.(region); }} disabled={!anatomy}>{region}</button>)}
            <button className="f2-focus-control" aria-pressed={focused} onClick={() => setFocused(!focused)}>{focused ? 'Show panels' : 'Hide panels'} ↗</button>
          </div>
          <div ref={mountRef} className={`f2-stage ${reference ? 'f2-stage-hidden' : ''}`} />
          {reference && result && <img className="f2-reference" src={result.source.src} alt={`Original photograph of ${sourceName}`} />}
          {reference && showShaftTrace && anatomy?.shaftTrace && anatomy.photoSurface && <svg className="f2-shaft-trace" viewBox={`0 0 ${anatomy.photoSurface.width} ${anatomy.photoSurface.height}`} role="img" aria-label="Detected calamus and rachis centreline on the source photograph"><polyline points={Array.from({ length: anatomy.shaftTrace.length / 2 }, (_, i) => `${anatomy.shaftTrace![i * 2]},${anatomy.shaftTrace![i * 2 + 1]}`).join(' ')} fill="none" stroke="#bcffb0" strokeWidth={Math.max(1, anatomy.photoSurface.height / 650)} /></svg>}
          {!anatomy && <div className="f2-stage-loading"><LabIcon name="feather" size={40} /><p>{scanError ? 'Choose another feather or import a photo.' : 'Reading shape, barbs and markings…'}</p></div>}
          <div className="f2-stage-corner top-left" /><div className="f2-stage-corner bottom-right" />
          <span className="f2-stage-axis">TIP ↑<span>↓ CALAMUS</span></span>
          {busy && <div className="f2-scan-status" role="status"><i />Analysing feather</div>}
          <div className="f2-stage-caption">{reference ? 'Original photograph' : windTool ? 'Hold and drag across the feather to move the air' : 'Drag to turn · scroll to magnify · right-drag or two fingers to pan'}</div>
        </div>
        <div className="f2-stage-toolbar">
          <div className="f2-render-tabs"><span className="f2-hybrid-label">Living particles</span>{(['Natural', 'Anatomy', 'Pattern', 'Surface'] as const).map((label, index) => <button key={label} className={!reference && debugMode === index ? 'active' : ''} onClick={() => { setDebugMode(index as Dbg); setReference(false); }}>{label}</button>)}</div>
          <div className="f2-stage-tools">{reference && <button className="f2-btn" aria-pressed={showShaftTrace} onClick={() => setShowShaftTrace(v => !v)}>Shaft scan</button>}<button className={`f2-icon-btn ${reference ? 'active' : ''}`} aria-label="Show source photograph" aria-pressed={reference} title="Source photograph" onClick={() => setReference(!reference)} disabled={!anatomy}>▧</button>{!reference && <><button className={`f2-icon-btn ${!windTool ? 'active' : ''}`} aria-label="Orbit tool" aria-pressed={!windTool} title="Orbit" onClick={() => setWindTool(false)}><LabIcon name="orbit" /></button><button className={`f2-icon-btn ${windTool ? 'active' : ''}`} aria-label="Wind tool" aria-pressed={windTool} title="Touch wind" onClick={() => setWindTool(true)}><LabIcon name="wind" /></button></>}<span /><button className="f2-icon-btn" aria-label="Reset camera" title="Reset view" onClick={() => { resetView.current?.(); setInspection('Whole'); }}><LabIcon name="reset" /></button><button className="f2-icon-btn" aria-label="Enter performance view" title="Fullscreen performance" onClick={enterPresentation}><LabIcon name="expand" /></button></div>
          <span className="f2-point-count">{anatomy ? surfaceBlend < 0.01 ? 'Photo detail' : `${(anatomy.count / 1000).toFixed(1)}k points` : 'Preparing specimen'}</span>
        </div>
      </main>

      <aside className="f2-inspector" aria-label="Feather settings">
        <div className="f2-inspector-title"><h2>Make it yours.</h2><span>↙</span></div>
        <div className="f2-control-level" aria-label="Control detail"><button aria-pressed={!advancedControls} onClick={() => setAdvancedControls(false)}>Simple</button><button aria-pressed={advancedControls} onClick={() => setAdvancedControls(true)}>Advanced</button></div>
        {advancedControls && <div className="f2-tabs" role="tablist" aria-label="Inspector">{([['look', 'Appearance'], ['react', 'Response'], ['analysis', 'Anatomy'], ['layers', 'Masks'], ['zones', 'Zones']] as const).map(([id, label]) => <button key={id} role="tab" id={`f2-tab-${id}`} aria-selected={tab === id} aria-controls="f2-inspector-content" tabIndex={tab === id ? 0 : -1} onKeyDown={(event) => {
          const ids = ['look', 'react', 'analysis', 'layers', 'zones'] as const;
          const index = ids.indexOf(id);
          const next = event.key === 'ArrowRight' ? ids[(index + 1) % ids.length] : event.key === 'ArrowLeft' ? ids[(index - 1 + ids.length) % ids.length] : event.key === 'Home' ? ids[0] : event.key === 'End' ? ids[ids.length - 1] : null;
          if (next) { event.preventDefault(); setTab(next); document.getElementById(`f2-tab-${next}`)?.focus(); }
        }} onClick={() => setTab(id)}>{label}</button>)}</div>}
        <div className="f2-panel-content" id="f2-inspector-content" role={advancedControls ? "tabpanel" : undefined} aria-labelledby={advancedControls ? `f2-tab-${tab}` : undefined} tabIndex={0}>
          {!embedded && <PresetsPanel presets={presets} activeId={activePreset} currentLabel={sourceName}
            onSave={(name) => { const saved = capturePreset(name); setPresets(upsertFeatherPreset(saved)); setActivePreset(saved.id); }}
            onLoad={applyPreset}
            onDelete={(id) => { setPresets(deleteFeatherPreset(id)); if (activePreset === id) setActivePreset(null); }} />}
          <MusicLoopPanel player={musicPlayer} onStatus={() => setAudioTick(v => v + 1)} onStart={async index => {
            setDemo(false); feed.pauseFile(); feed.stopMic();
            const item = FEATHERS.find(feather => feather.id === LOOP_STYLES[index].feather);
            if (item) pick(item.src, item.label);
            await musicPlayer.play(index); setAudioTick(v => v + 1);
          }} />
          {!advancedControls && <SimpleControls controls={layerControls.current} onChange={changeSimpleLayers} particleCount={particleCount} onParticles={setParticleCount} busy={busy} volume={look.current.volume} thickness={look.current.thickness} onVolume={v => setLook('volume', v)} onThickness={v => setLook('thickness', v)} particleShape={look.current.particleShape} connection={look.current.connection} onShape={v => setLook('particleShape', v)} onConnection={v => setLook('connection', v)} optics={{ motionBlur: look.current.motionBlur, roughness: look.current.roughness, reflection: look.current.reflection, metalness: look.current.metalness, taper: look.current.taper, centreSize: look.current.centreSize, tipSize: look.current.tipSize, size: look.current.size, alpha: look.current.alpha, radiance: look.current.radiance, tail: look.current.tail, blendMode: look.current.blendMode }} onOptics={(key, value) => setLook(key, value)} />}
          {advancedControls && <>
          {tab === 'look' && <>
            <div className="f2-section-heading"><h2>Render style</h2><span>01</span></div>
            <div className="f2-render-modes">{(['Natural', 'Anatomy', 'Patterns', 'Surface'] as const).map((label, i) => <button key={label} className={debugMode === i ? 'selected' : ''} aria-pressed={debugMode === i} onClick={() => { setDebugMode(i as Dbg); setReference(false); }}><span className={`f2-mode-swatch mode-${i}`} />{label}</button>)}</div>
            <p className="f2-note">{['Original image detail on a flexible anatomical surface.', 'The recovered shaft, vane, down and markings.', 'Individual pattern zones across the vane.', 'Red: loose fibres · green: barb direction · blue: shaft.'][debugMode]}</p>
            <div className="f2-section-heading"><h2>Surface</h2><span>02</span></div>
            <F2Amp label="Photo → fibres" min={0} max={1} step={0.01} value={surfaceBlend} onChange={setSurfaceBlend} />
            <p className="f2-note">Each particle carries its own image detail. Blend the texture into fibres, then use Movement and Separation on any mask or master to release it into the air.</p>
            <F2Amp label="Particle size"  min={0.25} max={3} step={0.05} value={look.current.size} onChange={(v) => setLook('size', v)} />
            <F2Amp label="Softness"  max={1} step={0.02} value={look.current.soft} onChange={(v) => setLook('soft', v)} />
            <F2Amp label="Opacity" min={0.15} max={1} step={0.01} value={look.current.alpha} onChange={(v) => setLook('alpha', v)} />
            <F2Amp label="Layer depth" max={2.5} value={look.current.volume} onChange={(v) => setLook('volume', v)} />
            <div className="f2-section-heading"><h2>Light & lens</h2><span>03</span></div>
            <F2Amp label="Bloom" value={look.current.bloom} onChange={(v) => setLook('bloom', v)} />
            <F2Amp label="Depth of field" disabled={true} max={1} step={0.02} value={look.current.dof} onChange={(v) => setLook('dof', v)} />
            <F2Amp label="Chromatic separation" max={1.5} value={look.current.aberr} onChange={(v) => setLook('aberr', v)} />
            <div className="f2-toggle-row"><span>Slow orbit</span><button role="switch" aria-label="Slow orbit" aria-checked={look.current.spin} className="f2-switch" onClick={() => setLook('spin', !look.current.spin)}><i /></button></div>
            <div className="f2-toggle-row"><span>Echo one beat behind</span><button role="switch" aria-label="Beat echo"  aria-checked={look.current.ghost} className="f2-switch" onClick={() => setLook('ghost', !look.current.ghost)}><i /></button></div>
            <p className="f2-note">Lens effects follow the audio routing. Beat echo appears when a tempo is detected.</p>
          </>}
          {tab === 'react' && <>
            <div className="f2-section-heading"><h2>Flight field</h2><span>01</span></div>
            <div className="f2-flight-modes">{['Curl', 'Stream', 'Orbit', 'Burst'].map((name, mode) => <button key={name} aria-pressed={flight.mode === mode} onClick={() => setFlight(v => ({ ...v, mode }))}>{name}</button>)}</div>
            <F2Amp label="Release into air" min={0} max={2} step={0.01} value={flight.scatter} onChange={scatter => setFlight(v => ({ ...v, scatter }))} />
            <F2Amp label="Root attachment" min={0} max={1} step={0.01} value={flight.anchor} onChange={anchor => setFlight(v => ({ ...v, anchor }))} />
            <button className="f2-btn f2-wide" onClick={() => setFlight(v => ({ ...v, scatter: v.scatter > 0 ? 0 : 0.8 }))}>{flight.scatter > 0 ? 'Recall feather' : 'Release feather'}</button>
            <p className="f2-note">Movement and Separation in Masks control each part, colour and pattern independently. Rachis and calamus always share one aligned shaft. Root attachment controls how closely surrounding fibres stay attached.</p>
            <div className="f2-section-heading"><h2>Movement</h2><span>01</span></div>
            <F2Amp label="Bend" value={amps.current.flex} onChange={(v) => setAmp('flex', v)} />
            <F2Amp label="Flutter" value={amps.current.fringe} onChange={(v) => setAmp('fringe', v)} />
            <F2Amp label="Recovery" min={50} max={1500} step={10} unit="ms" value={response.current.release} onChange={(v) => setResponse('release', v)} />
            <div className="f2-memory-card"><div><strong>Gesture memory</strong><span>Recent movement leaves a bounded residue.</span></div><i aria-hidden="true" /></div>
            <div className="f2-breathe-section"><span className="f2-eyebrow">SIMULATED AIRFLOW</span><button className={`f2-breath-control ${breathHeld ? 'held' : ''}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setBreathHeld(true); setReference(false); }} onPointerUp={() => setBreathHeld(false)} onLostPointerCapture={() => setBreathHeld(false)}><LabIcon name="wind" size={25} /><strong>{breathHeld ? 'Sending air' : 'Hold to breathe'}</strong><small>{breathHeld ? 'Release to settle' : 'or hold Space'}</small></button></div>
            <div className="f2-section-heading"><h2>Response character</h2><span>02</span></div>
            <div className="f2-preset-list">{(['organic', 'percussive', 'weightless'] as const).map((id, i) => <button key={id} className={currentPreset === id ? 'selected' : ''} aria-pressed={currentPreset === id} onClick={() => applyResponse(id)}><span>{['Organic', 'Percussive', 'Weightless'][i]}</span><small>{['A natural rise and fall', 'Fast attack, defined pulses', 'Slow, suspended movement'][i]}</small><i /></button>)}</div>
            <F2Amp label="Audio sensitivity" value={response.current.gain} onChange={(v) => setResponse('gain', v)} />
            <F2Amp label="Attack" min={5} max={400} step={5} unit="ms" value={response.current.attack} onChange={(v) => setResponse('attack', v)} />
            <div className="f2-section-heading"><h2>Touch wind</h2><span>03</span></div>
            <button className={`f2-btn f2-wide ${windTool ? 'on' : ''}`} aria-pressed={windTool} onClick={() => { setWindTool(!windTool); setReference(false); }}><LabIcon name="wind" />{windTool ? 'Wind tool enabled' : 'Enable wind tool'}</button>
            <F2Amp label="Wind strength" value={response.current.wind} onChange={(v) => setResponse('wind', v)} />
            <p className="f2-note">Hold and drag on the feather. The loose fibres bend into the gust and settle when you release.</p>
            <div className="f2-section-heading"><h2>Anatomical movement</h2><span>04</span></div>
            <F2Amp label="Markings" value={amps.current.eye} onChange={(v) => setAmp('eye', v)} disabled={!anatomy?.zones.length} />
            <F2Amp label="Vane wave" value={amps.current.wave} onChange={(v) => setAmp('wave', v)} />
            <F2Amp label="Barb shimmer" value={amps.current.shimmer} onChange={(v) => setAmp('shimmer', v)} />
            <F2Amp label="Colour response" value={amps.current.color} onChange={(v) => setAmp('color', v)} />
            <F2Amp label="Reactive separation" max={1} step={0.02} value={amps.current.depth} onChange={(v) => setAmp('depth', v)} />
            <details className="f2-routing"><summary>Audio routing matrix <span>↗</span></summary><p className="f2-note">Click a cell: off → 50% → 100%. Shift-click clears its row. An empty matrix is a true bypass. Musical elements are estimates from the mix.</p><div className="f2-matrix-scroll"><F2Matrix routes={routes.current} onCell={bumpRoute} register={elemMeter} /></div><button className="f2-btn" onClick={() => { routes.current = defaultRoutes(); savePreference(ROUTES_KEY, routes.current); savePreference(ROUTES_VERSION_KEY, ROUTES_VERSION); setAmpTick((x) => x + 1); }}>Reset routing</button></details>
          </>}
          {tab === 'analysis' && <>
            {anatomy && <AnalysisPanel anatomy={anatomy} elapsed={result!.elapsed} />}
            <div className="f2-section-heading"><h2>Refine analysis</h2></div>
            <F2Amp label="Particle amount" min={24000} max={500000} step={10000} unit="k" value={particleCount} onChange={setParticleCount} />
            <p className="f2-note">Higher counts preserve finer barb and barbule structure. The current feather stays visible while the denser scan runs.</p>
            <F2Amp label="Pattern sensitivity" max={1} step={0.02} unit="%" value={sens} onChange={setSens} />
            <p className="f2-note">Higher values recover finer markings. The current feather remains interactive while the new scan runs.</p>
            <button className="f2-btn f2-wide" onClick={() => { setDebugMode(1); setReference(false); }}>Inspect anatomical regions</button>
          </>}
          {tab === 'layers' && <>
            {anatomy && <LayerMixer
              anatomy={anatomy}
              controls={layerControls.current}
              zones={interactionZones.current.zones}
              onSelect={selectLayer}
              onAdd={addLayer}
              onAddGroup={addGroup}
              onAutoSeparate={autoSeparateLayers}
              onRemove={removeLayer}
              onChange={changeLayer}
              onMoveLayer={moveLayer}
              onSolo={soloLayer}
              onRoute={bumpLayerRoute}
            />}
          </>}
          {tab === 'zones' && <InteractionZonesPanel
            groups={layerControls.current.groups}
            document={interactionZones.current}
            onSelect={selectInteractionZone}
            onAdd={addInteractionZone}
            onDetect={detectInteractionZones}
            onRemove={removeInteractionZone}
            onChange={changeInteractionZone}
            onRoute={bumpInteractionRoute}
          />}
          </>}
        </div>
        <div className="f2-inspector-foot"><i />Settings saved on this device</div>
      </aside>

      <footer className="f2-audio-dock">
        <div className="f2-audio-source"><div className="f2-audio-symbol"><LabIcon name="audio" size={23} /></div><div><span className="f2-eyebrow">AUDIO INPUT</span><strong>{musicPlayer.active ? `${LOOP_STYLES[musicPlayer.selected].name} · 5 stems` : demo ? 'Demo signal · 108 BPM' : feed.sourceLabel || 'Give the feather a sound'}</strong><span>{musicPlayer.active ? '16-second loop · Music test lab' : demo ? 'Silent simulation' : feed.micOn ? 'Listening through your microphone' : feed.filePlaying ? 'Playing · loops continuously' : feed.sourceLabel ? 'Paused' : 'Import a track, use your mic, or try the demo'}</span></div></div>
        <EncounterTimeline register={encounterMeter} />
        <div className="f2-audio-actions">
          <button className="f2-btn" disabled={audioBusy} onClick={() => audioFile.current?.click()}><LabIcon name="upload" />{audioBusy ? 'Loading…' : 'Audio file'}</button>
          <button className={`f2-icon-btn ${feed.micOn ? 'active' : ''}`} aria-label={feed.micOn ? 'Stop microphone' : 'Use microphone'} aria-pressed={feed.micOn} disabled={audioBusy} onClick={async () => {
            setAudioBusy(true); setError(''); setDemo(false);
            try { musicPlayer.stop(); if (feed.micOn) feed.stopMic(); else await feed.useMic(); setAudioTick((x) => x + 1); }
            catch (err) { setError(err instanceof Error ? err.message : 'Could not access the microphone.'); }
            finally { setAudioBusy(false); setAudioTick((x) => x + 1); }
          }}><LabIcon name="mic" /></button>
          {feed.sourceLabel && feed.sourceLabel !== 'microphone' && !demo && <button className="f2-icon-btn" aria-label={feed.filePlaying ? 'Pause audio' : 'Play audio'} disabled={audioBusy} onClick={async () => {
            try { musicPlayer.stop(); if (feed.filePlaying) feed.pauseFile(); else await feed.resumeFile(); setAudioTick((x) => x + 1); }
            catch (err) { setError(err instanceof Error ? err.message : 'Could not resume audio.'); }
          }}><LabIcon name={feed.filePlaying ? 'pause' : 'play'} /></button>}
          <button className={`f2-btn ${demo ? 'on' : ''}`} aria-pressed={demo} disabled={audioBusy} onClick={() => { musicPlayer.stop(); if (!demo) { feed.pauseFile(); feed.stopMic(); } setDemo(!demo); setAudioTick((x) => x + 1); }}><LabIcon name={demo ? 'pause' : 'play'} />{demo ? 'Stop demo' : 'Try demo'}</button>
        </div>
        <F2Meters register={meter} />
      </footer>
      {(error || scanError) && <div className="f2-error" role="alert"><span>{error || scanError}</span>{error && <button aria-label="Dismiss error" onClick={() => setError('')}><LabIcon name="close" /></button>}</div>}
      {dragging && <div className="f2-drop-overlay"><LabIcon name="upload" size={34} /><strong>Drop a feather or a track</strong><span>Image files for analysis · audio files for movement</span></div>}
      {presenting && <button className="f2-exit-present f2-btn" onClick={exitPresentation}><LabIcon name="close" />Exit presentation <kbd>esc</kbd></button>}
      <span hidden>{audioTick}</span>
    </div>
  );
}

/**
 * Live readout of what the analyser hears: six auto-gained bands, the three
 * onset detectors, and the tempo tracker's verdict. Without this the audio
 * engine is a black box — when the feather doesn't move you can't tell whether
 * the track is quiet, the band is empty or the beat wasn't found.
 */
const ENCOUNTER_PHASES = [
  ['rest', 'Rest'],
  ['presence', 'Presence'],
  ['breath', 'Breath'],
  ['awakening', 'Awakening'],
  ['rememberedEncounter', 'Memory'],
  ['collectiveFlight', 'Flight'],
  ['settling', 'Settling'],
] as const;

function EncounterTimeline({
  register,
}: {
  register: React.RefObject<((phase: string, state: { energy: number; residue: number; recall: number }) => void) | null>;
}) {
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const caption = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    register.current = (phase, state) => {
      const index = Math.max(0, ENCOUNTER_PHASES.findIndex(([id]) => id === phase));
      nodes.current.forEach((node, nodeIndex) => node?.classList.toggle('current', nodeIndex === index));
      if (caption.current) {
        caption.current.textContent = state.recall > 0.02
          ? 'A recent gesture is returning.'
          : state.residue > 0.03
            ? 'The body carries a fading trace.'
            : state.energy > 0.03
              ? 'Air is moving through one body.'
              : 'A feather, waiting.';
      }
    };
    return () => { register.current = null; };
  }, [register]);
  return <div className="f2-encounter"><div className="f2-encounter-title"><b>Encounter</b><span ref={caption}>A feather, waiting.</span></div><div className="f2-encounter-phases">{ENCOUNTER_PHASES.map(([, label], index) => <div key={label} ref={(node) => { nodes.current[index] = node; }} className={index === 0 ? 'current' : ''}><span>{label}</span><i /></div>)}</div></div>;
}

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
                    aria-label={`${e.label} → ${t.label}, ${Math.round(g * 100)} percent`}
                    aria-pressed={g > 0}
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
          ? 'Awaiting audio'
          : f.bpm
            ? `${Math.round(f.bpm)} bpm · lock ${Math.round(f.lock * 100)}%`
            : 'Listening · finding tempo';
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
            <small>{l}</small><span ref={(e) => { bars.current[i] = e; }} />
          </label>
        ))}
      </div>
      <div className="f2-hits">
        {HIT_LABELS.map((l, i) => (
          <em key={l} ref={(e) => { hits.current[i] = e; }}>{l}</em>
        ))}
        <span className="f2-phase" ref={dot} />
      </div>
      <div className="f2-srcname" ref={txt}>Awaiting audio</div>
    </div>
  );
}

function F2Amp({
  label, value, onChange, disabled, min = 0, max = 2, step = 0.05, unit,
}: {
  label: string; value: number; onChange: (v: number) => void;
  disabled?: boolean; min?: number; max?: number; step?: number; unit?: 'ms' | '%' | 'k';
}) {
  return (
    <label className={`f2-amp ${disabled ? 'off' : ''}`}>
      <span>{label}<output>{unit === '%' ? `${Math.round(value * 100)}%` : unit === 'ms' ? `${Math.round(value)} ms` : unit === 'k' ? `${Math.round(value / 1000)}k` : value.toFixed(2)}</output></span>
      <input
        type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
        style={{ backgroundSize: `${Math.max(0, Math.min(100, (value - min) / (max - min) * 100))}% 3px, 100% 3px` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
