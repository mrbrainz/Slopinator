#!/usr/bin/env python3
"""
master.py — a simple automated mastering chain.

Chain: corrective EQ (gentle) -> mono-bass below crossover -> soft
saturation -> loudness normalize to target LUFS -> true-peak safe
brickwall limiter -> optional dither on 16-bit export.

Usage:
    python3 master.py input.wav output.wav
    python3 master.py input.wav output.wav --target -9 --format club
    python3 master.py *.wav --outdir mastered/ --target -14

Run `python3 master.py --help` for all options.
"""

import argparse
import glob
import json
import os
import sys

import numpy as np
import soundfile as sf

# numpy-only stand-in for the scipy.signal functions this app needs —
# verified against scipy by tests/compare_dsp.py (run it before touching
# dsp.py). Dropping scipy keeps ~39MB out of the frozen app. pyloudnorm
# imports scipy.signal for one lfilter call, so it gets a stub backed by
# dsp, installed before pyloudnorm's import below.
import dsp as signal

import types

_scipy_stub = types.ModuleType("scipy")
_scipy_signal_stub = types.ModuleType("scipy.signal")
_scipy_signal_stub.lfilter = signal.lfilter
_scipy_stub.signal = _scipy_signal_stub
sys.modules["scipy"] = _scipy_stub
sys.modules["scipy.signal"] = _scipy_signal_stub

import pyloudnorm as pyln


def load_audio(path):
    data, sr = sf.read(path, always_2d=True)  # shape: (samples, channels)
    return data.astype(np.float64), sr


def shelf_filter(data, sr, freq, gain_db, kind="high", order=2):
    """Gentle shelf EQ. kind: 'high' (boost/cut above freq) or 'low'."""
    if gain_db == 0:
        return data
    nyq = sr / 2
    normal_freq = min(freq / nyq, 0.99)
    btype = "highpass" if kind == "high" else "lowpass"
    b, a = signal.butter(order, normal_freq, btype=btype)
    filtered = signal.filtfilt(b, a, data, axis=0)
    # Blend filtered (boosted/cut band) with dry signal to act like a shelf
    gain_lin = 10 ** (gain_db / 20)
    if kind == "high":
        return data + filtered * (gain_lin - 1)
    else:
        return data + filtered * (gain_lin - 1)


def corrective_eq(data, sr, low_mid_cut_db=-1.0, presence_cut_db=-0.5, air_boost_db=0.5):
    """Mild broad corrective moves: tame 200-500Hz buildup, tame 2-5kHz
    harshness, gentle air lift above 10kHz."""
    nyq = sr / 2

    def band_shelf(x, f_lo, f_hi, gain_db):
        if gain_db == 0:
            return x
        f_lo_n = max(f_lo / nyq, 0.001)
        f_hi_n = min(f_hi / nyq, 0.99)
        b, a = signal.butter(2, [f_lo_n, f_hi_n], btype="bandpass")
        band = signal.filtfilt(b, a, x, axis=0)
        gain_lin = 10 ** (gain_db / 20)
        return x + band * (gain_lin - 1)

    out = data.copy()
    out = band_shelf(out, 200, 500, low_mid_cut_db)
    out = band_shelf(out, 2000, 5000, presence_cut_db)
    out = shelf_filter(out, sr, 10000, air_boost_db, kind="high")
    return out


def mono_bass(data, sr, crossover=120):
    """Sum content below crossover to mono for phase/club safety."""
    if data.shape[1] < 2:
        return data
    nyq = sr / 2
    b, a = signal.butter(4, crossover / nyq, btype="lowpass")
    low = signal.filtfilt(b, a, data, axis=0)
    high = data - low
    low_mono = low.mean(axis=1, keepdims=True)
    low_mono = np.repeat(low_mono, data.shape[1], axis=1)
    return low_mono + high


def saturate(data, amount=0.05):
    """Gentle tanh saturation for glue/warmth. amount: 0 = none."""
    if amount <= 0:
        return data
    drive = 1 + amount * 10
    return np.tanh(data * drive) / np.tanh(drive)


def true_peak_limiter(data, sr, ceiling_db=-1.0, oversample=4):
    """Lookahead brick-wall limiter with oversampling for true-peak safety."""
    ceiling = 10 ** (ceiling_db / 20)

    # Oversample to catch inter-sample peaks
    up = signal.resample_poly(data, oversample, 1, axis=0)
    peak = np.max(np.abs(up))
    if peak <= ceiling:
        gain_curve = np.ones(data.shape[0])
    else:
        # Simple lookahead gain-reduction limiter on the original-rate signal
        window = max(1, int(sr * 0.005))  # 5ms lookahead
        abs_data = np.max(np.abs(data), axis=1)
        gain_curve = np.ones_like(abs_data)
        env = np.copy(abs_data)
        # smooth envelope (lookahead max filter)
        for i in range(len(env)):
            lo = i
            hi = min(len(env), i + window)
            local_max = np.max(abs_data[lo:hi]) if hi > lo else abs_data[i]
            if local_max > ceiling:
                gain_curve[i] = ceiling / local_max
        # release smoothing so gain reduction doesn't chatter
        release_samples = max(1, int(sr * 0.050))
        smoothed = np.copy(gain_curve)
        for i in range(1, len(smoothed)):
            if smoothed[i] > smoothed[i - 1]:
                # slow release back up
                max_step = 1.0 / release_samples
                smoothed[i] = min(smoothed[i], smoothed[i - 1] + max_step)
        gain_curve = smoothed

    limited = data * gain_curve[:, None]
    # Final hard safety clip just in case
    limited = np.clip(limited, -ceiling, ceiling)
    return limited


