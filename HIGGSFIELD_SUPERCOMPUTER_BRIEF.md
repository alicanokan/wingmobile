# Wing Beat — Higgsfield Supercomputer Brief

## Project in one sentence

Wing Beat is an interactive installation where a real or simulated breath
moves a scientifically structured digital feather, generates sound, and sends
light through a physical room.

## Core idea

Feathers are treated as vessels of culture and memory. A participant creates
air through breath, touch, presence, or a wind sensor. That air becomes:

1. physical movement in a reconstructed feather,
2. a layered musical response,
3. spatial sound through four speakers,
4. LED behaviour in the installation,
5. a shared visual event rather than a conventional audio visualizer.

The feather should feel alive, delicate, and physically credible. Technology
must support the ritual; it should not turn the experience into a dashboard or
generic particle demo.

## Current system

The browser simulation and physical installation use the same engine.

```text
wind / motion / presence / microphone / audio
                    ↓
             Wingbeat engine
                    ↓
     feather motion + sound + spatial gain
                    ↓
       projection + speakers + LED nodes
```

- React, TypeScript, Three.js, WebGL shaders, Tone.js.
- Simulation and ESP8266/MQTT hardware share one state and mapping model.
- Five interaction channels currently address tip, rachis, two colour groups,
  and the downy tail.
- The installation can use cultural scene packs with distinct sound and light
  palettes.

## Feather Lab

Feather Lab converts a black-background feather photograph into an interactive
3D particle reconstruction.

### Image analysis

- Up to 240,000 sampled points.
- True-black background segmentation that preserves dark pigment.
- Calamus and rachis recovery.
- Firm vane and down/fringe classification.
- Barb-flow and surface-field estimation.
- Six measured colour clusters.
- Up to twelve independently detected pattern zones.
- Shaft-centred anatomical coordinates aligned with the 3D world.

The analysis reports measurements, not species identification or fictional AI
confidence.

### Layer system

The scan can automatically build eight semantic master layers:

1. Vane body
2. Pattern zones
3. Primary colours
4. Accent colours
5. Rachis
6. Calamus
7. Down and fringe
8. Marking anatomy

Every master contains selectable image masks. Masters and masks support:

- visibility and solo,
- brightness,
- particle size,
- movement,
- depth,
- independent audio routing.

### Trigger effects

Master layers can use Pulse, Flutter, Shimmer, Lift, and Blackout effects.
Effects can toggle on each trigger, follow a signal, or run as a one-shot.

### Interaction zones

A separate matrix routes any master layer to reusable interaction-zone objects.
Each zone has:

- a musical trigger,
- toggle, gate, or one-shot behaviour,
- steady, sine, or strobe motion,
- speed,
- attack and release,
- brightness, particle-size, movement, and depth outputs.

One master can receive several zones; one zone can control several masters.

## Current visual direction

- Pure black stage.
- The source feather remains recognizable.
- Particle reconstruction should preserve measured colours.
- Rachis and calamus remain structurally stable.
- Firm vane behaves as an interlocked surface.
- Loose down and fringe yield, flutter, separate, and settle.
- Movement can bend, twist, ripple, shimmer, unzip, lift, or briefly disperse.
- The visual language is dark, quiet, botanical, cinematic, and precise.

## Problems still worth solving

1. The experience has powerful controls but risks feeling like production
   software instead of an artwork.
2. The relationship between cultural memory, feather anatomy, and sound should
   become more legible without explanatory text.
3. Layer and zone complexity needs a simple performance mode for installation
   operators.
4. Motion must remain recognizably feather-like at extreme settings.
5. The transition from one resting feather to a collective “flight” event needs
   a stronger emotional arc.
6. We need a visual identity and interaction thesis that cannot be mistaken for
   a generic music visualizer.

## Non-negotiable constraints

- Preserve the source feather silhouette and anatomical logic.
- Do not invent scientific certainty or species claims.
- Do not use arbitrary particle explosions as the main visual idea.
- Keep the rachis rooted and mechanically different from the vane and down.
- Respect reduced-motion and accessibility needs.
- Target smooth real-time browser rendering and installation reliability.
- The physical and simulated systems must remain behaviourally consistent.
- Keep the black-stage presentation suitable for projection.

## What a strong next version should achieve

- A visitor understands that breath becomes air, air becomes feather movement,
  and movement becomes sound and light without reading instructions.
- The feather appears to remember and respond, not merely react to amplitude.
- Each cultural scene changes behaviour and atmosphere without stereotyping.
- Operators can author complex mappings, then perform them through a simple,
  stable interface.
- Still frames are visually compelling, but the real identity emerges through
  motion, timing, anticipation, and recovery.

## Material available for concept development

- Feather photographs on black.
- Natural, anatomy, pattern, and surface-field render modes.
- Audio-reactive particle footage.
- Layer and interaction-zone UI captures.
- A working browser prototype and physical MQTT architecture.
