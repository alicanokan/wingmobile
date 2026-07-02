// AUTO-GENERATED catalog of the feather collection in public/feathers/.
// Regenerate by re-running the copy+catalog step, or edit labels by hand.

export interface FeatherItem {
  id: string;
  src: string;
  label: string;
  procedural?: boolean;
}

export const FEATHERS: FeatherItem[] = [
  { id: 'procedural', src: '', label: 'Procedural', procedural: true },
  { id: '01f', src: '/feathers/01f.png', label: 'Feather 01' },
  { id: '02f', src: '/feathers/02f.png', label: 'Feather 02' },
  { id: '04f', src: '/feathers/04f.png', label: 'Feather 04' },
  { id: '05f', src: '/feathers/05f.png', label: 'Feather 05' },
  { id: '06f', src: '/feathers/06f.png', label: 'Feather 06' },
  { id: '07f', src: '/feathers/07f.png', label: 'Feather 07' },
  { id: '08f', src: '/feathers/08f.png', label: 'Feather 08' },
  { id: '09f', src: '/feathers/09f.png', label: 'Feather 09' },
  { id: '10f', src: '/feathers/10f.png', label: 'Feather 10' },
  { id: '11f', src: '/feathers/11f.png', label: 'Feather 11' },
  { id: '12f', src: '/feathers/12f.png', label: 'Feather 12' },
  { id: '13f', src: '/feathers/13f.png', label: 'Feather 13' },
  { id: '14f', src: '/feathers/14f.png', label: 'Feather 14' },
  { id: '15f', src: '/feathers/15f.png', label: 'Feather 15' },
  { id: '16f', src: '/feathers/16f.png', label: 'Feather 16' },
  { id: '17f', src: '/feathers/17f.png', label: 'Feather 17' },
  { id: '18f', src: '/feathers/18f.png', label: 'Feather 18' },
  { id: '19f', src: '/feathers/19f.png', label: 'Feather 19' },
  { id: '20f', src: '/feathers/20f.png', label: 'Feather 20' },
  { id: '21f', src: '/feathers/21f.png', label: 'Feather 21' },
  { id: '22f', src: '/feathers/22f.png', label: 'Feather 22' },
  { id: '23f', src: '/feathers/23f.png', label: 'Feather 23' },
  { id: '24f', src: '/feathers/24f.png', label: 'Feather 24' },
  { id: '26f', src: '/feathers/26f.png', label: 'Feather 26' },
  { id: '27f', src: '/feathers/27f.png', label: 'Feather 27' },
  { id: '28f', src: '/feathers/28f.png', label: 'Feather 28' },
  { id: '29f', src: '/feathers/29f.png', label: 'Feather 29' },
  { id: '30f', src: '/feathers/30f.png', label: 'Feather 30' },
  { id: '31f', src: '/feathers/31f.png', label: 'Feather 31' },
  { id: '32f', src: '/feathers/32f.png', label: 'Feather 32' },
  { id: '33f', src: '/feathers/33f.png', label: 'Feather 33' },
  { id: '34f', src: '/feathers/34f.png', label: 'Feather 34' },
  { id: '35f', src: '/feathers/35f.png', label: 'Feather 35' },
  { id: '36f', src: '/feathers/36f.png', label: 'Feather 36' },
  { id: '37f', src: '/feathers/37f.png', label: 'Feather 37' },
  { id: '38f', src: '/feathers/38f.png', label: 'Feather 38' },
  { id: '39f', src: '/feathers/39f.png', label: 'Feather 39' },
  { id: '40f', src: '/feathers/40f.png', label: 'Feather 40' },
  { id: '41f', src: '/feathers/41f.png', label: 'Feather 41' },
  { id: '42f', src: '/feathers/42f.png', label: 'Feather 42' },
  { id: '43f', src: '/feathers/43f.png', label: 'Feather 43' },
  { id: '44f', src: '/feathers/44f.png', label: 'Feather 44' },
  { id: '45f', src: '/feathers/45f.png', label: 'Feather 45' },
];

export const DEFAULT_FEATHER = 'procedural';

export function getFeather(id: string): FeatherItem {
  return FEATHERS.find((f) => f.id === id) ?? FEATHERS[0];
}
