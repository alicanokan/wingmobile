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
- ⏳ **Stage 2 — the flip**: `supabase/lockdown_after_deploy.sql` is staged in
  the repo. **Run it only after the new client is deployed to wingbeat.art**
  (old client's direct upserts break at that moment, by design). Public
  becomes read-only on all tables; storage keeps read + insert, loses
  update/delete. Until it runs, the hole is still open.

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
| 1 | **`/feather2` never connects its LED link.** Only page that calls `ledService.push()`, never calls `connect()`; `autoConnect` config exists but is read by nothing. | `led/ledService.ts:164`, `:26/37`, `feather2/Feather2.tsx:965` | **No music-driven LED frame has ever reached hardware.** Console's sent/dropped counters are a different singleton and look healthy. |
| 2 | **Default LED mode publishes near-black.** `hsv()` returns 0..1 but the `elements`/`sensor` branches feed it into a 0..255 pipeline (`to255(r/255)`). | `led/LedRouter.ts:133-142,155` | Even once #1 is fixed, strips glow dim grey regardless of the music. |
| 3 | **`patternsOn = false` by default** — `melody`/`perc`/`accent` never fire until someone finds the toggle in Settings. | `engine/WingbeatEngine.ts:253` | Operator loads trigger samples, hears nothing; projection pulse animation stays still. |
| 4 | **BPM controls drive nothing.** Five UIs write `Tone.Transport.bpm`, but loops are plain `Player`s that never read it; phone tempo gets snapped back by `onLayersChange`. | `engine/AudioEngine.ts:329-339`, `App.tsx:230/694` | "Set the tempo" is a no-op that reads as broken hardware. |
| 5 | **Hardware mode hides the show controls.** Whole Inputs rail (routing, mic, camera, pairing, Wind×) gated `mode === 'sim'`; keyboard handler bails on non-sim. | `App.tsx:951`, `:698-699` | The mode used at the actual show is the one with the controls removed. |
| 6 | **Dead ESP nodes look alive.** `engine.tickStaleness()` is called only by SimTransport; `LedLink.lastSeen` recorded but never read. | `transports/MqttTransport.ts` (absent), `SimTransport.ts:55`, `led/LedLink.ts:161` | A browned-out node keeps its green dot; strip freezes mid-colour, nobody is told. |
| 7 | **No true blackout.** `allOff()` un-latches itself next frame (`router.resync()`); LED config/blackout edited on `/conductor` never reaches the `/feather2` instance (separate page singletons); firmware motion-flash writes white pixels *after* the OFF case. | `led/ledService.ts:184-188`, `feather_node.ino:273-278` | The emergency "all off" flashes black for ~16 ms and resumes; touched feathers strobe white through blackout. |
| 8 | **Audio nodes can never receive a command.** Role gate compares against the *triggering sensor's* id, so the `cmd/audio` path is unreachable; firmware's `silence` verb exists nowhere in TS. | `transports/MqttTransport.ts:88-99`, `engine/WingbeatEngine.ts:207` | Audio ESPs loop `/bed.mp3` from boot forever, uncontrollable from the console. |
| 9 | **Opening the Controllers panel erases the routing matrix.** Auto-route effect overwrites slots 1–5 with a hardcoded layout and *persists* it; re-fires on every peer update. | `App.tsx:642-690` | An afternoon of patching destroyed by opening a panel to read a pairing code. |
| 10 | **Console reload orphans every phone.** Device IDs/codes are re-minted randomly per mount, never persisted; PeerJS has no `disconnected` handling, no re-dial, 4 lifetime attempts. | `net/link.ts:99-100,150-175,218` | One refresh = re-display 5 QR codes and re-pair every phone mid-show. |
| 11 | **`/feather` projection has zero audio reactivity.** Display window creates an AudioEngine but never `attach()`/`init()`, so `audioReady` never fires, loops park forever, `getLevel()` reads 0. | `sim/FeatherView.tsx:23,31` | The actual second-screen projection — the thing the audience sees — doesn't react to sound. |
| 12 | **"Pushed live ✓" can be a lie.** Realtime subscribe has no status callback, `getLive` failure looks like "nothing pushed", failed sample downloads are `console.warn`, one hung fetch (no timeout/abort) blocks remaining loops. | `net/cloud.ts:156-166,140-144`, `net/liveSync.ts:25-38,120` | Conductor sees success; some devices never got the push, some sensors stay silent, no UI anywhere says so. |
| 13 | **Anyone can take over the installation (verify RLS).** No auth anywhere; anon key upserts `wingbeat_live` id=1, upserts presets, deletes storage. No SQL/policies in repo to prove writes are restricted. | `net/supabaseClient.ts:6-9`, `net/cloud.ts:116-153` | If RLS allows anon writes, any visitor to wingbeat.art can push their config to every device in the venue. |
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
