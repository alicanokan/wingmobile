# Wing BEat — Interactive Sound + Light Installation

Forest-distributed installation where feathers become instruments. Each tree
zone has a small ESP8266 node sensing breath, motion, and presence; a central
Mac mini runs an MQTT broker, a browser UI rendering animated feather
line-art, and a layered Tone.js soundscape that swells, blooms, and dissolves
in response to participants. Optional ESP8266 audio nodes drive local
speakers via I2S.

Concept brief: see `docs/architecture.md` and the source PDFs in the project
Drive folder.

## Repository layout

```
wingbeat-system/
├── README.md                  ← you are here
├── docs/
│   ├── architecture.md        ← system overview + diagram
│   └── mqtt-topics.md         ← message schema
├── broker/
│   ├── docker-compose.yml     ← Mosquitto with MQTT + WebSocket listeners
│   └── mosquitto/mosquitto.conf
├── firmware/
│   ├── feather_node/          ← sensor + WS2812 LED firmware (ESP8266)
│   │   ├── feather_node.ino
│   │   └── config.h
│   └── audio_node/            ← I2S DAC audio firmware (ESP8266)
│       ├── audio_node.ino
│       ├── config.h
│       └── data/              ← .mp3 layer files (uploaded via LittleFS plugin)
└── web/
    ├── index.html             ← browser UI
    ├── style.css
    └── app.js                 ← MQTT.js + Tone.js + animated SVG feathers
```

## Quick start

### 1. Start the broker

You need Docker on the central machine (Mac mini, your laptop, whatever).

```bash
cd wingbeat-system/broker
docker compose up -d
docker compose logs -f mosquitto    # check it's up
```

The broker listens on `1883` (for ESPs) and `9001` (for the browser UI over
WebSockets). Both bind to `0.0.0.0` so they're reachable on your install LAN.

Find the host's LAN IP — that's what goes into each ESP's `config.h` as
`MQTT_HOST`.

### 2. Set up the WiFi the install will use

The simplest forest setup: put a travel router or a phone hotspot on a
power bank, name the SSID `WingBeat`, give it a sensible password, and let
all the ESPs and the Mac mini join it. The `config.h` defaults match.

If your venue has its own WiFi, edit `WIFI_SSID` / `WIFI_PASS` in the
firmware configs.

### 3. Flash the feather sensor/LED nodes

For each ESP8266 sensor node:

1. Open `firmware/feather_node/feather_node.ino` in Arduino IDE.
2. Edit `config.h` — change `NODE_ID` to a unique string (`feather_01`,
   `feather_02`, …), change `MQTT_HOST` to your broker IP.
3. Install libraries (Library Manager): `PubSubClient`, `ArduinoJson`,
   `Adafruit NeoPixel`, `MPU6050_light`.
4. Board: NodeMCU 1.0 (ESP-12E) or LOLIN(WEMOS) D1 mini.
5. Upload.

#### Wiring (NodeMCU pinout)

```
                ┌────────────────┐
                │   NodeMCU      │
                │                │
   3V3   ──────►│ 3V3            │
   GND   ──────►│ GND            │
                │                │
   MIC OUT ────►│ A0   (analog wind/breath input, 0..1V)
                │                │
   PIR signal ─►│ D5  (GPIO14)   │
                │                │
   MPU6050 SDA►│ D2  (GPIO4)    │  (I2C SDA)
   MPU6050 SCL►│ D1  (GPIO5)    │  (I2C SCL)
                │                │
   WS2812 DIN ◄│ D8  (GPIO15)   │  (NeoPixel data — 5V level shift recommended)
                └────────────────┘
```

Notes:
- ESP8266 A0 reads 0–1V; an electret breakout typically outputs 0–3.3V, so
  use a divider (e.g., 22 kΩ + 10 kΩ to ground) or a breakout with a built-in
  divider.
- MPU6050 modules are 3.3V tolerant — connect VCC to 3V3.
- WS2812 wants 5V data ideally. A 74AHCT125 level shifter is cheap insurance,
  especially for >8 pixels.
- PIR modules ("HC-SR501") have an onboard regulator and run from 5V; their
  output is 3.3V-friendly.

