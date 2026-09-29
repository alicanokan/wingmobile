# Wing Beat — Engine

Wing Beat invites a visitor to hold a feather lightly between thumb and index
finger, notice the weight of the air, and turn a small gesture into movement,
colour and sound. The artistic direction is for feathers to become vessels for
music and cultures from different continents. The six bundled scenes currently
remain internal sound studies; their authorship records do not claim cultural
provenance.

## Run and verify

```sh
npm ci
npm run dev
npm run check
npm run check:mqtt
```

Open the printed local address. `check` runs TypeScript, the regression suite
and a production build. `check:mqtt` compares the adjacent system's MQTT topic
document with the shared wire contract without changing files. Vercel now uses
`npm run check` as its build command. The repository workflow also checks MQTT
documentation; it takes effect when committed and pushed.

## Visitor and operator entry points

| Route | Purpose |
| --- | --- |
| `/` | Visitor invitation, Hold / Feel / Listen onboarding, cultural philosophy |
| `/test.html` | 44-feather sound atlas with five audio layers, local uploads, visual response editing and master BPM |
| `/experience` | Living feather with Play pads, sound, paired phones, MQTT and lighting |
| `/?mode=control` | Full installation console, source routing, mixer and network settings |
| `/?mode=performance` | Start / Hold / Settle / Stop performance controls |
| `/?mode=mobile` | Compact console experience on a phone |
| `/controller` | Paired phone touch, motion, microphone and camera controller |
| `/cam` | Same paired controller, with camera guidance; no development relay required |
| `/feather2` | Feather Studio: photo anatomy, look, response, sound and lighting authoring |
| `/feather` | Classic display receiving local console broadcasts |
| `/conductor` | Shared presets, samples and live configuration |

A phone and host use the Device ID and Code shown by Control. Five channels
can accept multiple phones. Both host surfaces merge participants independently:
one person releasing does not cancel another. The host chooses Play only,
Play + FX or Everything. Camera images stay on the phone; motion values travel
through the paired connection.

## Feather sound lab

Open `/test.html` to audition 44 proposed feather/music pairings across seven
geographies. Every study has five independently analysed layers, with Solo,
Mute and volume controls. Each layer accepts a local audio file; replacement
keeps its response settings. Open the arrow to choose a feather part, movement,
sensitivity, amount and speed. Master BPM sets the selection's tempo, and each
uploaded clip has an editable source BPM. Tempo changes speed and pitch.

Uploads and edits remain in the current tab until reload. WAV exports four bars
of the current mix. These are original synthesized studies and artistic pairings,
not verified bird origins or traditional recordings. `/testfeather.html` remains
an alias. Export the complete pairing report with
`node --experimental-strip-types scripts/export-sound-atlas.ts <output-folder>`;
add `--audio` for twelve listening examples.

## How the engine works

```text
ESP sensors / phones / keyboard / touch / mic / camera
                    ↓ normalized readings
          InputState + WingbeatEngine
                    ↓
         EncounterModel: load, gesture, memory, recovery
                    ↓ shared expressive state
      living feather + classic projection + sound + lights
```

The current room layout has **five sensor channels and one held-feather prop**.
The core combines sources per node, retains presence per node, expires missing
input after eight seconds and restores a node on its next valid reading. Wind
and motion expire independently; a motion packet cannot keep an old wind level
alive. Source disconnection releases its contribution.

The encounter is deterministic: thresholds and recent gestures control the
phases, residue, weaker recall and anticipation. It is not machine learning.
The living feather now consumes that same state when embedded in Experience,
and analyzes the host audio mix. In standalone Studio its own encounter also
contributes to deformation. Root movement stays bounded while the vane and
fringe carry the larger response.

Audio has drone, wind, melody, percussion and accent buses, plus a synchronized
loop per sensor. Tempo changes playback speed, including pitch. Mixer faders,
mutes and master level precede output. Audio startup has a bounded wait and
visible retry feedback if the browser does not grant playback.

## Four speakers

Connect a compatible audio interface before opening the page. Start audio, then
choose **Mix → Speaker output → Four speakers** in Experience, or the same
output selector in console Settings. Order:

1. Front left
2. Front right
3. Back left
4. Back right

Stereo is the default on every page load. Selecting four speakers requires a
browser destination exposing at least four channels. If unavailable, stereo
stays active and the operator sees an explanation. The quad path routes sensor
loops and the wind/trigger buses with room-position weights and preserves four
channels through filtering, delay and reverb. It is bus spatialization: voices
sharing a trigger bus follow that bus's latest position.

With the development server running, open `/tests/browser/audio-output.html`
and run the offline render check. It verifies four independent channels without
playing sound. Physical socket order and speaker levels still require a venue
test with the chosen interface, OS and browser.

## Physical installation

In Experience, open **Control → Hardware + phones**, set the broker WebSocket
address and open **Lights** to configure fixtures. The full console retains its
hardware transport controls. HTTPS pages require a secure `wss://` broker;
`ws://` is for an appropriate local development setup.

The MQTT bridge receives sensor/status messages and sends scene, LED and
accent commands. Lighting arbitration prevents the engine and streaming router
from fighting over a node. Engine LED state renews every two seconds, before
the firmware's 3.5-second timeout. Blackout remains authoritative.

See [the venue guide](docs/VENUE_KIT.md) and
[installation readiness](docs/INSTALLATION_READINESS.md) for rehearsal steps.
A single intended host should own the sound and hardware output. Cloud preset
sync distributes configuration and samples; it does not stream live sensor
input between computers. Public PeerJS/TURN availability still affects phones;
use configured venue services for a dependable show.


## Runtime media in version control

The feather photographs and thumbnails in `public/feathers`, the fifty WAV
loops in `public/music-tests`, and `public/creative-assets/feather-motion.mp4`
are required runtime assets. The app ignore rules explicitly include them
despite the parent repository excluding other media. Keep these files in
Git so a clean checkout passes the asset tests and produces a complete site.
