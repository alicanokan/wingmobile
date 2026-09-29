# Wing Beat — Repair and onboarding report

**29 September 2026**

**Project:** `/Users/alicanokan/Documents/GitHub/wingmobile/wingbeat-engine`

**Status:** repairs implemented and verified locally; deployment and physical rehearsal pending.

## Result

The main gaps found in the initial review now have working code paths and
regression coverage. Experience can host hardware, sound and lights together;
the living feather shares the encounter's memory and audio; disconnected input
releases; simultaneous participants no longer overwrite one another. A discrete
four-speaker output is available on compatible hardware.

The landing page now introduces the sensory practice before presenting the
operator tools. Its main invitation is **“Feel the weight of the air.”**

## Visitor onboarding

The page leads visitors through three clear steps:

1. **Hold — As lightly as you can.** Rest the feather's stem between thumb and
   index finger, leaving the soft parts free.
2. **Feel — Notice the weight of the air.** Pause, sense its small pull and
   tremble, then move slowly or offer a gentle breath.
3. **Listen — Let a wing beat begin.** Notice movement, colour and sound;
   release the gesture and let the feather settle.

“I’m ready — begin” opens Experience. Visitors without a physical feather get
an explicit invitation to use its Play pads. The cultural section introduces
feathers as vessels carrying music from different continents through colour,
movement and feeling, with the closing line:

> Hold lightly. Listen closely. Feel what travels between us.

The landing now loads separately from the full engine, avoiding background
renderer, sound and connection setup during the first visit. The existing
feather video, reduced-motion handling and other entry routes remain available.

The philosophy describes the intended cultural exchange. No new recordings or
cultural provenance were invented: the current six bundled scenes remain
labelled internal sound studies.

## Repairs against the original review

| Finding | Implemented change | Verification / limit |
| --- | --- | --- |
| Lost sensor leaves wind and encounter active | Expiring input state clears stale contributions, releases encounter load and restores online state on fresh valid data | Regression tests for loss, recovery and invalid input |
| One absent sensor cancels another's presence | Presence is tracked per node and combined; hardware and touch retain separate contributions | Tests for multiple nodes and source release |
| Living feather does not share encounter memory | Embedded renderer receives the host engine and audio analysis; bounded memory, recall and anticipation feed deformation | Response/recovery tests; browser renders the Experience |
| Experience lacks the physical installation path | Added MQTT input selection, broker field, status and Lights panel; both renderer choices feed the shared LED router | Mock-broker integration tests and browser UI check; actual ESP rig not connected |
| Four speakers are only represented in the room model | Added optional discrete FL/FR/BL/BR output, source-position gains and four-channel effects; stereo remains default | Native browser offline render verifies four isolated channels; two-channel device fallback tested |
| Console phones overwrite each other | Console now uses the existing input arbiter, handles disconnects and enforces operator permissions | Existing multi-participant tests retained; reconnect tests added |
| Phone camera route has no receiver | `/cam` now opens the paired controller with camera guidance; removed unused development-only relay | Route uses the established receiver; actual camera/phone permission rehearsal pending |
| Phone connections do not recover reliably | Added initial-connection retry, single scheduled backoff, handshake deadlines, network wake handling and cleanup; open data channels survive signalling loss | Four controlled recovery tests passed; public signalling still dropped during browser session |
| Audio Begin can wait indefinitely | Added an eight-second deadline, visible error/retry feedback and startup guards; removed duplicate reverb generation | Timeout tests passed; local browser startup completed |
| Deployment can skip checks | Vercel build now runs typecheck, tests and production build; workflow also verifies generated MQTT documentation | Full checks passed locally; workflow must be committed/pushed to run remotely |
| Documentation describes older behaviour | Updated README, module map, venue guide and firmware-readiness note; added installation-readiness guide | Documentation now describes five channels, shared runtime and current speaker/camera paths |

