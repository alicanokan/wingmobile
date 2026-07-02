# Wing Beat — Engine

The shared **brain** of the Wing Beat installation. One transport-agnostic
engine turns sensor readings (breath / wind, motion, presence) into a layered
soundscape, LED commands, and a generative feather visual — and it does this
identically whether the input is a **simulation** in your browser or the
**real ESP8266 hardware** over MQTT.

> Concept: feathers become vessels of culture, carrying the winds of different
> traditions. Each gust a participant makes is a note; the room's eight wind
> sensors ring a central interaction zone, four speakers spatialize the sound,
> and a projected feather bends to the loudest breath. See the project brief.

```
            ┌──────────────┐        ┌──────────────────┐        ┌──────────────────┐
 sensors →  │  TRANSPORT   │  ───►  │  WingbeatEngine  │  ───►  │  CONSUMERS        │
            │  sim | mqtt  │ ingest │  (the brain)     │  bus   │  audio (Tone.js)  │
            └──────────────┘        │  state + mapping │ events │  operator map     │
                  ▲                 │  scenes + spatial│        │  feather projection│
                  │ led/scene cmds  └──────────────────┘        │  MQTT → LED strips│
                  └─────────────────────────  bus  ─────────────┘
```

The engine knows **nothing** about WebSockets, MQTT, Tone.js, React, or LEDs.
Swap the transport from `SimTransport` to `MqttTransport` and the brain is
byte-for-byte the same — that is the entire point. **The simulation you tune is
the installation that ships.**

## Run the simulation

```bash
cd wingbeat-engine
npm install
npm run dev        # http://localhost:5173
```

You get one operator console with two **linked** views of the same engine:

- **left — operator room map:** the layout diagram come alive (projection
  screen, 4 corner speakers that glow with their live spatial gain, the central
  INTERACTION zone, the 8 ring wind-sensors, the feather prop). **Press & hold
  any sensor to blow wind on it.**
- **right — projection feather:** the audience-facing 3D feather. Aim a
  projector at this (use the **⛶ fullscreen** button) and it becomes the
  *screen* in the diagram.

Controls in the top bar:

| Control | What it does |
|---|---|
| **Start audio** | Required once per session (browsers block audio until a click). |
| **Auto-demo** | Synthetic gusts/presence on every sensor — the piece plays itself. |
| **Use mic** | Your laptop mic drives the feather's wind value (breathe at the screen). |
| **Scene chips** | Switch the cultural feather pack (sound palette + LED tint). |
| **❖ collection** | Open the feather picker — choose the feather the projection shows. |
| **⚙ mixer** | Open the audio settings + mixer (per-layer volume/mute, voices, samples). |
| **vol / wind×** | Master gain / wind sensitivity. |

### Feather collection

The projection can render either the **procedural** feather (built from rachis +
barbs + vane geometry) or any photograph from your collection. The photos live
in `public/feathers/`; each is shot on black.

A chosen photo is turned into a **3D particle cloud** (`buildParticles` in
`src/sim/Projection.tsx`): the engine samples ~10–15k pixels, drops the black
background, and places each as a colored particle in 3D by its pixel position.
- The **rachis** column stays ~80 % stable (central particles have high
  `aStability`, so effects barely move them) — the still source.
- Each particle is tagged with its nearest **palette color group**, so a color
  sensor swirls *that* color through 3D space (XY orbit + Z lift); region
  sensors (Tip/Tail/…) move their band.
- **Bloom**: idle → the cloud collapses to the rachis line; taking the feather
  in hand (feather_01 presence / **F**) blooms it into the full feather form.

#### The 4 interaction phases

Each interaction escalates the particle cloud through four phases (driven by
`uBloom / uPattern / uAudioMix / uDisperse` in the point shader):

1. **Line → barbs** — any active sensor (or the held feather) blooms the form
   out of the single rachis line.
2. **Barbs → visible pattern** — as engagement grows, the active sensor's
   designated color group / band becomes visible and starts to move.
3. **→ audio-reactive** — that motion then pumps with the **live audio level**
   (a `Tone.Meter` tap on the master, read each frame), so the pattern moves to
   the sound it triggers.
