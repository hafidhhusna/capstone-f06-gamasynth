from fastapi import FastAPI
import numpy as np
import scipy.io.wavfile as wav

app = FastAPI()

@app.get("/FFT")
def compute_fft():
    # --- 1. Ambil file audio ---
    file_path = 'sintesis_saron_p1.wav'
    sr, audio = wav.read(file_path)

    # Jika stereo → ubah ke mono
    if len(audio.shape) == 2:
        audio = np.mean(audio, axis=1)

    # --- 2. FFT ---
    N = len(audio)
    fft_vals = np.fft.fft(audio)
    fft_magnitude = np.abs(fft_vals)[:N//2]
    freqs = np.fft.fftfreq(N, 1/sr)[:N//2]

    # Convert ke Python native list agar bisa jadi JSON
    freqs_list = freqs.tolist()
    magnitude_list = fft_magnitude.tolist()

    # --- 3. Return data JSON ---
    return {
        "sample_rate": int(sr),
        "samples": int(N),
        "frequency": freqs_list,
        "magnitude": magnitude_list
    }
