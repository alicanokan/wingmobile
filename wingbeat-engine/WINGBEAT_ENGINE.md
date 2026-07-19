# Wingbeat Engine — Module Map

> **How to use this file:** this is an auto-drafted inventory of every engine and
> module currently in the codebase (`wingbeat-engine/src`). Read through, mark
> anything **missing / wrong / misnamed**, and hand it back to Claude to fix the
> code or the doc. Edit freely — add ✅ / ❌ / notes inline.
>
> Legend: `📄 path` = source file · ⚠️ = Claude is unsure, please confirm.
>
> _Last generated: 2026-07-18 from commit `6a5f069`._

---

## Wingbeat goal

Wingbeat is an interactive installation where a **feather** — rendered as a live
particle system on a projection — reacts to people in the room. Breath, motion,
phones, and real ESP hardware feed *sensors*; each sensor drives a *part* or
*colour layer* of the feather (it moves, separates, glows) and plays its own
*loop sample*, all tuned to a cultural "scene" (Phoenix/Anatolia, Crane/Ghana…).

The system is built in **three decoupled layers** so the same "brain" runs a
laptop simulation or the real forest install unchanged:

```
   INPUT (transport)  ─►  THE BRAIN (WingbeatEngine)  ─►  CONSUMERS (outputs)
   mic / camera /          state model + thresholds +      audio engine (Tone.js)
   phones / ESP32          cooldowns + scene, emits          visual feather (Projection)
                           a typed EVENT BUS                  LED commands (hardware)
```

<!-- ✎ EDIT: is this goal statement right? anything about the artistic intent missing? -->

---

## 1. Input modules
*Raw signals that become a sensor's activation level.*

| Module | What it does | 📄 File |
|---|---|---|
| **Mic** (`MicSource`) | Laptop microphone → smoothed 0..1 level. "Breathe at the screen." Sim stand-in for the ESP electret breath sensor. | `src/sim/mic.ts` |
| **Laptop camera** (`CameraSource`) | Webcam motion-theremin: frame-diff → motion energy (volume) + horizontal centre (position). | `src/sim/camera.ts` |
| **Phone camera (QR)** (`CamSender`) | Phone opens `/cam`, runs the same motion detection **locally**, streams only motion numbers over the LAN relay. Video never leaves the phone. | `src/sim/CamSender.tsx`, `src/sim/camNet.ts` |
| **Phone controller (QR)** (`Controller`) | Phone opens `/controller`, pairs over WebRTC, sends a motion pad / accelerometer + scene / tempo / volume. Up to 5 phones (D1–D5). | `src/sim/Controller.tsx`, `src/net/link.ts` |
| **Keyboard** | Keys `q w e r t` fire the 5 sensor slots as enveloped pulses (amount + release). | `src/sim/KeyboardPanel.tsx`, `src/sim/inputs.ts` |
| **Manual (operator map)** | Click/press-and-hold a sensor diamond on the room map to "blow" on it. | `src/sim/OperatorMap.tsx`, `SimTransport` |
| **Auto-demo** | Synthetic gusts/presence on every ring sensor so the piece animates itself. | `src/transports/SimTransport.ts` |
| **ESP8266 devices** | Real hardware over MQTT: `wind / motion / presence` per node (`feather_node.ino`). Confirmed 2026-07-19: ESP8266, not ESP32. | `src/transports/MqttTransport.ts` |

**Input routing (the patch bay):** a 3-stage matrix — **source → slot → part(s)** —
so any input can feed any of the 5 sensor slots, and one slot can move several
feather parts. 📄 `src/sim/inputs.ts`, `src/sim/InputMatrix.tsx`, `src/sim/channels.ts`

<!-- ✎ EDIT: any input source missing? (e.g. OSC, DMX, plant/capacitive sensor?) -->

---

## 2. Networking & sync modules
*Move state between devices/windows.*

| Module | What it does | 📄 File |
|---|---|---|
| **Transport interface** | The one seam between "simulation" and "real install". Inbound sensor readings + outbound LED/audio. | `src/transports/Transport.ts` |
| **SimTransport** | Runs everything in the browser (manual / mic / auto-demo). | `src/transports/SimTransport.ts` |
| **MqttTransport** | Hardware bridge — speaks the ESP MQTT topic schema byte-for-byte. | `src/transports/MqttTransport.ts` |
| **WebRTC link** (PeerJS) | Pairs phones to the console from a static deploy, no backend. STUN + public TURN. | `src/net/link.ts` |
| **Cross-window sync** | Console broadcasts wind/presence/scene/feather at ~30 Hz to the `/feather` display window. | `src/sim/sync.ts` |
| **Live conductor sync** | Every engine device subscribes to the cloud "live" row and applies pushes (rig, feather, scene, loop samples). | `src/net/liveSync.ts` |
| **Phone-cam net protocol** | Message shape + relay URL for `/cam`. | `src/sim/camNet.ts` |

