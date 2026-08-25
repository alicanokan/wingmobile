# Wingbeat Solidity Audit — missing links & hardening plan

> **How to use this file:** like `WINGBEAT_ENGINE.md` — read, mark ✅ / ❌ / notes
> inline, hand back to Claude to fix. Generated 2026-08-16 by four parallel
> subsystem audits (engine core + audio · UI/state · networking/sync · LED/ESP
> hardware) over `wingbeat-engine/src` + `wingbeat-system` firmware.
> Baseline: `tsc --noEmit` passes clean. ~60 unique high-severity findings.

---

## Changelog — 2026-08-16, quick wins applied (typecheck + build clean)

- ✅ **#3 patterns**: `patternsOn` now defaults **true**; new `∿ Patterns` toggle
  on the console Audio rail. `WingbeatEngine.ts:253`, `App.tsx` rail.
- ✅ **#5 hardware-mode controls**: Inputs rail no longer gated to sim (only
  Auto-demo stays sim-only); QWERT keys work under any transport (F/Space
  feather-in-hand stays sim-only — hardware has the real prop).
- ✅ **#6 staleness**: `MqttTransport` now runs the same 2 s `tickStaleness()`
  sweep as sim; dead nodes go grey on hardware too.
- ✅ **#9 auto-route destroyer**: control-mode trigger removed (opening the
  Controllers panel no longer touches routing); fullscreen autopilot keeps it
  but no longer persists it or mutates state inside the updater.
- ✅ **#7 blackout (engine half)**: `allOff()` now latches `blackout` instead of
  resync-resuming next frame; LED config/fixtures sync across pages via
  `storage` events (conductor edits now reach the streaming page); new
  **Auto-connect** checkbox in the Light Engine panel. Firmware motion-flash
  bypass still open.
- ✅ **#1 (operator path)**: `ledService.push()` honours `autoConnect`, so
  `/feather2` can reach the broker. Single-owner arbitration (decision Q1)
  still to design.
- ✅ **NaN-bpm kill switch**: phone `bpm` is validated, clamped 40–220 and
  written through to `rig.global.bpm` (no more snap-back on layer rebuild).
- ✅ **Console state persists**: `wb.console.v1` keeps mode/mqttUrl/master/
  windSens across reloads (inputs.ts validation pattern).
- ✅ **Error boundary** on every route (`ErrorBoundary.tsx`) + **exact-match
  routing with a 404 page** — a typo'd URL no longer renders the operator
  console to the audience.
- ✅ **Emitter isolation**: one throwing bus subscriber can no longer silence
  the rest or crash the ingest path.
