import { describe, expect, it } from 'vitest';
import { emptyLayerRoutes, type LayerControls } from '../LabPanels.tsx';
import { defaultInteractionZones, type InteractionZoneDocument } from '../interactionZones.ts';
import { defaultAnalysisMasters, groupIdForLayer, preferredZoneId, restoreAnalysisMasters, seedMasterRoutes } from '../zoneMasters.ts';

function layers(ids: string[]): LayerControls {
  return {
    source: 'test',
    selectedId: ids[0] ?? '',
    groups: ids.map((id, index) => ({
      id,
      name: `Named ${index + 1}`,
      brightness: 1,
      size: 1,
      movement: 1,
      depth: 1,
      visible: true,
      audioEnabled: true,
      expanded: false,
      effect: { preset: 'none', trigger: 'kick', mode: 'toggle', amount: 1 },
      routes: emptyLayerRoutes(),
    })),
    layers: [
      { id: 'layer-calamus', groupId: ids[0] ?? '', name: 'Calamus', kind: 'parts', index: 0, brightness: 1, size: 1, movement: 1, depth: 1, visible: true, audioEnabled: true, routes: emptyLayerRoutes() },
      { id: 'layer-pattern', groupId: ids[0] ?? '', name: 'Pattern 01', kind: 'patterns', index: 0, brightness: 1, size: 1, movement: 1, depth: 1, visible: true, audioEnabled: true, routes: emptyLayerRoutes() },
      { id: 'layer-colour', groupId: ids[0] ?? '', name: 'Colour C', kind: 'colors', index: 2, brightness: 1, size: 1, movement: 1, depth: 1, visible: true, audioEnabled: true, routes: emptyLayerRoutes() },
    ],
  };
}

describe('analysis masters', () => {
  it('restores the eight analysis groups and rehomes masks dumped onto a zone', () => {
    const zones = defaultInteractionZones();
    const document: InteractionZoneDocument = { selectedId: zones[0].id, zones, routes: { [zones[0].id]: { [zones[0].id]: 1 } } };
    const controls = layers([zones[0].id, zones[1].id, zones[2].id]);
    expect(restoreAnalysisMasters(controls, document)).toBe(true);
    expect(controls.groups.map((group) => group.id)).toEqual(defaultAnalysisMasters().map((group) => group.id));
    expect(controls.layers.find((layer) => layer.id === 'layer-calamus')?.groupId).toBe('master-calamus');
    expect(controls.layers.find((layer) => layer.id === 'layer-pattern')?.groupId).toBe('master-patterns');
    expect(controls.layers.find((layer) => layer.id === 'layer-colour')?.groupId).toBe('master-colour-accent');
  });

  it('keeps extra user masters that are not behaviour zones', () => {
    const zones = defaultInteractionZones();
    const document: InteractionZoneDocument = { selectedId: zones[0].id, zones, routes: {} };
    const controls = layers(['master-body', 'master-custom']);
    controls.groups[1].name = 'Studio isolate';
    restoreAnalysisMasters(controls, document);
    expect(controls.groups.some((group) => group.id === 'master-custom')).toBe(true);
    expect(controls.groups).toHaveLength(9);
  });

  it('replaces zone-identity routing with analysis → zone defaults', () => {
    const zones = defaultInteractionZones();
    const document: InteractionZoneDocument = {
      selectedId: zones[0].id,
      zones,
      routes: Object.fromEntries(zones.map((zone) => [zone.id, { [zone.id]: 1 }])),
    };
    const groups = defaultAnalysisMasters();
    expect(seedMasterRoutes(document, groups)).toBe(true);
    expect(document.routes['master-down'][preferredZoneId('master-down', zones)]).toBe(1);
    expect(document.routes[zones[0].id]).toBeUndefined();
  });

  it('rebuilds analysis routing when auto detect is forced', () => {
    const zones = defaultInteractionZones();
    const groups = defaultAnalysisMasters();
    const document: InteractionZoneDocument = {
      selectedId: zones[0].id,
      zones,
      routes: { [groups[0].id]: { [zones[0].id]: 1 } },
    };
    expect(seedMasterRoutes(document, groups, true)).toBe(true);
    expect(document.routes['master-down'][preferredZoneId('master-down', zones)]).toBe(1);
    expect(document.routes[groups[0].id][zones[0].id]).toBeUndefined();
  });

  it('maps detected masks onto anatomy and colour groups', () => {
    expect(groupIdForLayer('parts', 3)).toBe('master-down');
    expect(groupIdForLayer('patterns', 0)).toBe('master-patterns');
    expect(groupIdForLayer('colors', 0)).toBe('master-colour-primary');
    expect(groupIdForLayer('colors', 3)).toBe('master-colour-accent');
  });
});