---

## 3. The brain — WingbeatEngine core
*Transport-agnostic, output-agnostic. Turns sensor readings into meaning and emits events.*

- **`WingbeatEngine`** — state model + thresholds + cooldowns + scene; emits a typed event bus. 📄 `src/engine/WingbeatEngine.ts`
- **Event bus** (`Emitter`) — tiny typed emitter. 📄 `src/engine/emitter.ts`
- **Event types** — `node`, `wind`, `melody`, `perc`, `accent`, `scene`, `feather`, `led`, `audioReady`. 📄 `src/engine/types.ts`
- **Spatial model** — room layout: screen, 4 corner speakers, 8-sensor ring, feather prop; drives panning + per-speaker gain + the operator map. 📄 `src/engine/spatial.ts`
- **Domain types** — the transport ↔ engine ↔ consumer contract (matches the MQTT schema). 📄 `src/engine/types.ts`
- **Engine snapshot poller** — polls engine → React state at ~30fps. 📄 `src/sim/useEngine.ts`

---

## 4. Reactive modules (consumers of the event bus)

- **Audio playback** → the Audio engine (section 5).
- **Visual feather** → the Feather / Projection engine (section 6).
- **LED / hardware** → `led` events out via MqttTransport.
- **MIDI out** — agreed but **not built yet**; see "Planned" at the bottom.

---

## 5. Master audio engine modules
*`AudioEngine` (Tone.js) — a consumer of the event bus.* 📄 `src/engine/AudioEngine.ts`

| Module | What it does |
|---|---|
| **Mixer** | One **bus (gain + mute)** per layer: `bed`, `wind`, `melody`, `perc`, `accent`, + master gain. |
| **Voices (synth engines)** | `bed` = PolySynth drone (+ slow LFO); `wind` = filtered Noise; `melody` = PluckSynth; `perc` = MembraneSynth; `accent` = MetalSynth bell. Each panned by room position. |
| **Loop player / "sequencer"** ⚠️ | Per-sensor **loop samples** phase-aligned to a **shared transport** (`bpm`) so they stay in sync; each loop's gain rises on trigger. ⚠️ *It's a synced multi-loop player, not a step-sequencer — confirm the name you want.* |
| **EQ / spectrum** | Per-loop **FFT** (256) → band levels `full / low / mid / high / custom(Hz range)`. Drives each layer's audio-reactivity. Editable in the visual EQ. 📄 `src/sim/EqEditor.tsx` |
| **Routing** | `melody/perc/accent` sample layers + per-feather-layer players/synth routed onto buses/pans; sensor loops routed to visual layers. |
| **Reverb + master meter** | Master → Reverb → destination; a Meter taps master level for global audio-reactive motion. |
| **Sample slots** | User can load an audio file to REPLACE a trigger voice (melody/perc/accent) or clear back to synth. 📄 `src/sim/SettingsPanel.tsx` |
| **Scene → sound** | Scene sets the drone chord + melody scale (section 9). |

**Key methods:** `setLayerGain/Mute`, `setMasterGain`, `setBedOsc`, `setNoiseColor`,
`setReverbWet`, `loadLoop`/`clearLoop`/`setLoopGain`, `getLoopBand`/`getLoopBandRange`,
`getLevel`. <!-- ✎ EDIT: is the loop system a "sequencer" in your terms, or just a loop player? -->

---

## 6. Feather modules (the visual engine)

| Module | What it does | 📄 File |
|---|---|---|
| **Image analyzer** | k-means over a feather photo's non-black pixels → dominant **colour groups** (palette), position-aware so a layer stays on one anatomical patch. | `src/sim/analyzeFeather.ts` |
| **Layer separator** | LAYERS of a feather: `auto` (k-means cluster), `color` (colour+tolerance range), `area` (marked vertical band). A particle can belong to many layers; max 8. | `src/sim/rig.ts` |
| **Rig (per-sensor module racks)** | The modular control model. Per-sensor modules: **movement / release / color / monitor**. Motion shapes: `swirl, rise, scatter, wave, flutter, pulse, fall, pulseZ`. Plus sensitivity, reach, attack/release, audio band, layer routing. | `src/sim/rig.ts`, `src/sim/RigPanel.tsx` |
| **Feather basics (anatomy)** | Projection models real anatomy: calamus, rachis, barbs, vane, downy base. Wind bows the rachis, separates barbs, ruffles the down. | `src/sim/Projection.tsx` |
| **Projection shader engine** | The particle renderer (React-Three-Fiber / Three.js). Reads `rig` every frame: per-layer charge, motion, audio-reactive colour/glow, pump/float/sink, wing-beat, gravity-sand, relief. | `src/sim/Projection.tsx` |
| **Sensor → feather channels** | Maps the 5 sensors to feather parts: `region` (Tip / Rachis / Tail / edge) or `color` (a colour group). | `src/sim/channels.ts` |
| **Feather catalog + scenes** | The collection in `public/feathers/`; each feather seeds a culture scene (round-robin, overridable). | `src/sim/feathers.ts`, `src/sim/featherScenes.ts` |

