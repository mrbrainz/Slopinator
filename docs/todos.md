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

1. Add a raw-file analysis mode to `master.py` (or a new script) that
   measures integrated LUFS + true peak of an unprocessed file. Needed by
   the Library screen's Loudness/Peak columns and by Compare's "Original"
   stats — nothing today measures a file before mastering it.
2. Track library data layer: local persisted store (Electron `userData`
   dir) of imported files — path, duration, sample rate/bit depth, import
   date, status (raw / needs mastering / mastered), last-measured stats.
   IPC handlers to add/list/update tracks. Nothing persists across runs
   today.
3. New app shell: tab navigation (Library / Chain view / Compare / Export)
   and the mockup's visual design system (colors, Space
   Grotesk/Manrope/JetBrains Mono, module-rack look) as shared styles,
   replacing the current single-screen UI.
4. Waveform peak extraction: decode an audio file down to a peaks array for
   rendering as bars (real data, not the mockup's random placeholder bars).
5. In-app audio playback (local file paths) — needed for Chain view's
   waveform and Compare's A/B listen buttons. Nothing plays audio today.
6. Screen 1 — Library: track rows (status dot, measured loudness/peak via
   #1, tags) backed by #2; import via file picker/drag-drop (mostly exists)
   writes into the library; row click opens Chain view for that track.
7. Screen 2 — Chain view: interactive module rack exposing `master.py`'s
   real parameters as clickable modules with an expandable detail panel —
   EQ on/off, mono-bass crossover + bypass, saturation drive + on/off,
   loudness target, limiter ceiling (`--target`/`--ceiling`/`--crossover`/
   `--saturation`/`--no-eq`/`--no-mono-bass`/`--no-saturation`) — replacing
   today's single format-preset dropdown. Uses #3's shell and #4's
   waveform.
8. Meter sidebar showing the real measured LUFS/true-peak/ladder parsed
   from `master.py`'s post-run output (see scoping note above on what
   "live" means here).
9. Screen 3 — Compare: before/after cards using #1's real original-file
   stats and #5's real playback, replacing the mockup's static numbers.
10. Screen 4 — Export: batch export queue reusing the existing
    drag-and-drop batch logic, with real per-track status parsed from
    `master.py`'s streamed stdout (see scoping note above), and a
    format/bit-depth selector wired to `--bit-depth` + output extension
    (FLAC output already works — `soundfile` infers format from the `.flac`
    extension, confirmed by reading `master_file()`'s `sf.write` call).
11. Save/reuse named chain presets ("Save presets used" in the mockup) —
    extend #2's library store to remember a named parameter set a user can
    reapply to other tracks.

## Distribution

12. Real code signing + notarization (requires an Apple Developer ID
    certificate — ad-hoc signing only satisfies Gatekeeper on this machine,
    not on a build handed to someone else).
