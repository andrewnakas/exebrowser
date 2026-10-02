# Parkhaven: provenance

Parkhaven is an original work. It was written by a clean-room implementation team from a
functional specification (`cleanroom/parkhaven/SPEC.md`) that describes rules and numbers
only. The implementation team did not see the code, art, sounds, text or data files of any
existing theme-park game, and did not use screenshots or extracted assets.

- **Code**: all JavaScript, HTML and CSS here was written for Parkhaven. There are no
  runtime dependencies and no build step.
- **Art**: every model is generated in code at run time (procedural low-poly geometry with
  flat colours drawn through WebGL 2). There are no image files.
- **Text**: all interface text, guest thoughts, ride, stall, item and scenario names are
  Parkhaven's own.
- **Sound**: every sound effect and the music-box tune are synthesised at run time with the
  Web Audio API. The spec allowed the community packs OpenSoundEffects (MIT) and OpenMusic
  (CC-BY-SA-4.0); **neither pack is used**, so no third-party audio is shipped.
- **Numbers**: the game uses the rule values given in the functional spec, tuned where noted
  in `DESIGN-NOTES.md`.

Licence: MIT, copyright 2026 Andrew Nakas (see `LICENSE`).
