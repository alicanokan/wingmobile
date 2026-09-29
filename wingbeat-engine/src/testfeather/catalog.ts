/** Curatorial proposals, not bird provenance. All demo audio is newly synthesized. */
export type Continent = 'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania' | 'Antarctica';
export type Voice = 'pluck' | 'tine' | 'metal' | 'flute' | 'reed' | 'bow' | 'brass' | 'pad' | 'noise' | 'wood';
export interface SoundFeather {
  id: string; continent: Continent; place: string; style: string; carries: string; pairing: string;
  bpm: number; beats: number; root: number; scale: number[]; pulse: string; swing: number;
  voices: [Voice, Voice, Voice, Voice]; layers: [string, string, string, string, string];
  reference?: { title: string; url: string };
}
export const CONTINENTS: Continent[] = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica'];
export const CONTINENT_COLOURS: Record<Continent, string> = {
  Africa: '#e8b368', Asia: '#d6a2b7', Europe: '#aabbdc', 'North America': '#daa58a',
  'South America': '#aad59a', Oceania: '#87cfd0', Antarctica: '#ced9e3',
};
const refs = {
  koto: { title: 'Smithsonian · Japanese instrumental traditions', url: 'https://folkways.si.edu/news-and-press/unesco-collection-week-53-juxtaposing-traditional-and-modern-music-of-japan' },
  vina: { title: 'Smithsonian · Karaikudi vina', url: 'https://folkways.si.edu/south-india-ranganayaki-rajagopalan-continuity-in-the-karaikudi-vina-style/world/music/album/smithsonian' },
  santur: { title: 'Smithsonian · Santur instrument collection', url: 'https://www.si.edu/object/musical-instrument-santoor-or-santur%3Anmnhanthropology_8423251' },
  gamelan: { title: 'UNESCO · Gamelan', url: 'https://ich.unesco.org/en/RL/gamelan-01607' },
  guqin: { title: 'UNESCO · Guqin and its music', url: 'https://ich.unesco.org/en/RL/guqin-and-its-music-00061' },
  mbira: { title: 'UNESCO · Mbira / Sansi', url: 'https://ich.unesco.org/en/RL/art-of-crafting-and-playing-mbira-sansi-the-finger-plucking-traditional-musical-instrument-in-malawi-and-zimbabwe-01541' },
  gnawa: { title: 'UNESCO · Gnawa', url: 'https://ich.unesco.org/en/RL/gnawa-01170' },
  mbalax: { title: 'Music In Africa · Mbalax in Senegal', url: 'https://musicinafrica.net/magazine/mbalax-senegal/' },
  fado: { title: 'UNESCO · Fado', url: 'https://ich.unesco.org/en/RL/fado-urban-popular-song-of-portugal-00563' },
  harp: { title: 'UNESCO · Irish harping', url: 'https://ich.unesco.org/en/RL/irish-harping-01461' },
  bulgaria: { title: 'Smithsonian · Bulgarian National Ensemble', url: 'https://folkways.si.edu/koutev-bulgarian-national-ensemble/world/music/album/smithsonian' },
  steelpan: { title: 'Smithsonian · Steel drums of Kim Loy Wong', url: 'https://folkways.si.edu/kim-loy-wong/the-steel-drums-of/caribbean-music-instruction-world/album/smithsonian' },
  joropo: { title: 'UNESCO · Joropo in Venezuela', url: 'https://ich.unesco.org/en/RL/joropo-in-venezuela-02092' },
  pacific: { title: 'Smithsonian · Hawaiian and Pacific Islander diaspora', url: 'https://folkways.si.edu/lesson/music-and-the-hawaiian-and-pacific-islander-diaspora' },
  samoa: { title: 'Smithsonian · Music from Western Samoa', url: 'https://folkways.si.edu/music-from-western-samoa-from-conch-shell-to-disco/world/album/smithsonian' },
} as const;
// Scales are equal-tempered composition palettes for these electronic studies.
// They do not reproduce raga, maqam, gamelan tuning, or a traditional repertoire.
const scales: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  bright: [0, 2, 4, 6, 7, 9, 11], sparse: [0, 2, 5, 7, 9], harmonic: [0, 2, 3, 5, 7, 8, 11],
};
type Row = [string, Continent, string, string, string, string, number, number, number, string, string, number, string, string, (keyof typeof refs)?];
const rows: Row[] = [
  ['01f','Asia','Japan','Koto study','Space between notes','Ivory ribs suggest the spacing of plucked strings.',72,4,62,'sparse','x...o...x..o....',0,'pluck,pad,wood,pluck','Soft knock|Low string|Breath drone|String harmonics|Koto-like plucks','koto'],
  ['02f','Asia','North India','Hindustani string study','A note unfolding slowly','Gold and red become a sustained drone with patient ornament.',64,4,60,'major','x.....o.x...o...',0,'pluck,pad,tine,bow','Hand-drum sketch|Drone strings|Sustained air|Light ornaments|Bowed melody'],
  ['04f','Europe','Norway','Nordic fiddle study','Resonance in the dark','A dark vane and pale base suggest bowed overtones.',78,3,57,'dorian','x...o.o.....',0.06,'bow,pad,pluck,bow','Footfall|Bowed ground|Open fifths|Plucked echoes|Fiddle-like line'],
  ['05f','Africa','Ghana','Highlife guitar study','Conversation in motion','Bright yellow suggests a buoyant exchange between guitar lines.',112,4,60,'major','x..ox.o.x..ox.o.',0.12,'pluck,reed,wood,pluck','Bell and drum|Guitar bass|Warm reed bed|Offbeat guitar|Answering guitar'],
  ['06f','Oceania','Hawaiʻi','Slack-key guitar study','Open strings, open space','Blue held inside gold suggests ringing open-string harmonies.',82,4,55,'major','x...o...x...o.o.',0.15,'pluck,pad,tine,pluck','Soft footfall|Alternating bass|Open-string air|Harmonics|Fingerpicked line','pacific'],
  ['07f','Asia','Iran','Santur study','A web of ringing strings','Fine brown and ivory detail suggests overlapping struck strings.',94,6,62,'harmonic','x...o.x...o.',0,'tine,pad,metal,tine','Frame-drum sketch|Low struck strings|Resonant air|Metal echoes|Santur-like notes','santur'],
  ['08f','South America','Andean Bolivia & Peru','Charango and panpipe study','Breath answering strings','Turquoise chevrons suggest alternating breaths and bright strums.',104,4,64,'minorPent','x..ox...x.o.x.o.',0,'pluck,flute,wood,flute','Drum pulse|Charango-like ground|Panpipe air|Strummed answers|Flute melody'],
  ['09f','Asia','Anatolia, Türkiye','Bağlama study','A travelling string story','Amber fibres suggest the grain and resonance of a long-necked lute.',96,7,57,'phrygian','x..ox..ox..o..',0,'pluck,pad,wood,pluck','Frame-drum sketch|Low lute string|Drone|Picked ornaments|Bağlama-like line'],
  ['10f','Africa','Malawi & Zimbabwe','Mbira / Sansi study','Interwoven cycles','Small dark markings become repeating, interlocking tine notes.',98,6,60,'pent','x..o..x.o.o.',0.08,'tine,pad,wood,tine','Rattle pulse|Low tines|Resonant air|Upper tines|Answering tines','mbira'],
  ['11f','Africa','Mande region, West Africa','Kora study','Memory passed hand to hand','Gold flecks on a dark vane suggest alternating harp-lute lines.',90,4,62,'major','x...o.x.x...o.x.',0.07,'pluck,pad,tine,pluck','Soft calabash sketch|Low strings|String resonance|Upper ostinato|Kora-like line'],
  ['12f','Europe','Finland','Kantele study','Small resonances held close','Cool blue and charcoal suggest delicate, lingering string harmonics.',68,4,62,'minorPent','x.......o.......',0,'pluck,pad,tine,tine','Muted tap|Low plucks|Long resonance|Harmonics|Kantele-like line'],
  ['13f','North America','Trinidad & Tobago','Steelpan study','Inventiveness in bright metal','Yellow punctuated by black marks becomes a field of struck tones.',108,4,65,'major','x..ox.o.x..ox.o.',0.05,'metal,pad,wood,metal','Percussion pulse|Low pan tones|Ringing air|Metal answers|Steelpan-like line','steelpan'],
  ['14f','Europe','Lisbon, Portugal','Fado guitar study','Longing and reply','A slender tan vane suggests an intimate plucked-string voice.',70,4,57,'harmonic','x...o...x...o...',0.10,'pluck,pad,tine,pluck','Soft pulse|Guitar ground|Sustained air|Guitarra-like ornaments|Wordless string line','fado'],
  ['15f','Europe','Ireland','Irish harp study','A story carried by strings','Pale sweeping bands suggest a melody crossing ringing strings.',84,6,62,'major','x..o..x..o..',0.05,'pluck,pad,tine,pluck','Light tap|Low harp strings|Resonance|Harmonic answers|Harp-like melody','harp'],
  ['16f','Asia','Java, Indonesia','Javanese gamelan study','Many parts, one cycle','Repeated gold motifs suggest a shared cycle marked by gongs.',76,4,60,'pent','x.......o.......',0,'metal,pad,metal,metal','Gong-like pulse|Low metal tones|Suspended resonance|Interlocking keys|Metallophone line','gamelan'],
  ['17f','North America','Cuba','Son cubano study','A call inviting an answer','Red and blue suggest dialogue between syncopated parts.',108,4,60,'major','x..x..x...x.x...',0.06,'pluck,brass,wood,pluck','Clave-like sketch|Anticipated bass|Brass air|Shaker and wood|Tres-like line'],
  ['18f','Oceania','Aotearoa New Zealand','Contemporary dub study','Distance, echo, return','Turquoise geometry suggests delayed fragments moving through space.',74,4,55,'dorian','....x.......x...',0.08,'pluck,pad,wood,reed','Spacious backbeat|Deep bass|Echo cloud|Offbeat chops|Delayed reed line'],
  ['19f','North America','New Orleans, USA','New Orleans jazz study','Many voices in the street','Gold checks suggest overlapping phrases in a shared pulse.',116,4,58,'dorian','x...o.x.x...o.x.',0.30,'pluck,reed,wood,brass','Brush-like pulse|Walking ground|Reed bed|Piano-like accents|Brass answer'],
  ['20f','Asia','China','Guqin study','Listening into silence','Balanced golden branches suggest restrained, spacious string gestures.',56,4,60,'pent','x...........o...',0,'pluck,pad,tine,pluck','Quiet knock|Low strings|Long air|Harmonics|Guqin-like phrase','guqin'],
  ['21f','South America','Rio de Janeiro, Brazil','Choro study','Playful melodic conversation','Amber and red detail suggests nimble interlacing phrases.',120,4,62,'major','x..ox.o.x..ox.o.',0.10,'pluck,flute,wood,pluck','Pandeiro-like sketch|Guitar ground|Flute air|Cavaquinho-like pulse|Quick string melody'],
  ['22f','Europe','Andalusia, Spain','Flamenco guitar study','Tension opening into movement','Red and teal beneath ivory suggest alternating restraint and release.',110,6,64,'phrygian','x.o.x..ox.o.',0,'pluck,pad,wood,pluck','Palm-clap sketch|Low guitar|String air|Strummed accents|Guitar-like ornaments'],
  ['23f','Oceania','Solomon Islands','Panpipe ensemble study','Breaths fitting together','Layered blue and gold suggest voices sharing a breath pattern.',102,4,60,'pent','x.o.x..ox.o.x.o.',0,'flute,pad,wood,flute','Bamboo-like taps|Low pipe tones|Breath texture|Pipe answers|Panpipe-like line'],
  ['24f','Asia','Bali, Indonesia','Balinese interlocking study','Two patterns becoming one','Loops and bright eyes suggest alternating struck-note patterns.',126,4,62,'sparse','x.o.x.o.x.o.x.o.',0,'metal,pad,metal,metal','Small gong sketch|Low metal ground|Resonance|Alternating keys|Bright interlock','gamelan'],
  ['26f','South America','Venezuelan plains','Joropo study','Three and two in conversation','Fine cream and gold suggest quick harp figures over a dance pulse.',138,6,62,'major','x.o.x.o..o..',0,'pluck,pad,wood,pluck','Maraca-like pulse|Harp bass|String air|Cuatro-like strums|Harp melody','joropo'],
  ['27f','South America','Coastal Peru','Afro-Peruvian festejo study','A shared rhythmic conversation','Earth, red and cream become overlapping percussion and guitar.',114,6,57,'dorian','x..ox.o.x.o.',0.06,'pluck,pad,wood,pluck','Cajón-like pulse|Guitar bass|Soft resonance|Wood replies|Guitar phrase'],
  ['28f','Oceania','Samoa','Contemporary island guitar study','Gathering around a melody','Sky blue and soft gold suggest open, gently strummed harmonies.',92,4,60,'major','x...o..ox...o..o',0.08,'pluck,pad,wood,pluck','Light hand pulse|Guitar bass|Open harmony|Offbeat strums|Guitar-like melody','samoa'],
  ['29f','Asia','Tamil Nadu, India','Carnatic veena study','Ornament meeting a cycle','Vivid red and yellow suggest a plucked line with animated detail.',96,8,62,'major','x..ox.o.x...o.o.',0,'pluck,pad,wood,pluck','Hand-drum sketch|Drone strings|Sustained air|Picked ornaments|Veena-like line','vina'],
  ['30f','Europe','Crete, Greece','Laouto study','Strings carrying the dance','Regular golden ribs suggest a steady lute accompaniment.',104,4,62,'dorian','x..ox...x.o.x.o.',0.08,'pluck,bow,wood,pluck','Dance pulse|Low lute|Bowed air|Strum accents|Laouto-like phrase'],
  ['31f','Africa','Morocco','Gnawa-inspired instrumental study','A grounded repeating exchange','Black and white marks suggest a low repeating line and metal accents.',90,6,55,'minorPent','x..ox.x..ox.',0.12,'pluck,pad,metal,pluck','Metal pulse|Guembri-like bass|Low resonance|Metal answers|Plucked response','gnawa'],
  ['32f','Africa','Addis Ababa, Ethiopia','Ethio-jazz study','A meeting of musical worlds','Warm spotted detail suggests a winding reed line above jazz harmony.',88,4,62,'minorPent','x...o.x.x...o.o.',0.23,'pluck,reed,metal,reed','Brush-like pulse|Round bass|Reed harmony|Vibraphone-like accents|Reed melody'],
  ['33f','North America','Kingston, Jamaica','Jamaican dub study','Space becomes an instrument','Bold alternating blocks suggest bass, silence and echo.',72,4,57,'minor','....x.......x...',0.12,'pluck,pad,wood,reed','One-drop sketch|Sub bass|Delay air|Offbeat chords|Echo fragments'],
  ['34f','Europe','Paris, France','Musette waltz study','A turning dance','A pale crown over a dark base suggests a light melody over a waltz.',126,3,60,'harmonic','x...o...o...',0.05,'pluck,pad,wood,reed','Three-beat pulse|Waltz bass|Reed air|Chord accents|Accordion-like line'],
  ['35f','South America','Caribbean Colombia','Cumbia study','A circular gathering','Golden waves suggest a swaying pulse answered by breath.',96,4,62,'minor','x..ox...x..ox.o.',0.08,'pluck,flute,wood,flute','Drum sketch|Low ground|Flute air|Shaker texture|Gaita-like phrase'],
  ['36f','Europe','Bulgaria','Uneven-meter dance study','Balance in an uneven step','Contrasting spots and stripes become a 2 + 2 + 3 pulse.',168,7,62,'minor','x...x...x.....',0,'bow,flute,wood,reed','2 + 2 + 3 pulse|Bowed ground|Flute air|Wood accents|Reed-like dance line','bulgaria'],
  ['37f','Africa','Senegal','Mbalax percussion study','Rhythm talking across layers','Dense speckling suggests answering drum accents.',118,4,60,'dorian','x.o.xx.ox.o.x.oo',0.12,'pluck,pad,wood,brass','Sabar-like sketch|Bass ground|Warm air|Drum replies|Bright melody','mbalax'],
  ['38f','North America','Veracruz, Mexico','Son jarocho study','The gathering carries the song','Small bright marks on dark fibres suggest strummed and tapped answers.',120,6,60,'major','x.o.x.o..o..',0,'pluck,pad,wood,pluck','Footwork-like pulse|Low string|Resonance|Jarana-like strum|Requinto-like line'],
  ['39f','Oceania','Tonga','Brass-band study','A melody shared in public','White and gold suggest a bright ensemble of sustained tones.',100,4,58,'major','x...o.x.x...o.x.',0,'brass,pad,wood,brass','March-like pulse|Low brass|Sustained harmony|Short brass accents|Brass melody','pacific'],
  ['40f','Oceania','Tahiti, French Polynesia','Toʻere percussion study','Wooden voices in dialogue','Dark bars and a gold base suggest contrasting wooden attacks.',124,4,60,'pent','x.oxx.o.x.oxx.o.',0,'wood,noise,wood,wood','Log-drum sketch|Low wood|Air texture|High wood answers|Tuned wood phrase'],
  ['41f','South America','Argentina & Uruguay','Tango study','A pause charged with movement','Banded cream and black suggest marked steps and sudden pauses.',116,4,57,'harmonic','x..x..x.x..x..x.',0,'pluck,bow,wood,reed','Marked pulse|Plucked bass|Bowed air|Piano-like accents|Bandoneon-like line'],
  ['42f','Oceania','Australia','Contemporary ambient electronics','A wide field of listening','Blue-grey fibres suggest slow harmonic weather.',52,4,55,'bright','x...............',0,'pad,noise,metal,pad','Soft electronic pulse|Low drone|Wind texture|Distant chimes|Slow synth melody'],
  ['43f','North America','Appalachia, USA','Old-time banjo study','A tune passed between hands','Tight black and white stripes suggest repeated picked notes.',112,4,62,'major','x...o.x.x...o.x.',0.13,'pluck,bow,wood,pluck','Footfall|Low strings|Bowed air|Picked roll|Banjo-like melody'],
  ['44f','Africa','Cape Town, South Africa','Cape jazz study','A city in musical conversation','A quiet brown surface suggests warm reeds and a buoyant bass.',114,4,58,'major','x..ox.x.x...o.x.',0.24,'pluck,reed,wood,brass','Brush-like pulse|Walking bass|Reed harmony|Piano-like accents|Brass phrase'],
  ['45f','Asia','Korea','Gayageum study','A string that continues to bend','Scalloped light and dark suggest plucked tones with lingering inflection.',80,6,62,'pent','x...o.x.o...',0,'pluck,pad,wood,pluck','Soft drum sketch|Low zither|Resonant air|Harmonics|Gayageum-like line'],
  ['air-study','Antarctica','Antarctica · imagined soundscape','Wind and ice electronics','A shared responsibility to listen','Silver-white fibres suggest wind, ice and a fragile environment; this is an ecological study, not an Indigenous musical tradition.',48,4,60,'bright','x...........o...',0,'pad,noise,metal,flute','Ice-like tick|Sub drone|Wind|Crystalline echoes|Breath tones'],
];
export const SOUND_FEATHERS: SoundFeather[] = rows.map(([id,continent,place,style,carries,pairing,bpm,beats,root,scale,pulse,swing,voices,layers,reference]) => ({
  id,continent,place,style,carries,pairing,bpm,beats,root,scale:scales[scale],pulse,swing,
  voices: voices.split(',') as SoundFeather['voices'], layers: layers.split('|') as SoundFeather['layers'],
  reference: reference ? refs[reference] : undefined,
}));
export const LAYERS = [
  { name: 'Pulse', part: 'Shaft', action: 'Bends the centreline', icon: 'pulse' },
  { name: 'Ground', part: 'Vane', action: 'Ripples the main fibres', icon: 'wave' },
  { name: 'Air', part: 'Down', action: 'Lifts the soft fibres', icon: 'air' },
  { name: 'Pattern', part: 'Markings', action: 'Animates detected markings', icon: 'dots' },
  { name: 'Melody', part: 'Colour', action: 'Shifts the feather’s light', icon: 'sun' },
] as const;
export const featherLabel = (id: string) => id === 'air-study' ? 'Air study' : `Feather ${id.slice(0, 2)}`;
export function atlasCsv(): string {
  const rows = [['Feather','Continent','Place','Musical study','What it carries','Visual pairing',...LAYERS.map(l => `${l.name} → ${l.part}`),'BPM','Pulse units per bar','Reference'],
    ...SOUND_FEATHERS.map(f => [featherLabel(f.id),f.continent,f.place,f.style,f.carries,f.pairing,...f.layers,String(f.bpm),String(f.beats),f.reference?.url ?? 'Curatorial proposal'])];
  return rows.map(row => row.map(v => `"${v.replaceAll('"','""')}"`).join(',')).join('\r\n');
}
