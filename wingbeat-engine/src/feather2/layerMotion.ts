/** All mask kinds share the same motion contract; colour/pattern masks are not
 * appearance-only. Neutral depth is 1; movement 0 is a local motion bypass. */
export function layerMotion(layer: { movement: number; depth: number }, master: { movement: number; depth: number },
  routed: { movement: number; depth: number; layerDepth: number }, movementDrive: number, depthDrive: number) {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  return {
    movement: Math.min(8, Math.max(0, finite(layer.movement, 1) * finite(master.movement, 1) * finite(routed.movement, 1) * (1 + finite(movementDrive, 0)))),
    depth: Math.min(8, Math.max(0, finite(layer.depth, 1) * finite(master.depth, 1) * finite(routed.depth, 1) + finite(depthDrive, 0), finite(routed.layerDepth, 0))),
  };
}
