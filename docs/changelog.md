# Changelog

All notable changes to this project are documented here. Format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning is
[SemVer](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Fixed
- v0.2.0's release notes went out as three empty headers, then (after a
  manual rewrite) as a verbatim technical changelog dump — the
  `release-notes` CI job hardcoded extracting `[Unreleased]`, which by
  release time was the empty placeholder for *this* section, not what
  had actually shipped. Now extracts the section matching the real
  released version instead. Doesn't fix the deeper issue that the
  extracted content is written for this file, not for a public release
  — still needs a hand-written rewrite before publishing, see
  `docs/context.md`'s gotcha for the actual style bar (#50)

## [0.2.0] - 2026-07-28

### Added
- New **Stereo Width** module in Chain view's rack, between Mono bass
  and Saturation — a bypass toggle plus a 0–200% width slider (100% =
  unchanged). `stereo_width()` in `master.py` does plain mid/side
  processing (encode → scale the side channel → decode back); runs
  after `mono_bass()` so widening only ever touches content that's
  already safe to spread out, never fighting its below-crossover mono
  safety. New `--width`/`--no-width` CLI flags,
  `params.width`/`params.widthAmount` end to end (Chain view → IPC →
  Export's per-track params/preset matching). All three built-in
  presets updated: Streaming stays at 100% (needs to translate safely
  across every playback system), Soundcloud and Club get a bit wider
  (110%/115%) since headphones and a PA system both take extra size
  well. `library.js`'s `loadPresets()` backfills width onto any
  presets.json saved before this existed too (tuned value for a
  built-in preset name, neutral 100% for a custom one) rather than
  leaving it silently unset on already-existing installs — a one-time
  migration, persisted back to disk, never touching already-mastered
  tracks' own `previewParams` (a record of what was actually rendered,
  not a template to retroactively rewrite). Compare screen gained a
  "Stereo width" stat next to the existing "Stereo bass" one, showing
  the mastered side's actual width setting (#45)

