# Slopinator

A desktop app for fast, consistent first-pass audio mastering. Import
tracks, dial in a chain (or just pick a preset), preview it, A/B it
against the original, then batch-export everything at once.

It's a fast way to get 90% of the way to a mastered track — not a
replacement for critical listening on something important. Use it to
get close quickly, then spot-check by ear.

Under the hood, Slopinator is a bloated, slop-coded Electron wrapper 
for a tiny Python script (`master.py`) frozen into the app so nothing 
extra needs to be installed to use it. It was built for idiots, like me.
A no-skill fat Millenial that forgot to cancel his Claude subscription.

## Getting the app

Prebuilt macOS, Windows, and Linux builds are published on the
[GitHub Releases](https://github.com/mrbrainz/Slopinator/releases) tab.
Windows and Linux builds are
currently unsigned (see "Known limitations" below), so you may need to
click through an OS warning on first launch.

Prefer to build it yourself? See "For developers" below.

## Using the app

The app has four tabs, meant to be used roughly in order:

### 1. Library

Your track list. Drag files in (or "+ Import tracks") — WAV, AIFF, and
FLAC are supported. Each row shows its measured loudness/true peak
once analyzed, and a status: raw import, needs mastering, or mastered.
A row whose source file has been moved or deleted since it was
imported is flagged clearly rather than silently failing later. Click
a row to open it in Chain view; the ✕ button removes it from the
library (the original file on disk is untouched).

### 2. Chain view

Where you actually dial in a track. The waveform is clickable to seek
around, with a play button and a running time counter. Three built-in
presets — **Streaming** (-14 LUFS), **Soundcloud** (-11 LUFS), and
**Club** (-8 LUFS, more drive) — cover the common targets; Chain view
opens with Club selected by default. Pick one from the dropdown, save
your own tweaked chain under a name, or adjust things module by
module:

- **EQ** — mild corrective cuts/lift, on by default
- **Mono bass** — sums bass below a crossover frequency to mono (club/vinyl safety)
- **Saturation** — light warmth/glue, adjustable drive
- **Loudness** — target integrated LUFS
- **Limiter** — true-peak ceiling

Each module has a bypass toggle. Hit **Master** to render a preview —
this doesn't ask where to save; it renders to an app-managed slot so
you can audition it in Compare and re-render as many times as you like
without piling up files. A real, user-chosen destination file only
gets written from the Export tab.

### 3. Compare

Before/after: the original track and the rendered preview, side by
side, with independent waveforms, playback, and loudness/true-peak
stats. Listen to both, and if it's not right, "Adjust chain" sends you
back to Chain view.

### 4. Export

Batch-export everything that's ready (never exported, or re-mastered
since its last export) to a folder in your choice of format — WAV
16-bit (dithered), WAV 24-bit, or FLAC 16-bit. Each row shows which
preset it'll export at and lets you override that on the spot without
opening Chain view, or export just that one track. A WAV-16/FLAC-16
export reuses a track's already-rendered preview when nothing's been
changed, rather than re-running the whole mastering chain again — a
WAV-24 export always does a full fresh render, since the preview never
held 24-bit precision.

### Settings

The gear icon in the titlebar has one real setting (UI mode) — Normal
or Cringe. Cringe mode is a purely cosmetic easter egg; try it.

## Under the hood: the mastering chain

Whatever you dial in Chain view (or a preset) maps directly to real
flags on `master.py`, run in this order:

1. **Corrective EQ** — mild broad cuts around 200–500Hz (mud) and
   2–5kHz (harshness), gentle lift above 10kHz (air). Not a substitute
   for fixing problems in the mix.
2. **Mono bass** — sums content below the crossover to mono.
3. **Saturation** — light tanh-based warmth, subtle by default.
4. **Loudness normalization** — hits your integrated LUFS target via
   `pyloudnorm` (ITU-R BS.1770, the same standard Spotify/YouTube use
   for their own normalization).
5. **True-peak limiter** — oversampled lookahead limiter, keeps
   inter-sample peaks under your ceiling so lossy codecs don't clip.
6. **Dither** — light TPDF dither added automatically on 16-bit export.

## Known limitations

- The EQ moves are fixed and broad — it doesn't analyze your specific
  track's frequency content and adapt. For real problem tracks, fix
  it in the mix first.
- The limiter is a simple lookahead/release design, not a multi-stage
  brickwall like a commercial limiter (Ozone, FabFilter Pro-L2) — for
  very hot masters it can sound slightly more "pumpy" under heavy gain
  reduction. Keep gain reduction under ~4–6dB for best results.
- No stereo widening or multiband compression — deliberately kept
  simple.