An additional lighting defect was found during repair: engine-owned LED state
could expire after 3.5 seconds without a new gesture. It now renews every two
seconds while respecting router ownership and blackout. Tests cover renewal and
non-interference with router-owned fixtures. Malformed MQTT samples no longer
advance the timestamp guard, and invalid broker addresses report an error
instead of throwing through the page.

## How the repaired engine works

```text
Physical sensors ── MQTT ──────────────┐
Phones ── paired WebRTC ── arbiter ───┤
Keys / touch / microphone / camera ──┤
                                     ↓
                      Per-node, per-source input state
                                     ↓
                            WingbeatEngine
                                     ↓
                       Shared encounter and memory
                                     ↓
              ┌──────────────────────┼──────────────────────┐
              ↓                      ↓                      ↓
       Living / classic        Sound and sample        Lighting router
           feather                 loops                 + MQTT
                                     ↓
                           Stereo or four speakers
```

The encounter is a deterministic system of load, gesture timing, decaying
residue and quieter recall. It is not machine learning. Five sensor channels
plus the held-feather prop describe the current room. Source expiry stops old
readings from remaining active while the expressive state settles naturally.

Quad output spatializes the sensor loops and sound buses using room positions.
It is bus-level spatialization: simultaneous notes sharing a trigger bus follow
that bus's latest position. Output order is **1 front left, 2 front right,
3 back left, 4 back right**. Choose it after Start audio in Experience Mix or
console Settings. Stereo is selected again on a page reload.

## Verification performed

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Automated tests | **144 passed, 26 test files** |
| Production build | Passed |
| MQTT documentation consistency | Passed |
| Patch whitespace check | Passed |
| Desktop landing and onboarding | Visually checked; links entered Experience |
| Phone-width landing | Visually checked in a 390 × 844 iframe |
| Browser audio startup | Completed; five loop names visible in Mix |
| Unsupported quad selection | Stereo stayed selected; clear device explanation shown |
| Offline four-channel audio render | All four passed; no measured cross-channel leakage |
| Experience controls | MQTT/broker/lights/camera links and five Play pads present |

Offline render RMS for each isolated channel:

| Intended output | FL | FR | BL | BR |
| --- | ---: | ---: | ---: | ---: |
| FL | 0.710585 | 0 | 0 | 0 |
| FR | 0 | 0.710585 | 0 | 0 |
| BL | 0 | 0 | 0.710585 | 0 |
| BR | 0 | 0 | 0 | 0.710585 |

Two existing intensive tests initially exceeded their five-second time limits
while several rendering previews were active. Test concurrency is now capped
at four workers. The complete final suite passed in about eight seconds without
weakening assertions or increasing timeouts.

The production build still reports two large engine bundles. The lightweight
landing has been separated from those bundles; further renderer/network bundle
optimization remains a performance follow-up.

## Remaining work outside local verification

- **Physical rig:** verify flashed firmware, sensor unplug/replug, LED blackout,
  hand-back and command expiry, and local audio-node playback.
- **Real speakers:** verify the selected interface exposes four channels to the
  browser, then check socket order, levels and room balance. The offline render
  does not certify physical wiring or audible quality.
- **Phones and venue network:** rehearse concurrent phones, sleep/reconnect,
  touch, microphone and camera. Public PeerJS signalling dropped in this
  environment. Retry behaviour is tested, but external-service availability and
  phone-to-host connectivity were not established end to end.
- **Cultural programme:** load the intended music and contributor/provenance
  information. The task changed the invitation, not the music catalogue.
- **Release:** review and commit the working tree, deploy, then smoke-test the
  public site. **wingbeat.art was not deployed or changed by this task.**

Existing local phone/Experience changes were preserved and extended. Unrelated
parent-project files were left alone. No commit or push was made during the initial repair. Publication was
subsequently authorized; the workflow is included with these changes.

## Handover

