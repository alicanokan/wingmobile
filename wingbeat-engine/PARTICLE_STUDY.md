# Wing Beat particle study

The artistic basis is the feather as memory and instrument: individually playable
colours, markings and anatomical regions, carried by gestures into a collective
composition. The supplied project notes and presentations informed this direction;
their old implementation plans were treated as reference, not new task instructions.

## Current foundation

The renderer draws one texture-bearing GPU instance per measured particle. Each
instance retains its original image coordinates, anatomical classification, colour
group and detected pattern. The source image is sampled within the particle, so
fine detail travels with it. There are no triangles connecting separate particles.
The detail/fibre blend happens inside each instance rather than fading a stationary
photo against a moving cloud. This remains a single-image reconstruction.

Movement and Separation now apply to every available mask type and master, with
both manual values and audio matrix routing. Solo no longer depends on keeping
unrelated anatomical groups visible. Colour/pattern separation may be strong
because it now moves independent fragments, not connected triangle strips.

## Repeatable starting study

Use existing Feather 02 (contrasting gold/black bands), then:

1. Choose Whole. In Appearance, set Photo → fibres to 0.2, Particle size to 1,
   Opacity to 1 and Bloom to 0.1. In Anatomy, use 140k samples initially; increase
   toward 240k only after assessing responsiveness on the display machine.
2. In Response, start with Release into air at 0 and Root attachment at 0.9.
3. In Masks, solo one colour or pattern. Set its Movement to 2 and Separation to
   2. Bring in a demo or audio track. Restore all layers by toggling Solo again.
4. Select Curl, then Release feather. Compare Stream, Orbit and Burst. Recall
   removes the global release gradually; independent layer separation remains
   under that layer's control. Set layer Separation back to 1 to remove it.
5. Lower Root attachment toward 0 to release surrounding fibres; the rachis and calamus remain aligned.

## Source capture for the next feather

Use a sharp, uniformly lit image around 2000–4000 pixels tall, with the complete
calamus and tip visible. Keep space around the outline. A clean transparent PNG
is preferable; otherwise use a plain contrasting background. Preserve actual
barbs and small gaps rather than smoothing the silhouette. Use several clearly
distinct coloured regions and well-separated markings for the initial study.
More input pixels improve the texture; analysis remains bounded to 240k samples.
No additional source image was synthesized for this revision.

## Validation and limits

84 tests and the production build passed. Tests cover source UV bounds, geometry,
mask/master motion modulation and solo-category logic. Browser access is blocked
by the app's policy-verification error, so GPU shader execution, frame rate and
visual quality have not been verified. Do not treat the build as visual approval.
The current flow fields are deterministic GPU deformation, not a fluid solver.
Detected colour groups and selectable pattern masks retain the existing analyser's
limits (6 colour groups and the first 12 detected pattern zones).

## Independent always-on layer behaviour

In Masks, select a master or image mask and open its Always-on behaviour controls.
Choose Still, Organic drift, Fly outward, Swirl, Orbit centre, Pump or Wave.
Motion amount and Speed are independent per selection. Glow rhythm and Colour
travel can operate even on Still layers. These run without audio or the demo.
A mask defaults to Follow master; choosing its own mode gives it independent
settings. The configuration is saved with the existing layer preferences and
included in scene exports. Older scenes begin with a subtle, slow organic drift.

Rachis and calamus always use one continuous shaft curve, preserving their
original thickness. Layer separation, release and independent movement cannot
split them. Rachis Wave bends both together; their glow and colour remain
independent. Root attachment in Response controls the surrounding fibres. Use Still
and zero glow/colour travel to turn off a layer's always-on contribution; existing
audio routing and global release remain separate controls.

Suggested combination: rachis Wave at amount 0.2 / speed 0.4, calamus Still with
glow 0.25, barbs Organic drift at amount 0.35 / speed 0.6, a pattern mask Swirl at
amount 0.5 / speed 0.3, and a colour mask Pump with colour travel 0.3. Set these
on each chosen mask or master; they are not automatically applied to your scene.