### Changed
- Upgraded Electron `31.7.7` → `43.2.0` and `electron-builder` `24.13.3`
  → `26.15.3` (12 major Electron versions — latest stable, prompted by
  Windows testing surfacing how far behind it had drifted). Discovered
  along the way: `electron-builder` 26.x's `electronLanguages` option
  now actually prunes `Electron Framework.framework`'s real locale
  packs itself (it didn't in 24.x, which is why
  `scripts/afterSign.js`'s manual `pruneFrameworkLocales()` existed) —
  it now runs 0 times in practice, kept only as a defensive no-op.
  `npm audit` flags 16 high-severity issues, all transitive
  dev-tooling dependencies inside `electron-builder` itself (glob/
  brace-expansion, used only at build time, never shipped in the app)
  — not addressed here, tracked as a separate follow-up. Verified
  locally: dev launch, and a full `npm run dist` (mac) producing a
  correctly signed, launchable `.app`/`.dmg`; Windows/Linux builds are
  only verified by the next CI release run, same as every other
  cross-platform change this project has made (#48)

### Fixed
- Windows: nothing played when hitting play in Chain view/Compare —
  `player.js`'s `toFileUrl()` split paths on `/` only, so a Windows path
  (backslashes, drive letter) never split at all and got
  `encodeURIComponent`'d as one opaque segment, including the drive
  letter's `:`, producing a `file://` URL Chromium couldn't resolve. Now
  normalizes backslashes to `/` first and leaves a drive-letter segment
  un-encoded (#46)
- Windows: `master.py` crashed with `UnicodeEncodeError` from `cp1252`
  the moment a track's path contained a character outside that codepage
  (e.g. a non-breaking hyphen), since stdout only had line-buffering
  reconfigured, not encoding. `sys.stdout`/`sys.stderr` now force
  `encoding="utf-8", errors="replace"` (#46)
- Mastering any file crashed with `AttributeError: module 'math' has no
  attribute 'fma'` on any Python older than 3.13 (`math.fma` was added in
  3.13) — hit on a fresh Windows venv reported after #46 fixed the
  playback/encoding bugs, but not actually Windows-specific: the frozen
  `master-bin` picks up whatever Python built it, and this app never
  pinned a minimum version anywhere. `dsp.py`'s `_zi_transient()` now
  falls back to a plain multiply-add when `math.fma` isn't available;
  the fallback double-rounds instead of single-rounding, differing at
  the last bit or two, which is inaudible and still far inside the
  bounded-transient's precision budget (#47)
- The first real release run: `release-notes`'s `gh release edit
  "${{ github.ref_name }}"` failed with "release not found". Root
  cause: electron-builder names its GitHub release
  `v<package.json's "version">` regardless of what git tag actually
  triggered the build (`vPrefixedTagName`, on by default) — the pushed
  tag was `v0.1`, `package.json` was still `"0.1.0"`, so
  electron-builder published to `v0.1.0` while the job kept looking for
  a release literally named `v0.1`. `release-notes` now re-derives the
  real tag straight from `package.json` (matching how electron-builder
  computes it) instead of trusting the git ref that triggered the
  workflow (#44)
- Adding the Width module's rack tile (6 modules now, up from 5) made
  Chain view need a horizontal scrollbar for the *whole page*, not just
  the rack strip. `.chain` already had `overflow-x:auto` for exactly
  this, but `.chain-main` (the rack's grid column in `.chain-layout`)
  had no `min-width:0` — grid items default to `min-width:auto`, which
  refuses to shrink below its content's intrinsic min size, so the
  column blew out instead of clipping. Fixed the grid item, tightened
  `.module` (112px min-width/12px margin → 90px/8px, now `flex:1 1
  90px` so tiles fill any slack evenly instead of sitting at a fixed
  size), and widened `.app-frame` (860px → 960px) and the window
  (980px → 1080px) for real breathing room rather than a razor-thin
  fit (#45)
- Windows taskbar icon rendered as corrupted rainbow noise instead of
  the actual artwork. electron-builder was auto-generating the `.ico`
  from `assets/icon.png` (782×782, no explicit `build.win.icon`) at
  build time, and that conversion produced garbage — macOS's `.icns`
  generation from the same source was fine. New
  `scripts/build-ico.js` packs pre-resized 16–256px PNGs into a proper
  multi-resolution `.ico` directly (plain buffer-writing, no new
  dependency — the ICO container format is simple enough), committed
  as `assets/icon.ico` and wired in via `build.win.icon`, bypassing
  electron-builder's auto-conversion entirely. Verified by extracting
  the actual embedded icon resource from a locally cross-built `.exe`
  and confirming it decodes as the real artwork, not just that the
  build succeeded (#49)

## [0.1.0] - 2026-07-28

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
- Export queue rows gained a per-track preset dropdown (Streaming/
  Soundcloud/Club, sourced from the same `presets.json` Chain view
  reads/writes) that overrides that track's export target for this
  export only, without touching what's saved in Chain view
  (`export-view.js`'s in-memory `exportOverrides` map). Each row also
  gained its own "Export…" button to export a single track without
  running the whole queue (#33)
- `master.py --transcode` re-encodes already-mastered audio to a
  different container/bit depth without re-running the mastering
  chain, and Export now uses it: a WAV-16/FLAC-16 export of a track
  using its dialed-in Chain view params (no preset override) reuses
  the existing preview file instead of redoing the full EQ/mono-bass/
  saturation/loudness/limiter pass from the original source — the
  preview is already that exact render, always at PCM_16. WAV-24
  exports, and any export using a preset override, still do a full
  fresh render, since the preview never held 24-bit precision and an
  override means the preview's audio doesn't match what should ship.
  New `run-transcode` IPC handler (#33)
- Elapsed / total time counter (`0:00 / 0:00`-style) under every
  waveform — Chain view's, and both of Compare's before/after. Total
  comes from `getPeaks()`'s own `duration_sec` (known as soon as the
  waveform renders, independent of whichever file the shared player
  currently has loaded); elapsed comes from the new
  `window.player.getCurrentTime()` during playback, and updates
  instantly on click too, alongside the existing bar highlighting (#35)
- Build number in the footer (`Build #N (commit)`), so a running or
  packaged app can be matched back to an exact commit instead of
  guessing whether it's stale — several bug reports this project has had
  turned out to be exactly that. `N` is `git rev-list --count HEAD`
  (monotonically increasing, no counter file to maintain); `commit` is
  the short hash, `+dirty` suffixed if there were uncommitted changes at
  build time. New `scripts/generate-build-info.js` writes
  `src/main/build-info.json` (gitignored, regenerated every run), run via
  new `prestart`/updated `prepack`/`predist` hooks; `preload.js` reads it
  directly (no IPC round trip needed) and exposes it as
  `window.slopinator.buildInfo` (#38)
- Windows and Linux release targets: `build.win` (portable `.exe`) and
  `build.linux` (`AppImage`) in `package.json`, alongside the existing
  macOS `.dmg`. `scripts/freeze-python.sh` rewritten as
  `scripts/freeze-python.js` — PyInstaller can't cross-compile, so
  `master-bin` has to be frozen natively on each OS, and bash alone
  doesn't know a venv's executables live in `.venv/bin` on macOS/Linux
  but `.venv/Scripts` on Windows. `main.js` picks `master-bin/master.exe`
  vs `master-bin/master` by `process.platform`.
  `scripts/afterSign.js` now no-ops on non-macOS (`.app`-bundle pruning/
  signing doesn't apply there, and electron-builder's `afterSign` hook
  can fire for Windows too). New `.github/workflows/release.yml`
  builds all three platforms in parallel on GitHub-hosted runners and
  publishes to the GitHub Releases tab (`build.publish` in
  `package.json`), triggered by pushing a `v*` tag. New root
  `requirements.txt` for the workflow's Python setup. Windows/Linux
  builds are unsigned (no Authenticode cert — see `docs/todos.md`) (#42)
- Release workflow now publishes as a draft (`releaseType: "draft"` in
  `package.json`'s `build.publish`) rather than going live immediately,
  and a new `release-notes` job (runs once, after all three platform
  builds finish uploading) fills the draft's title
  (`Slopinator <tag>`) and body from `docs/changelog.md`'s
  `[Unreleased]` section via `gh release edit`, so it's ready to review
  and publish by hand instead of starting from an empty description
  (#43)
- Rewrote `README.md` from scratch — it was still entirely about the
  original `master.py` CLI script from before the Electron wrapper
  existed, with no mention of the actual app's four tabs (Library/
  Chain view/Compare/Export) at all. Now covers using the app itself
  (screen by screen), a "For developers" section (dev setup, project
  structure, building distributables, the release process, testing
  `dsp.py` against real scipy), and keeps `master.py`'s direct CLI
  usage as a secondary "advanced" section rather than the primary
  framing (#43)

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
- Export's fallback default for never-dialed-in tracks was hardcoded to
  `-14 LUFS streaming`, left over from before Chain view's default
  became "Club" (#27) — every un-dialed track in the queue silently
  exported at the wrong target with no way to change it short of
  opening it in Chain view first. Now falls back to the actual "Club"
  preset from `presets.json` (with a hardcoded Club-shaped fallback only
  if that preset was deleted), and the new per-row preset dropdown lets
  it be overridden directly from Export either way (#33)
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
- `.bar`'s CSS (`width:3px; flex-shrink:0`) meant a waveform's bars
  packed to the left of their container instead of filling it, so
  clicking near the right edge (#31) would seek correctly by fraction
  but land on a point well past where the visible bars actually ended.
  Bars now use `flex:1 1 0` so they always span the full container width,
  matching the click math exactly (#32)
- Compare's before/after waveforms never highlighted played bars during
  playback — only Chain view's did. Both now track `window.player`'s
  `onTimeUpdate` against `originalPath`/`previewPath` the same way Chain
  view does against its own `inputPath` (#32)
- Reopening an already-mastered track in Chain view (via the Library, or
  switching to another track and back) always blanked the meter sidebar
  and left whatever settings another track happened to leave dialed into
  the rack, instead of restoring that track's own result.
  `selectChainInput()` now looks the track up and, if it has
  `previewParams`/`previewLufs`, restores both the rack and the meter
  reading to what actually produced that track's last master, rather
  than only doing this for the track open when the app launched (#34)
- Chain view's `inputPath` and Compare's `originalPath` are frequently
  the exact same source file, so both screens' `window.player.onTimeUpdate`
  handlers matched simultaneously — playing the original from Chain view
  also drove Compare's "before" bar highlighting and time counter (#35),
  and vice versa, even on the screen you weren't looking at. New
  `window.player.setOwner()`/`getCurrentOwner()` tags which screen last
  initiated playback/seek (`'chain'`/`'compare-before'`/`'compare-after'`);
  each screen's progress handlers now gate on owner *and* path instead of
  path alone (#36)
- The `<marquee>` in Cringe mode only auto-scrolls if it's already
  visible at layout time — it's `display:none` in normal mode, so
  toggling to Cringe via the settings menu left it sitting frozen (only
  a full reload, where `body.cringe` is applied before first paint,
  actually started it). `settings.js`'s `applyMode()` now calls the
  marquee's own `start()` method when switching to Cringe (#37)
- #38's build-info footer broke *every* `window.slopinator.*` call —
  including Library import — in any real (non-dev-shortcut) launch:
  `preload.js` runs under Electron's sandboxed preload (default since
  Electron 20; this app is on 31 and never opts out), which has no
  generic `require('fs')`/`require('path')`. Adding those directly threw
  at preload parse time, silently killing the whole script before
  `contextBridge.exposeInMainWorld()` ever ran, so `window.slopinator`
  was `undefined` everywhere — not just for the build number. Moved the
  `build-info.json` read into `main.js` (never sandboxed) behind a new
  `get-build-info` IPC handler; `preload.js` now only calls
  `ipcRenderer.invoke('get-build-info')`, same pattern as everything else
  it exposes (#39)
- Chain view's waveform time counter (#35) never actually updated —
  frozen at its static `0:00 / 0:00` HTML default with no console
  errors. Root cause: `chain-view.js` and `compare-view.js` are plain
  `<script>` tags sharing one global scope, and both independently
  declared a top-level `function updateWaveTime(...)` with different
  signatures. `compare-view.js` loads after `chain-view.js` in
  `index.html`, so its 3-arg version silently won the collision — every
  1-arg call from `chain-view.js` ran the wrong function body, setting
  `.textContent` on a bare number instead of a DOM element (a silent
  no-op, not a thrown error). Renamed both files' now-duplicate helpers
  to `formatChainTime`/`updateChainWaveTime` and
  `formatCompareTime`/`updateCompareWaveTime` so they can't collide
  (#40)
- Export's per-row preset dropdown always said "Dialed in Chain view
  (X LUFS)" for any track with `previewParams`, even one mastered from
  an unchanged Streaming/Soundcloud/Club preset — same generic label
  whether or not anything was actually tweaked. `renderPresetSelect()`
  now deep-compares `previewParams` against every saved preset's full
  param set (`eq`/`monoBass`/`crossover`/`saturation`/
  `saturationAmount`/`target`/`ceiling`, not just target) and shows the
  matching preset's real name when it's an exact match, falling back to
  a plain "Custom" label only when the params have genuinely diverged
  from every saved preset (#41)

## [0.0.0] - 2026-07-25

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
