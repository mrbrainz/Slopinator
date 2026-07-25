"""dsp.py — numpy-only replacements for the three scipy.signal functions
master.py uses (butter, filtfilt, resample_poly), so the frozen app
doesn't have to bundle scipy (~39MB).

Every function reproduces scipy's output near-exactly (~1e-9 or better)
— verified by tests/compare_dsp.py, which must pass before any change
here ships. The mastering chain's sound must not change.

The one non-obvious piece: filtfilt needs an IIR filter, and a
per-sample Python loop over millions of samples is far too slow. Instead
the recursive (AR) part of the filter is applied as FFT convolution with
its own truncated impulse response — for a stable filter that response
decays geometrically, so truncating where it falls below ~1e-17 of its
peak reproduces the exact recursion to machine precision, fully
vectorized. Initial conditions fold in exactly: a DF2T filter with state
zi is equivalent to prepending zi as a length-k input to the AR stage.
"""

import math

import numpy as np

# butter() registers the exact zeros/poles it designed, keyed by the
# resulting (b, a) bytes, so filtfilt can rebuild its filter sections
# from them directly. Recovering them from the polynomials instead
# (np.roots) is catastrophically inaccurate for repeated roots — a
# Butterworth lowpass has a quadruple zero at -1, which np.roots places
# with only ~eps**(1/4) ≈ 1e-4 accuracy.
_ZPK_CACHE = {}
_ZPK_CACHE_MAX = 64


# --- Butterworth design (scipy.signal.butter equivalent) ---
# Same pipeline scipy uses: analog prototype poles -> frequency transform
# (lp2lp / lp2hp / lp2bp on zeros-poles-gain) -> bilinear transform ->
# polynomial coefficients.

def _buttap(order):
    m = np.arange(-order + 1, order, 2)
    poles = -np.exp(1j * np.pi * m / (2 * order))
    return np.array([], dtype=complex), poles, 1.0


def _lp2lp_zpk(z, p, k, wo):
    degree = len(p) - len(z)
    return z * wo, p * wo, k * wo**degree


def _lp2hp_zpk(z, p, k, wo):
    degree = len(p) - len(z)
    z_hp = np.append(wo / z if len(z) else [], np.zeros(degree))
    p_hp = wo / p
    k_hp = k * np.real(np.prod(-z) / np.prod(-p))
    return z_hp, p_hp, k_hp


def _lp2bp_zpk(z, p, k, wo, bw):
    degree = len(p) - len(z)
    z_lp = z * bw / 2
    p_lp = p * bw / 2
    z_bp = np.concatenate([z_lp + np.sqrt(z_lp**2 - wo**2), z_lp - np.sqrt(z_lp**2 - wo**2)]) if len(z) else np.array([], dtype=complex)
    p_bp = np.concatenate([p_lp + np.sqrt(p_lp**2 - wo**2), p_lp - np.sqrt(p_lp**2 - wo**2)])
    z_bp = np.append(z_bp, np.zeros(degree))
    k_bp = k * bw**degree
    return z_bp, p_bp, k_bp


def _bilinear_zpk(z, p, k, fs):
    degree = len(p) - len(z)
    fs2 = 2.0 * fs
    z_d = (fs2 + z) / (fs2 - z) if len(z) else np.array([], dtype=complex)
    p_d = (fs2 + p) / (fs2 - p)
    z_d = np.append(z_d, -np.ones(degree))
    k_d = k * np.real(np.prod(fs2 - z) / np.prod(fs2 - p))
    return z_d, p_d, k_d


