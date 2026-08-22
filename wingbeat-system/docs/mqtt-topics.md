# Wing BEat — MQTT Topic Schema

> **Generated** from `wingbeat-engine/src/protocol/wire.ts` (protocol v1) by
> `npm run docs:mqtt`. Edit the TypeScript, not this file. The firmware in
> `wingbeat-system/firmware/` is the other party to this contract.

All payloads are JSON. Numeric ranges are `0.0..1.0` unless the field says
otherwise. Unknown keys are ignored by every party, so additive changes can be
rolled out to browser and firmware in either order.

## Identity

Every node has a string id from its `config.h` — `feather_01`, `sensor_03`,
`audio_01`, `plant_01`. Its `role` (`sensor · feather · audio · plant`) rides in
the status payload; the browser's spatial layout (`engine/spatial.ts`) decides
where each id sits in the room.

## Topics

| Topic | Direction | Example payload | QoS | Retain | Notes |
|---|---|---|---|---|---|
| `wingbeat/node/<id>/status` | node → broker | `{"online":true,"role":"feather","fw":"0.2.0","rssi":-62,"ip":"10.0.0.21"}` | 1 | yes | Retained. The node's last-will publishes {"online":false,"role":…} so every client flags a dead node at once. The engine also sweeps: a node silent for 8 s is marked offline even if its TCP session survived. |
| `wingbeat/node/<id>/sensor/wind` | node → broker | `{"v":0.42,"raw":612,"ts":12345678}` | 0 | no | Smoothed breath/wind 0..1. ~20 Hz while changing. |
| `wingbeat/node/<id>/sensor/motion` | node → broker | `{"ax":0.02,"ay":-0.11,"az":0.97,"mag":0.14,"ts":12345678}` | 0 | no | Accelerometer in g; `mag` is the high-pass shake magnitude (~0..1.5). ~10 Hz above the noise floor. |
| `wingbeat/node/<id>/sensor/presence` | node → broker | `{"present":true,"distance_cm":120,"ts":12345678}` | 0 | yes | Edge-triggered, retained. The node publishes {"present":false} on boot so a retained `true` from a previous life is cleared. `distance_cm` is optional (PIR nodes omit it). |
| `wingbeat/node/<id>/cmd/led` | browser → node | `{"mode":"solid","r":120,"g":40,"b":200,"intensity":0.8,"src":"router","brightness":1}` | 1 | no | `mode` ∈ off · solid · pulse · shimmer · wind · rainbow. `intensity` 0..1. `src` says which pipeline sent it (engine = event-driven modes at QoS 1; router = the solid-colour stream at QoS 0; identify = the operator's white flash) — the two pipelines arbitrate per node on this tag (led/types.ts LedArbiter). `brightness` 0..1 caps the whole strip (firmware ≥ 0.2). Feather/plant nodes only. |
| `wingbeat/node/<id>/cmd/audio` | browser → node | `{"layer":"accent","gain":0.8,"play":true}` | 1 | no | Audio-role nodes only. `layer` ∈ bed · melody · perc · accent; `loop` defaults to true for bed. The engine sends `accent` to every online audio node on a presence onset. |
| `wingbeat/global/scene` | browser → all nodes | `{"scene":"crane_ghana","fade_ms":2500,"led":{"r":60,"g":200,"b":130}}` | 1 | yes | Retained, so a freshly booted node syncs to the current pack. `led` is the pack tint for firmware that wants to react without a table. |
| `wingbeat/global/cmd/all` | browser → all nodes | `{"action":"calibrate"}` | 1 | no | `action` ∈ reset (ESP.restart) · calibrate (feather nodes: re-zero the IMU + wind baseline) · rainbow (feather nodes: test pattern) · silence (audio nodes: stop playback). |

LED modes: `off` · `solid` · `pulse` · `shimmer` · `wind` · `rainbow`. Global actions: `reset` · `calibrate` · `rainbow` · `silence`.

## Subscriptions

- **Browser (engine, `MqttTransport`)**: `wingbeat/node/+/sensor/+` (QoS 0),
  `wingbeat/node/+/status` (QoS 1), and `wingbeat/node/+/cmd/led` (QoS 0) so it
  can see the router's stream and yield per node.
- **Browser (lights, `LedLink`)**: `wingbeat/node/+/status` (discovery) and
  `wingbeat/node/+/cmd/led` (the output monitor shows what is truly on the wire).
- **Feather node**: its own `cmd/led`, `global/scene`, `global/cmd/all`.
- **Audio node**: its own `cmd/audio`, `global/scene`, `global/cmd/all`.

## Two LED pipelines, one topic

The engine publishes event-driven modes (`shimmer` on a melody, `wind` on a gust,
`pulse` at rest) at QoS 1. The light router streams `solid` colours from the
music or the sensors at QoS 0. Both tag their packets with `src`; the engine
side yields to a router stream that has spoken for a node in the last 3.5 s and
re-asserts its colour when the stream stops. Blackout wins over everything and
is sent as `off` by whoever holds it.

## Example flow

```
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
```
