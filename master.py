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
import os
import sys

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy import signal


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


PRESETS = {
    "streaming": -14.0,
    "club": -8.0,
    "soundcloud": -11.0,
}


def main():
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
    args = parser.parse_args()

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
