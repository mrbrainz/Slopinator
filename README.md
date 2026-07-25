# master.py — automated mastering chain

A command-line tool that runs a WAV/AIFF/FLAC file through a basic
mastering chain: corrective EQ → mono bass → gentle saturation →
loudness normalization → true-peak-safe limiter → dither on export.

This is a fast, consistent first-pass master — not a replacement for
critical listening on an important release. Use it to get 90% of the
way there quickly, then spot-check by ear.

## Setup (one-time)

Requires Python 3.9+ and ffmpeg installed (ffmpeg only needed if you
want to feed it MP3s — it uses `soundfile` directly for
WAV/AIFF/FLAC).

```bash
python3 -m venv .venv
.venv/bin/pip install numpy scipy soundfile pyloudnorm pydub
```

(A venv is required on Homebrew Python — it blocks global `pip install`.
The Electron app auto-detects `.venv/bin/python3` if present, falling back
to plain `python3` otherwise.)

## Usage

**Single file:**
```bash
python3 master.py input.wav output.wav
python3 master.py input.wav output.wav --format club
python3 master.py input.wav output.wav --target -9 --ceiling -0.8
```

**Batch (a whole folder of edits/tracks):**
```bash
python3 master.py --batch "tracks/*.wav" --outdir mastered/
python3 master.py --batch "tracks/*.wav" --outdir mastered/ --format soundcloud
```

## Loudness presets (`--format`)

| Preset       | Target LUFS |
|--------------|-------------|
| streaming    | -14         |
| soundcloud   | -11         |
| club         | -8          |

Or set an exact value with `--target -10.5`.

## Options

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

## What the chain actually does

1. **Corrective EQ** — mild broad cuts around 200–500Hz (mud) and
   2–5kHz (harshness), gentle lift above 10kHz (air). This is not a
   substitute for fixing problems in the mix.
2. **Mono bass** — sums content below the crossover to mono, for
   club system / vinyl safety.
3. **Saturation** — light tanh-based warmth/glue, off by default
   intensity is subtle.
4. **Loudness normalization** — hits your integrated LUFS target
   using `pyloudnorm` (ITU-R BS.1770 standard, same algorithm
   Spotify/YouTube use for their normalization).
5. **True-peak limiter** — oversampled lookahead limiter that keeps
   inter-sample peaks under your ceiling, avoiding clipping on lossy
   codecs.
6. **Dither** — light TPDF dither added automatically when exporting
   to 16-bit.

## Building a distributable (macOS)

```bash
npm install
npm run dist        # or `npm run pack` for an unsigned .app without a .dmg
```

This produces `dist/mac-arm64/Slopinator.app` (+ a `.dmg` for `dist`). A
`postpack`/`postdist` hook (`scripts/sign-mac.sh`) ad-hoc re-signs the app
automatically — without it, Gatekeeper trashes it as "malware" the same way
it does the dev `Electron.app` binary (see `docs/context.md`). Ad-hoc
signing satisfies Gatekeeper on this machine but isn't notarized, so the
build isn't yet suitable for handing to other machines.

**Current limitation:** the distributable bundles `master.py` but not a
Python runtime or its dependencies — it falls back to system `python3`,
which needs `numpy`/`scipy`/`soundfile`/`pyloudnorm`/`pydub` installed. Fine
for this dev machine; bundling a real Python runtime (e.g. PyInstaller) is
tracked in `docs/todos.md`.

## Known limitations

- The EQ moves are fixed and broad — it doesn't analyze your specific
  track's frequency content and adapt. For real problem tracks, fix
  in the mix first.
- The limiter is a simple lookahead/release design, not a
  multi-stage brickwall like a commercial limiter (e.g. Ozone,
  FabFilter Pro-L2) — for very hot masters it can sound slightly more
  "pumpy" under heavy gain reduction. Keep gain reduction under
  ~4-6dB for best results.
- No stereo widening or multiband compression — deliberately kept
  simple. Ask if you want those added.
