// Render src/protocol/wire.ts into wingbeat-system/docs/mqtt-topics.md.
//   npm run docs:mqtt
// Run with Node ≥ 22.6 (type stripping) — no build step, no extra deps.
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIRE_DOC, PROTOCOL_VERSION, LED_MODES, GLOBAL_ACTIONS } from '../src/protocol/wire.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../wingbeat-system/docs/mqtt-topics.md');

const esc = (s: string) => s.replace(/\|/g, '\\|');
const rows = WIRE_DOC.map((e) =>
  `| \`${e.topic}\` | ${e.direction} | \`${esc(e.example)}\` | ${e.qos} | ${e.retain ? 'yes' : 'no'} | ${esc(e.notes)} |`,
).join('\n');

const md = `# Wing BEat — MQTT Topic Schema

> **Generated** from \`wingbeat-engine/src/protocol/wire.ts\` (protocol v${PROTOCOL_VERSION}) by
> \`npm run docs:mqtt\`. Edit the TypeScript, not this file. The firmware in
> \`wingbeat-system/firmware/\` is the other party to this contract.

All payloads are JSON. Numeric ranges are \`0.0..1.0\` unless the field says
otherwise. Unknown keys are ignored by every party, so additive changes can be
rolled out to browser and firmware in either order.

## Identity

Every node has a string id from its \`config.h\` — \`feather_01\`, \`sensor_03\`,
\`audio_01\`, \`plant_01\`. Its \`role\` (\`sensor · feather · audio · plant\`) rides in
the status payload; the browser's spatial layout (\`engine/spatial.ts\`) decides
where each id sits in the room.

## Topics

| Topic | Direction | Example payload | QoS | Retain | Notes |
|---|---|---|---|---|---|
${rows}

LED modes: ${LED_MODES.map((m) => `\`${m}\``).join(' · ')}. Global actions: ${GLOBAL_ACTIONS.map((a) => `\`${a}\``).join(' · ')}.

## Subscriptions

- **Browser (engine, \`MqttTransport\`)**: \`wingbeat/node/+/sensor/+\` (QoS 0),
  \`wingbeat/node/+/status\` (QoS 1), and \`wingbeat/node/+/cmd/led\` (QoS 0) so it
  can see the router's stream and yield per node.
- **Browser (lights, \`LedLink\`)**: \`wingbeat/node/+/status\` (discovery) and
  \`wingbeat/node/+/cmd/led\` (the output monitor shows what is truly on the wire).
- **Feather node**: its own \`cmd/led\`, \`global/scene\`, \`global/cmd/all\`.
- **Audio node**: its own \`cmd/audio\`, \`global/scene\`, \`global/cmd/all\`.

## Two LED pipelines, one topic

The engine publishes event-driven modes (\`shimmer\` on a melody, \`wind\` on a gust,
\`pulse\` at rest) at QoS 1. The light router streams \`solid\` colours from the
music or the sensors at QoS 0. Both tag their packets with \`src\`; the engine
side yields to a router stream that has spoken for a node in the last 3.5 s and
re-asserts its colour when the stream stops. Blackout wins over everything and
is sent as \`off\` by whoever holds it.

## Example flow

\`\`\`
[feather_03 boots]
→ pub wingbeat/node/feather_03/status           {"online":true,"role":"feather",…}   (retained)
→ pub wingbeat/node/feather_03/sensor/presence  {"present":false}                    (retained — clears stale state)

[someone walks up]
→ pub wingbeat/node/feather_03/sensor/presence  {"present":true}

[engine: accent → bell + audio nodes, shimmer on the feather]
→ pub wingbeat/node/audio_01/cmd/audio          {"layer":"accent","gain":0.8,"play":true}
→ pub wingbeat/node/feather_03/cmd/led          {"mode":"shimmer","r":200,"g":120,"b":60,"intensity":0.6,"src":"engine"}

[/feather2 is open and its router owns feather_03 → the engine goes quiet for it]
→ pub wingbeat/node/feather_03/cmd/led          {"mode":"solid","r":255,"g":64,"b":0,"intensity":0.9,"src":"router"}   (15 Hz, QoS 0)
\`\`\`
`;

writeFileSync(out, md);
console.log(`wrote ${out} (${WIRE_DOC.length} topics)`);
