# Wing BEat — MQTT Topic Schema

All payloads are JSON unless noted. All numeric ranges are `0.0..1.0` unless
the field name says otherwise.

## Identity

Every node has a string `node_id` set in its `config.h`. Recommended naming:
`feather_01`, `feather_02`, …, `audio_01`. Any tree/zone you want addressable
should have its own id.

## Topics published BY nodes

| Topic | Payload | Notes |
|---|---|---|
| `wingbeat/node/<id>/status` | `{"online":true,"role":"feather","fw":"0.1.0","rssi":-62}` | Retained. Last-will publishes `{"online":false}` so the UI can flag dead nodes. |
| `wingbeat/node/<id>/sensor/wind` | `{"v":0.42,"raw":612,"ts":12345678}` | Smoothed breath/wind intensity. Sent at ~20 Hz when changing, otherwise at 1 Hz. |
| `wingbeat/node/<id>/sensor/motion` | `{"ax":0.02,"ay":-0.11,"az":0.97,"mag":0.14,"ts":...}` | Accelerometer in g. `mag` is high-pass-filtered shake magnitude. Sent at ~10 Hz when above noise floor. |
| `wingbeat/node/<id>/sensor/presence` | `{"present":true,"distance_cm":120,"ts":...}` | Edge-triggered (only on change), retained. |

## Topics subscribed BY nodes

| Topic | Payload | Notes |
|---|---|---|
| `wingbeat/node/<id>/cmd/led` | `{"mode":"solid","r":120,"g":40,"b":200,"intensity":0.8}` | `mode` ∈ `solid`, `pulse`, `shimmer`, `wind`, `off`. Feather nodes only. |
| `wingbeat/node/<id>/cmd/audio` | `{"layer":"bed","gain":0.6,"play":true}` | Audio nodes only. `layer` ∈ `bed`, `melody`, `perc`, `accent`. |
| `wingbeat/global/scene` | `{"scene":"crane_ghana","fade_ms":2500}` | All nodes. Retained. Triggers per-role behavior change. |
| `wingbeat/global/cmd/all` | `{"action":"reset" \| "calibrate" \| "rainbow"}` | Maintenance. |

## Topics published / subscribed by the BROWSER

The browser subscribes to **all** `wingbeat/node/+/sensor/+` and
`wingbeat/node/+/status` so it can reactively render every feather and play
sound layers driven by every zone.

It publishes:
- `wingbeat/node/<id>/cmd/led` (back to whichever node triggered the sound,
  to mirror the soundscape on the LED feather)
- `wingbeat/global/scene` (when operator changes cultural pack)
- `wingbeat/global/cmd/all` (operator panel buttons)

## QoS / retain conventions

- `status` and `global/scene`: QoS 1, retain=true (so a freshly-booted node
  or a freshly-loaded browser sees the last known state).
- Sensor topics: QoS 0, retain=false (high rate, freshness > delivery).
- Cmd topics: QoS 1, retain=false (don't want stale commands replayed on
  reconnect).

## Example flow

```
[feather_03 boots]
→ pub wingbeat/node/feather_03/status {"online":true,"role":"feather", ...}

[someone walks up]
→ pub wingbeat/node/feather_03/sensor/presence {"present":true,"distance_cm":85}

[browser receives presence, picks scene "crane_ghana", schedules drone]
→ pub wingbeat/node/feather_03/cmd/led {"mode":"shimmer","r":40,"g":180,"b":120,"intensity":0.5}

[participant exhales toward the feather]
→ pub wingbeat/node/feather_03/sensor/wind {"v":0.81,"raw":880}

[browser swells a melodic layer + brightens the LED feather]
→ pub wingbeat/node/feather_03/cmd/led {"mode":"wind","r":40,"g":220,"b":160,"intensity":0.95}
```
