# Open Cadet — a CC0 game-data package for the open-source Space Cadet engine

This package (`PINBALL.DAT` + `sound*.wav`) is a **fully original, public-domain
(CC0)** replacement for the proprietary data files of *3D Pinball for Windows –
Space Cadet*. It is designed to run with the open-source engine
**k4zmu2a/SpaceCadetPinball** (MIT licensed), producing the first freely
redistributable build of the game that requires no Microsoft files.

## What is original here (copyrightable expression — created from scratch, CC0)

- **All bitmap art** in `PINBALL.DAT` (playfield, score panel, lights, bumpers,
  flippers, targets, ball, etc.). Every pixel is procedurally generated original
  art in a "neon space" style. No pixels were copied from any source.
- **The color palette** — an original neon palette.
- **All sound effects** (`sound*.wav`) — original waveforms synthesized with
  numpy (sine/noise/decay envelopes). No audio sample was copied.
- **Text strings** (labels, notices) — original wording.

## What is factual (not copyrightable — extracted for interoperability)

The container's structure and numeric data are facts dictated by the engine
format and the physics of the table, and are used here for interoperability:

- Group names, group order, and record type codes (the engine's data format).
- Geometry: wall-segment coordinates, component positions, sprite bounding
  boxes, the table boundary polygon.
- Physics parameters: elasticity, smoothness, thresholds, gravity, ball radius.
- The `table_objects` assembly list and the camera/projection matrix.
- Depth/perspective data: the per-surface depth values (z-map magnitudes) are
  used as functional geometry to drive shading direction and foreshortening so
  the rendered table sits at the correct viewing angle. The original artwork's
  pixel silhouettes are NOT reused — every sprite shape is drawn independently.
- Sound-effect *filenames* (the filename contract between the DAT and the
  engine), e.g. `sound12.wav`.

Facts and measurements are not protected by copyright (see Feist v. Rural).
This is the same clean-room principle behind projects like Wine and ReactOS:
an original implementation may interoperate with a documented format.

## Engine

The renderer/physics engine is **not** included here. Get it from
https://github.com/k4zmu2a/SpaceCadetPinball (MIT). Place `PINBALL.DAT` and the
`sound*.wav` files in the engine's data search path (the working directory or
next to the executable) and run.

## Not affiliated with Microsoft, Maxis, or Cinematronics.
