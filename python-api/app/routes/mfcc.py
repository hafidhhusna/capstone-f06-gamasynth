from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
import uuid
import os
import tempfile
from app.services.mfcc_service import MFCCExtractor

router = APIRouter()

@router.post("/extract_mfcc/")
async def extract_mfcc(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = tmp.name

    # Ekstraksi MFCC
    y, sr = MFCCExtractor(tmp_path, sr=None)  # kalau mau langsung service extract, bisa panggil extract_mfcc_from_file
    extractor = MFCCExtractor(sr=sr)
    mfcc_result = extractor.extract(y)

    # Simpan plot
    png_filename = f"mfcc_{uuid.uuid4().hex}.png"
    extractor.save_plot(mfcc_result, png_filename)

    os.remove(tmp_path)

    return JSONResponse({
        "mfcc": mfcc_result.tolist(),
        "plot_file": png_filename
    })
