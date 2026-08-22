// ============================================================================
//  React binding for the rig store. Every panel that shows rig values calls
//  useRigTick(): it re-renders on ANY rig change (from any panel, a preset
//  recall, a conductor push) and gets back the notifier to call after its own
//  edits. This replaces the per-panel `setTick` hacks, which only re-rendered
//  the panel that made the edit and left the others showing stale values.
// ============================================================================

import { useEffect, useState } from 'react';
import { notifyRigChange, onRigChange } from './rig.ts';

export function useRigTick(): () => void {
  const [, setTick] = useState(0);
  useEffect(() => onRigChange(() => setTick((v) => v + 1)), []);
  return notifyRigChange;
}