def loudness_normalize(data, sr, target_lufs):
    meter = pyln.Meter(sr)
    current_loudness = meter.integrated_loudness(data)
    if current_loudness == float("-inf"):
        return data, current_loudness
    normalized = pyln.normalize.loudness(data, current_loudness, target_lufs)
    return normalized, current_loudness


def master_file(in_path, out_path, target_lufs=-14.0, ceiling_db=-1.0,
                 crossover=120, low_mid_cut=-1.0, presence_cut=-0.5,
                 air_boost=0.5, saturation=0.05, bit_depth="PCM_16",
                 skip_eq=False, skip_mono_bass=False, skip_saturation=False):
    print(f"Loading {in_path} ...")
    data, sr = load_audio(in_path)

    if not skip_eq:
        print("Applying corrective EQ...")
        data = corrective_eq(data, sr, low_mid_cut, presence_cut, air_boost)

    if not skip_mono_bass:
        print(f"Summing bass below {crossover}Hz to mono...")
        data = mono_bass(data, sr, crossover)

    if not skip_saturation and saturation > 0:
        print("Applying gentle saturation...")
        data = saturate(data, saturation)

    print(f"Normalizing loudness to {target_lufs} LUFS...")
    data, measured = loudness_normalize(data, sr, target_lufs)
    if measured != float("-inf"):
        print(f"  measured input loudness: {measured:.1f} LUFS")

    print(f"Limiting to {ceiling_db} dBTP true peak ceiling...")
    data = true_peak_limiter(data, sr, ceiling_db)

    # dither only matters when truncating bit depth; add light TPDF dither for 16-bit
    if bit_depth == "PCM_16":
        dither = (np.random.rand(*data.shape) - np.random.rand(*data.shape)) / (2 ** 16)
        data = data + dither

    print(f"Writing {out_path} ({bit_depth})...")
    sf.write(out_path, data, sr, subtype=bit_depth)

    meter = pyln.Meter(sr)
    final_loudness = meter.integrated_loudness(data)
    true_peak = np.max(np.abs(data))
    true_peak_db = 20 * np.log10(true_peak) if true_peak > 0 else -np.inf
    print(f"Done. Final: {final_loudness:.1f} LUFS, {true_peak_db:.2f} dBTP\n")


def transcode_file(in_path, out_path, bit_depth="PCM_16"):
    """Re-encode already-mastered audio (e.g. Chain view's preview file) to
    a different container/bit depth without re-running the mastering
    chain — used by Export to reuse a preview instead of redoing the full
    EQ/mono-bass/saturation/loudness/limiter pass on the original source."""
    print(f"Loading {in_path} ...")
    data, sr = load_audio(in_path)

    if bit_depth == "PCM_16":
        dither = (np.random.rand(*data.shape) - np.random.rand(*data.shape)) / (2 ** 16)
        data = data + dither

    print(f"Writing {out_path} ({bit_depth})...")
    sf.write(out_path, data, sr, subtype=bit_depth)

    meter = pyln.Meter(sr)
    final_loudness = meter.integrated_loudness(data)
    true_peak = np.max(np.abs(data))
    true_peak_db = 20 * np.log10(true_peak) if true_peak > 0 else -np.inf
    print(f"Done. Final: {final_loudness:.1f} LUFS, {true_peak_db:.2f} dBTP\n")


def analyze_file(path, oversample=4):
    """Measure integrated LUFS, true peak, and basic format info for an
    unprocessed file, without running it through the mastering chain."""
    info = sf.info(path)
    data, sr = load_audio(path)

    meter = pyln.Meter(sr)
    lufs = meter.integrated_loudness(data)

    # Oversample for a genuine true-peak reading (catches inter-sample
    # peaks a plain sample-peak read would miss) — same technique
    # true_peak_limiter() uses.
    up = signal.resample_poly(data, oversample, 1, axis=0)
    peak = np.max(np.abs(up))
    true_peak_db = 20 * np.log10(peak) if peak > 0 else float("-inf")

    return {
        "path": path,
        "duration_sec": round(info.frames / sr, 2),
        "sample_rate": sr,
        "channels": data.shape[1],
        "bit_depth": info.subtype,
        "lufs": None if lufs == float("-inf") else round(lufs, 1),
        "true_peak_db": None if true_peak_db == float("-inf") else round(true_peak_db, 2),
    }