### 4. Flash the audio nodes (optional)

For each ESP8266 with an I2S DAC:

1. Open `firmware/audio_node/audio_node.ino`.
2. Edit `config.h` — set `NODE_ID = "audio_01"` (or `_02`…), set MQTT host.
3. Install libs: `PubSubClient`, `ArduinoJson`, `ESP8266Audio`.
4. **Install the LittleFS uploader plugin**:
   <https://github.com/earlephilhower/arduino-esp8266littlefs-plugin>
5. Drop your audio layer files into `firmware/audio_node/data/` named
   `bed.mp3`, `melody.mp3`, `perc.mp3`, `accent.mp3`. Mono, 96 kbps, total
   under ~900 KB.
6. Run `Tools → ESP8266 LittleFS Data Upload` to flash the audio.
7. Then upload the sketch.

#### Audio node wiring (PCM5102 board)

```
ESP8266 (NodeMCU)        PCM5102
  GND      ────────►  GND
  3V3 / 5V ────────►  VIN
  GPIO15 (D8) ─────►  BCK
  GPIO2  (D4) ─────►  LCK
  GPIO3  (RX) ─────►  DIN
  GND       ──────►  SCK     (tie low — PCM5102 internal PLL)
                      FMT, XSMT  → see PCM5102 datasheet (typical: tied appropriately)
```

> Heads up: GPIO3 is the serial RX pin. After upload, audio uses RX, so you
> won't be able to receive serial input. Serial output (TX) still works for
> debug logs.

### 5. Open the web UI

The simplest way is to serve the `web/` folder over HTTP. From the project
root:

```bash
cd web
python3 -m http.server 8080
```

Then open <http://localhost:8080> on the Mac mini. Click **Start audio**
(browser audio policy requires a user gesture — Tone.js will refuse to
start without it).

If your install runs unattended, set the Mac mini to autoboot the browser
fullscreen onto that URL — Chrome's `--kiosk --autoplay-policy=no-user-gesture-required`
is the usual trick (set the flag in the launch command, not the global
preferences).

### 6. Test without hardware

If you want to demo the browser UI before flashing anything:

1. Open the operator panel (top-right "Operator" button).
2. Click **Spawn test feather** — a synthetic node appears, generating fake
   wind/motion/presence streams. You'll see a feather appear on the canvas
   and hear the soundscape come alive.
3. Spawn 3–5 of them and try switching scenes.

## Operating the install

- **Start audio** — required once per browser session (audio policy).
- **Scene chips** — switch the cultural sound + visual palette globally.
  The change is published as a retained MQTT message so newly-connecting
  nodes pick up the current scene immediately.
- **Operator panel**:
  - Master gain — global UI sound output.
  - Wind sensitivity — multiplier on incoming wind values; useful when
    sensors read low because participants are tentative.
  - Rainbow burst — fun moment for crowd photos.
  - Silence audio nodes — emergency mute for the I2S nodes.
  - Reset all — sends `wingbeat/global/cmd/all {action:"reset"}`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser says "broker offline" | Mosquitto container not running, or port 9001 blocked by firewall. `docker compose logs mosquitto` |
| Feathers appear but soundscape silent | Forgot to click **Start audio** — browsers block audio until user gesture |
| ESP boots but never connects to MQTT | Wrong `MQTT_HOST` IP, or the host has WiFi isolation enabled (most home routers, "Client isolation"); use a dedicated install router |
| LEDs flicker / first pixel wrong colour | Power injection on long strips, or no level shifter — bring 5V data or move data line closer to the strip |
| Audio node plays but glitchy | LittleFS read is slower than expected; try lower-bitrate mp3, or use shorter files |

## Extending

- **Biotron / plant signals** — write a small Python script that reads your
  plant electrode AD converter and publishes to
  `wingbeat/node/plant_01/sensor/wind` (or `motion`). The browser UI will
  spawn a "plant_01" feather automatically.
- **More scenes** — add to the `SCENES` object in `web/app.js`. Each scene is
  ~15 lines: notes, scale, color palette, tempo.
- **Projection mapping** — point a projector at a wall, fullscreen the
  browser, hide the topbar by editing CSS. The SVG canvas scales cleanly.
