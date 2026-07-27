# Changelog

All notable changes to this project are documented here. Format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning is
[SemVer](https://semver.org/).

## [Unreleased]

### Added
- Electron project scaffold: main process, preload, minimal renderer, and
  electron-builder packaging config alongside the existing `master.py`
  chain (#1)
- Mastering UI: input/output file pickers, loudness preset dropdown, and a
  "Master" button (not yet wired to `master.py`) (#2)
- Wired the Master button to `master.py` via a spawned child process; app
  auto-detects a project-local `.venv/bin/python3` if present, falling back
  to plain `python3` (#3)
- Live mastering progress log in the UI, streamed from `master.py`'s
  stdout/stderr as it runs (#4)
- Drag-and-drop: drop a folder onto the app to batch-master every
  wav/aiff/flac track in it (output to `<folder>/mastered/`), or drop a
  single file to populate the input picker (#5)
- `npm run pack`/`npm run dist` produce a macOS distributable
  (`dist/mac-arm64/Slopinator.app` + `.dmg`), bundling `master.py` as an
  extra resource and auto ad-hoc-signing via `scripts/sign-mac.sh` so
  Gatekeeper doesn't trash the packaged app (#6)
- The distributable is now fully self-contained: `master.py` and its deps
  are frozen into a standalone `master-bin` binary via PyInstaller
  (`scripts/freeze-python.sh`, run automatically as a `prepack`/`predist`
  hook) — no system Python or venv required at runtime (#7)
- `master.py --analyze <file>` measures integrated LUFS, oversampled true
  peak, duration, sample rate, channels, and bit depth of an unprocessed
  file and prints it as JSON, without running the mastering chain (#9)
- Track library data layer (`src/main/library.js`): a JSON store in
  Electron's `userData` dir, with `library-list`/`library-add`/
  `library-update`/`library-remove`/`library-analyze` IPC handlers. Not
  wired to any UI yet — foundational for the Library screen in the redesign
  (#10)
- New app shell: tab navigation (Library / Chain view / Compare / Export)
  and the `docs/design/mockup.html` visual design system (dark theme, Space
  Grotesk/Manrope/JetBrains Mono), replacing the single-screen UI. Existing
  mastering functionality (pickers, preset dropdown, Master button,
  drag-drop, live log) moved into the Chain view tab, restyled but
  functionally unchanged; Library/Compare/Export are placeholders until
  their own to-dos land (#11)
- `master.py --peaks <file> --buckets N` prints N downsampled peak values
  (0-1) for waveform display, without a full-resolution decode — max
  absolute sample across all channels per bucket, so a quiet channel isn't
  masked by averaging. New `get-peaks` IPC handler exposed as
  `window.slopinator.getPeaks()`. Not wired to any UI yet — foundational for
  Chain view and Compare's real waveforms (#12)
- In-app audio playback (`src/renderer/player.js`): a thin wrapper around a
  shared `<audio>` element, exposed as `window.player`
  (load/play/pause/toggle/seekToFraction/isPlaying/onTimeUpdate/onEnded).
  Not wired to any UI yet — foundational for Chain view's waveform and
  Compare's A/B listen buttons (#13)
- Library screen is now real (`src/renderer/library-view.js`): track rows
  (status dot, measured loudness/peak, tag) backed by `src/main/library.js`;
  "+ Import tracks" and drag-drop (files or whole folders, non-audio files
  skipped) add tracks and auto-analyze them via the new `library-import`
  IPC handler (expands folders using the same extension-scan pattern as
  batch mastering); clicking a row switches to Chain view with that
  track's path pre-selected as the input. Library is now the default
  active tab (#14)
- Chain view is now a real interactive module rack
  (`src/renderer/chain-view.js`): 5 clickable modules (EQ, Mono bass,
  Saturation, Loudness, Limiter) with an expandable detail panel — sliders
  for crossover/saturation drive/loudness target/limiter ceiling, bypass
  toggles for EQ/mono-bass/saturation, loudness preset chips — mapping
  directly to `master.py`'s real CLI flags, replacing the single
  format-preset dropdown. Real waveform bars via `getPeaks()`, played back
  via `window.player` with live playhead highlighting. On a successful
  master run of a track opened from the Library, `libraryUpdate`s it to
  `status: 'mastered'` with the preset (if any) and timestamp (#15)
- Meter sidebar in Chain view: integrated LUFS reading and a 10-rung true
  peak ladder (teal/amber/red zones), parsed from `master.py`'s own
  "Done. Final: ..." line after a completed single-file run. Shows the
  *final* measured values, not live metering during processing. Widened
  the app window (980×720) and `.app-frame` (860px) to fit the new
  two-column Chain view layout (#16)
- App icon (`assets/icon.png`) — used for the dev window and, via
  electron-builder's `directories.buildResources`, auto-generated into a
  proper `.icns` for the packaged app (#17)
- Compare screen is now real (`src/renderer/compare-view.js`): before/after
  cards for whichever track is loaded in Chain view, once it's been
  mastered — real loudness/true-peak stats, real waveforms, and A/B listen
  buttons via `window.player`. Shows an explanatory placeholder if no
  track is selected or it hasn't been mastered yet. Refreshes on tab
  activation (`renderer.js` now dispatches a `screen-activated` event)
  rather than tracking its own selection (#18)
- Export screen is now real (`src/renderer/export-view.js`): every
  analyzed library track queues up with its target shown; "Export to
  folder…" re-masters each one sequentially into the chosen folder using
  the exact params it was mastered with in Chain view (`masteredParams`,
  falling back to the rack's current settings), with stepped per-track
  progress (queued / rendering / done / failed — `master.py` reports
  nothing mid-file, so there's no honest percentage). Format selector
  (WAV 16-bit dithered / WAV 24-bit / FLAC 16-bit) wired to `--bit-depth`
  plus the output extension; new `pick-export-folder` IPC handler (#19)
- Named chain presets: save the rack's current params under a name, apply
  or delete saved presets from a bar under the module detail panel in
  Chain view. Stored in `presets.json` beside `library.json`
  (`loadPresets`/`savePreset`/`deletePreset` in `src/main/library.js`;
  `presets-list`/`presets-save`/`presets-delete` IPC). Saving under an
  existing name overwrites. Lives in Chain view rather than the mockup's
  Export placement — Export already re-uses per-track `masteredParams`,
  and the rack being snapshotted is edited here (#20)
- Settings menu (gear in the titlebar) with one option: UI mode, "Normal"
  or "Cringe" (`docs/design/mockup-cringe.html`). Cringe mode is purely
  cosmetic — `src/renderer/cringe.css` restyles everything under a
  `body.cringe` class (largely by redefining the design-system CSS
  variables), and `src/renderer/settings.js` swaps static labels, shows a
  marquee + blinking badge, and rains confetti. Same DOM, so every screen
  works identically in both modes. Persisted in `localStorage` (#21)
- Library rows gained a remove ("✕") button — confirms first, then calls
  the existing `library-remove` IPC handler (`library.removeTrack()`,
  already wired since #10/#26 but never exposed in the UI). Deletes the
  track's library entry and its preview file; the original audio file on
  disk is untouched (#28)
- Missing-file detection for tracks whose source file was moved/deleted
  outside the app: `library-view.js`'s `refreshLibrary()` now stats every
  track's path (via the existing `classify-path` IPC) in parallel on
  each refresh and renders a red "file missing" status dot/tag plus the
  path itself in place of duration/date; the library count line adds a
  "N missing" segment. Chain view does the same check in
  `selectChainInput()` before loading the waveform — shows "File not
  found…" in place of the path and disables Play/Master, instead of
  silently leaving a blank waveform with both buttons still clickable
  (#29)
- Redesigned the module rack's Bypass control: a circular power-icon
  button (amber glow + ring when engaged, plain outline when bypassed)
  with a "Processing on"/"Bypassed" status label beside it, replacing
  the cramped inline On/Off pill switch (#30)
- Click-to-seek on every waveform: clicking anywhere in Chain view's
  waveform, or either of Compare's before/after waveforms, jumps
  playback to that point (`window.player.seekToFraction()`, already
  existed for a planned feature but was unused until now). Clicking
  loads the corresponding track into the shared player first if it
  wasn't already the one loaded (Compare) or already-selected input
  (Chain view), then seeks and starts playback if not already playing,
  mirroring the existing Listen-button/Play-button behavior (#31)

### Changed
- README setup instructions now use a `.venv` instead of a global
  `pip install`, since Homebrew Python blocks global installs (#3)
- `run-master`/`run-master-batch` IPC handlers take a full `params` object
  (target/ceiling/crossover/saturationAmount/eq/monoBass/saturation)
  instead of a single `format` string, to carry the rack's full parameter
  set (#15)
- `run-master`'s result now includes `finalLufs`/`finalTruePeakDb`, parsed
  from the run's own stdout server-side, instead of leaving log-scraping
  to the renderer (#16)
- Library track schema gained `masteredPath`/`masteredLufs`/
  `masteredTruePeakDb`/`masteredParams`, snapshotted on a successful master
  run — needed by Compare to know what to show and play back, and by the
  Loudness/Export to-dos later (#18)
- `window.player` gained `getCurrentPath()` — needed once more than one
  screen (Chain view, Compare) shares the same underlying `<audio>`
  element, so each can tell whether the currently loaded/playing file is
  actually its own before reacting to `onTimeUpdate`/`onEnded` (#18)
- Chain view's Master button no longer has an output-path picker —
  it renders to an app-managed preview slot instead
  (`<userData>/previews/<trackId>.flac`, one file per track, FLAC).
  Writing to a real, user-chosen destination is Export's job alone now.
  This is what removed the duplicate-file bug where mastering a track in
  Chain view and then batch-exporting from Export produced two different
  files under two different naming conventions for the same track — see
  "Preview vs export" in `docs/context.md`. Library track schema split
  the old `mastered*` fields into `preview{Path,Lufs,TruePeakDb,Params,
  Preset,edAt}` (Chain view's slot) and `exported{Path,At}` (Export's
  last real destination); Export's queue now only shows a track if it's
  never been exported or has been re-dialed in Chain view since
  (`previewedAt > exportedAt`), instead of unconditionally reprocessing
  everything on every run. `window.player.load()` gained a `force` param
  to bypass its same-path caching, needed because a preview's path is
  fixed and reused, so it can point at different bytes after a
  re-master (#26)
- New `library.previewPathForTrack()`/`sweepPreviews()`: previews are
  never authoritative (always regenerable from `previewParams`), so a
  startup sweep (`app.whenReady()` in `main.js`) aggressively deletes
  orphaned (track no longer exists) and stale (>30 days) preview files
  without needing to be conservative — the worst case is a one-second
  re-render next time Compare needs it. `library.removeTrack()` also
  deletes a track's preview immediately rather than waiting for the
  sweep (#26)
- Chain view is now library-only: removed the folder/file drop zone and
  the input-file picker, since the Library screen is the sole way to get
  a track into Chain view. Named chain presets (the "Apply preset…"
  dropdown) moved to between the Play button and the module rack, and
  ship prepopulated with three defaults tuned per playback target —
  Streaming (-14 LUFS, gentle drive, -1dBTP), Soundcloud (-11 LUFS,
  -1dBTP) and Club (-8 LUFS, more drive, -0.3dBTP) — seeded into
  `presets.json` on first read (`library.loadPresets`) rather than
  starting empty. "Club" is applied by default on every launch, not the
  last-used selection. Loudness's quick-target chips are now
  capitalized ("Streaming"/"Soundcloud"/"Club"), and the Bypass toggle
  got a wider, more tactile pill styling instead of a cramped inline
  A/B switch (#27)

### Changed (size)
- Distributable shrunk from 311MB .app / 122MB .dmg to 263MB / 105MB:
  pruned 54 Chromium locale packs from the Electron framework (all but
  `en.lproj`, in `afterSign.js` before signing), excluded proven-unused
  stdlib modules (`ssl`/`_ssl`/`_hashlib` → drops libcrypto/libssl) and
  stripped docstrings (`--optimize 2`) in the PyInstaller freeze, and
  switched the DMG to lzfse compression (`format: ULFO`). scipy (39MB)
  can't be pruned by excludes — see the "App size" section in
  `docs/context.md` and the numpy-DSP to-do (#22)
- Distributable shrunk further to 220MB .app / 92MB .dmg: scipy (39MB)
  replaced entirely by `dsp.py`, a numpy-only reimplementation of the
  `butter`/`filtfilt`/`resample_poly`/`lfilter` calls `master.py` and
  pyloudnorm need, verified against real scipy by `tests/compare_dsp.py`
  (sample-level diff on real audio: exactly float32 epsilon — pure
  storage rounding, not an algorithmic difference). `master.py` stubs
  `sys.modules['scipy.signal']` with a `dsp.lfilter`-backed shim before
  importing pyloudnorm, whose K-weighting filter otherwise imports the
  real scipy. `freeze-python.sh` also needs an explicit
  `--exclude-module scipy` even with scipy fully unimported at
  runtime — PyInstaller bundles by static `import` analysis, and
  pyloudnorm's source still has `import scipy.signal` at module level
  (#23)

### Fixed
- Exporting a track from the Export screen genuinely mastered it but
  never told the Library — `status` stayed `needs_mastering` forever,
  and Compare kept insisting the track "hasn't been mastered yet" even
  though a real mastered file now existed on disk. Each successful
  export now `libraryUpdate`s the track (status/masteredPath/
  masteredLufs/masteredTruePeakDb/masteredParams/masteredPreset/
  masteredAt), the same shape Chain view's Master button already writes
  (#25)
- Library screen never re-rendered on tab revisit (only Compare/Export
  listened for `screen-activated`) — mastering a track in Chain view left
  its Library row showing the stale pre-mastering status/tag until the
  app restarted. `library-view.js` now refreshes on activation too (#24)
- Export queued tracks that were never mastered in Chain view using
  whatever params happened to currently be sitting in the rack — leftover
  edits from an unrelated track would silently apply to a track the user
  never touched. Replaced with fixed defaults (`master.py`'s own), and
  the queue row now says "(default)" so it's not mistaken for a real
  per-track choice. Removed the now-unused `window.getChainParams()` (#24)
- `master.py` now line-buffers stdout explicitly
  (`sys.stdout.reconfigure(line_buffering=True)`), since plain `-u` /
  `PYTHONUNBUFFERED` didn't reach a PyInstaller-frozen binary's stdout and
  silently broke the live progress log (#4) for packaged builds (#7)
- The signed `.dmg` from `npm run dist` was actually shipping an unsigned
  app: the `postpack`/`postdist` signing script (#6) ran after
  electron-builder had already packed the `.app` into the `.dmg`, so the
  `.dmg` kept the old insufficient signature no matter what got signed
  afterward. Replaced with `scripts/afterSign.js`, wired through
  electron-builder's own `build.afterSign` hook so signing happens before
  the `.dmg` is built (#8)

## [0.1.0] - 2026-07-25

### Added
- Initial mastering chain: corrective EQ, mono bass, saturation, loudness
  normalization, true-peak limiter, dither on export.
- Loudness presets (`streaming`, `soundcloud`, `club`) and batch mode.

## Updating per PR

Add a bullet under `## [Unreleased]`, in the group matching the change type
(`Added` / `Changed` / `Fixed` / `Removed`), ending with the PR number, e.g.:

```
### Added
- Electron window shell wrapping the CLI mastering chain (#4)
```

Delete empty group headers when the section is otherwise empty; leave the
group headers under `[Unreleased]` in place (even empty) between PRs so the
next PR has somewhere to add its bullet.

## Versioning

Bump the version when cutting a release, not per-PR:

- **Patch** (`0.1.x`) — bug fixes only.
- **Minor** (`0.x.0`) — new features, backwards-compatible.
- **Major** (`x.0.0`) — breaking changes (e.g. CLI flag removal, output
  format changes).

To cut a release: rename `[Unreleased]` to the new version + today's date,
then add a fresh empty `[Unreleased]` section above it with the three group
headers.
