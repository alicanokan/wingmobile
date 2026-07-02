// ============================================================================
//  Wing Beat — Spatial model of the room
//
//  This reproduces the layout diagram: a projection SCREEN on the left, four
//  corner SPEAKERS, a central INTERACTION zone ringed by 8 wind-sensors, and
//  the FEATHER prop off to the right. Coordinates are normalized 0..1 with
//  origin at the top-left, so the same numbers drive the SVG operator map and
//  the audio panning math.
//
//  When you build the real room, you change ONLY this file: measure the actual
//  speaker/sensor positions (as fractions of the room), and every spatial
//  behavior — panning, per-speaker gain, the operator map — follows.
// ============================================================================

import type { SpatialLayout, Point } from './types.ts';

// The operator map is drawn in a PORTRAIT viewBox (taller than wide). The ring
// radius is split into x/y components so the sensor ring stays visually
// circular despite the non-square aspect: rx/ry == H/W.
export const VIEWBOX = { w: 660, h: 1040 };

const CENTER: Point = { x: 0.5, y: 0.5 };
const RING_R = 200; // ring radius in px, in the portrait viewBox
const RX = RING_R / VIEWBOX.w; // ~0.303
const RY = RING_R / VIEWBOX.h; // ~0.192
const N_SENSORS = 5;

function ringSensors(): SpatialLayout['nodes'] {
  const nodes: SpatialLayout['nodes'] = [];
  // 5 sensors fanned across the TOP arc of the interaction zone (left → top →
  // right), matching the installation diagram.
  for (let i = 0; i < N_SENSORS; i++) {
    const angle = Math.PI + (i / (N_SENSORS - 1)) * Math.PI; // 180° → 360°
    nodes.push({
      id: `sensor_${String(i + 1).padStart(2, '0')}`,
      role: 'sensor',
      pos: {
        x: CENTER.x + Math.cos(angle) * RX,
        y: CENTER.y + Math.sin(angle) * RY,
      },
    });
  }
  // The held feather prop — below the interaction zone, as in the diagram.
  nodes.push({ id: 'feather_01', role: 'feather', pos: { x: 0.5, y: 0.78 } });
  return nodes;
}

export const LAYOUT: SpatialLayout = {
  center: CENTER,
  interactionRadius: 150 / VIEWBOX.w, // ~0.227 → 150px circle
  // Projection screen across the TOP of the portrait room.
  screen: { pos: { x: 0.5, y: 0.12 }, w: 0.34, h: 0.13 },
  speakers: [
    { id: 'spk_FL', pos: { x: 0.13, y: 0.07 } },
    { id: 'spk_FR', pos: { x: 0.87, y: 0.07 } },
    { id: 'spk_BL', pos: { x: 0.13, y: 0.93 } },
    { id: 'spk_BR', pos: { x: 0.87, y: 0.93 } },
  ],
  nodes: ringSensors(),
};

export function nodeSpec(id: string) {
  return LAYOUT.nodes.find((n) => n.id === id);
}

// ---------- Spatialization --------------------------------------------------

/**
 * Stereo pan position (-1 left .. +1 right) for a sound originating at a node.
 * Derived purely from the node's X in the room, so the simulation's stereo
 * output already "points" toward where the participant acted.
 */
export function panForNode(id: string): number {
  const spec = nodeSpec(id);
  if (!spec) return 0;
  return Math.max(-1, Math.min(1, (spec.pos.x - 0.5) * 2));
}

/**
 * Per-speaker gain (0..1) for a sound at `src`, by inverse-distance weighting.
 * The 4 numbers come back in LAYOUT.speakers order [FL, FR, BL, BR].
 *
 * The browser sim outputs stereo, but the engine still computes these so the
 * operator map can show which speakers light up — and so the real install
 * (where you DO have 4 amps) can route audio per-speaker with no extra code.
 */
export function perSpeakerGain(src: Point): number[] {
  const dists = LAYOUT.speakers.map((s) => {
    const dx = s.pos.x - src.x;
    const dy = s.pos.y - src.y;
    return Math.hypot(dx, dy);
  });
  // inverse-distance, softened so the nearest speaker dominates but others bleed
  const weights = dists.map((d) => 1 / (d * d + 0.02));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => w / sum);
}

export function nodeGain(id: string): number[] {
  const spec = nodeSpec(id);
  return perSpeakerGain(spec ? spec.pos : LAYOUT.center);
}
