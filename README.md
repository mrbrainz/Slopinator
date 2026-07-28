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
.venv/bin/pip install numpy soundfile pyloudnorm pydub
```

(A venv is required on Homebrew Python — it blocks global `pip install`.
The Electron app auto-detects `.venv/bin/python3` if present, falling back
to plain `python3` otherwise.)

`master.py` uses `dsp.py` (plain numpy) instead of scipy — see "App size"
in `docs/context.md`. scipy is only needed to run
`tests/compare_dsp.py`, which verifies `dsp.py` against it:
`.venv/bin/pip install scipy`.

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

**Analyze (measure a file without mastering it):**
```bash
python3 master.py --analyze input.wav
# {"path": "input.wav", "duration_sec": 214.3, "sample_rate": 44100,
#  "channels": 2, "bit_depth": "PCM_24", "lufs": -15.8, "true_peak_db": -4.2}
```
Prints integrated LUFS, true peak (oversampled, catches inter-sample
peaks), duration, sample rate, channels, and bit depth as one JSON line.
`lufs`/`true_peak_db` are `null` for silent/near-silent input rather than
`-Infinity`.

**Peaks (waveform data for display):**
```bash
python3 master.py --peaks input.wav --buckets 200
# {"path": "input.wav", "duration_sec": 214.3, "peaks": [0.12, 0.34, ...]}
```
Prints `buckets` peak values (0-1, max absolute sample across all channels
per bucket — so a quiet channel isn't masked by averaging), for rendering
a waveform without a full-resolution decode. `--buckets` defaults to 200
and is clamped to the file's actual sample count.

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
npm run dist        # dist/Slopinator-<version>-arm64.dmg
npm run pack        # or just dist/mac-arm64/Slopinator.app, no .dmg
```

This produces a self-contained app — no system Python or venv required at
runtime. Two hooks run automatically as part of `electron-builder`'s own
build lifecycle (both fire for `pack` and `dist`):

- `prepack`/`predist` (`scripts/freeze-python.js`) freezes `master.py` and
  its dependencies into a standalone binary with PyInstaller (installed into
  `.venv` on first use), bundled as the `master-bin` extra resource.
- `afterSign` (`scripts/afterSign.js`, wired via the `build.afterSign` config
  in `package.json`) ad-hoc re-signs the app. This has to run as
  electron-builder's own `afterSign` hook rather than a `postpack`/`postdist`
  npm script — a npm post-script fires only after the `.dmg` is already
  built, so the `.dmg` would still contain the old, insufficient signature.
  Without this, Gatekeeper trashes the app as "malware" the same way it does
  the dev `Electron.app` binary (see `docs/context.md`).

Ad-hoc signing satisfies Gatekeeper on this machine but isn't notarized, so
the build isn't yet suitable for handing to other machines.

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
