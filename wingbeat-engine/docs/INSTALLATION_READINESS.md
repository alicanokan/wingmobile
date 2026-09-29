# Wing Beat — Installation readiness

Updated 29 September 2026 after the engine repair and visitor-onboarding work.

## What is now connected

The five-channel experience accepts phones, touch/keys and MQTT sensors. The
living feather reads the host's expressive state and audio analysis. The same
host supplies light-router input. Stale input expires, presence is combined
across nodes, and phone participants are merged independently in both host UIs.
Camera controllers use the same paired WebRTC route as other phone input.

Audio starts through a bounded browser-permission wait. The optional quad
output preserves four discrete channels, with stereo as the default and a clear
fallback when the current interface exposes fewer than four outputs.

Visitors begin at a lightweight landing page: Hold / Feel / Listen, followed by
a direct invitation into Experience. Its cultural text states the artistic
idea; the bundled scene metadata still identifies internal studies.

## Verified locally

- `npm run check`: TypeScript, 144 tests in 26 files, production build passed.
- `npm run check:mqtt`: shared topic documentation matches the wire contract.
- Browser: landing invitation, onboarding link and Experience entry.
- Browser: audio startup completed; five loop names appeared in Mix.
- Browser: unsupported quad selection kept Stereo selected with a clear error.
- Offline browser audio render: all four isolated outputs passed, with zero
  measured signal in the three untargeted channels.
- Browser: Control showed MQTT selection, broker address, Lights and camera
  links; Play exposed all five touch channels.
- Visual inspection: desktop landing and 390-pixel-wide landing preview.

New automated coverage includes stale-input release, fresh-sample recovery,
independent source release, per-node presence, invalid input, shared feather
memory response, phone reconnect/handshake cleanup, audio timeout and MQTT
lighting lease renewal/ownership. Existing arbiter tests remain in place.

Two older CPU-intensive tests hit their five-second limits during a run with
multiple active rendering previews. Test workers are now capped at four. The
complete final suite passed in approximately eight seconds without loosening
assertions or increasing timeouts.

## Still requires the venue

1. Connect the real broker and flashed ESP nodes. Verify input, disconnect,
   recovery, TTL fallback, router hand-back, blackout and accent playback.
2. Check the four-output interface, OS channel configuration, socket order and
   speaker levels. An offline audio render does not verify physical wiring.
3. Pair actual phones over the venue network. Test simultaneous input, sleep,
   reconnect, microphone and camera permission. Public signalling still dropped
   in this browser session; recovery logic passed controlled regression tests,
   but public service reachability is not guaranteed by that result.
4. Confirm samples and their provenance/attribution for the intended cultural
   programme. The existing six studies are not newly sourced continent-specific
   recordings.
5. Commit/review and deploy the local changes, then repeat the visitor smoke
   test on wingbeat.art. The production website was not changed in this task.

## Reproducible browser checks

With the development server running:

- `/tests/browser/audio-output.html`: click Run speaker checks; renders offline.
- `/tests/browser/landing-preview.html`: 390 × 844 landing iframe for layout inspection.

Vercel is configured to run `npm run check`. The repository workflow checks the
same suite and MQTT documentation once included in a commit. Two large engine
bundles still produce Vite size warnings; the visitor landing loads separately
from those engine bundles. This is a performance follow-up, not a failed build.
