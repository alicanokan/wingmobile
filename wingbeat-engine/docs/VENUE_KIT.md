# Wingbeat — Venue Kit

What to run on the console laptop so the show does not depend on anyone
else's servers. Every item here has a free-cloud fallback that the app uses
automatically when the item is absent — the kit replaces single points of
failure, it does not add new ones.

| Need | Free default (works, but not yours) | Venue kit (yours) |
|---|---|---|
| ESP nodes ↔ browser | — (there is no cloud MQTT; a broker is always local) | **Mosquitto** on the laptop, WebSocket listener on 9001 |
| Phones ↔ console signalling | PeerJS cloud (`0.peerjs.com`) | **PeerJS server** on the laptop |
| Phones on cellular / guest wifi | openrelay.metered.ca (public TURN) | **coturn**, or any TURN you pay for |
| Presets, samples, live push | Supabase project `ralyyojiwvnsqdnxkfwb` | (stays in the cloud; devices cache samples locally and keep playing offline) |

## 1 · MQTT broker (required for hardware)

`wingbeat-system/broker/mosquitto.conf` already defines the two listeners.

```
brew install mosquitto            # or apt install mosquitto
mosquitto -c wingbeat-system/broker/mosquitto.conf -v
```

- Console (`/`, hardware mode) → MQTT URL `ws://<laptop-ip>:9001`.
- Lights (`/conductor` → Light Engine, or `/feather2` with Auto-connect) → same URL.
- ESP firmware `config.h` → `MQTT_HOST` = the laptop's LAN IP, port 1883.

Give the laptop a **static LAN IP** (or a DHCP reservation) so the nodes'
`config.h` never goes stale between rehearsals.

## 2 · PeerJS signalling server (recommended)

Phones find the console through a signalling server; the data itself flows
peer-to-peer. With the free cloud, a cloud outage or a venue firewall that
blocks `0.peerjs.com` silently kills every phone.

```
npx peer --port 9000 --path /wb --key wingbeat
```

Tell the app about it — either at build time (`.env.local` before
`npm run build` / deploy):

```
VITE_PEER_HOST=192.168.1.10
VITE_PEER_PORT=9000
VITE_PEER_PATH=/wb
VITE_PEER_SECURE=false
VITE_PEER_KEY=wingbeat
```

…or at runtime on the console: Settings → **Network** (stored in
`wb.net.v1`). **Phones must use the same values.** Runtime settings live
only in the browser that set them, so for phones use the env route (a build
that bakes the venue's server in), or serve the app itself from the laptop:

```
npm run build && npx serve -s dist -l 5199
```

and point the phones' QR links at `http://<laptop-ip>:5199/controller`.

> Browsers require a secure context for the camera, motion sensors and Web
> MIDI. A plain `http://<ip>` page on a phone can still drive the **motion
> pad** (touch), but device-motion needs HTTPS. If that matters, put the
> laptop behind `mkcert` + any static HTTPS server, or keep using wingbeat.art
> for the phones and only self-host the signalling server (`VITE_PEER_SECURE`
> must then be `true` with a valid cert on the PeerJS server).

## 3 · TURN (only if phones are not on the venue LAN)

On the same wifi as the console, phones connect directly; STUN is enough.
TURN matters when phones are on cellular or an AP-isolated guest network.
The public relay is rate-limited and shared with the world.

```
VITE_TURN_URLS=turn:turn.yourhost.com:3478,turn:turn.yourhost.com:443?transport=tcp
VITE_TURN_USER=wingbeat
VITE_TURN_CRED=<secret>
```

(`coturn` with a static user works; Twilio/Metered paid tiers also work.)

## 4 · Cloud (Supabase)

- **Conductor secret** — paste it once into the `/conductor` header on the
  conducting laptop (`wb.conductorSecret.v1`). Without it every write fails
  with a clear message; reads and live-follow never need it.
- Devices cache every sample in IndexedDB (250 MB LRU) the first time they
  see it. Run the full show once with internet **before** doors — after that
  the venue's internet can drop and every device keeps playing.
- The live row is re-read whenever a device comes back online or its tab
  becomes visible, so a push made while a display was asleep is caught up.

## 5 · Lights

- `/conductor` → Light Engine: **Auto-connect** on, URL set, then open
  `/feather2` on the machine that should stream music-driven colour.
- Fixtures default to **Elements** (driven by `/feather2`). Set a fixture to
  **Sensor** to have the console drive it from its node's own wind/motion, or
  **Engine** to hand it back to the event-driven shimmer/wind/pulse.
- **Blackout** is global (both pipelines, every node). **Identify** flashes
  one strip white so it can be found on the rig.
- ESP firmware ≥ 0.2.0: `{"action":"calibrate"}` on `wingbeat/global/cmd/all`
  re-zeroes a node after it was re-hung; `brightness` (0..1) in a `cmd/led`
  caps a strip that is too hot for its spot.

## 6 · Pre-show checklist

1. Laptop on mains, sleep disabled, static IP, broker running.
2. Console open in **hardware** mode, green dot on every node in the room map.
3. `Start audio` pressed (browser autoplay), master at the desk level.
4. Secret pasted on `/conductor`; one test push; displays show the change.
5. Phones paired (rooms persist across console reloads now — re-pair only if
   the Device ID/Code on screen changed).
6. Light Engine connected; **Identify** each strip once; fixtures patched.
7. Walk the room with internet **off** for two minutes. Nothing should stop.
