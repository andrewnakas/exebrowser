# Plan: Open-Source PINBALL.DAT Replacement

## Verdict: No existing open-source replacement exists

Every web port of SpaceCadetPinball (alula, markusbkk, oootkarsh) requires the user to bring their own `PINBALL.DAT` from Windows XP. The format is fully reverse-engineered and documented in k4zmu2a's source, so a clean-room replacement is feasible. This document is a complete spec for an AI agent to build one.

---

## What PINBALL.DAT contains (from k4zmu2a source analysis)

The file is a binary container (`datFileHeader` signature at byte 0) with N **groups**, each group holding typed **entries**:

| FieldType | Value | Contents |
|-----------|-------|----------|
| ShortValue | 0 | Single int16 — component type ID, state ID, etc. |
| Bitmap8bit | 1 | 8bpp indexed sprite: `dat8BitBmpHeader` + raw pixel data |
| GroupName | 3 | char[] — name string identifying the group |
| Palette | 5 | 256 × RGBA (4 bytes each) = 1024 bytes |
| String | 9 | char[] — text (score messages, labels) |
| ShortArray | 10 | int16[] — wall geometry, state tables |
| FloatArray | 11 | float[] — physics params (elasticity, threshold, smoothness) |
| Bitmap16bit | 12 | 16bpp depth/z-map: `dat16BitBmpHeader` + pixel data |

The loader reads groups by index. Group identity is established by `GroupName` entries and by the `ShortValue` type-code (e.g. value 202 = sound record). The engine references groups by index numbers baked into `control.cpp`.

### Asset inventory (what must be created)

**Sprites (Bitmap8bit groups)**
- Table background at 3 resolutions (640×480, 800×600, 1024×768) — the full playfield art
- Ball sprite (small circle, ~16×16, 3 frames for shadow/highlight)
- Flipper sprites — left and right, ~10 animation frames each
- Bumpers — 3 bumpers, lit/unlit states (~6 sprites each)
- Plunger — ~12 frames of compression animation
- Rollover lights — lit/unlit pairs (~20 lights)
- Drain/ball return area
- Score display digit sprites (0–9, ~14px tall, 7-segment style)
- Mission/mode indicator lights
- Flag spinners (2), kickbacks, popup targets — ~5 frames each
- Ramps (3) — static art integrated into table background or as overlays
- Launch ramp ball-in-transit frames (~8 frames)
- Gravity well / black hole animation (~12 frames)
- Skill shot indicator
- Bonus multiplier indicator lights
- Extra ball indicator
- High score / end-of-ball display backgrounds

**Palette (Palette group)**
- Single 256-color palette shared across all 8bpp sprites
- Must be consistent: background, ball, and all objects share one palette

**Depth maps (Bitmap16bit groups)**
- Z-map for each sprite so the renderer composites objects in correct draw order
- Same dimensions as corresponding Bitmap8bit

**Audio (ShortValue type 202 = sound record)**  
The DAT file does NOT store audio — sounds are separate `.wav` files loaded by name. The k4zmu2a engine references them via `Sound::PlaySound(soundId)` → `sound_list[id]`. A companion `SOUNDS/` directory is needed with these files (all must be created as original works or sourced CC0):
- `BALL_LAUNCH.wav` — plunger release
- `BALL_HIT_*.wav` — bumper hits (soft, hard)
- `FLIPPER_UP.wav`, `FLIPPER_DOWN.wav`
- `DRAIN.wav` — ball lost
- `EXTRA_BALL.wav`
- `MISSION_COMPLETE.wav`
- `ROLLOVER_*.wav` — light activations
- `BUMPER_HIT.wav`
- `KICKBACK.wav`
- `TILT.wav`
- `GRAVITY_WELL_*.wav` — 3 zoom-in sounds
- Background music MIDI (optional — `PINBALL.MID` equivalent)

**Physics / geometry data (ShortArray + FloatArray groups)**  
These are numbers, not art — they can be extracted from the open k4zmu2a source or the original binary without copyright concern (facts/numbers are not copyrightable). Key data:
- Wall segment coordinates (`ShortArray` groups loaded by `TEdgeSegment`)
- Flipper pivot points and rotation limits (`FloatArray`)
- Bumper positions and radii
- Rollover positions
- Plunger travel range
- Gravity constant, ball mass

