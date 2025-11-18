from fastapi import FastAPI, UploadFile, File
import numpy as np
import scipy.io.wavfile as wav
import tempfile

app = FastAPI()

@app.post("/FFT")
async def compute_fft(file: UploadFile = File(...)):
    # --- 1. Simpan file sementara ---
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp.write(await file.read())
        temp_path = tmp.name

    # --- 2. Baca file audio ---
    sr, audio = wav.read(temp_path)

    # Jika stereo → ubah ke mono
    if len(audio.shape) == 2:
        audio = np.mean(audio, axis=1)

    # --- 3. FFT ---
    N = len(audio)
    fft_vals = np.fft.fft(audio)
    fft_magnitude = np.abs(fft_vals)[:N // 2]
    freqs = np.fft.fftfreq(N, 1/sr)[:N // 2]

    # Convert ke list agar bisa di-JSON-kan
    return {
        "sample_rate": int(sr),
        "samples": int(N),
        "frequency": freqs.tolist(),
        "magnitude": fft_magnitude.tolist()
    }