def butter(order, Wn, btype="lowpass"):
    """Digital Butterworth (b, a), matching scipy.signal.butter for
    btype in {'lowpass', 'highpass', 'bandpass'} with fs=2 normalization
    (Wn in units of Nyquist), the only forms master.py uses."""
    Wn = np.asarray(Wn, dtype=float)
    z, p, k = _buttap(order)
    fs = 2.0
    warped = 2 * fs * np.tan(np.pi * Wn / fs)

    if btype in ("lowpass", "low"):
        z, p, k = _lp2lp_zpk(z, p, k, warped)
    elif btype in ("highpass", "high"):
        z, p, k = _lp2hp_zpk(z, p, k, warped)
    elif btype == "bandpass":
        wo = np.sqrt(warped[0] * warped[1])
        bw = warped[1] - warped[0]
        z, p, k = _lp2bp_zpk(z, p, k, wo, bw)
    else:
        raise ValueError(f"unsupported btype: {btype}")

    z, p, k = _bilinear_zpk(z, p, k, fs)
    b = np.real(k * np.poly(z))
    a = np.real(np.poly(p))
    if len(_ZPK_CACHE) >= _ZPK_CACHE_MAX:
        _ZPK_CACHE.clear()
    _ZPK_CACHE[(b.tobytes(), a.tobytes())] = (z, p, k)
    return b, a


def _lookup_zpk(b, a):
    key = (np.asarray(b, dtype=float).tobytes(), np.asarray(a, dtype=float).tobytes())
    zpk = _ZPK_CACHE.get(key)
    if zpk is not None:
        return zpk
    # Fallback for coefficients not designed by our butter() — accurate
    # only for filters without repeated roots.
    return np.roots(b), np.roots(a), b[0] / a[0]


# --- fast convolution (overlap-add, numpy.fft) ---

def _oa_convolve(x, h):
    """conv(x, h) truncated to len(x) (i.e. the causal filter output),
    via overlap-add FFT so long signals stay fast and memory-bounded."""
    n, m = len(x), len(h)
    if m == 0:
        return np.zeros(n)
    block = 1 << 18
    while block < 4 * m:
        block *= 2
    nfft = block
    step = nfft - (m - 1)
    H = np.fft.rfft(h, nfft)
    out = np.zeros(n + m - 1)
    for start in range(0, n, step):
        seg = x[start:start + step]
        y = np.fft.irfft(np.fft.rfft(seg, nfft) * H, nfft)[: len(seg) + m - 1]
        out[start:start + len(seg) + m - 1] += y
    return out[:n]


# --- exact lfilter via truncated AR impulse response ---

def _ar_impulse_response(a, tol=1e-17, max_len=2_000_000):
    """Impulse response of 1/A(z), truncated where it decays below
    tol * its running peak. Geometric decay for stable filters keeps
    this to a few thousand samples for audio-band Butterworths."""
    poles = np.roots(a)
    r = np.max(np.abs(poles))
    if r >= 1.0:
        raise ValueError("unstable filter")
    length = int(np.ceil(np.log(tol) / np.log(r))) + len(a)
    length = min(max(length, 64), max_len)
    h = np.zeros(length)
    h[0] = 1.0
    k = len(a) - 1
    for n in range(1, length):
        j_max = min(n, k)
        h[n] = -np.dot(a[1:j_max + 1], h[n - 1:n - j_max - 1:-1] if n - j_max > 0 else h[n - 1::-1])
    return h


def _conjugate_pairs(roots):
    """Group roots into real second-order (conjugate pair) / first-order
    (real root) coefficient arrays, plus the raw pair for gain probes."""
    sections = []
    used = np.zeros(len(roots), dtype=bool)
    order = np.argsort(roots.real)
    for i in order:
        if used[i]:
            continue
        used[i] = True
        r = roots[i]
        if abs(r.imag) > 1e-12:
            j = next(k for k in range(len(roots)) if not used[k] and abs(roots[k] - np.conj(r)) < 1e-8)
            used[j] = True
            sections.append((np.array([1.0, -2.0 * r.real, (r * np.conj(r)).real]), r))
        else:
            sections.append((np.array([1.0, -r.real]), r))
    return sections


