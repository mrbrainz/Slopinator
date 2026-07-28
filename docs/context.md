# Slopinator — context & working instructions

Read this first. [changelog.md](changelog.md) (history
+ versioning).

## What this is

I asked Claude to create a script to master audio and this is what it came up with.
I want to create a fully fledged Electron app

## Per-PR workflow (one to-do per PR)

1. `git checkout main && git pull`, then `git checkout -b feature/<name>`.
2. Implement — keep edits **surgical**.
3. Verify cheaply (see below).
4. Update [todos.md](todos.md): remove the finished item, renumber, fix any
   cross-refs.
4.5. Add a bullet under `## [Unreleased]` in [changelog.md](changelog.md) (right
   group, end with the PR number). Bump the version when cutting a release —
   see that file's "Updating per PR" / "Versioning" sections.
5. Commit (footer `Co-Authored-By: Claude {{model}} <noreply@anthropic.com>`),
   push, `gh pr create` (PR-body footer
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`).
6. **Stop** — the user merges and says "continue".

## Known gotchas

- **`preload.js` runs under Electron's sandboxed preload (default `true`
  since Electron 20; this app is on Electron 31 and never sets
  `sandbox: false`), which has no generic `require('fs')`/`require('path')`
  — only `require('electron')` and a curated subset of Node.** Adding a
  direct `require('fs')` (or similar) call in `preload.js` throws at
  parse time, which silently kills the *entire* preload script before
  `contextBridge.exposeInMainWorld()` ever runs — `window.slopinator`
  ends up completely undefined, breaking every single feature that
  depends on it, not just whatever you were adding. This happened for
  real (#38's build-info footer, fixed immediately after). Anything
  preload needs that isn't already exposed goes through an
  `ipcMain.handle()` in `main.js` (which is never sandboxed) and an
  `ipcRenderer.invoke()` wrapper in `preload.js`, same as everything
  else — never reach for a generic Node built-in directly in `preload.js`.
  This class of bug is also easy to miss in dev: `npm start`'s exit code
  alone won't show it (Electron doesn't crash the main process just
  because preload throws), and this sandboxed shell environment has no
  display to actually open/inspect the window — a broken preload needs
  an actual visual check (or reading `preload.js` for anything beyond
  `require('electron')`), not just "the process didn't immediately die."
- **`src/renderer/*.js` are plain classic `<script>` tags (no modules,
  no bundler), so every top-level `function`/`const`/`let` in every one
  of them shares a single global `window` scope.** Two files declaring
  the same top-level function name silently collide — no error, the
  later `<script>` tag in `index.html` just overwrites the earlier one's
  definition. This happened for real: both `chain-view.js` and
  `compare-view.js` independently added a `function updateWaveTime(...)`
  helper for the waveform time counters (#35), with *different*
  signatures (1 arg vs. 3). `compare-view.js` loads after `chain-view.js`
  in `index.html`, so its 3-arg version silently won — every
  `updateWaveTime(currentSec)` call from `chain-view.js` actually ran
  `updateCompareWaveTime`'s body with only 1 of its 3 args, so
  `el.textContent = ...` set a property on a bare number instead of a
  DOM element. That's a silent no-op in a non-strict global script (no
  thrown error), which is exactly why Chain view's counter stayed frozen
  at its static HTML default with nothing in the console to find (#40).
  Before adding a new top-level helper to any renderer file, check it
  isn't already the name of something in a *different* renderer file —
  grep across `src/renderer/*.js`, not just the one you're editing.
- **macOS trashes Electron.app as "malware" after `npm install`.** This is
  Gatekeeper/AMFI rejecting the prebuilt Electron binary's missing/invalid
  code signature ("no CMS blob" / "Unrecoverable CT signature issue"), not
  an actual compromised package. Fix after every fresh install (the binary
  gets re-downloaded into `node_modules/electron/dist/`):
  ```bash
  xattr -cr node_modules/electron/dist/Electron.app
  codesign --deep --force --sign - node_modules/electron/dist/Electron.app
  ```
  Do this before the first `npm start` / `electron .` in a clean checkout or
  after any `npm install` that touches the `electron` package.
- **Packaged builds (`npm run pack` / `npm run dist`) hit the same Gatekeeper
  issue.** `scripts/afterSign.js` runs automatically, wired via
  electron-builder's own `build.afterSign` config in `package.json`, and
  ad-hoc re-signs the app — no manual step needed.
- **Signing must happen via electron-builder's `afterSign` hook, not a
  `postpack`/`postdist` npm script.** We shipped it as a npm post-script
  first (#6/#7) and it silently produced broken `.dmg`s: npm post-scripts
  only run after the *entire* build finishes, but electron-builder packs the
  `.app` into the `.dmg` before that — so the `.dmg` had already baked in
  the old, insufficient signature by the time the npm hook ran and re-signed
  the loose `.app` sitting next to it. Always verify a `.dmg`'s actual
  contents after touching signing (`hdiutil attach` it, `codesign -dv` the
  mounted `.app`), not just the loose build output.
- **An unsigned `master-bin` binary (PyInstaller output) is ~24s slow on its
  very first run** — that's macOS scanning its ~600 bundled dylibs, not an
  actual perf issue (subsequent runs are <1s). `afterSign.js` signs it along
  with the rest of the app (`--deep`), which avoids this for end users.
- **PyInstaller-frozen `master.py` buffers stdout fully unless explicitly
  line-buffered in the script itself** (`sys.stdout.reconfigure(line_buffering=True)`
  at the top of `main()`). Plain `python3 -u` / `PYTHONUNBUFFERED=1` don't
  reliably reach a frozen binary's stdout — this broke the live progress log
  (#4) for packaged builds until fixed directly in `master.py`.
- **electron-builder's default build-resources directory is `build/`, which
  collides with `scripts/freeze-python.js`'s PyInstaller output
  (`build/pyinstaller*`, gitignored).** App icons etc. go in `assets/`
  instead — `package.json`'s `build.directories.buildResources` is set to
  `"assets"` to match. Don't put build resources in `build/`; they'd
  silently never get committed.
- **The footer shows `Build #N (commit)` — check it before debugging a
  reported bug that "isn't happening" in the code on `main`.** Several
  bug reports in this project turned out to be a stale running/packaged
  app that predated the fix already merged. `N` is `git rev-list --count
  HEAD` (monotonically increasing, no counter file needed) and `commit`
  is the short hash, `+dirty` if there were uncommitted changes at build
  time — both generated fresh by `scripts/generate-build-info.js` on
  every `npm start`/`pack`/`dist` (`prestart`/`prepack`/`predist` in
  `package.json`), written to `src/main/build-info.json` (gitignored,
  regenerated every run) and read by `preload.js`. If the footer's build
  number is older than the fix in question, the fix is real — the user
  just needs to relaunch (`npm start`) or rebuild (`npm run dist`).

## App size (approach + facts, PRs #22-#23)

Baseline was 311MB .app / 122MB .dmg. #22 (locale/stdlib pruning) got it
to 263MB / 105MB. #23 (dropping scipy) got it to 220MB / 92MB. Where the
bytes went and what was done:

- **~170MB: Electron Framework itself.** The floor for any Electron app —
  untouchable without leaving Electron.
- **54MB was Chromium locale packs** (55 × ~1.3MB `.lproj` inside
  `Electron Framework.framework`). `scripts/afterSign.js` deletes all but
  `en.lproj` before signing. Note: the `electronLanguages` option in
  `package.json` only prunes the *empty* `.lproj` stubs in the app's own
  `Contents/Resources` — it never touches the framework's real packs,
  which is why the manual prune exists.
- **PyInstaller `master-bin`.** `freeze-python.js` passes `--optimize 2`
  (strips docstrings) and `--exclude-module ssl/_ssl/_hashlib` — proven
  unused by running all three modes (master run, `--analyze`, `--peaks`)
  and checking `sys.modules`; drops libcrypto+libssl (6MB). **Before
  adding imports to `master.py`, check they don't need the excluded
  modules** — the frozen binary will fail at import time if they do
  (always rerun all three modes on a packaged build after touching Python
  deps).
- **scipy (was 39-43MB depending on measurement point) is gone
  entirely — not excluded, replaced.** `import scipy.signal`
  transitively imports every heavy scipy subpackage (stats, optimize,
  sparse, spatial…) at module level, so on its own
  `--exclude-module scipy.*` doesn't work as a size lever (verified
  empirically against real scipy — don't re-try it as a first move).
  `dsp.py` is a numpy-only reimplementation of the three scipy.signal
  functions `master.py` used (`butter`, `filtfilt`, `resample_poly`) plus
  `lfilter` (pyloudnorm calls this internally — see below), imported as
  `import dsp as signal` in `master.py`. **This still needs an explicit
  `--exclude-module scipy` in `freeze-python.js`** even with scipy fully
  unimported by our own code — PyInstaller decides what to bundle by
  *static* analysis of `import` statements in every module it collects,
  and pyloudnorm's `iirfilter.py` has `import scipy.signal` at module
  level; our runtime `sys.modules` stub (below) only changes what runs,
  not what PyInstaller's analyzer sees. Without the exclude, scipy came
  back in fully sized despite never being imported for real.
  **`tests/compare_dsp.py` is the proof this didn't change the sound** —
  it compares every function against real scipy across every filter
  shape `master.py` produces (needs `pip install scipy` in `.venv`, dev-
  only, never installed for the shipped app). **Run it before touching
  `dsp.py`** — the acceptance bar for the whole rewrite was "does not
  change the sound," not "looks right."
  - The non-obvious part of `dsp.py`: `filtfilt` needs a stable IIR
    recursion, which a per-sample Python loop can't do fast enough for
    real audio. The zero-state part is computed as FFT convolution with
    the filter's own truncated impulse response (decays below ~1e-17 of
    its peak within a few thousand samples for a stable filter, so
    truncating there is exact to machine precision) — split into
    gain-balanced biquad sections first, because one un-split stage for a
    near-unit-circle pole cluster (e.g. order-4 lowpass at 40Hz/96kHz)
    has ~1e11 internal gain, which amplifies FFT rounding past any
    reasonable tolerance. The zero-*input* transient from filtfilt's
    initial conditions is kept as an actual sample-by-sample recursion on
    purpose — folding it into the convolution path needs the same ~1e11
    of cancellation, catastrophic in floating point, while the recursion
    only ever holds the bounded net state; it's short (transient decays
    within the same few thousand samples) so the loop cost is negligible.
  - `dsp.py`'s `butter()` caches the exact zeros/poles it designs, keyed
    by the resulting `(b, a)` bytes. `filtfilt`/`_make_sos` look them up
    from there rather than recomputing via `np.roots(a)` — a Butterworth
    lowpass has a repeated root (e.g. a quadruple zero at −1), and
    `np.roots` on a repeated root is only accurate to about
    `eps**(1/multiplicity)` ≈ 1e-4, nowhere near float64 precision. If a
    filter design not created by this `butter()` needs `filtfilt`, add it
    to the cache the same way rather than trusting the `np.roots`
    fallback for anything with repeated/near-repeated roots.
  - `master.py` stubs `sys.modules['scipy']`/`['scipy.signal']` with a
    tiny shim backed by `dsp.lfilter` **before** `import pyloudnorm` —
    pyloudnorm's K-weighting filter (`iirfilter.py`) does
    `import scipy.signal` and calls `scipy.signal.lfilter` directly. This
    is the one place `dsp.py`'s `np.roots`-based fallback path actually
    runs (pyloudnorm's biquads have simple well-separated roots, so it's
    fine there) rather than the cached-zpk path.
- **DMG uses `format: ULFO`** (lzfse) — compresses better than the
  default.

## Preview vs export (PR #26)

Two deliberately separate things a track can have, easy to conflate if
you're only skimming the schema:

- **`preview{Path,Lufs,TruePeakDb,Params,Preset,edAt}`** — Chain view's
  own slot. One file per track at a fixed, app-managed path
  (`<userData>/previews/<trackId>.flac`, via
  `library.previewPathForTrack()`), written *only* by Chain view's
  Master button. This is for dialing in settings and auditioning in
  Compare — never a final deliverable, and never presented to the user
  as a save location (Master has no output-path picker at all anymore).
- **`exported{Path,At}`** — the last real, user-chosen destination
  Export wrote a file to. Export reads `previewParams` (falling back to
  fixed defaults for a track never opened in Chain view) but never
  writes the preview fields back — exporting doesn't change what's
  dialed in, it just records that version as committed to a real file.

This split exists because the two used to be the same field
(`masteredPath` etc.), each written by a different screen with its own
naming convention and its own idea of where to save — which meant
mastering a track in Chain view and then batch-exporting from Export
produced two different files under two different names for the same
track, silently, every time. Export's queue now only shows a track if
`!exportedAt || previewedAt > exportedAt` (never exported, or re-dialed
since the last export) — that's what makes running Export twice not
duplicate every file. If you're adding a third place that writes a real
output file, give it the same `exportedAt`-style bookkeeping rather than
inventing a fourth path field.

**Export reuses the preview when it can, instead of re-running the whole
chain (PR #33).** The preview file is already a full render of
`previewParams`, always at `PCM_16` (Chain view's Master button never
passes a `bitDepth`). So a WAV-16/FLAC-16 export of a track using its
dialed-in params (no per-row preset override — see below) skips straight
to `master.py --transcode`, which just decodes+re-encodes the preview
file with no EQ/mono-bass/saturation/loudness/limiter pass at all — the
DSP work is already baked into the preview's bytes. A WAV-24 export
always does a full fresh render from the original source, because the
preview never held 24-bit precision to begin with; same for any track
where the Export row's preset dropdown overrides the dialed-in params,
since then the preview's audio no longer matches what should ship.
`export-view.js`'s `exportOverrides` map holds those per-row overrides
in memory only (cleared on refresh/successful export) — they never
touch `previewParams`, so overriding a track's target for one export
doesn't change anything Chain view or Compare see.

**Previews are never authoritative — always regenerable** from
`previewParams` (mastering one track takes about a second), which is
what makes it safe to garbage-collect them aggressively:
- `library.removeTrack()` deletes a track's preview file immediately.
- `library.sweepPreviews()` runs once on every launch (`app.whenReady()`
  in `main.js`) and deletes any preview file whose track no longer
  exists (orphan) or that's older than 30 days regardless (stale) — it
  doesn't need to be conservative, because the worst case is just a
  re-render next time it's needed.
- Compare (`compare-view.js`'s `regeneratePreviewIfMissing`) checks the
  file actually exists on disk before using it, and silently re-renders
  if not, rather than erroring. A track can also be `status: 'mastered'`
  with `previewPath: null` — exported straight from Export's defaults,
  never opened in Chain view — and Compare shows an honest "open it in
  Chain view" message for that case instead of pretending there's
  something to A/B.
- Preview format is FLAC (not WAV) purely for footprint — lossless, no
  behavior difference, `player.js`/`getPeaks()` already handle it
  identically to WAV via `soundfile`.

**Gotcha this surfaced**: `window.player`'s shared `<audio>` element
caches by path (`currentPath === filePath` skips reloading) as a normal
optimization — but a preview's path is fixed and reused, so after a
re-master the same path now points at different bytes on disk. `load()`
takes a `force` param to bypass the cache for exactly this case; any new
code that plays back a preview/export path (not a stable, never-rewritten
source file) needs to pass it.

- Don't re-read files you've seen; use `Read` with offset/limit and `grep`, not
  whole-file dumps. Never paste large network logs.
- Delegate bulk/mechanical edits to subagents; script mechanical transforms in
  bash; plan first, execute lean.
- Try to work token efficently where possible, and add new efficiencies to this doc
