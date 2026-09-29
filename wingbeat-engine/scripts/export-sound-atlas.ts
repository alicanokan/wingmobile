/** Export the same curatorial catalogue and original audio that power /test.html. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SOUND_FEATHERS, CONTINENTS, LAYERS, featherLabel, atlasCsv } from '../src/testfeather/catalog.ts';
import { renderStudy, mixWav } from '../src/testfeather/synthesis.ts';
const destination=resolve(process.argv[2] ?? 'docs/sound-atlas');
const includeAudio=process.argv.includes('--audio');
mkdirSync(destination,{recursive:true});
writeFileSync(resolve(destination,'wingbeat-feather-sound-atlas.csv'),'\uFEFF'+atlasCsv());
const examples=['10f','01f','15f','13f','08f','06f','air-study'].map(id=>SOUND_FEATHERS.find(f=>f.id===id)!);
let report=`# Wing Beat — Feather sound atlas\n\nPrepared 29 September 2026. **44 image feathers · 7 geographies · 5 independently playable layers.**\n\nOpen the sound lab at [wingbeat.art/test.html](https://www.wingbeat.art/test.html). Select a continent and a feather, press **Listen**, then **Solo** a layer to hear and see its contribution. Mute and volume controls affect both the sound and its measured visual response. Each channel accepts an uploaded clip while retaining its volume, mute, solo and visual response. Open the arrow to choose a feather region, movement, sensitivity, amount and speed. Master BPM changes the selection’s tempo; set the source BPM for uploaded clips. Tempo changes both speed and pitch. Uploads and edits remain in the current tab until reload. WAV exports four bars of the current mix; All pairings opens the catalogue and CSV download.\n\n## Curatorial premise\n\nA feather becomes a vessel by carrying a musical conversation: pulse, ground, air, pattern and melody. Its visible colours and markings suggest a way of listening. The proposed meanings below are new interpretations for Wing Beat; they are not inherited cultural meanings of these particular feathers.\n\nThe image collection contains no verified species or origins. These pairings therefore use colour and form, not zoological provenance. There is no single sound of a continent: each pairing names a place or musical practice. The procedural feather has no fixed image and remains unassigned. Antarctica is an imagined ecological soundscape, not an Indigenous musical tradition.\n\n## Listen first\n\n| Geography | Feather | Proposed musical direction | What it carries |\n| --- | --- | --- | --- |\n`;
for(const f of examples)report+=`| ${f.continent} | ${featherLabel(f.id)} | ${f.style} · ${f.place} | ${f.carries} |\n`;
report+=`\n## How the five layers move the feather\n\n| Sound layer | Feather region | Visible response |\n| --- | --- | --- |\n`;
for(const l of LAYERS)report+=`| ${l.name} | ${l.part} | ${l.action} |\n`;
report+=`\nFive loop buffers begin on the same audio clock. Each passes through its own volume control and analyser. Measured RMS energy, with a gentle response curve and attack/release smoothing, reaches the existing Feather2 particle renderer through its live play contract and five-stem shader controls. This uses the current image analysis, centreline, barbs, down, colour and pattern masks. It is actual audio-driven motion, not a timer pretending to detect music.\n\nThe main vane inherits the shaft bend, so isolated Pulse can move the whole attached feather. Pattern movement depends on the markings detected in the image. The Motion slider scales audio response independently of loudness; zero removes that response while the renderer’s small resting movements remain. The page uses the existing studio look.\n\n## Every feather and its proposed cultural vessel\n\n`;
for(const continent of CONTINENTS){
  report+=`### ${continent}\n\n| Feather | Place / musical reference | What it carries | Why this visual pairing |\n| --- | --- | --- | --- |\n`;
  for(const f of SOUND_FEATHERS.filter(f=>f.continent===continent)){
    const name=f.reference?`[${f.style}](${f.reference.url})`:f.style;
    report+=`| ${featherLabel(f.id)} | ${f.place} · ${name} | ${f.carries} | ${f.pairing} |\n`;
  }
  report+='\n';
}
report+=`## Layer recipes\n\nInstrument names describe the intended musical reference. The prototype uses electronic approximations.\n\n| Feather | Pulse → shaft | Ground → vane | Air → down | Pattern → markings | Melody → colour |\n| --- | --- | --- | --- | --- | --- |\n`;
for(const f of SOUND_FEATHERS)report+=`| ${featherLabel(f.id)} | ${f.layers.join(' | ')} |\n`;
report+=`\n## What the audio examples are\n\nAll 220 stems are newly generated electronic sketches: 44 four-bar compositions, each with five layers. They vary in pulse pattern, tempo, scale palette, register, timbre, swing, phrasing and/or echo. They contain no sampled recordings, copied melodies or recorded performers. The audio is synthesized at 22,050 Hz and exported as mono 16-bit WAV.\n\nThese studies demonstrate the interaction and help choose directions. They do not faithfully recreate traditional instruments, regional repertoire, raga, maqam, gamelan tuning, vocal traditions or performance technique. Equal temperament and simplified rhythmic sketches are prototype constraints. Named instruments and genres should be developed with musicians from the corresponding communities before presenting the finished installation as a cultural representation.\n\nFor a production commission, request five separately licensed stems on an agreed shared tempo and cycle, plus performer credits, pronunciation, context and preferred description. Agree permissions for public installation playback, modification and distribution. Regional studies currently have different tempos and are designed to be auditioned one at a time; cross-feather synchronization and the installation’s multi-speaker/hardware routing are outside this test page.\n\n## Reference reading\n\nThese references inform selected musical directions. The feather pairings, symbolic descriptions and electronic compositions are Wing Beat proposals, not claims made by the sources.\n\n`;
const refs=new Map(SOUND_FEATHERS.flatMap(f=>f.reference?[[f.reference.url,f.reference.title] as const]:[]));
for(const [url,title]of refs)report+=`- [${title}](${url})\n`;
if(includeAudio){
  mkdirSync(resolve(destination,'listening-examples'),{recursive:true});
  report+=`\n## Downloadable listening examples\n\nThese are the same original sketches used by the page. The five isolated Andean-study files make the layer assignment easy to audition.\n\n`;
  for(const f of examples){
    const audio=renderStudy(f);
    const file=`listening-examples/${f.id}-mix.wav`;
    writeFileSync(resolve(destination,file),new Uint8Array(mixWav(audio,[0.75,0.78,0.65,0.6,0.78],0.4)));
    report+=`- [${featherLabel(f.id)} · ${f.style}](${file})\n`;
    if(f.id==='08f')for(let i=0;i<5;i++){
      const stemFile=`listening-examples/08f-${LAYERS[i].name.toLowerCase()}.wav`;
      writeFileSync(resolve(destination,stemFile),new Uint8Array(mixWav(audio,[0,1,2,3,4].map(s=>s===i?0.8:0),0.4)));
      report+=`  - [${LAYERS[i].name} → ${LAYERS[i].part}](${stemFile})\n`;
    }
  }
}
writeFileSync(resolve(destination,'wingbeat-feather-sound-atlas.md'),report);
console.log(`Exported ${SOUND_FEATHERS.length} pairings${includeAudio?' and 12 audio examples':''} to ${destination}`);
