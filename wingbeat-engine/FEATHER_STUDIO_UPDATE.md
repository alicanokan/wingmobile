# Feather studio update — 7 September 2026

Built on the current uncommitted wingmobile files, preserving the anatomy, masks,
interaction zones, response controls, audio routing, LED integration and exports.

- Landing page: black, warm white and sage; supplied feather footage, optimized
  to a 4.1 MB portrait crop; pause/play and system reduced-motion handling.
- Studio: more room for the specimen, quieter collection and inspector, focus
  mode, whole/vane/tip/down/detail camera presets and drag/pinch panning.
- A full-resolution photographic texture is now mapped to a connected surface
  in the measured shaft coordinate frame. Each mesh vertex inherits measured
  anatomical attributes, so existing shader motion, masks and routing still apply.
- Photo mode softens random depth variation and reduces bloom. Original point
  rendering remains available; point-only controls are disabled in photo mode.
- The supplied clip's feather is available as “Air study”. Both /feather2 and
  /feather2.html open the designer.

This uses a deformable single photograph, not a multi-angle scan or a volumetric
reconstruction. Reverse-side appearance and depth are approximations. Magnification
is limited by the original image resolution; it does not invent microscopic detail.

Validation: 78 tests passed and the production build passed. The anatomy tests
cover the new source specimen, finite surface geometry, valid attribute mapping
and background masks. Browser visual/interaction validation was blocked by the
app's admin-policy verification failure when opening the local preview. That
visual review remains outstanding; no screenshots or measured frame-rate claims
are included.

## Organic hybrid revision

The digital strip artifacts reported in the September 7 screenshots came from
categorical depth offsets and independent point-style displacement on connected
triangles. The hybrid revision removes those offsets and uses one continuous
shaft-driven deformation for both surface and points. Photo and point coordinates
now use the same interpolated shaft frame.

The Photo → fibres slider blends both passes simultaneously, with strong surface
coverage on the rachis and calamus. Bend travels along the shaft; delayed waves
travel outward through the vane, with softer tethered movement in down. Colour
and pattern depth controls now produce small ripple accents rather than separate
floating plates. The blend setting persists and is included in scene exports.

The revised code passes the existing 78 tests. Browser verification remains blocked
by the same admin-policy verification error; visual fidelity is not yet verified.