4. **All 5 active → flight** — when every sensor is active the particles partly
   separate from the feather and fly across the whole screen as a unique,
   audio-reactive **data artwork**.

(Audio-reactivity needs **Start audio** running — the meter is silent until then.)

#### Motion panel (✦ motion)

A live control surface (`src/sim/MotionPanel.tsx` → `src/sim/motion.ts`) for the
particle movement — every slider maps to a shader uniform, read each frame:

| Control | Effect |
|---|---|
| **Reach** | overall travel distance of the particles |
| **Max distance** | hard clamp — how far a particle may stray from its source point |
| **Swirl / Lift** | XY orbit vs Z (depth) amount |
| **Idle sway** | ambient breathing |
| **Flight (all-5)** | phase-4 screen-flight distance |
| **Audio react** | how much the live audio level pumps the motion |
| **Trigger kick** | impulse added to a sensor's particles **each time its sound fires** |
| **Rachis lock** | how still the central shaft stays |
| **Particle size** | point size |

**Trigger reactivity:** every `melody`/`perc`/`accent` event the engine emits
kicks an impulse into that sensor's channel (decays each frame), so you *see*
each triggered note/pattern move its color group — the MIDI-/sound-reactive
movement. Lower **Reach** + **Max distance** to keep particles close to the
feather (they were straying too far by default).

The selection is engine state (`engine.setFeather(id)` → `'feather'` bus event),
so it's shared like a scene and could later be driven by hardware or a scene change.

**Add your own feathers:** drop more PNGs (feathers on a black background,
shot vertically, tip up) into `public/feathers/`, then regenerate the catalog
`src/sim/feathers.ts` (the array of `{ id, src, label }`) and the small
thumbnails in `public/feathers/thumbs/` (`sips -Z 150 *.png --out thumbs/`) —
or just add entries by hand. They appear in the picker automatically.

### Per-sensor mapping + color understanding

The **5** ring sensors (fanned across the top of the interaction zone, matching
the installation diagram) each drive a **different part or color** of the
feather (`src/sim/channels.ts`):

| Sensor | Key | Drives |
|---|---|---|
| sensor_01 | Q | **Tip** — flutters the top of the vane |
| sensor_02 | W | **Rachis** — sways/brightens the central shaft |
| sensor_03 | E | **Color A** — the brightest color group |
| sensor_04 | R | **Color B** — the next color group |
| sensor_05 | T | **Tail** — ruffles the downy base |

