# Boxedwine overlay zips — provenance and local modifications

These are Wine 1.7.55 overlay filesystems from [Boxedwine](https://www.boxedwine.org/).
Wine is LGPL-2.1; Boxedwine is GPL-2.0. They are mounted *over* the 50 MB root
(`fullWine1.7.55-v8.zip`, range-fetched through the Worker), so the small files
here shadow their counterparts in the root.

## `wine1.7.55-v8-min-online.zip` — **locally modified**

This is the overlay that actually loads (`overlayBasename` in `public/app.js`).
It is upstream Boxedwine's overlay with **one deliberate change**:

`home/username/.wine/system.reg` gained a driver-selection key:

```
[Software\\Wine\\Drivers] 1488041835
"Audio"="oss"
```

**Why.** Wine 1.7.55 probes audio drivers in the order pulse → alsa → oss.
This root contains neither `libasound` nor `libpulse`, so `winealsa.drv.so` and
`winepulse.drv.so` cannot load and the first two candidates fail. Boxedwine
emulates an OSS sound card (`/dev/dsp`, `/dev/mixer`, `SNDCTL_DSP_*`) and the
root does ship `wineoss.drv.so`, so OSS is the only driver that can work here —
but nothing was selecting it. Without this key, Wine apps run silent even
though sound is enabled everywhere else in the stack (`app.js` passes
`sound=true`, the shell only adds `-nosound` when sound is off, and
`installAudioReviver()` in `app.js` already resumes the SDL2 AudioContext).

Nothing else in the zip was touched — same 217 entries, same layout.
To regenerate: unzip, edit `system.reg`, `zip -r -X`.

## `wine1.7.55-v8-min-online-patch.zip` — unused

19 empty directories with `.keep` files. Nothing references it: the only
overlay `public/app.js` loads is `wine1.7.55-v8-min-online`. Kept because it
ships alongside the runtime upstream, but it has no effect on the site.