- ❌ **REFUTED — "default LED mode publishes near-black"** (was show-stopper
  #2): verified `hsv()` already returns 0..255 via `to255` and line 155
  re-normalizes consistently. Harmless round-trip, not a bug. The real trap
  remains: `NodeState.hue` is integer degrees and would wrap to red if fed to
  the router unconverted — fix at the boundary when wiring `sensors` (Phase 1).
- 🔴 **RLS confirmed wide open**: policies on all three `wingbeat_*` tables are
  `USING (true) WITH CHECK (true)` for `public` on ALL commands, and the
  storage bucket allows public INSERT/UPDATE/DELETE. Fix (secret-gated RPCs +
  read-only public) must land together with a client change + redeploy.

## Changelog — 2026-08-17, cloud write lockdown (stage 1 of 2)

- ✅ **DB**: migration `wingbeat_secret_gated_writes` applied to the live
  project — private `wingbeat_config` table (RLS, zero policies, API roles
  revoked) holding the conductor secret, plus SECURITY DEFINER RPCs
  `wingbeat_push_live / save_preset / delete_preset / register_sample /
  delete_sample`, each checking the secret and stamping `updated_at`
  **server-side** (also fixes the client-clock ordering problem). Verified:
  wrong secret → error 28000; save→upsert→delete round-trip clean.
- ✅ **Latent bug fixed**: `wingbeat_presets` never had the `(feather, name)`
  unique constraint the client's upsert requires — cloud preset saves over an
  existing name were erroring. Deduped and added.
- ✅ **Client**: `cloud.ts` write paths now call the RPCs;
  `getConductorSecret`/`setConductorSecret` (localStorage
  `wb.conductorSecret.v1`); friendly error when the secret is missing.
  `/conductor` header has a secret field next to Live mode. Also fixed the
  dead `skipFirstLivePush` guard (enabling Live mode no longer instantly
  broadcasts the on-screen config).
- ✅ **Stage 2 — the flip (done 2026-08-22, see changelog below).**

---

## Changelog — 2026-08-22, deployed + locked down (takeover hole CLOSED)

- ✅ **Deployed**: commit `6a3cdf4` (all quick wins + RLS stage 1) pushed to
  `main` and shipped to wingbeat.art via `vercel deploy --prod`
  (`dpl_FsQq7NUPkdH5KstwkJkwu1tZ8wse`, bundle `index-EEUlIDdw.js`).
- ✅ **DB flipped**: migration `wingbeat_lockdown_public_writes` applied to
  `ralyyojiwvnsqdnxkfwb` (= `supabase/lockdown_after_deploy.sql`). Public role
  is now SELECT-only on `wingbeat_live / presets / samples`; storage bucket
  keeps read + insert, lost update + delete.
- ✅ **Verified against the live API with the public key**: anon read 200;
  anon UPDATE live → 0 rows (row untouched); anon INSERT preset → 401 RLS
  violation; anon DELETE samples → 0 rows; RPC with wrong secret → 403
  `bad conductor secret`; RPC with the real secret → save/list/delete
  round-trip clean. Show-stopper #13 is closed.
- ⚠️ **Operator step**: paste the conductor secret into the `/conductor`
  header field on the conducting laptop (kept in `wb.conductorSecret.v1`).
  Without it, Push live / preset save / sample upload fail with a clear
  message — by design.

## Changelog — 2026-08-22 (later), Phase 1 "un-dead the show path"

Typecheck + build clean; router/arbiter logic covered by a headless Node test
(15 assertions, all pass).

- ✅ **LED arbitration (decision Q1 — keep both pipelines)**. Every `cmd/led`
  payload now carries `src: engine | router | identify` (firmware ignores the
  extra key). `ledService` implements a `LedArbiter`; `MqttTransport` takes it
  (`new MqttTransport({ url, led: ledService })`) and asks `engineMayDrive(id)`
  before every event-driven publish. Rule per node: blackout → only `off`;
  identify flash wins; fixture source `engine` (new) or no fixture → engine;
  a router stream seen on the wire in the last 3.5 s → router; otherwise →
  engine. Liveness is measured on the broker, so it works across tabs. When a
  stream stops or blackout lifts the transport **re-asserts** the engine's
  last colour (1 s sweep), so a strip never freezes on the router's last
  frame. Blackout now also sends `off` to every engine node, not just
  patched fixtures.
- ✅ **Two routers, one fixture list, no fight**. `LedRouter.resolve` returns
  `null` (skip — no packet, no heartbeat) for fixtures whose inputs this
  page didn't supply: the console carries `sensors` + `sceneLed`, `/feather2`
  carries `elements` + `parts`. Before, `/feather2` published every `sensor`
  fixture black every 2 s.
- ✅ **Sensor-driven strips finally lit**: the console feeds
  `ledService.push({ sensors, sceneLed })` at 25 Hz (hue degrees → 0..1 at
  the boundary). "Sensor" fixtures and "Elements · scene" hues had no data
  source until now. `Engine` added to the fixture Source dropdown.
- ✅ **Audio lifecycle**: `init()` is single-flight (shared promise; a click
  racing a conductor push no longer builds two graphs); `start()`/`stop()`
  are real (bed released, loops gated, master faded, **context suspended** —
  the Stop button used to only flip its label); `dispose()` tears the graph
  down (used by `/feather` on unmount); scene `fadeMs` shapes the bed's
  attack/release (a scene change is a crossfade, `0` is a cut).
- ✅ **Tempo is real**: `setBpm` sets every loop's `playbackRate` relative to
  `LOOP_NATIVE_BPM = 120` (the rig default, so untouched presets sound
  identical) and keeps the phase-alignment maths correct at any rate. The
  Tempo slider, phone tempo and conductor pushes now audibly stretch the
  loops (tape-style). Per-sample authored tempo → preset v2.
- ✅ **`/feather` is audio-reactive** without audio: the console broadcasts
  `audio.snapshotLevels()` (master + per-loop full/low/mid/high) in its 25 Hz
  sync state; the display's `AudioEngine.setRemoteLevels()` makes
  `getLevel/getLoopLevel/getLoopBand/hasLoop` read the mirror (stale after
  1.5 s, so a dead console doesn't freeze the feather loud). One machine,
  one set of speakers, no doubled audio.
- ✅ **Phones survive the night**: console rooms (Device ID + Code) persist in
  `wb.devices.v1` and are re-claimed on reload (fallback to a fresh room only
  on `unavailable-id`, written back via `onIdentity`); host handles
  `disconnected` → `reconnect()`; phone re-dials on close/error with
  backoff + jitter (cap 60, reset on every open) and reconnects signalling.
- ✅ **Audio ESP nodes reachable**: `accent` now goes to every online node with
  role `audio` (the old gate compared the triggering sensor's role).
- ✅ **Firmware** (`wingbeat-system/firmware/feather_node/feather_node.ino`,
  needs a reflash): the motion flash no longer punches white pixels through
  `OFF`.
- ✅ **Engine**: `setScene` rejects unknown keys (the `getScene` fallback made
  the old guard unfalsifiable).
- ✅ **Live sync honesty (#12, partial)**: sample downloads abort after 20 s
  instead of blocking the remaining loops; the realtime channel reports
  `subscribing / live / error / closed` and re-reads the live row on every
  (re)subscribe so a push missed while offline is caught up. A UI indicator
  for the channel state is still to do.

## Changelog — 2026-08-22 (evening), Phases 2–4 shipped

Typecheck, **38 Vitest tests**, production build and the MQTT-doc drift check
all clean — and now enforced by CI on every push
(`.github/workflows/wingbeat-engine.yml`).

**Phase 2 — state solidity**
- ✅ `rig` is an observable store (`onRigChange` / `notifyRigChange`,
  `useRigTick()`); the four `setTick` hacks are gone, every panel re-renders on
  any rig change. `loadIntoRig` validates (`validatePreset`: every number
  clamped, every missing field defaulted — never throws).
- ✅ **Preset v2** (`presets.ts`): a bundle of rig + scene + input routing +
  mixer + cloud `SampleRef`s; v1 entries and files migrate on read; confirm
  before overwrite / delete; recall re-applies routing, mixer, scene and
  re-installs the loops (audio travels with the preset at last).
- ✅ Persisted with validators: mixer/voices/loop faders (`wb.mixer.v1`, via
  `new AudioEngine({ persist })` — preview engines don't persist), mic and
  camera calibration (`wb.mic.v1` / `wb.cam.v1`, setters save), routing
  already (`validateRouting` factored out). Shared helper `sim/persisted.ts`.
- ✅ Single sources of truth: scene writes through to `featherScenes` from
  phones and conductor pushes (pushes set the feather's scene *before* the
  feather switch, which is why remote scenes used to revert); BPM lives in
  `rig.global.bpm` on every page (`/experience` fixed); the procedural
  feather recalls and autosaves its own rig (it used to write into the
  previous image feather's slot); fullscreen swipe reads the current
  next/prev through refs; `MicSource.active` can no longer claim a mic that
  permission denied.

**Phase 3 — network resilience**
- ✅ `liveSync`: strictly-newer `updated_at` (server-stamped); configs
  validated (`validateConductorConfig`, schema `v` + `origin` client id);
  loop installs are generation-guarded (a newer push cancels the older one)
  and download in parallel; re-read on `online` / `visibilitychange`; the
  console shows a `☁ live / error / closed` chip (stopper #12 closed).
- ✅ `cloud.ts`: one in-flight download per sample; `text/html` responses
  rejected (captive portals), length verified against `size_bytes`, 20 s
  timeout. `sampleCache` v2: meta store, 250 MB LRU cap, quota errors surfaced
  (`cacheLastError`).
- ✅ Runtime validation + version on everything that crosses a boundary:
  `parseControl` (phone → console), `parseSyncMsg` (console → display),
  `validateConductorConfig` (cloud), `parseLedCmd` / `parseStatus` (MQTT).
- ✅ Configurable PeerJS signalling + STUN/TURN (Vite env or Settings →
  Network, `wb.net.v1`); free cloud stays the fallback; `docs/VENUE_KIT.md`
  documents the laptop kit (Mosquitto, PeerJS server, TURN, pre-show list).

**Phase 4 — keep it solid**
- ✅ **Wire contract** `src/protocol/wire.ts`: topic builders, parsers,
  vocabulary, QoS table, doc entries; `MqttTransport` and `LedLink` import
  it; `npm run docs:mqtt` regenerates `wingbeat-system/docs/mqtt-topics.md`
  (CI fails on drift).
- ✅ **Firmware 0.2.0** (`feather_node.ino`, reflash): `brightness` over
  MQTT, `calibrate` action, retained presence cleared on every connect, gamma
  on SOLID, motion flash never through OFF.
- ✅ **Tests** (Vitest, Node env, no DOM): LedRouter ownership + gates,
  LED arbiter, engine thresholds/cooldowns/staleness/scene guard/listener
  isolation, preset validation + v1→v2 migration + round-trip identity,
  routing validator, wire parsers, control/sync validators, MIDI note map.
- ✅ **CI**: typecheck → test → build → doc-drift on push/PR touching
  `wingbeat-engine/`.
- ✅ **Docs**: `WINGBEAT_ENGINE.md` reconciled (routes incl. `/experience`
  and `/feather2`, `/cam` marked parked, LED pipelines, MIDI built, OSC
  planned).
- ✅ **MIDI out** built (`src/midi/MidiOut.ts`, Settings → MIDI out).
- ⏳ **OSC out**: design only — a bus consumer like MidiOut plus a
  WebSocket→UDP bridge on the laptop. Not started (decision: future).

## Changelog — 2026-08-26, multi-channel control

- ✅ `/experience` Control sheet: **group codes** — select 2+ parts, mint one
  QR/code; a phone joining it drives all of them with the same gesture
  (`handleControl` fan-out). Groups persist (`wb.xpGroups.v1`, same codes
  after a reload) and are removable per tile.
- ✅ The console→phone data channel now carries a **channel directory**
  (`HostMsg`/`ChannelAd` in `net/link.ts`, validated by `parseHostMsg`; sent
  on join and re-broadcast on every change).
- ✅ `/controller`: **＋ button** lists the console's free channels (one-tap
  add, manual codes as fallback); each added channel is its own PeerJS
  connection with its own strip in a **multi-channel view** (vertical touch
  faders, multi-touch, per-channel status + remove). The big pad, camera and
  accelerometer drive ALL connected channels; a strip drives only its own.
- Tests: `parseHostMsg` round-trip + rejection (40 total).

## Changelog — 2026-08-26 (later), FX matrix on the phone pad

- ✅ The controller's all-channels pad is now a Kaoss-style **FX matrix**:
  finger position drives a master FX section (`AudioEngine.setFx` — new
  chain master → high-pass → low-pass → tempo-synced FeedbackDelay → reverb),
  quadrants TL delay · TR reverb · BL high-pass · BR low-pass, center = dry,
  radius = amount, adjacent quadrants crossfade (no dead edges). Finger
  SPEED still blows wind on all channels — one hand plays both layers.
- Wire: new `fx` verb in `Control` (validated; sent through the primary
  channel only, ~30 fps). Delay time follows `setBpm` (an 8th on the grid);
  the FX reverb rides ABOVE the operator's Voices wet and falls back to it
  on release; `stop()` resets the FX so a filter sweep can't park across a
  stop. Corner labels + crosshair + glow dot on the pad.

---

## The verdict in one paragraph

The engine's *architecture* is right — transport seam, typed event bus, pure LED
router, cache-first samples — and several files are genuinely excellent
(`audio2.ts`, `MqttTransport.ts`, `inputs.ts` persistence, `LedRouter.ts`). What
makes it fragile is that **the halves were built separately and never fully
wired together**: the best audio analysis drives only `/feather2`'s own visuals,
the music-driven LED path has never reached a strip, hardware mode is missing
the controls and the health checks that sim mode has, and almost every failure
(cloud, sample, peer, broker) is swallowed silently. Solidity here is mostly a
*wiring and truth-telling* problem, not a rewrite problem.

---

## 1 · The show-stoppers (fix these before anything else)

| # | Missing link | Where | Consequence at the venue |
|---|---|---|---|
| 1 | ~~**`/feather2` never connects its LED link.**~~ **FIXED** — `push()` honours Auto-connect (2026-08-16); both pipelines now arbitrated per node, with `src` tags on the wire (2026-08-22). | `led/ledService.ts`, `transports/MqttTransport.ts` | Was: no music-driven LED frame had ever reached hardware. |
| 2 | **Default LED mode publishes near-black.** `hsv()` returns 0..1 but the `elements`/`sensor` branches feed it into a 0..255 pipeline (`to255(r/255)`). | `led/LedRouter.ts:133-142,155` | Even once #1 is fixed, strips glow dim grey regardless of the music. |
| 3 | **`patternsOn = false` by default** — `melody`/`perc`/`accent` never fire until someone finds the toggle in Settings. | `engine/WingbeatEngine.ts:253` | Operator loads trigger samples, hears nothing; projection pulse animation stays still. |
| 4 | ~~**BPM controls drive nothing.**~~ **FIXED 2026-08-22** — loops follow `setBpm` via playbackRate relative to `LOOP_NATIVE_BPM` (120). | `engine/AudioEngine.ts` | Was: "set the tempo" was a no-op. |
| 5 | **Hardware mode hides the show controls.** Whole Inputs rail (routing, mic, camera, pairing, Wind×) gated `mode === 'sim'`; keyboard handler bails on non-sim. | `App.tsx:951`, `:698-699` | The mode used at the actual show is the one with the controls removed. |
| 6 | **Dead ESP nodes look alive.** `engine.tickStaleness()` is called only by SimTransport; `LedLink.lastSeen` recorded but never read. | `transports/MqttTransport.ts` (absent), `SimTransport.ts:55`, `led/LedLink.ts:161` | A browned-out node keeps its green dot; strip freezes mid-colour, nobody is told. |
| 7 | ~~**No true blackout.**~~ **FIXED** — `allOff()` latches (08-16); blackout is honoured by the engine pipeline and sent to every engine node (08-22); firmware motion flash guarded behind `mode != OFF` (08-22, reflash needed). | `led/ledService.ts`, `transports/MqttTransport.ts`, `feather_node.ino` | Was: "all off" lasted one frame; touched feathers strobed white through blackout. |
| 8 | ~~**Audio nodes can never receive a command.**~~ **FIXED 2026-08-22** — `accent` is published to every online `audio`-role node. `silence` verb still only via `global/cmd/all` (firmware). | `transports/MqttTransport.ts` | Was: the `cmd/audio` path was unreachable. |
| 9 | **Opening the Controllers panel erases the routing matrix.** Auto-route effect overwrites slots 1–5 with a hardcoded layout and *persists* it; re-fires on every peer update. | `App.tsx:642-690` | An afternoon of patching destroyed by opening a panel to read a pairing code. |
| 10 | ~~**Console reload orphans every phone.**~~ **FIXED 2026-08-22** — rooms persist (`wb.devices.v1`), host reconnects signalling, phones re-dial with backoff + jitter. | `sim/App.tsx`, `net/link.ts` | Was: one refresh = re-pair five phones mid-show. |
| 11 | ~~**`/feather` projection has zero audio reactivity.**~~ **FIXED 2026-08-22** — the console mirrors live levels over the sync channel; the display's AudioEngine reads them. | `sim/FeatherView.tsx`, `engine/AudioEngine.ts`, `sim/sync.ts` | Was: the audience-facing projection didn't react to sound. |
| 12 | ~~**"Pushed live ✓" can be a lie.**~~ **FIXED 2026-08-22** — downloads time out + verify, realtime channel status shown as a `☁` chip on the console, re-read on resubscribe/online/visible, generation-guarded installs. Remaining idea: per-device ack table (Phase 5). | `net/cloud.ts`, `net/liveSync.ts`, `sim/App.tsx` | Was: conductor saw success while devices silently missed the push. |
| 13 | ~~**Anyone can take over the installation.**~~ **FIXED 2026-08-22** — writes go through secret-gated SECURITY DEFINER RPCs; public role is read-only (migrations `wingbeat_secret_gated_writes` + `wingbeat_lockdown_public_writes`). Verified live. | `net/cloud.ts`, `supabase/` | Was: any visitor to wingbeat.art could push their config to every device in the venue. Now: needs the conductor secret. |
| 14 | **The `/cam` phone-camera feature is entirely dead.** Relay is a Vite-dev-only plugin (404s on Vercel), nothing consumes it (no `'net'` source in `inputs.ts`), and its only UI (`PhonePanel`) is orphaned. | `vite.config.ts:11-40`, `sim/camNet.ts`, `sim/PhonePanel.tsx` | Docs promise a feature that has never been wired; stage time burned debugging it. |

---

## 2 · Systemic weaknesses (the patterns behind the bugs)

### A. Two products that never meet
- `audio2.ts` (the best analysis in the codebase: onset detection, tempo tracker,
  six musical elements) drives only `/feather2`; none of it reaches the
  WingbeatEngine bus, and the engine's loops/levels never reach the LED router.
- Two LED pipelines publish the same topic `wingbeat/node/<id>/cmd/led` with
  different vocabularies (`shimmer/wind/pulse` @QoS 1 vs `solid/off` @QoS 0). If
  both run, last packet wins → strips strobe between two colour schemes.
  `MqttTransport.ts:76` vs `LedLink.ts:172`.
- `LedInputs.sensors` and `sceneLed` are never populated by any caller, so the
  operator-selectable "Sensor" and "scene" LED sources are permanently black /
  fixed-hue. And `NodeState.hue` is degrees while `SensorSnapshot.hue` is 0..1 —
  wiring them naively turns every fixture pure red. `led/types.ts:80-85`,
  `WingbeatEngine.ts:109`.
- Module singletons (`ledService`, `rig`) + full-page navigation between routes
  = state edited on one page silently doesn't exist on another.

### B. Failures are silent by policy
- Five bare `catch {}` around `Player.start()`; `liveSync` failures are
  `console.warn`/`.catch(() => {})`; MQTT error objects discarded; PeerJS errors
  render as the bare word "error"; `alert()` used for the rest (blocks the
  render loop mid-show). No error boundary anywhere — one corrupt preset or a
  Safari-private-mode `localStorage` throw = black screen.
- `emitter.emit()` has no per-handler try/catch: one throwing subscriber stops
  AudioEngine + Projection from seeing the event. `engine/emitter.ts:23-27`.
- `setScene('typo')` is *worse* than a no-op: the guard can never fail
  (`getScene` always falls back), so the bad key is set, emitted, and published
  **retained** to `wingbeat/global/scene`, poisoning every node that boots
  later. `WingbeatEngine.ts:224`, `scenes.ts:87-89`.
- Unvalidated wire input: phone `bpm` unclamped (NaN kills all loops,
  `App.tsx:230`); ESP `Number(payload.v)` without `isFinite`
  (`MqttTransport.ts:132`); no version field on any of the three wire protocols
  (`Control`, `CamMsg`, `SyncMsg`) or on `ConductorConfig`.

### C. State has no single source of truth
- **Scene**: 4 stores (engine, `featherScenes` localStorage, `ConductorConfig`,
  seed). Remote/phone scene changes revert on next feather switch. `App.tsx:562`.
- **BPM**: 3 stores; layer rebuild snaps phone tempo back.
- **Feather**: 3 stores; `rig.feather` only set by `ImageFeather.onload`, so the
  default procedural feather never recalls its rig **and autosaves its tweaks
  into the previous image feather's slot**. `Projection.tsx:845-863`.
- `rig` is a mutable module singleton with no subscription — panels fake
  reactivity with local `setTick`s and show stale values side-by-side.

### D. Persistence is partial and unversioned
- Not persisted at all: transport mode + MQTT URL, `masterGain`, the whole
  mixer (gains/mutes/drone/noise/reverb), mic/camera calibration, `windSens`.
  One accidental refresh at a show = sim mode, 70 % volume, every mute undone,
  venue calibration gone.
- Presets miss: input routing, mixer, mic/cam calibration, LED patch,
  feather→scene map, the feather itself (explicitly not restored), and **loop
  audio** — only filenames ship, so an exported preset loads at another venue
  looking complete and plays silence. (`/conductor`'s `SampleRef` path does
  this right — copy it.)
- `wb_presets` / `wb_last_*` / cloud `ConductorConfig` have no schema version;
  old presets load blind. `inputs.ts` (`wb.routing.v2` + allowlist + per-field
  validation) is the house pattern — apply it everywhere.

### E. Every external service is a silent single point of failure
| Service | Today's behaviour when down |
|---|---|
| Supabase DB / Storage / Realtime | Silent — "pushed ✓" with no delivery, silent sensors |
| PeerJS free cloud (×5 hosts) | All phone controllers dead, no fallback |
| openrelay TURN (free, hardcoded) | Phones on cellular/guest-wifi "connected", zero data |
| MQTT broker | ✅ the one good case — auto-retry every 2 s |
- Also: sample cache has no eviction and no length/content check — one
  captive-portal HTML response **permanently poisons** that sample on that
  device (`cloud.ts:78-85`); quota errors are swallowed so caching silently
  stops working; overlapping `applyLoops` runs interleave two configs.

### F. Audio lifecycle has no teardown
- `init()` not single-flight → double node graph (~+6 dB, permanent leak);
  "Stop audio" only flips a React flag; no `dispose()` exists; `Noise`/LFO
  started and never stopped; Conductor's preview engines leak on unmount.
  `AudioEngine.ts:108-111,569-573`, `App.tsx:765-773`.
- Scene switch is non-atomic: audio hard-cuts (ignores `fadeMs`), MQTT
  hardcodes 2500 ms, visuals catch up next frame, hardware LEDs (pipeline B)
  never notified.

---

## 3 · What is SOLID — do not churn

- `LedRouter.ts` — pure, testable, rate+change+heartbeat gating is exactly right.
- `MqttTransport.ts` — reconnect, honest status, validated ingest. The
  discipline `src/net/` should copy.
- `feather2/audio2.ts` + `patterns.ts` — strongest analysis code in the repo.
  Wire it up; don't touch the internals.
- `AudioEngine` loop phase-alignment (`:376-390`) and two-stage loop gain
  (`:416-452`) — genuinely correct, keep.
- `inputs.ts` versioned+validated persistence; `rig.ts` self-healing merge.
- `spatial.ts`, `emitter.ts`, `scenes.ts` data (all 6 scenes fully populated —
  no duplication with `featherScenes.ts`).
- `sync.ts` presence protocol (ping/bye/stale), `sampleCache` cache-first
  contract, `link.ts` room-collision recovery, ICE debug logs.
- Firmware: LWT correctly registered/parsed, EMA + noise-floor + rate caps on
  sensors, key-order-independent payload parsing.
- The pre-emptive environment warnings (localhost QR, https/`ws://`, secure
  context) — there should be more of these.
- The comment culture — several comments document past bugs and why the shape
  prevents them. Institutional memory in source.

---

## 4 · The hardening plan

### Phase 0 — Make truth visible *(foundation; ~1 session)*
1. Global React error boundary per route + a non-blocking toast/status system.
   Kill every `alert()`.
2. **System health strip** on the console: broker · Supabase · realtime · per-
   device peers · ESP nodes (last-seen age) · audio state. Everything that can
   fail gets a light.
3. Per-handler try/catch in `emitter.emit()`; guard all `localStorage` access.
4. Route every swallowed error (`liveSync`, `cloud`, sample fetch, MQTT error
   object, PeerJS) into the toast/health system.

### Phase 1 — Un-dead the show path *(the 14 show-stoppers)*
1. **LED chain end-to-end**: honour `autoConnect` (or connect on first
   `push()`); fix the hsv 0..1/0..255 bug; populate `LedInputs.sensors` +
   `sceneLed` (convert hue degrees→0..1 at the boundary); BroadcastChannel the
   LED config so blackout/master/identify cross pages; make `allOff()` latch;
   guard firmware motion-flash behind `mode != OFF`; pick **one owner** for
   `cmd/led` (recommend: LedRouter owns it; engine's `led` events feed
   `LedInputs.sensors` instead of publishing directly).
2. **Audio**: single-flight `init()`; real `stop()`/`dispose()`; default
   `patternsOn = true` (or surface it on the console rail, not buried in
   Settings); make BPM real (derive loop `playbackRate` from transport or
   declare tempo per-sample and re-grid); honour `fadeMs` on scene change;
   give `/feather` an explicit story (init+attach on user tap, or read levels
   from the broadcast channel).
3. **Hardware-mode parity**: `tickStaleness()` in the engine itself (not per
   transport); show the Inputs rail + keyboard in hardware mode; fix the audio-
   node role gate; implement the ESP matrix branch or remove the column.
4. **Phones**: persist device IDs/codes; handle `peer.on('disconnected')` →
   `reconnect()`; phone re-dial with backoff+jitter; reset `attempts` on open.
5. **Decide `/cam`**: wire it (add `'net'` source + deployable relay) or delete
   `CamSender`/`camNet`/relay plugin/`PhonePanel`/`PairPanel`. Half-shipped is
   the worst state.

### Phase 2 — State solidity
1. Persist the operator-critical set (mode, mqttUrl, masterGain, mixer,
   mic/cam calibration, windSens) using the `inputs.ts` pattern (versioned key,
   allowlist, clamp).
2. **Preset v2**: versioned schema; capture routing + mixer + scene + feather +
   `SampleRef`s (reuse the Conductor path so audio travels with the preset);
   confirm before overwrite/delete/discard (`selectFeather` currently discards
   unsaved edits silently).
3. Single source of truth: scene writes-through to `featherScenes`; BPM lives
   in `rig.global.bpm` only; fix `rig.feather` assignment for procedural.
4. Turn `rig` into a tiny observable store (subscribe/notify) — delete the
   `setTick` hacks.
5. Remove the auto-route destroyer; fix the fullscreen-swipe stale closure;
   fix `MicSource.active` lying after permission denial.

### Phase 3 — Network resilience
1. `liveSync`: monotonic version (server timestamp or counter) instead of
   client-clock `===`; in-flight guard + abort on `applyLoops`;
   `AbortController` + timeout on every fetch; in-flight promise map to dedupe
   downloads; origin/client-id on `LiveState` (prevents future echo loops).
2. `sampleCache`: verify `byteLength` vs `size_bytes` before caching; surface
   quota errors; add size cap + LRU eviction.
3. Version field + runtime validation (clamp numbers, check discriminants) on
   `Control`, `CamMsg`, `SyncMsg`, `ConductorConfig`.
4. Reduce SPOFs: env-configurable PeerJS server + TURN (keep free tiers as
   fallback, not the only path); document the venue kit (local Mosquitto +
   optional local PeerJS server on the console laptop); **verify/write RLS
   policies** for `wingbeat_live`/`wingbeat_presets`/storage — this is the one
   security item.
5. `online`/`visibilitychange` handlers that re-arm channels after laptop sleep.

### Phase 4 — Lock it down so it stays solid
1. **Shared wire-contract module**: one file exporting topic builders, payload
   types, and the LED mode vocabulary, imported by both `MqttTransport` and
   `LedLink`; regenerate `mqtt-topics.md` from it. Fix firmware drift
   (`calibrate`/`silence`, `distance_cm`, retained-presence clear on boot,
   gamma on SOLID, brightness-over-MQTT).
2. **Tests where they pay** (Vitest): `LedRouter` (pure — trivially testable),
   `WingbeatEngine` ingest/threshold/cooldown, preset round-trip
   (save→load→save is identity), protocol validators.
3. CI: `typecheck` + tests + build on every push. Optional Playwright smoke:
   boot each route, assert no console errors.
4. Update `WINGBEAT_ENGINE.md` (add `/experience`, `/feather2`; mark `/cam`
   decision) and reconcile or retire the TouchDesigner/OSC diagram in
   `WB-Experience.md`.
5. Then the roadmap features on a solid base: **MIDI out** (the planned bus
   consumer — now trivial because the bus is trustworthy), scene-per-feather,
   sample matrix, TE look.

### Quick wins (one sitting, disproportionate payoff)
`patternsOn` default · `tickStaleness` in engine · hsv unit fix ·
connect-on-push · `allOff` latch · clamp phone `bpm` · persist
mode/mqttUrl/masterGain · delete the auto-route effect · keyboard under
hardware mode · error boundary.

---

## 5 · Decisions — ANSWERED by Alican, 2026-08-16

1. **LED owner** → ✅ **Keep both pipelines, add arbitration.** An explicit
   switch/priority so only one publishes `cmd/led` at a time (Phase 1 design).
2. **`/cam`** → ✅ **Leave as is for now.** Not wired, not deleted; decide
   later. (History check: `/cam` never worked in this repo — only the phone
   half was imported; the console never had a consumer or a `net` source. The
   thing that "worked perfectly" is `/controller`, which stays.)
3. **Patterns** → ✅ **ON by default + visible toggle on the console rail.**
4. **Peer infra** → ✅ **Configurable + venue kit.** Env/settings-configurable
   PeerJS + TURN, free cloud stays as fallback; document a local venue kit
   (PeerJS server + Mosquitto on the console laptop).
5. **Supabase RLS** → ✅ **Inspect + fix.** (Any policy fix must be coordinated
   with client changes so "Push live" keeps working — Phase 3.)
6. **TouchDesigner/OSC** → ✅ **Future — plan OSC out.** Goes on the roadmap as
   a bus consumer alongside MIDI out; `WB-Experience.md` diagram stays as
   intent, engine remains browser-native until then.
