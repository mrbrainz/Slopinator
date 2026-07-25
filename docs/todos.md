# To-dos

One item = one PR. Remove the finished item and renumber when done (see
[context.md](context.md) workflow).

## Redesign toward docs/design/mockup.html ("Chain")

Target is the 4-screen mockup at [design/mockup.html](design/mockup.html)
(Library / Chain view / Compare / Export). Sequenced so foundational
capabilities land before the screens that depend on them. Two things in the
mockup are scoped down from how they're drawn, since the underlying
capability doesn't really support them as-is:
- Export's mid-file progress bar → stepped (queued/rendering/done), not a
  smooth percentage — `master.py` has no progress reporting mid-file.
- The meter ladder → shows the *final* measured values after a run
  completes, not true real-time metering during processing.

1. Waveform peak extraction: decode an audio file down to a peaks array for
   rendering as bars (real data, not the mockup's random placeholder bars).
2. In-app audio playback (local file paths) — needed for Chain view's
   waveform and Compare's A/B listen buttons. Nothing plays audio today.
3. Screen 1 — Library: track rows (status dot, measured loudness/peak,
   tags) backed by the `library-*` IPC handlers (`src/main/library.js`);
   import via file picker/drag-drop (mostly exists) adds to the library via
   `libraryAdd`, then `libraryAnalyze` fills in stats and flips status to
   `needs_mastering`; row click opens Chain view for that track. Currently
   a placeholder in `src/renderer/index.html` (`#screen-library`).
4. Screen 2 — Chain view: interactive module rack exposing `master.py`'s
   real parameters as clickable modules with an expandable detail panel —
   EQ on/off, mono-bass crossover + bypass, saturation drive + on/off,
   loudness target, limiter ceiling (`--target`/`--ceiling`/`--crossover`/
   `--saturation`/`--no-eq`/`--no-mono-bass`/`--no-saturation`) — replacing
   today's single format-preset dropdown (`#screen-chain` currently has the
   original simple form UI, just restyled). Uses #1's waveform. On a
   successful master run, `libraryUpdate` the track to `status: 'mastered'`
   with `masteredPreset`/`masteredAt` set.
5. Meter sidebar showing the real measured LUFS/true-peak/ladder parsed
   from `master.py`'s post-run output (see scoping note above on what
   "live" means here).
6. Screen 3 — Compare: before/after cards using `libraryAnalyze`'s real
   original-file stats and #2's real playback, replacing the mockup's
   static numbers. Currently a placeholder (`#screen-compare`).
7. Screen 4 — Export: batch export queue reusing the existing
   drag-and-drop batch logic, with real per-track status parsed from
   `master.py`'s streamed stdout (see scoping note above), and a
   format/bit-depth selector wired to `--bit-depth` + output extension
   (FLAC output already works — `soundfile` infers format from the `.flac`
   extension, confirmed by reading `master_file()`'s `sf.write` call).
   Currently a placeholder (`#screen-export`).
8. Save/reuse named chain presets ("Save presets used" in the mockup) —
   extend `src/main/library.js`'s store to remember a named parameter set a
   user can reapply to other tracks.

## Distribution

9. Real code signing + notarization (requires an Apple Developer ID
   certificate — ad-hoc signing only satisfies Gatekeeper on this machine,
   not on a build handed to someone else).
