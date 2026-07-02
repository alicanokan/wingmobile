# Wing BEat — System Architecture

Forest-distributed interactive sound + light installation. Each tree zone has
a small ESP8266 node that senses a participant's breath / motion / presence
and translates it into MQTT messages. A central computer (Mac mini per the
Naturatone brief) runs the broker, the browser UI (feather line-art + Tone.js
layers), and a couple of dedicated I2S audio nodes drive the speakers.

## Roles

```
                    ┌──────────────────────────────────┐
                    │    CENTRAL HUB  (Mac mini)       │
                    │                                  │
                    │   • Mosquitto broker             │
                    │     - MQTT  :1883  (ESPs)        │
                    │     - WS    :9001  (browser)     │
                    │   • Static file server :8080     │
                    │   • Browser → web/index.html     │
                    │     – SVG feather line-art       │
                    │     – Tone.js sound layers       │
                    │     – Operator/scene panel       │
                    └──────────────────────────────────┘
                              ▲       ▲
                  WiFi (MQTT) │       │ MQTT-over-WS
                              │       │
        ┌─────────────────────┼───────┴──────────────────────────┐
        │                     │                                   │
   ┌────┴─────┐         ┌─────┴────┐                       ┌──────┴──────┐
   │ Feather  │   …N    │ Feather  │     …                 │ Audio node  │
   │ node #1  │         │ node #N  │                       │  (I2S DAC)  │
   │  ESP8266 │         │  ESP8266 │                       │   ESP8266   │
   │          │         │          │                       │             │
   │ • Mic /  │         │ • Mic /  │                       │ • PCM5102 / │
   │   anemo  │         │   anemo  │                       │   MAX98357 │
   │ • MPU6050│         │ • MPU6050│                       │ • LittleFS  │
   │ • PIR    │         │ • PIR    │                       │   sample    │
   │ • WS2812 │         │ • WS2812 │                       │   bank      │
   │   strip  │         │   strip  │                       │             │
   └──────────┘         └──────────┘                       └─────────────┘
```

### Why two firmware roles?

ESP8266 has a single I2S peripheral. The library that drives WS2812 LEDs at
high count via DMA uses I2S, and so does I2S DAC audio output. Running both
at the same time on one board produces glitches in either the audio or the
LED chain.

So:

- **Feather nodes** (most of them — one per tree/zone) run the sensor +
  WS2812 LED firmware. Sound for that zone is produced *in the browser* and
  played out the central speakers. NeoPixel uses the Adafruit bit-bang
  driver (interrupts disabled briefly per frame) — works fine for a few
  dozen pixels per node.
- **Audio nodes** (one per speaker / zone where you want truly local sound)
  run the I2S DAC firmware. They do not drive LEDs. They subscribe to
  `wingbeat/audio/cmd/...` and play short sound layers from internal flash.

You can mix freely — you might have eight feather nodes and one or two audio
nodes in the same forest.

## Data flow

1. Participant approaches a tree → PIR fires → feather node publishes
   `wingbeat/node/<id>/sensor/presence` with `{distance_cm, present:true}`.
2. Browser UI subscribes to `wingbeat/node/+/sensor/+`. On presence:true it
   schedules a Tone.js *bed layer* (drone) for that zone's cultural pack.
3. Participant breathes / waves a feather → mic envelope or anemometer rises
   → node publishes `wingbeat/node/<id>/sensor/wind` (float 0..1, smoothed).
4. Browser maps wind intensity to: (a) a noise/wind synth gain, (b) a melodic
   layer trigger when crossing a threshold, (c) the corresponding SVG
   feather's bend / shimmer amount.
5. Browser publishes back `wingbeat/node/<id>/cmd/led` with HSV/intensity so
   the feather's LED strip glows in sync with what the participant just made
   sonically.
6. Operator (artist) can change the global scene/cultural pack via the
   operator panel → `wingbeat/global/scene` → all nodes + browser update.
7. (Optional) Biotron plant signal feeds in as a virtual node id `plant_*`
   from a separate process; same MQTT shape, no special-casing in the UI.

## Scene model

A *scene* is a named cultural sound + visual palette. Default packs
included as stubs in `web/sounds/`:

- `crane_ghana`     — Crowned Crane / West African rhythms
- `peacock_india`   — peacock / North Indian classical fragments
- `phoenix_anatolia`— Anatolian modal layers (your home pack)
- `condor_andes`    — flute + andean rhythmic bed
- `eagle_plains`    — drum + chant layers

Each pack is a small JSON descriptor + a folder of audio files (or
purely-synthesized layers in Tone.js — easier to ship, sounds great).

## Latency budget

WiFi MQTT inside one venue: typically 5–25 ms. Browser MQTT-over-WS: similar.
Web Audio scheduling adds 5–20 ms. End-to-end "I breathed → sound layer
swelled" is ~30–60 ms which is well below noticeable for a slow-evolving
soundscape.

For sharp percussive triggers (rare in this piece) consider running the
audio node firmware so the trigger path is `sensor → MQTT → audio node` and
the sample plays from local flash with ~10 ms total latency.

## Failure modes

- Node loses WiFi: keeps running, retries; LED defaults to slow ambient
  pulse so the forest doesn't go visually dark.
- Broker dies: nodes buffer last-will status; browser shows "broker offline"
  banner.
- Browser tab closes: nodes keep their LED state (last received command);
  no sound until tab reopens.
