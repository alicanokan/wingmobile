import { emptyLayerRoutes, type LayerControls, type LayerGroup, type LayerKind } from './LabPanels.tsx';
import type { InteractionZone, InteractionZoneDocument } from './interactionZones.ts';

export const ANALYSIS_MASTERS: Array<{ id: string; name: string; prefer: InteractionZone['behaviour'] }> = [
  { id: 'master-body', name: 'Vane body', prefer: 'lift' },
  { id: 'master-patterns', name: 'Pattern zones', prefer: 'lift' },
  { id: 'master-colour-primary', name: 'Primary colours', prefer: 'pulse' },
  { id: 'master-colour-accent', name: 'Accent colours', prefer: 'shimmer' },
  { id: 'master-rachis', name: 'Rachis', prefer: 'shimmer' },
  { id: 'master-calamus', name: 'Calamus', prefer: 'shimmer' },
  { id: 'master-down', name: 'Down & fringe', prefer: 'flutter' },
  { id: 'master-markings', name: 'Marking anatomy', prefer: 'lift' },
];

export function makeAnalysisMaster(id: string, name: string): LayerGroup {
  return {
    id,
    name,
    brightness: 1,
    size: 1,
    movement: 1,
    depth: 1,
    visible: true,
    audioEnabled: true,
    expanded: false,
    effect: { preset: 'none', trigger: 'kick', mode: 'toggle', amount: 1 },
    routes: emptyLayerRoutes(),
  };
}

export function defaultAnalysisMasters(): LayerGroup[] {
  return ANALYSIS_MASTERS.map((master) => makeAnalysisMaster(master.id, master.name));
}

export function groupIdForLayer(kind: LayerKind, index: number): string {
  if (kind === 'parts') return ['master-calamus', 'master-rachis', 'master-body', 'master-down', 'master-markings'][index] ?? 'master-body';
  if (kind === 'colors') return index > 1 ? 'master-colour-accent' : 'master-colour-primary';
  return 'master-patterns';
}

export function preferredZoneId(groupId: string, zones: InteractionZone[]): string {
  const prefer = ANALYSIS_MASTERS.find((master) => master.id === groupId)?.prefer ?? 'pulse';
  return zones.find((zone) => zone.behaviour === prefer)?.id ?? zones[0]?.id ?? '';
}

function isZoneShaped(group: LayerGroup, zones: InteractionZone[]): boolean {
  return zones.some((zone) => zone.id === group.id || zone.name === group.name);
}

/** Put analysis masters back, and move dumped masks off behaviour zones. */
export function restoreAnalysisMasters(layers: LayerControls, document: InteractionZoneDocument): boolean {
  let changed = false;
  const existing = new Map(layers.groups.map((group) => [group.id, group]));
  const next: LayerGroup[] = ANALYSIS_MASTERS.map((master) => {
    const group = existing.get(master.id);
    if (group) {
      if (group.name !== master.name && isZoneShaped(group, document.zones)) {
        group.name = master.name;
        changed = true;
      }
      return group;
    }
    changed = true;
    return makeAnalysisMaster(master.id, master.name);
  });
  for (const group of layers.groups) {
    if (ANALYSIS_MASTERS.some((master) => master.id === group.id) || isZoneShaped(group, document.zones)) continue;
    next.push(group);
  }
  const keep = new Set(next.map((group) => group.id));
  for (const layer of layers.layers) {
    if (keep.has(layer.groupId)) continue;
    layer.groupId = groupIdForLayer(layer.kind, layer.index);
    changed = true;
  }
  if (layers.groups.length !== next.length || layers.groups.some((group, index) => group !== next[index])) {
    layers.groups = next;
    changed = true;
  }
  if (!layers.groups.some((group) => group.id === layers.selectedId) && !layers.layers.some((layer) => layer.id === layers.selectedId)) {
    layers.selectedId = layers.groups[0]?.id ?? '';
    changed = true;
  }
  return changed;
}

export function seedMasterRoutes(document: InteractionZoneDocument, groups: LayerGroup[], force = false): boolean {
  if (!document.zones.length || !groups.length) return false;
  const zoneIds = new Set(document.zones.map((zone) => zone.id));
  const keys = Object.keys(document.routes);
  const onlyZoneIdentity = keys.length > 0 && keys.every((key) => zoneIds.has(key));
  const missingMasters = groups.some((group) => !document.routes[group.id] || Object.keys(document.routes[group.id]).length === 0);
  if (!force && !onlyZoneIdentity && !missingMasters) return false;
  if (force || onlyZoneIdentity) document.routes = {};
  for (const group of groups) {
    const row = (document.routes[group.id] ??= {});
    if (Object.keys(row).length === 0) {
      const zoneId = preferredZoneId(group.id, document.zones);
      if (zoneId) row[zoneId] = 1;
    }
  }
  for (const key of Object.keys(document.routes)) {
    if (zoneIds.has(key) && !groups.some((group) => group.id === key)) delete document.routes[key];
  }
  return true;
}
