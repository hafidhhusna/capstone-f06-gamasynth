from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import soundfile as sf
from scipy import signal
import os, tempfile, base64

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Helper Functions ---
# --- Helper dari kode kamu ---
def read_mono(path):
    y, sr = sf.read(path)
    if y.ndim > 1:
        y = np.mean(y, axis=1)
    return y, sr

def find_peaks_fft(y, sr, n_peaks=6, min_freq=20):
    N = len(y)
    S = np.abs(np.fft.rfft(y * np.hanning(N)))
    freqs = np.fft.rfftfreq(N, 1/sr)
    mask = freqs > min_freq
    freqs, S = freqs[mask], S[mask]
    peaks_idx = np.argsort(S)[-n_peaks:][::-1]
    peak_freqs, peak_amps = freqs[peaks_idx], S[peaks_idx]
    return peak_freqs, peak_amps, freqs, S

def estimate_I_simple(y, sr, f_c, f_m):
    N = len(y)
    S = np.abs(np.fft.rfft(y * np.hanning(N)))
    freqs = np.fft.rfftfreq(N, 1/sr)
    idx_c = np.argmin(np.abs(freqs - f_c))
    idx_sb = np.argmin(np.abs(freqs - (f_c + f_m)))
    amp_c, amp_sb = S[idx_c], S[idx_sb]
    ratio = amp_sb / amp_c if amp_c > 0 else 0.0
    I_est = np.clip(0.5 + 10 * ratio, 0.2, 8.0)
    return I_est, ratio

def synth_improved(f_c, f_m, I0, duration=3.0, sr=44100,
                   attack_rate=200.0, decay_rate=3.0,
                   noise_level=0.9, noise_ms=8,
                   add_partials=6, partial_decay=1.8,
                   bp_bw=0.35, secondary_mod_ratio=0.5):
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    N = len(t)

    trans_samples = int(sr * (noise_ms/1000.0))
    noise = np.random.randn(N)
    noise_burst = np.zeros(N)
    win = 0.5 * (1 - np.cos(2*np.pi*np.arange(trans_samples)/max(1,trans_samples)))
    noise_burst[:trans_samples] = noise[:trans_samples] * win

    nyq = sr/2
    low = max(20.0, f_c*(1 - bp_bw))
    high = min(nyq-100, f_c*(1 + bp_bw))
    b, a = signal.butter(2, [low/nyq, high/nyq], btype='band')
    colored_noise = signal.lfilter(b, a, noise_burst)

    env_attack = 1.0 - np.exp(-attack_rate * t)
    env_decay = np.exp(-decay_rate * t)
    amp_env = env_attack * env_decay

    mod2 = secondary_mod_ratio * I0 * np.sin(2*np.pi*(f_m*1.6) * t)
    I_t = I0 * np.exp(-1.5 * t)
    y_fm = np.sin(2*np.pi*f_c*t + (I_t * np.sin(2*np.pi*f_m*t) + mod2))

    partials = np.zeros(N)
    for n in range(1, add_partials+1):
        detune = 1.0 + 0.002 * (n-1)
        amp = np.exp(-partial_decay*(n-1))
        partials += amp * np.sin(2*np.pi*(f_c * n * detune) * t)

    y = 0.9 * amp_env * (0.8 * y_fm + 0.5 * partials) + noise_level * colored_noise
    b2, a2 = signal.iirpeak(f_c/nyq, Q=10)
    y = signal.lfilter(b2, a2, y)
    y = y / (np.max(np.abs(y)) + 1e-12)

    return y, sr

# --- Endpoint ---
@app.post("/synthesize/")
async def synthesize(file: UploadFile = File(...), duration: float = Form(3.0)):
    # Simpan file sementara
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = tmp.name

    y_ref, sr = read_mono(tmp_path)
    seg_len = min(len(y_ref), sr * 3)
    y_ref_seg = y_ref[:seg_len]

    peak_freqs, peak_amps, _, _ = find_peaks_fft(y_ref_seg, sr, n_peaks=20)
    f_c = peak_freqs[np.argmax(peak_amps)]
    candidates = [f for f in np.sort(peak_freqs) if f > f_c + 20]
    f_m = candidates[0] - f_c if len(candidates) > 0 else f_c * 0.5
    I_est, _ = estimate_I_simple(y_ref_seg, sr, f_c, f_m)

    attack_rate, decay_rate = 200.0, 3.0
    y_new, sr_out = synth_improved(f_c, f_m, I_est, duration=duration, sr=sr,
                                   attack_rate=attack_rate, decay_rate=decay_rate)

    out_path = tmp_path.replace(".wav", "_synth.wav")
    sf.write(out_path, y_new.astype(np.float32), sr_out)

    # Encode audio ke base64
    with open(out_path, "rb") as f:
        audio_bytes = f.read()
    audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

    os.remove(tmp_path)
    os.remove(out_path)

    return JSONResponse({
        "f_c": float(f_c),
        "f_m": float(f_m),
        "I_est": float(I_est),
        "attack_rate": attack_rate,
        "decay_rate": decay_rate,
        "audio_base64": audio_base64
    })