def extract_peaks(path, buckets=200):
    """Downsample a file to `buckets` peak values (0-1) for waveform
    display — max absolute sample across all channels per bucket, so quiet
    single-channel content in a stereo file isn't masked by averaging."""
    data, sr = load_audio(path)
    combined = np.max(np.abs(data), axis=1)  # (samples,)

    n = len(combined)
    buckets = max(1, min(buckets, n)) if n > 0 else 1
    edges = np.linspace(0, n, buckets + 1, dtype=int)

    peaks = []
    for i in range(buckets):
        lo, hi = edges[i], edges[i + 1]
        segment = combined[lo:hi] if hi > lo else combined[lo:lo + 1]
        peaks.append(round(float(np.max(segment)), 4) if segment.size else 0.0)

    return {
        "path": path,
        "duration_sec": round(n / sr, 2),
        "peaks": peaks,
    }


PRESETS = {
    "streaming": -14.0,
    "club": -8.0,
    "soundcloud": -11.0,
}


def main():
    # Line-buffer stdout so progress prints stream to callers piping our
    # output (e.g. the Electron UI) instead of arriving in one final batch.
    # Plain -u/PYTHONUNBUFFERED doesn't reliably reach this when frozen by
    # PyInstaller, so it's set explicitly here.
    sys.stdout.reconfigure(line_buffering=True)

    parser = argparse.ArgumentParser(
        description="Simple automated mastering chain.",
        epilog="Single file:  python3 master.py in.wav out.wav\n"
               "Batch:        python3 master.py --batch 'tracks/*.wav' --outdir mastered/",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("input", help="Input audio file, or glob pattern when used with --batch")
    parser.add_argument("output", nargs="?", help="Output file path (single-file mode only)")
    parser.add_argument("--batch", action="store_true", help="Treat 'input' as a glob pattern and process every match")
    parser.add_argument("--outdir", help="Output directory (batch mode, default: mastered/)")
    parser.add_argument("--target", type=float, help="Target integrated loudness in LUFS (default -14)")
    parser.add_argument("--format", choices=PRESETS.keys(), help="Loudness preset instead of --target")
    parser.add_argument("--ceiling", type=float, default=-1.0, help="True peak ceiling in dBTP (default -1.0)")
    parser.add_argument("--crossover", type=float, default=120, help="Mono-bass crossover Hz (default 120)")
    parser.add_argument("--no-mono-bass", action="store_true")
    parser.add_argument("--no-eq", action="store_true")
    parser.add_argument("--no-saturation", action="store_true")
    parser.add_argument("--saturation", type=float, default=0.05, help="Saturation amount 0-1 (default 0.05)")
    parser.add_argument("--bit-depth", default="PCM_16", choices=["PCM_16", "PCM_24", "FLOAT"])
    parser.add_argument("--transcode", action="store_true",
                         help="Skip the mastering chain — just re-encode 'input' (already-mastered "
                              "audio) to 'output' at --bit-depth")
    parser.add_argument("--analyze", action="store_true",
                         help="Measure LUFS/true-peak/format of 'input' and print JSON, without mastering it")
    parser.add_argument("--peaks", action="store_true",
                         help="Print a JSON array of downsampled peak values for 'input', for waveform display")
    parser.add_argument("--buckets", type=int, default=200,
                         help="Number of peak values for --peaks (default 200)")
    args = parser.parse_args()

    if args.analyze:
        print(json.dumps(analyze_file(args.input)))
        return

    if args.peaks:
        print(json.dumps(extract_peaks(args.input, args.buckets)))
        return

    if args.transcode:
        if not args.output:
            print("Error: specify an output path, e.g. python3 master.py in.flac out.wav --transcode", file=sys.stderr)
            sys.exit(1)
        transcode_file(args.input, args.output, bit_depth=args.bit_depth)
        return

    target = args.target if args.target is not None else PRESETS.get(args.format, -14.0)

    common_kwargs = dict(
        target_lufs=target, ceiling_db=args.ceiling, crossover=args.crossover,
        skip_eq=args.no_eq, skip_mono_bass=args.no_mono_bass,
        skip_saturation=args.no_saturation, saturation=args.saturation,
        bit_depth=args.bit_depth,
    )

    if args.batch:
        in_files = glob.glob(args.input)
        if not in_files:
            print(f"No files matched pattern: {args.input}", file=sys.stderr)
            sys.exit(1)
        outdir = args.outdir or "mastered"
        os.makedirs(outdir, exist_ok=True)
        for f in in_files:
            base = os.path.splitext(os.path.basename(f))[0]
            out_path = os.path.join(outdir, f"{base}_mastered.wav")
            master_file(f, out_path, **common_kwargs)
    else:
        if not args.output:
            print("Error: specify an output path, e.g. python3 master.py in.wav out.wav", file=sys.stderr)
            sys.exit(1)
        master_file(args.input, args.output, **common_kwargs)


if __name__ == "__main__":
    main()
