from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse
from app.services import gmm_service, mfcc_service
import io

router = APIRouter()

@router.post("/compare/")
async def compare_gmm(reference_model: str = Form(...), test_file: UploadFile = File(...), topk: float = Form(0.2)):
    b = await test_file.read()
    mfcc = mfcc_service.extract_mfcc_from_file(io.BytesIO(b))
    result = gmm_service.compare_with_model(reference_model, mfcc, topk=topk)
    result.update({'test_file': test_file.filename, 'n_frames': len(result['per_frame'])})
    return JSONResponse(result)

@router.post("/plot_histogram/")
async def plot_gmm_histogram(reference_model: str = Form(...), test_file: UploadFile = File(None)):
    mfcc = None
    if test_file:
        b = await test_file.read()
        mfcc = mfcc_service.extract_mfcc_from_file(io.BytesIO(b))
    buf = gmm_service.plot_histogram(reference_model, mfcc)
    return StreamingResponse(buf, media_type="image/png")
