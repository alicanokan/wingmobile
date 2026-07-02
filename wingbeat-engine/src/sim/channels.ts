// ============================================================================
//  Sensor → feather channels
//
//  The 8 ring sensors each drive a DIFFERENT part of the feather. Two kinds of
//  channel:
//
//    region  — moves a physical zone of the feather (tip, rachis/shaft, tail/
//              down, leading edge). Wind on that sensor flutters/bends that zone.
//    color   — drives a COLOR GROUP the engine extracted from the chosen photo.
//              Wind on that sensor makes pixels of that color ripple + glow, so
//              "the white parts move", "the blue parts shimmer", etc.
//
//  This is the operator-facing map of "which sensor does what". The values
//  (band centre/width, side) are in feather-local UV: y=0 calamus, y=1 tip;
//  x=0 leading edge, x=1 trailing edge.
// ============================================================================

export type ChannelKind = 'region' | 'color';
export type ChannelSide = 'both' | 'left' | 'right' | 'center';

export interface SensorChannel {
  sensor: string; // node id, sensor_01 … sensor_08
  label: string; // shown in the operator legend
  key: string; // keyboard shortcut that fires this sensor (hold to blow)
  kind: ChannelKind;
  /** band centre + half-width in feather UV.y (used for region motion + procedural). */
  bandY: number;
  bandHW: number;
  side: ChannelSide;
  /** for color channels: which extracted palette slot (0 = brightest) this drives. */
  colorSlot?: number;
}

// 5 sensors (matching the installation diagram). Keys q w e r t fire 1–5.
export const SENSOR_CHANNELS: SensorChannel[] = [
  { sensor: 'sensor_01', label: 'Tip',     key: 'q', kind: 'region', bandY: 0.9,  bandHW: 0.16, side: 'both' },
  { sensor: 'sensor_02', label: 'Rachis',  key: 'w', kind: 'region', bandY: 0.5,  bandHW: 0.55, side: 'center' },
  { sensor: 'sensor_03', label: 'Color A', key: 'e', kind: 'color',  bandY: 0.7,  bandHW: 0.25, side: 'both', colorSlot: 0 },
  { sensor: 'sensor_04', label: 'Color B', key: 'r', kind: 'color',  bandY: 0.4,  bandHW: 0.25, side: 'both', colorSlot: 1 },
  { sensor: 'sensor_05', label: 'Tail',    key: 't', kind: 'region', bandY: 0.08, bandHW: 0.16, side: 'both' },
];

export const KEY_TO_SENSOR: Record<string, string> = Object.fromEntries(
  SENSOR_CHANNELS.map((c) => [c.key, c.sensor]),
);

export const N_COLOR_SLOTS = 4;

/** numeric side code for the shader: -1 left, 0 both, 1 right, 2 center */
export function sideCode(s: ChannelSide): number {
  return s === 'left' ? -1 : s === 'right' ? 1 : s === 'center' ? 2 : 0;
}