**Engine mechanics (feather basics × layer separator × image analyzer):**
photo → `analyzeFeather` extracts colour groups → `rig` layers bind particles to
groups/areas → sensors route to layers → `Projection` animates each layer by its
motion shape, its loop's EQ band, and its envelope. <!-- ✎ EDIT: correct chain? -->

---

## 7. Cloud & persistence modules

| Module | What it does | 📄 File |
|---|---|---|
| **Cloud DB (Supabase)** | `wingbeat_samples` (audio library), `wingbeat_presets` (named conductor presets), `wingbeat_live` (the one row every device follows). | `src/net/cloud.ts`, `src/net/supabaseClient.ts` |
| **Sample cache (IndexedDB)** | Downloads each sample once; keeps playing if venue internet drops. | `src/net/sampleCache.ts` |
| **Presets** | Portable named presets (recall on any feather) + per-feather auto-"last" + JSON export/import. | `src/sim/presets.ts` |

---

## 8. Output modules

| Output | What it does | 📄 File |
|---|---|---|
| **Audio outputs** | Tone.js → speakers, panned per room position (4 corner speakers modelled). | `src/engine/AudioEngine.ts`, `src/engine/spatial.ts` |
| **Video / projection outputs** | The `/feather` display window (2nd screen, fullscreen), console projection panel, mobile feather view. | `src/sim/FeatherView.tsx`, `src/sim/Projection.tsx` |
| **LED / hardware outputs** | `led` events → `wingbeat/node/<id>/cmd/led` (off/solid/pulse/shimmer/wind/rainbow). | `src/transports/MqttTransport.ts` |

<!-- ✎ EDIT: any output missing? (DMX lighting? OSC out? recording/GIF export?) -->

---

## 9. Scenes (cultural feather packs)
Each = an LED/line tint + a held drone chord + a melody scale. 📄 `src/engine/scenes.ts`

1. **Phoenix · Anatolia** (default) — A natural minor
2. **Crowned Crane · Ghana** — D minor pentatonic
3. **Peacock · India** — raga-ish
4. **Condor · Andes** — G major pentatonic
5. **Eagle · Plains** — E minor pentatonic
6. **Tui · Aotearoa** — C major pentatonic

<!-- ✎ EDIT: add/rename cultures here; ~12 lines each in scenes.ts. -->

---

## 10. App shell, entry points & control panels
*Not "engines" but the surfaces that drive them.*

- **Entry points** (`main.tsx`): `/` operator console · `/feather` display · `/cam` phone camera · `/controller` phone remote · `/conductor` preset generator.
- **Landing** — Fullscreen / Control / Mobile entry. 📄 `Landing.tsx`
- **Operator console** — wires engine + audio + transport; map + feather. 📄 `App.tsx`
- **Conductor** — per-sensor sample/effect/sensitivity/EQ/envelope + global reaction; saves presets; "Push live". 📄 `Conductor.tsx`
- **Panels** — Rig, Scene, Settings/Mixer, Camera, Mic, Keyboard, Devices, Pair, Phone, InputMatrix, MobileMenu, OperatorMap, Knob, FeatherView.

---

## ✅ Answered (2026-07-19)

1. **ESP8266 is the real hardware.** The code is correct; the ESP32 in the
   original sketch was shorthand. All references stay ESP8266.
2. **MIDI = OUT only, and not yet built.** Wingbeat should drive *external*
   gear: sensor activity sends notes/CC to a DAW or hardware synth so the
   installation's sound can be produced outside the browser. MIDI **input** is
   not wanted. Nothing exists in code today — see "Planned" below.

## ⏳ Planned — MIDI out (not built)

Agreed direction, no code yet. Natural shape given the current engine: a new
consumer subscribing to the same bus every other output uses (like AudioEngine
does), translating engine events → Web MIDI:

- `melody` / `perc` / `accent` events → note-on with velocity
- per-sensor activation (the pulse air / envelope level) → CC per channel
- `scene` change → program change

📄 Would live alongside `src/engine/AudioEngine.ts` as e.g. `MidiOut.ts`, with a
device picker in the Conductor or Settings. Nothing in `ConductorConfig` yet.

## ❓ Still open for Alican

1. **"Loop sequencer"** — current code is a synced multi-loop *player*, not a
   step sequencer. Do you want an actual sequencer, or is "loop player" the
   right label? ______
2. **Anything missing entirely** (modules you have in your head but not in
   code)? ______
