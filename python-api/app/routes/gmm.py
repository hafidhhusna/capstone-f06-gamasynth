from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.encoders import jsonable_encoder
from app.services import gmm_service, mfcc_service
import io, tempfile, os, traceback
import numpy as np

router = APIRouter()

def make_json_safe(obj):
    # rekursif: ubah obj menjadi tipe python bawaan yang json-serializable
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj

    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)

    if isinstance(obj, (bytes, bytearray)):
        try:
            return obj.decode("utf-8")
        except Exception:
            return list(obj)

    if isinstance(obj, dict):
        return {str(k): make_json_safe(v) for k, v in obj.items()}

    if isinstance(obj, (list, tuple, set)):
        return [make_json_safe(x) for x in obj]

    if hasattr(obj, "__dict__"):
        try:
            return make_json_safe(vars(obj))
        except Exception:
            pass

    try:
        return str(obj)
    except Exception:
        return repr(obj)


def inspect_problematic(result):
    # cek item yang bukan tipe sederhana, untuk debugging
    problems = []
    if isinstance(result, dict):
        for k, v in result.items():
            t = type(v).__name__
            if not isinstance(v, (type(None), bool, int, float, str, list, dict)):
                problems.append((k, t, repr(v)[:200]))
    return problems


@router.post("/compare/")
async def compare_gmm(reference_model: str = Form(...),
                      test_file: UploadFile = File(...),
                      topk: float = Form(0.2)):
    # endpoint: bandingkan file uji dengan model gmm referensi
    tmp_path = None
    try:
        # baca file upload dan simpan sementara
        b = await test_file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(b)
            tmp_path = tmp.name

        # ekstrak mfcc dari file sementara
        mfcc = mfcc_service.extract_mfcc_from_file(tmp_path)

        # panggil service gmm
        result = gmm_service.compare_with_model(reference_model, mfcc, topk=topk)

        # hapus per_frame jika ada agar hasil ringan
        if "per_frame" in result:
            del result["per_frame"]

        # tambahkan metadata dasar
        result.update({
            "test_file": test_file.filename
        })

        # konversi ke json-safe
        safe = make_json_safe(result)
        safe = jsonable_encoder(safe)

        return JSONResponse(content=safe)

    except Exception as e:
        tb = traceback.format_exc()
        # kirim detail error untuk debugging lokal
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})
    finally:
        # hapus file sementara
        try:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


@router.post("/plot_histogram/")
async def plot_gmm_histogram(reference_model: str = Form(...), test_file: UploadFile = File(None)):
    # buat plot histogram dari hasil gmm (kembalikan image/png)
    tmp_path = None
    try:
        mfcc = None
        if test_file:
            b = await test_file.read()
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
                tmp.write(b)
                tmp_path = tmp.name
            mfcc = mfcc_service.extract_mfcc_from_file(tmp_path)

        buf = gmm_service.plot_histogram(reference_model, mfcc)
        return StreamingResponse(buf, media_type="image/png")

    except Exception as e:
        # kembalikan pesan error sederhana
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
