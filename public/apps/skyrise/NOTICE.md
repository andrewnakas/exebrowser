# Skyrise: notice and provenance

Skyrise is an original browser game: a side-on tower-construction and management game with lifts, tenants and a star rating.

## Provenance

- Skyrise was written from a **functional specification** that describes game rules, numbers and required states only (`cleanroom/skyrise/SPEC.md` in the source repository). The implementation team worked from that document and their own design decisions. Those decisions are recorded in `DESIGN-NOTES.md`.
- **No code** from any other game, reimplementation or decompilation was read or used.
- **No art** from any other game was used, traced or extracted. All graphics are drawn procedurally at run time by the Canvas 2D code in `js/art.js` and `js/render.js`. The game ships no image files.
- **No sound** from any other game was used. All audio is synthesised at run time with the WebAudio API (`js/audio.js`). The game ships no audio files.
- **No text** from any other game was used. All interface labels, messages, facility names, person names, film titles and event dialogs were written for Skyrise.

## Credits

Skyrise contributors.

## Licence

MIT. See `LICENSE`.
