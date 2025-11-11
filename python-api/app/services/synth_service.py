import numpy as np
import soundfile as sf
from scipy import signal
import tempfile
import os

# ===============================
# Helper Functions
# ===============================
def read_mono(path):
    y, sr = sf.read(path)
    if y.ndim > 1:
        y = np.mean(y, axis=1)
    return y, sr

def find_peaks_fft(y, sr, n_peaks=6, min_freq=20):
    N = len(y)
    S = np.abs(np.fft.rfft(y * np.hanning(N)))
    freqs = np.fft.rfftfreq(N, 1 / sr)
    mask = freqs > min_freq
    freqs = freqs[mask]
    S = S[mask]
    peaks_idx = np.argsort(S)[-n_peaks:][::-1]
    peak_freqs = freqs[peaks_idx]
    peak_amps = S[peaks_idx]
    return peak_freqs, peak_amps, freqs, S

def estimate_I_simple(y, sr, f_c, f_m):
    N = len(y)
    S = np.abs(np.fft.rfft(y * np.hanning(N)))
    freqs = np.fft.rfftfreq(N, 1 / sr)
    idx_c = np.argmin(np.abs(freqs - f_c))
    idx_sb = np.argmin(np.abs(freqs - (f_c + f_m)))
    amp_c = S[idx_c]
    amp_sb = S[idx_sb]
    ratio = amp_sb / amp_c if amp_c > 0 else 0.0
    I_est = np.clip(0.5 + 10 * ratio, 0.2, 8.0)
    return I_est, ratio

def synth_improved(f_c, f_m, I0, duration=7.0, sr=44100,
                   attack_rate=150.0, decay_rate=2.5,
                   noise_level=10.0, noise_ms=5,
                   add_partials=10, partial_decay=1.4,
                   bp_bw=0.25, secondary_mod_ratio=0.25,
                   detune_step=0.0015):
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    N = len(t)

    # Transient noise
    trans_samples = int(sr * (noise_ms / 1000.0))
    noise = np.random.randn(N)
    noise_burst = np.zeros(N)
    win = 0.5 * (1 - np.cos(2 * np.pi * np.arange(trans_samples) / max(1, trans_samples)))
    noise_burst[:trans_samples] = noise[:trans_samples] * win

    nyq = sr / 2
    low = max(20.0, f_c * (1 - bp_bw))
    high = min(nyq - 100, f_c * (1 + bp_bw))
    b, a = signal.butter(2, [low / nyq, high / nyq], btype="band")
    colored_noise = signal.lfilter(b, a, noise_burst)

    # Envelope
    env_attack = 1.0 - np.exp(-attack_rate * t)
    env_decay = np.exp(-decay_rate * t)
    amp_env = env_attack * env_decay

    # FM synthesis
    mod2 = secondary_mod_ratio * I0 * np.sin(2 * np.pi * (f_m * 1.6) * t)
    I_t = I0 * np.exp(-2.0 * t)
    y_fm = np.sin(2 * np.pi * f_c * t + (I_t * np.sin(2 * np.pi * f_m * t) + mod2))

    # Additive partials
    partials = np.zeros(N)
    for n in range(1, add_partials + 1):
        detune = 1.0 + detune_step * (n - 1)
        amp = np.exp(-partial_decay * (n - 1))
        partials += amp * np.sin(2 * np.pi * (f_c * n * detune) * t)

    # Combine
    y = 0.9 * amp_env * (0.8 * y_fm + 0.5 * partials) + noise_level * colored_noise
    b2, a2 = signal.iirpeak(f_c / nyq, Q=10)
    y = signal.lfilter(b2, a2, y)
    y = y / (np.max(np.abs(y)) + 1e-12)
    return y, sr

# ===============================
# Service Functions
# ===============================
def analyze_file(file_bytes: bytes):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    y_ref, sr = read_mono(tmp_path)
    seg_len = min(len(y_ref), sr * 3)
    y_ref_seg = y_ref[:seg_len]
    duration = len(y_ref) / sr

    peak_freqs, peak_amps, _, _ = find_peaks_fft(y_ref_seg, sr, n_peaks=20)
    f_c = peak_freqs[np.argmax(peak_amps)]
    candidates = [f for f in np.sort(peak_freqs) if f > f_c + 20]
    f_m = candidates[0] - f_c if len(candidates) > 0 else f_c * 0.5
    I_est, _ = estimate_I_simple(y_ref_seg, sr, f_c, f_m)

    os.remove(tmp_path)

    return {
        "carrier_frequency_fc": round(float(f_c), 3),
        "modulator_frequency_fm": round(float(f_m), 3),
        "modulation_index_I": round(float(I_est), 3),
        "duration": round(float(duration), 3),
        "sampling_rate": sr,
        "attack_rate": 150.0,
        "decay_rate": 2.5,
        "noise_level": 10.0,
        "noise_ms": 10.0,
        "add_partials": 10.0,
        "bp_bw": 0.25,
        "secondary_mod_ratio": 0.25,
        "detune_step": 0.0015,
    }

def synthesize_file(file_bytes: bytes, params: dict):
    y_new, sr_out = synth_improved(
        params["carrier_frequency_fc"],
        params["modulator_frequency_fm"],
        params["modulation_index_I"],
        duration=params.get("duration", 7.0),
        sr=params.get("sampling_rate", 44100),
        attack_rate=params.get("attack_rate", 150.0),
        decay_rate=params.get("decay_rate", 2.5),
        noise_level=params.get("noise_level", 10.0),
        add_partials=params.get("add_partials", 10),
        bp_bw=params.get("bp_bw", 0.25),
        secondary_mod_ratio=params.get("secondary_mod_ratio", 0.25),
        detune_step=params.get("detune_step", 0.0015),
    )

    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix="_synth.wav")
    sf.write(tmp_file.name, y_new.astype(np.float32), sr_out)
    return tmp_file.name
