#!/usr/bin/env python3
"""Verify dsp.py reproduces scipy.signal for every call pattern
master.py uses. Needs scipy (dev-only dep — the shipped app doesn't):

    .venv/bin/python3 tests/compare_dsp.py

Exits non-zero if any comparison exceeds its tolerance. Run this before
shipping any change to dsp.py — the acceptance bar for dropping scipy
was "does not change the sound", and this is the proof.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
from scipy import signal as ss

import dsp

FAILURES = []


def check(name, ours, theirs, tol, relative=False):
    ours, theirs = np.asarray(ours), np.asarray(theirs)
    if relative:
        scale = np.max(np.abs(theirs)) or 1.0
        diff = np.max(np.abs(ours - theirs)) / scale
    else:
        diff = np.max(np.abs(ours - theirs))
    status = "ok  " if diff <= tol else "FAIL"
    print(f"{status} {name}: max diff {diff:.3e} (tol {tol:.0e})")
    if diff > tol:
        FAILURES.append(name)


def make_audio(n, channels, seed):
    rng = np.random.default_rng(seed)
    t = np.arange(n) / 44100
    base = (
        0.4 * np.sin(2 * np.pi * 55 * t)
        + 0.2 * np.sin(2 * np.pi * 440 * t)
        + 0.1 * np.sin(2 * np.pi * 9000 * t)
        + 0.05 * rng.standard_normal(n)
    )
    if channels == 1:
        return base
    return np.column_stack([base, base * 0.7 + 0.03 * rng.standard_normal(n)])


# --- butter: every design master.py can produce ---
BUTTER_CASES = []
for sr in (44100, 48000, 96000):
    nyq = sr / 2
    BUTTER_CASES += [
        (2, min(10000 / nyq, 0.99), "highpass"),          # shelf_filter air
        (2, [max(200 / nyq, 0.001), min(500 / nyq, 0.99)], "bandpass"),    # low-mid cut
        (2, [max(2000 / nyq, 0.001), min(5000 / nyq, 0.99)], "bandpass"),  # presence cut
    ]
    for crossover in (40, 120, 300):                      # mono-bass range
        BUTTER_CASES.append((4, crossover / nyq, "lowpass"))

for order, Wn, btype in BUTTER_CASES:
    b0, a0 = ss.butter(order, Wn, btype=btype)
    b1, a1 = dsp.butter(order, Wn, btype=btype)
    label = f"butter({order}, {btype}, Wn~{np.round(np.atleast_1d(Wn)[0], 5)})"
    check(f"{label} [b]", b1, b0, 1e-10, relative=True)
    check(f"{label} [a]", a1, a0, 1e-10, relative=True)

# --- filtfilt: those filters on realistic audio, mono + stereo ---
# Tolerance is anchored to scipy's OWN equivalence class: scipy ships two
# equally-valid filtfilt implementations (transfer-function `filtfilt`
# and second-order-section `sosfiltfilt`), and for near-unit-circle poles
# they disagree with each other by far more than any fixed tiny bound —
# 1.8e-6 for order-4 lowpass at 40Hz/96kHz, where a single ulp of input
# perturbation already moves scipy's output by 3e-8. Any third valid
# float64 implementation can sit up to ~2x that self-disagreement from
# either one, so the bar is max(5e-9, 2 * |filtfilt - sosfiltfilt|),
# computed per case. dsp.py currently lands *closer* to scipy's filtfilt
# than scipy's own sosfiltfilt does on every case.
mono = make_audio(200_000, 1, seed=1)
stereo = make_audio(200_000, 2, seed=2)

FILT_CASES = [
    ("mono-bass lowpass o4 @120Hz/44.1k", (4, 120 / 22050, "lowpass")),
    ("mono-bass lowpass o4 @40Hz/96k", (4, 40 / 48000, "lowpass")),
    ("air highpass o2 @10k/44.1k", (2, 10000 / 22050, "highpass")),
    ("low-mid bandpass o2 200-500/44.1k", (2, [200 / 22050, 500 / 22050], "bandpass")),
    ("presence bandpass o2 2k-5k/44.1k", (2, [2000 / 22050, 5000 / 22050], "bandpass")),
]


def filt_tol(order, Wn, btype, x):
    b, a = ss.butter(order, Wn, btype=btype)
    sos = ss.butter(order, Wn, btype=btype, output="sos")
    self_disagreement = np.max(np.abs(ss.filtfilt(b, a, x) - ss.sosfiltfilt(sos, x)))
    return max(5e-9, 2 * self_disagreement)


for name, (order, Wn, btype) in FILT_CASES:
    b, a = ss.butter(order, Wn, btype=btype)
    tol_mono = filt_tol(order, Wn, btype, mono)
    check(f"filtfilt {name} [mono]", dsp.filtfilt(b, a, mono), ss.filtfilt(b, a, mono), tol_mono)
    tol_st = filt_tol(order, Wn, btype, stereo[:, 0])
    check(f"filtfilt {name} [stereo]", dsp.filtfilt(b, a, stereo, axis=0), ss.filtfilt(b, a, stereo, axis=0), tol_st)

# short input near the padlen limit still must match
short = make_audio(2_000, 2, seed=3)
b, a = ss.butter(4, 120 / 22050, btype="lowpass")
check(
    "filtfilt short input [stereo]",
    dsp.filtfilt(b, a, short, axis=0),
    ss.filtfilt(b, a, short, axis=0),
    filt_tol(4, 120 / 22050, "lowpass", short[:, 0]),
)

# --- lfilter: pyloudnorm's actual K-weighting biquads (master.py stubs
# scipy.signal.lfilter with dsp.lfilter for pyloudnorm's benefit) ---
import pyloudnorm as pyln

for sr in (44100, 48000, 96000):
    meter = pyln.Meter(sr)
    audio = make_audio(200_000, 1, seed=4)
    for stage_name, stage in meter._filters.items():
        b, a = stage.b, stage.a
        check(
            f"lfilter K-weighting '{stage_name}' @{sr}",
            dsp.lfilter(b, a, audio),
            ss.lfilter(b, a, audio),
            5e-9,
        )

# end-to-end loudness: full pyloudnorm measurement, scipy vs dsp filtering
for sr in (44100, 96000):
    meter = pyln.Meter(sr)
    audio_st = make_audio(sr * 8, 2, seed=5)
    ref = meter.integrated_loudness(audio_st)  # real scipy path
    orig = pyln.iirfilter.scipy.signal.lfilter
    pyln.iirfilter.scipy.signal.lfilter = dsp.lfilter
    try:
        mine = pyln.Meter(sr).integrated_loudness(audio_st)
    finally:
        pyln.iirfilter.scipy.signal.lfilter = orig
    check(f"integrated LUFS via pyloudnorm @{sr}", np.array([mine]), np.array([ref]), 1e-9)

# --- resample_poly: 4x oversampling as used for true-peak ---
check("resample_poly 4x [mono]", dsp.resample_poly(mono, 4, 1), ss.resample_poly(mono, 4, 1), 1e-10)
check("resample_poly 4x [stereo]", dsp.resample_poly(stereo, 4, 1, axis=0), ss.resample_poly(stereo, 4, 1, axis=0), 1e-10)
check("resample_poly 4x [odd length]", dsp.resample_poly(mono[:44101], 4, 1), ss.resample_poly(mono[:44101], 4, 1), 1e-10)

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURE(S):", *FAILURES, sep="\n  ")
    sys.exit(1)
print("all comparisons passed")