- macOS builds are ad-hoc signed (satisfies Gatekeeper on the machine
  that built them, not one they're copied to); Windows/Linux builds
  are unsigned entirely. Real code signing/notarization is tracked in
  `docs/todos.md`.

## For developers

### Requirements

- Node.js and npm
- Python 3.9+ (only needed for local development — a packaged build
  bundles its own frozen Python runtime, nothing extra required to
  *use* the app)

### Dev setup

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm start
```

(A venv is required on Homebrew Python — it blocks global `pip
install`. The app auto-detects `.venv/bin/python3` if present, falling
back to plain `python3` otherwise.)

`npm start` runs a `prestart` hook (`scripts/generate-build-info.js`)
that stamps the build footer with the current commit, then launches
the app via Electron, running `master.py` directly out of the venv —
no freezing/packaging step needed for day-to-day dev work.

### Project structure

```
src/main/       Electron main process — window, IPC handlers, library.js (track/preset storage)
src/preload/    contextBridge surface exposed to the renderer as window.slopinator
src/renderer/   the four-tab UI (plain HTML/CSS/JS, no framework or bundler)
master.py       the mastering chain itself (also runnable standalone — see below)
dsp.py          numpy-only reimplementation of the scipy.signal calls master.py needs
tests/          tests/compare_dsp.py verifies dsp.py against real scipy
scripts/        build tooling (PyInstaller freeze, macOS signing, build-info generation)
docs/           context.md (working notes/gotchas), todos.md (backlog), changelog.md (full history)
```

### Building a distributable

```bash
npm run pack   # unpacked app, e.g. dist/mac-arm64/Slopinator.app — for quick local testing
npm run dist   # real installer: .dmg (mac), portable .exe (Windows), .AppImage (Linux)
```

Both run `scripts/freeze-python.js` first, which freezes `master.py`
and its dependencies into a standalone `master-bin` binary with
PyInstaller (installed into `.venv` on first use) — the packaged app
needs no system Python or venv at runtime. PyInstaller can't
cross-compile, so `master-bin` is only ever built for whatever OS
you're actually running the command on.

On macOS, `scripts/afterSign.js` ad-hoc re-signs the app as part of
electron-builder's own `afterSign` hook (has to happen there, not a
plain npm post-script — see `docs/context.md` for why). This satisfies
Gatekeeper locally but isn't notarized, so it isn't yet suitable for
handing to another machine as-is.

### Releasing

Pushing a version tag builds and publishes all three platforms:

```bash
git tag v0.2
git push origin v0.2
```

`.github/workflows/release.yml` builds macOS/Windows/Linux in parallel
on GitHub-hosted runners (each freezing its own native `master-bin`)
and publishes as a **draft** release on the GitHub Releases tab — it
never goes live on its own. The draft's title and body are filled in
automatically from `docs/changelog.md`'s `[Unreleased]` section
(everything merged since the last tag); review and trim it, then
publish by hand when it's ready.

### Testing

`master.py` uses `dsp.py`, a numpy-only reimplementation of the
`scipy.signal` calls it needs (keeps scipy — a large dependency — out
of the frozen app entirely). Verify it hasn't changed the sound before
touching `dsp.py`:

```bash
.venv/bin/pip install scipy   # dev-only, never installed for the shipped app
.venv/bin/python3 tests/compare_dsp.py
```

### Using `master.py` directly

The mastering engine is a normal CLI tool underneath the app, useful
for scripting or quick one-offs without opening the UI:

```bash
python3 master.py input.wav output.wav
python3 master.py input.wav output.wav --format club
python3 master.py input.wav output.wav --target -9 --ceiling -0.8

# Batch a whole folder:
python3 master.py --batch "tracks/*.wav" --outdir mastered/ --format soundcloud

# Measure a file without mastering it:
python3 master.py --analyze input.wav
# {"path": "input.wav", "duration_sec": 214.3, "sample_rate": 44100,
#  "channels": 2, "bit_depth": "PCM_24", "lufs": -15.8, "true_peak_db": -4.2}

# Downsampled peak data (what the app's waveforms are built from):
python3 master.py --peaks input.wav --buckets 200
```

**Loudness presets (`--format`):** `streaming` (-14 LUFS), `soundcloud`
(-11 LUFS), `club` (-8 LUFS) — or set an exact value with `--target`.

| Flag | Default | What it does |
|---|---|---|
| `--target` | -14 | Integrated loudness target (LUFS) |
| `--format` | — | Preset shortcut for `--target` |
| `--ceiling` | -1.0 | True-peak ceiling (dBTP) |
| `--crossover` | 120 | Hz below which stereo bass is summed to mono |
| `--no-mono-bass` | off | Skip the mono-bass step |
| `--no-eq` | off | Skip the corrective EQ step |
| `--no-saturation` | off | Skip saturation |
| `--saturation` | 0.05 | Saturation drive amount, 0–1 |
| `--bit-depth` | PCM_16 | PCM_16 / PCM_24 / FLOAT |
| `--transcode` | off | Skip the chain — just re-encode already-mastered audio to `--bit-depth` (what Export's preview-reuse path uses) |