def _zero_pairs(zeros):
    """Pair zeros first-with-last after sorting by real part, so a
    bandpass's {+1,+1,-1,-1} zeros split into two balanced (+1,-1)
    sections instead of one all-DC and one all-Nyquist section."""
    zs = sorted(zeros, key=lambda z: z.real)
    pairs = []
    while len(zs) > 1:
        z1, z2 = zs.pop(0), zs.pop(-1)
        pairs.append(np.real(np.poly([z1, z2])))
    if zs:
        pairs.append(np.real(np.poly([zs[0]])))
    return pairs


def _make_sos(b, a):
    """Split (b, a) into gain-balanced biquad sections, built from the
    exact zeros/poles butter() registered (see _ZPK_CACHE — recovering
    them via np.roots loses ~4 decimal digits on repeated zeros). Each
    section is normalized to ~unit gain at its own pole's resonant
    frequency, keeping every intermediate signal at input scale — one
    big stage lets rounding blow up by the filter's internal dynamic
    range (~1e11 for order-4 lowpass at 40Hz/96kHz)."""
    z, p, k_gain = _lookup_zpk(b, a)
    pole_secs = _conjugate_pairs(np.asarray(p))
    zero_secs = _zero_pairs(list(np.asarray(z)))
    while len(zero_secs) < len(pole_secs):
        zero_secs.append(np.array([1.0]))

    sections = []
    gains = []
    for (a_sec, pole), b_sec in zip(pole_secs, zero_secs):
        w = np.angle(pole) if abs(pole.imag) > 1e-12 else 0.0
        e = np.exp(-1j * w * np.arange(max(len(b_sec), len(a_sec))))
        gain = abs(np.dot(b_sec, e[: len(b_sec)]) / np.dot(a_sec, e[: len(a_sec)]))
        gain = gain if gain > 0 else 1.0
        sections.append([b_sec / gain, a_sec])
        gains.append(gain)

    # Distribute the overall gain (design k times the normalizations we
    # just divided out) evenly, keeping sections balanced.
    total = float(np.real(k_gain)) * float(np.prod(gains))
    c = abs(total) ** (1.0 / len(sections))
    for i, sec in enumerate(sections):
        sec[0] = sec[0] * (c * np.sign(total) if i == 0 else c)
    return sections


def _section_impulse_response(b_sec, a_sec):
    h_ar = _ar_impulse_response(a_sec)
    return np.convolve(h_ar, b_sec)


def _zi_transient(a, zi_scaled, length):
    """Exact DF2T zero-input response from initial state zi_scaled, via
    the same sequential recursion scipy runs. Kept as a plain loop on
    purpose: folding initial conditions into the convolution path needs
    k enormous terms to cancel to O(1) — catastrophic in floating point
    for near-unit-circle poles — while the recursion only ever holds the
    bounded net state. The transient decays below ~1e-17 of the input
    within `length` samples, so the loop is short."""
    k = len(zi_scaled)
    z = list(zi_scaled) + [0.0]
    out = np.zeros(length)
    a = list(a)
    fma = math.fma  # matches scipy's compiled fused multiply-add on arm64
    for n in range(length):
        y = z[0]
        for i in range(k - 1):
            z[i] = fma(-a[i + 1], y, z[i + 1])
        z[k - 1] = -a[k] * y if k < len(a) else 0.0
        out[n] = y
    return out


def _transient_length(b, a, cap):
    _, poles, _ = _lookup_zpk(b, a)
    r = np.max(np.abs(poles))
    if r >= 1.0:
        raise ValueError("unstable filter")
    return min(int(np.ceil(np.log(1e-17) / np.log(r))) + len(a), cap)


def _lfilter(sections, b_full, a_full, x, zi_scaled):
    """lfilter(b, a, x, zi)[0] as: gain-balanced SOS cascade (zero-state
    response, vectorized) + exact zero-input transient from zi."""
    y = x
    for b_sec, a_sec in sections:
        y = _oa_convolve(y, _section_impulse_response(b_sec, a_sec))
    length = _transient_length(b_full, a_full, len(x))
    y[:length] += _zi_transient(a_full, zi_scaled, length)
    return y