(The held feather prop, `feather_01`, sits below the ring and drives the overall
sway — it's the mic target in sim mode.)

**Color understanding:** when a photographic feather is chosen, the engine
analyses the image (`src/sim/analyzeFeather.ts`, k-means over the non-black
pixels) and extracts its dominant **color groups** into `engine.featherPalette`.
The color-channel sensors bind to those groups, so blowing on (or pressing the
key for) "Color A" makes that feather's *actual* color group ripple and glow —
"the white parts move", "the gold parts shimmer", etc. The operator map shows
each sensor's label, its color swatch, and its `[KEY]`.

How it reacts:
- **region** channels (Tip / Rachis / Tail / Leading) physically displace that
  zone of the feather (vertex deformation, localized to a UV band/side).
- **color** channels distort + brighten the pixels matching their color group
  (photographic feather), or push the procedural barbs toward that color.

**Keyboard:** in Simulation mode, **hold Q W E R T** to blow on sensors 1–5 —
handy for driving the piece by hand or recording the projection without the
operator map. (The keys map to the sensors via `KEY_TO_SENSOR`; change the
sensor count/arrangement in `src/engine/spatial.ts` and the mapping in
`src/sim/channels.ts` — everything else follows.)

### Audio settings + mixer

The **⚙ mixer** button opens the audio panel (`src/sim/SettingsPanel.tsx`):

- **Mixer** — master + per-layer volume and mute for **Drone, Wind, Melody,
  Percussion, Accent**. The continuous tone after "Start audio" is the **Drone**
  pad — mute or lower it here.
- **Voices** — swap the **Drone** oscillator (sine / triangle / saw / …), the
  **Wind** noise colour (white / pink / brown), and the reverb amount.
- **Samples** — load your own audio file to **replace** a layer's trigger sound
  (Melody / Percussion / Accent); Melody pitches the sample per note. "synth"
  reverts to the built-in voice.

Each layer runs through its own mixer bus (`src/engine/AudioEngine.ts`), so the
soundscape is fully re-voiceable live and settings persist before audio starts.

## Connect to the real installation

The hardware system lives in [`../wingbeat-system`](../wingbeat-system) —
Mosquitto broker + ESP8266 feather/audio nodes. To drive this engine from it:

1. Start the broker (`cd ../wingbeat-system/broker && docker compose up -d`).
   It exposes MQTT on `:1883` (for ESPs) and MQTT-over-WebSocket on `:9001`
   (for this browser engine).
2. Power on the ESP8266 nodes (they already publish to the topic schema this
   engine speaks — see `../wingbeat-system/docs/mqtt-topics.md`).
3. In the console top bar, click **Hardware**, set the URL to your broker's
   WebSocket listener (e.g. `ws://10.0.0.4:9001`), and you're live. Real
   breath on a real feather now lights the operator map, swells the
   soundscape, bends the projection, and sends LED commands back to the strips.

No code changes — only the transport switch. The `MqttTransport`:

- **inbound:** `wingbeat/node/<id>/sensor/{wind,motion,presence}` and
  `.../status` → `engine.ingest*()`
- **outbound:** engine `led` events → `wingbeat/node/<id>/cmd/led`; engine
  `scene` events → retained `wingbeat/global/scene`; `accent` on an audio node
  → `wingbeat/node/<id>/cmd/audio`.

## Layout of the code

```
src/
├── engine/                 ← THE BRAIN (no UI, no transport, no I/O)
│   ├── types.ts            ← domain contract (sensor payloads = MQTT schema)
│   ├── WingbeatEngine.ts   ← state model + sensor→sound/light mapping + bus
│   ├── emitter.ts          ← tiny typed event bus
│   ├── AudioEngine.ts      ← Tone.js layers (bed/wind/melody/perc/accent), a bus consumer
│   ├── scenes.ts           ← cultural feather packs (add a culture = ~12 lines)
│   └── spatial.ts          ← the room: 8 sensors, 4 speakers, screen, panning math
├── transports/             ← the ONLY thing that differs sim vs. hardware
│   ├── Transport.ts        ← interface + base class
│   ├── SimTransport.ts     ← synthetic + mic + manual input
│   └── MqttTransport.ts    ← bridge to the ESP8266 install (wingbeat-system schema)
└── sim/                    ← the operator console UI (React + R3F)
    ├── App.tsx             ← wires engine + audio + transport + the two views
    ├── OperatorMap.tsx     ← top-down room map (SVG)
    ├── Projection.tsx      ← 3D feather (react-three-fiber)
    ├── useEngine.ts        ← engine state → React at ~30fps
    └── mic.ts              ← laptop-mic breath source
```

### Where to tune things

- **The "feel" of the instrument** (thresholds, cooldowns) →
  constants at the top of `engine/WingbeatEngine.ts`.
- **A new culture / scene** → add an entry to `engine/scenes.ts`.
- **The physical room** (real speaker/sensor positions) → edit the normalized
  coordinates in `engine/spatial.ts`. Everything spatial — panning, per-speaker
  gain, the operator map — follows automatically.
- **The projected visual** → `sim/Projection.tsx`.

## Build

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc -b && vite build  → dist/
npm run preview     # serve the production build
```

## How this relates to the other two prototypes

This package unifies them. The polished 3D feather from
`../wing-beat_-ritual-of-remembrance` becomes the **projection**; the MQTT
topic schema and cultural packs from `../wingbeat-system` become the
**hardware transport** and **scenes**. The duplicated sensor→sound logic that
lived inside each prototype's UI now lives once, in `src/engine/`, with no UI
or transport baked in.
```