**Text strings (String groups)**
- Mission names: "Launch Training", "Alien Menace", "Cosmic Plague", etc.
- Score multiplier labels
- "GAME OVER", "TILT", "PLAYER 1/2/3" etc. — original wording must differ from Microsoft's

---

## Format specification for the writer

Binary layout of a valid `PINBALL.DAT`:

```
[datFileHeader - 183 bytes]
  FileSignature: "COMPILED DATA FILE\0" (19 chars + 2 null)  
  AppName:       "Space Cadet" (null-padded to 50 bytes)
  Description:   any string (null-padded to 100 bytes)
  FileSize:      total file size as int32
  NumberOfGroups: uint16
  SizeOfBody:    int32 (body after header)
  Unknown:       uint16 (set to 0)

[For each group:]
  [group header: group_id as int16, entry_count as int16]
  [For each entry:]
    [entry header: FieldType as int16, size as int32]
    [entry data: `size` bytes]
```

The AI writer must produce a file that passes `partman::load_records()` without error and causes `loader::loadfrom()` to find all expected group indices.

---

## Recommended approach for an AI agent

### Phase 1 — Extract the non-copyrightable data (1 day)

Use the k4zmu2a source + `strings` on a legitimate copy of PINBALL.DAT (anyone can extract strings from a file they legally own) to dump:
- All group indices and their type codes
- All `FloatArray` values (physics params)
- All `ShortArray` values (wall geometry, state tables)
- All `String` values (to know what text to replace with original text)

Write a Python script that parses the DAT format per `partman.cpp`'s `load_records()` and dumps a JSON manifest of all groups with their types and numeric data. This JSON is the skeleton.

### Phase 2 — Write a DAT builder (1 day)

Python script `build_dat.py`:
- Input: JSON manifest + folder of PNG sprites + folder of WAV files
- Output: `PINBALL.DAT` binary

The script must implement:
- `datFileHeader` struct packing
- 8bpp sprite encoding: quantize PNG to 256-color palette → `dat8BitBmpHeader` + raw bytes
- Z-map encoding: depth PNG (grayscale 16-bit) → `dat16BitBmpHeader` + raw bytes
- Palette encoding: 256 × RGBA from the quantized palette
- All other field types: pack as-is from JSON

### Phase 3 — Create original art assets (2–4 weeks, human artist or AI image gen)

**Recommended style:** Retro sci-fi / space neon aesthetic — visually distinct from Microsoft's blue-gradient table but spiritually similar (space theme, stars, planets).

For each sprite group, generate:
1. A full-color PNG at 1024×768 for the table background (AI image gen: "top-down view of a neon space-themed pinball table, dark background, purple and cyan color scheme, pixel art style")
2. Individual component sprites as PNGs with transparency channel
3. A 16-bit grayscale depth map for each sprite (can be generated procedurally from the alpha channel)

Palette constraint: all sprites must share one 256-color palette. Run `pngquant --ext .png --force 256` on all sprites together to get a shared palette, then re-encode.

**Sound:** Use a voice/sfx synthesis model or CC0 sound effects from freesound.org (filter: CC0 license). Generate 1–2 second clips for each event.

### Phase 4 — Wire it up (1 day)

Replace PINBALL.DAT group names and string fields with original text. Suggested names:
- Mission 1: "Orbital Insertion" (was "Launch Training")
- Mission 2: "Hostile Takeover" (was "Alien Menace")  
- etc.

Run the WASM build (alula fork) with the new DAT file. Iterate on art until the table looks correct.

---

## What to hand to the AI agent

Paste this entire document plus these three files from the k4zmu2a repo:
- `SpaceCadetPinball/partman.cpp` — binary parser (tells you exact byte layout)
- `SpaceCadetPinball/GroupData.h` — field type enum
- `SpaceCadetPinball/loader.cpp` — group index semantics

Start with Phase 1 (the DAT dumper script) — once you have a JSON of the original's group structure with all numeric data intact, Phase 3 (art) is the only creative work remaining and can be parallelized.

---

## Licensing

The output DAT file must be released under CC0 (public domain dedication). The physics data (numbers) are facts. The wall geometry data is facts. The art and sounds must be wholly original works. The string content must not reproduce Microsoft's mission names verbatim.

The k4zmu2a engine is MIT licensed — the combination (engine + CC0 data) would be the first freely hostable version of this game.
