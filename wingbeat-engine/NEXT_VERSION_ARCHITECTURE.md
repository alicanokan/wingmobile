# Wing Beat next-version architecture

Source of intent: `/Users/alicanokan/Downloads/wing-beat-next-version.txt`

## Interaction thesis

> A breath leaves a shape that the next breath inherits.

The runtime is one rooted feather body with short-lived, bounded memory. Particles render that body; masks select appearance; they do not create separate mechanical materials.

## One causal chain

```text
Calibrated input sample
  → gesture envelope
  → encounter phase + bounded memory
  → named anatomical behaviour
  → one combined deformation state
  → projection / sound / speaker width / LED envelope
  → safety and accessibility limits
```

The old direct master-effect trigger and interaction-zone trigger systems no longer both write deformation. Legacy master presets migrate into behaviour fields and are then disabled. All routed fields are combined once and clamped before deformation.

## Priority and dependency map

| Priority | Capability | Depends on | Runtime owner | Acceptance gate |
|---|---|---|---|---|
| P0 | Versioned calibrated input | — | `engine/types.ts`, transports | Source, time, validity and unit survive record/replay |
| P0 | Deterministic trace replay | calibrated input | `engine/replay.ts` | The same trace yields the same engine trajectory |
| P1 | Rooted anatomical body | analysis/rest coordinates | `feather2` shader, `sim/Projection.tsx` | Permitted extremes cannot move the root or detach pigment |
| P1 | Unified behaviour fields | body constraints | `feather2/interactionZones.ts` | No second trigger path writes the same property |
| P2 | Gesture memory and phases | deterministic time | `engine/encounter.ts` | A short sequence returns with recognizable spacing |
| P2 | Modest anticipation | stable gesture history | `engine/encounter.ts` | Irregular timing disables prediction; preparation remains subtle |
| P3 | Consequence-led sound/light | expressive state | `AudioEngine`, LED router, MQTT | Outputs follow yielding, lift, release and spatial breadth—not raw meters |
| P3 | Reliable room transport | versioned outputs | MQTT + firmware | Reconnect reasserts state; stale packets are rejected; TTL returns nodes safely |
| P4 | Authoring/performance split | validated runtime state | React UI | Performance mode cannot edit scenes and exposes only operational controls |
| P5 | Contributor-authored encounters | scene validation | `engine/scenes.ts` | Cultural naming requires provenance, consent and transformation permissions |

## Non-negotiable invariants

1. The calamus/root remains fixed.
2. Shaft displacement is continuous and capped.
3. The vane moves as a connected field.
4. Down/fringe can vary locally but remains attached.
5. Excitation is faster than release.
6. Appearance masks never acquire independent mechanics.
7. Several inputs are combined before deformation; limits always win.
8. No raw microphone recording is retained.
9. One input source is not evidence of multiple identifiable visitors.
10. “Cultural memory” is not used without an accountable contributor and permission record.

## Named behaviours

- `flutter`: attached down/fringe motion only.
- `lift`: coherent vane load distributed through restrained shaft motion.
- `shimmer`: restrained luminance response; no independent geometry.
- `pulse`: a narrow opening travelling along estimated barb flow.
- `blackout`: authored/operational transition, not routine feedback.

Strobe, arbitrary dispersion, roaming particles and public camera motion are outside the approved runtime vocabulary.

## Encounter phases

Phases are interruptible state descriptions, not a queued show:

`rest → presence → breath → awakening → rememberedEncounter → collectiveFlight → settling`

Any active phase can move to `settling`; emergency stop moves immediately to a safe dark/rest state. “Collective flight” means bounded movement and spatial breadth travelling into the room while the feather stays rooted.

## Memory model

- Immediate residue: asymmetric release preserves a faint bend/flutter.
- Gesture history: onset, duration, rise, fall and calibrated strength only.
- Encounter residue: bounded history decays rather than accumulating forever.
- Recall: the most recent three-gesture timing pattern returns once at lower strength.
- Anticipation: enabled only for repeated low-variance intervals; relaxes if the event does not arrive.

## Authoring model

The default editor follows:

`Input → Interpretation → Region → Behaviour → Output → Limit`

Linked views:

1. Feather/anatomy canvas.
2. Behaviour fields and encounter score.
3. Output routing and limits.

The full gain matrix remains an advanced inspector. Dependency checks flag excessive summed gain and blackout conflicts.

## Performance model

Performance mode loads a prepared scene and locks editing. It exposes:

- phase and scene;
- Start / Hold / Settle / Stop;
- bounded sensitivity and sound;
- reduced motion;
- sensor, input transport, audio, renderer and LED health;
- emergency stop.

Normal Stop settles and fades. Emergency stop mutes artwork outputs; it does not control venue safety lighting.

## Scene authorship

Existing culturally named presets are retained only as stable internal keys for compatibility. Their visible labels are neutral “remembered encounter” studies. A scene may be called contributor-authored only when it includes contributors, provenance, consent reference and permitted transformations.

## Remaining physical-installation gate

Browser contracts now carry output sequence, send time and TTL, and reject stale input timestamps. Firmware must enforce the same TTL locally so disconnected strips and audio nodes return to a safe state without depending on the browser or broker.
