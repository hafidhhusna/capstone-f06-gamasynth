from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from app.services.synth_service import analyze_file, synthesize_file
import numpy as np
import tempfile
import scipy.io.wavfile as wav

router = APIRouter()

@router.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    contents = await file.read()
    params = analyze_file(contents)
    return JSONResponse(params)

@router.post("/synthesize")
async def synthesize(
    file: UploadFile = File(...),
    carrier_frequency_fc: float = Form(...),
    modulator_frequency_fm: float = Form(...),
    modulation_index_I: float = Form(...),
    attack_rate: float = Form(...),
    decay_rate: float = Form(...),
    noise_level: float = Form(...),
    duration: float = Form(7.0),
    sampling_rate: int = Form(...),
    add_partials: int = Form(...),
    bp_bw: float = Form(...),
    secondary_mod_ratio: float = Form(...),
    detune_step: float = Form(...),
):
    contents = await file.read()
    params = {
        "carrier_frequency_fc": carrier_frequency_fc,
        "modulator_frequency_fm": modulator_frequency_fm,
        "modulation_index_I": modulation_index_I,
        "attack_rate": attack_rate,
        "decay_rate": decay_rate,
        "noise_level": noise_level,
        "duration": duration,
        "sampling_rate": sampling_rate,
        "add_partials": add_partials,
        "bp_bw": bp_bw,
        "secondary_mod_ratio": secondary_mod_ratio,
        "detune_step": detune_step,
    }
    out_path = synthesize_file(contents, params)
    return FileResponse(out_path, media_type="audio/wav", filename="file_synthesized.wav")

@router.post("/FFT")
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

