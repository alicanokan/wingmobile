# Wingbeat — Venue Kit

How to configure venue services and rehearse the installation. Defaults use
public phone signalling and TURN; MQTT needs a configured broker. Selecting a
venue endpoint does not automatically fail over to the public service.

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

- Experience (`/experience` → Control → Hardware + phones), or console (`/?mode=control`, hardware mode) → MQTT URL `ws://<laptop-ip>:9001`.
- Lights (`/conductor` → Light Engine, or `/feather2` with Auto-connect) → same URL.
- ESP firmware `config.h` → `MQTT_HOST` = the laptop's LAN IP, port 1883.

For a page served over HTTPS, the broker must expose `wss://` with a valid
certificate. Plain `ws://` is suitable for a local HTTP development setup.

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

On a LAN that permits device-to-device traffic, phones can often connect directly. Guest Wi-Fi and client isolation can still require TURN.
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

## 7 · September 2026 checks

- Landing → Begin here → Hold / Feel / Listen → I’m ready opens Experience.
- Start audio, hold a Play pad, release it, and hear/see the response settle.
- Test each physical input, unplug it mid-gesture, wait beyond eight seconds,
  then reconnect. Its stuck input should clear and fresh samples restore it.
- Pair two phones to the same channel. Release one while the other holds.
- Put a phone to sleep, restore it, and verify reconnect plus fresh input.
- For camera mode, use the channel’s Camera link and tap Use camera. Test on
  the real HTTPS phone browser; only motion readings are transmitted.
- For quad sound, choose Four speakers after connecting the audio interface.
  Verify sockets 1/2/3/4 are front-left/front-right/back-left/back-right and
  calibrate room levels. Stereo remains the default after a reload.
- Hold an engine-owned light state for more than 3.5 seconds. It must remain
  renewed; test router takeover, hand-back and blackout.
- Run `npm run check` and `npm run check:mqtt` before deployment. Rehearse again
  against the deployed build; local verification does not update wingbeat.art.