def _lfilter_zi(b, a):
    """scipy.signal.lfilter_zi, matching current scipy's closed form:
    zi[k] = sum_{j>k} (b[j] - y_inf*a[j]) with y_inf = sum(b)/sum(a).
    Well-conditioned even for near-unit-circle poles, unlike the older
    companion-matrix solve."""
    n = max(len(a), len(b))
    a = np.pad(np.asarray(a, dtype=float), (0, n - len(a)))
    b = np.pad(np.asarray(b, dtype=float), (0, n - len(b)))
    b = b / a[0]
    a = a / a[0]
    y_inf = np.sum(b) / np.sum(a)
    c = b - y_inf * a
    return np.flip(np.cumsum(np.flip(c)))[1:]


def lfilter(b, a, x):
    """scipy.signal.lfilter(b, a, x) (zero initial state) for 1-D x.
    Exists for pyloudnorm, whose K-weighting filters call exactly this —
    master.py stubs scipy.signal with this module so pyloudnorm doesn't
    drag the real scipy into the frozen app. Its biquads have simple,
    well-separated roots, so the np.roots fallback in _lookup_zpk is
    accurate for them."""
    x = np.asarray(x, dtype=float)
    sections = _make_sos(b, a)
    y = x
    for b_sec, a_sec in sections:
        y = _oa_convolve(y, _section_impulse_response(b_sec, a_sec))
    return y


def filtfilt(b, a, x, axis=0):
    """scipy.signal.filtfilt with default padding (odd extension,
    padlen = 3 * max(len(a), len(b))), for 1-D or 2-D x."""
    x = np.asarray(x, dtype=float)
    if x.ndim == 1:
        return _filtfilt_1d(b, a, x)
    return np.apply_along_axis(lambda col: _filtfilt_1d(b, a, col), axis, x)


def _filtfilt_1d(b, a, x):
    padlen = 3 * max(len(a), len(b))
    if len(x) <= padlen:
        raise ValueError("input too short for filtfilt padding")
    a_norm = np.asarray(a, dtype=float) / a[0]
    sections = _make_sos(b, a)
    zi = _lfilter_zi(b, a)
    ext = np.concatenate([2 * x[0] - x[padlen:0:-1], x, 2 * x[-1] - x[-2:-padlen - 2:-1]])
    y = _lfilter(sections, b, a, ext, zi * ext[0])
    y = _lfilter(sections, b, a, y[::-1], zi * y[-1])
    y = y[::-1]
    return y[padlen:-padlen]


# --- polyphase resampling (scipy.signal.resample_poly equivalent) ---

def _firwin_kaiser(numtaps, cutoff, beta):
    """scipy.signal.firwin(numtaps, cutoff, window=('kaiser', beta)) with
    default scaling, cutoff in Nyquist units."""
    m = np.arange(numtaps) - (numtaps - 1) / 2.0
    h = cutoff * np.sinc(cutoff * m)
    h *= np.kaiser(numtaps, beta)
    return h / h.sum()


def resample_poly(x, up, down, axis=0):
    """scipy.signal.resample_poly for integer up and down == 1 (the only
    form master.py uses: 4x oversampling for true-peak measurement)."""
    up, down = int(up), int(down)
    if down != 1:
        raise ValueError("only down=1 is supported")
    if up == 1:
        return np.asarray(x, dtype=float)
    x = np.asarray(x, dtype=float)
    if x.ndim == 1:
        return _resample_up_1d(x, up)
    return np.apply_along_axis(lambda col: _resample_up_1d(col, up), axis, x)


def _resample_up_1d(x, up):
    half_len = 10 * up
    h = _firwin_kaiser(2 * half_len + 1, 1.0 / up, 5.0) * up
    n_out = len(x) * up
    # Zero-stuffed convolution, computed per phase with short direct
    # convolutions (C-speed in numpy) and interleaved.
    full = np.zeros((len(x) - 1) * up + 1 + len(h) - 1)
    for phase in range(up):
        taps = h[phase::up]
        seg = np.convolve(x, taps)
        full[phase::up][: len(seg)] += seg
    return full[half_len:half_len + n_out]