Current operating instructions are in `README.md`, `docs/VENUE_KIT.md` and
`docs/INSTALLATION_READINESS.md`. Reproducible browser checks are available during
local development at `/tests/browser/audio-output.html` and
`/tests/browser/landing-preview.html`.

Run `npm run check` and `npm run check:mqtt` before releasing. For the installation,
open Experience → Control → Hardware + phones, apply the broker address, configure
Lights, start audio, and select the intended speaker output.

## Landing visual revision

Following feedback, the landing has been simplified to approximately 114 visible
words with the tools menu closed. Hold / Feel / Listen now use custom line
illustrations: a light fingertip grip, moving air and listening. A globe → feather
→ sound diagram carries the cultural explanation with two short caption lines.

Long tool descriptions have been replaced by an expandable footer with icons.
Slow feather sway and gentle line fades share one motion pause control; reduced
motion preferences disable animation. Direct links to onboarding and culture now
scroll correctly after the landing loads.

Validation: type checking and production build passed; visual layout checked
at the current narrow browser width without horizontal overflow. The pause
control stopped both the video and all diagram animations. Existing engine
behaviour was unchanged by this visual revision. This revision is still local.

## Experience onboarding revision

Experience now has a first-visit guide with four numbered icon buttons:
**Choose a feather → Link a controller → Interact → Mix**. Each opens the
corresponding panel. A short direction and next-step button continues the flow
inside each panel; the final action closes the controls. The guide can be
skipped and reopened through **How to play**.

The dock and number shortcuts now follow that order (1 Feather, 2 Control,
3 Play, 4 Mix, 5 Presets). Play and Mix include a Turn on sound button when
needed, so opening a panel does not hide the audio-start action. The instructions
also allow trying the piece with keyboard input or Test switches without a phone.

Validation: TypeScript and production build passed. Browser checks verified all
four panel transitions, reopening the guide, the inline sound action's presence
and the final close action. First-visit guidance was visually checked at a narrow
viewport; interaction guidance was also checked at desktop width. No engine or
hardware behaviour was changed by this onboarding revision.

## Experience Close and Skip controls

All five Experience panels (Feather, Control, Play, Mix and Presets) now have a
visible **Close ×** button in a pinned toolbar. It remains available while
scrolling and returns keyboard focus to the corresponding dock button. Closing
a panel preserves its settings and the running experience. Escape also closes
panels while an input is focused. The nested Lights section has an explicit
**Hide lights ×** toggle.

**Skip guide** is available in the overview and panel toolbars. It closes the
guide and open panel, and remembers the choice across reloads. Manual panels
then open without step directions; **How to play** restores the guide whenever
needed. Sound-start controls remain available in Play and Mix after skipping.

Validation: production build (including TypeScript) and whitespace checks
passed. Browser checks verified closing all five panels, focus return, the
pinned Close control after scrolling 688 pixels, Lights show/hide, skip
persistence, guide reopening and sound-start availability after skipping.
The controls were visually checked at desktop and 520-pixel widths. Changes
are available in the local preview; no public deployment was made.


## Publication validation — 29 September 2026

The user authorized committing and pushing all changes in `wingmobile`. The
final pre-commit checks passed: 144 tests across 26 files, TypeScript, production
build, and generated MQTT documentation verification. The existing large-chunk
build warning remains. The repair report is included in the repository at
`wingbeat-engine/docs/REPAIR_REPORT_2026-09-29.md`.

All pending code, interface, documentation and workflow changes in the parent
repository are included. The nested `twinbeats` directory is a separate Git
repository with pre-existing untracked files; it is not part of this commit.
Public deployment is not verified by this report.


## Clean-build asset correction

The first GitHub run exposed a difference from the local checkout: the parent
repository ignored PNG, WAV and MP4 files, so the feather-analysis and audio
library tests could not read their required media. The app now explicitly
tracks its feather photographs and thumbnails, fifty generated audio loops,
and landing video. Clean checkouts and production deployments therefore receive
the same runtime assets as the local preview.
