from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.encoders import jsonable_encoder
from app.services import gmm_service, mfcc_service
import tempfile, os, joblib, uuid, logging
import numpy as np
from pathlib import Path

router = APIRouter()

# direktori model
MODEL_DIR = Path(os.environ.get("GMM_MODEL_DIR", "models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# logger minimal
logger = logging.getLogger("app.gmm")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

# ---------------- helpers ----------------
def make_json_safe(obj):
    """Konversi objek menjadi tipe yang json-serializable (sederhana)."""
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, dict):
        return {str(k): make_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [make_json_safe(x) for x in obj]
    try:
        return str(obj)
    except Exception:
        return repr(obj)


def _sanitize_model_name(name: str) -> str:
    """Sederhana: ambil basename dan pastikan .pkl di akhir."""
    if not name:
        return name
    base = os.path.basename(name)
    return base if base.lower().endswith(".pkl") else base + ".pkl"


# ---------------- endpoints ----------------
@router.post("/compare/")
async def compare_gmm(reference_model: str = Form(...),
                      test_file: UploadFile = File(...),
                      topk: float = Form(0.2)):
    tmp_path = None
    try:
        # simpan sementara file upload
        b = await test_file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(b)
            tmp_path = tmp.name

        # ekstrak mfcc
        mfcc = mfcc_service.extract_mfcc_from_file(tmp_path)
        if mfcc is None or not isinstance(mfcc, np.ndarray) or mfcc.ndim != 2:
            raise HTTPException(status_code=400, detail="gagal ekstrak mfcc dari file uji")

        # bandingkan
        result = gmm_service.compare_with_model(reference_model, mfcc, topk=topk)

        # jangan kirim per-frame besar
        result.pop("per_frame", None)

        result.update({"test_file": test_file.filename})
        safe = make_json_safe(result)
        return JSONResponse(content=jsonable_encoder(safe))

    except HTTPException:
        raise
    except FileNotFoundError as e:
        # model tidak ditemukan
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("compare_gmm error")
        raise HTTPException(status_code=500, detail={"error": "internal server error", "msg": str(e)})
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


@router.post("/plot_histogram/")
async def plot_gmm_histogram(reference_model: str = Form(...), test_file: UploadFile = File(None)):
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

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("plot_histogram error")
        raise HTTPException(status_code=500, detail={"error": "internal server error", "msg": str(e)})
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


@router.post("/retrain_gmm/")
async def retrain_gmm(file: UploadFile = File(...),
                      model_name: str = Form(None),
                      n_components: int = Form(8)):
    tmp_ref = None
    try:
        # simpan file referensi sementara
        b = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(b)
            tmp_ref = tmp.name

        X = mfcc_service.extract_mfcc_from_file(tmp_ref)
        if X is None or not isinstance(X, np.ndarray) or X.ndim != 2:
            raise HTTPException(status_code=400, detail="gagal ekstrak mfcc dari file referensi")

        if X.shape[0] < max(2, int(n_components)):
            raise HTTPException(status_code=400, detail=f"audio terlalu pendek untuk n_components={n_components}")

        # training
        model_obj = gmm_service.train_model_from_features(X, n_components)

        # simpan model sederhana (langsung)
        if not model_name:
            model_name = f"gmm_{uuid.uuid4().hex}.pkl"
        else:
            model_name = _sanitize_model_name(model_name)

        model_path = MODEL_DIR / model_name
        joblib.dump(model_obj, model_path, compress=3)

        out = {
            "status": "ok",
            "model_name": model_name,
            "model_path": str(model_path),
            "stats": model_obj.get("stats", {})
        }
        safe = make_json_safe(out)
        return JSONResponse(content=jsonable_encoder(safe))

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("retrain_gmm error")
        raise HTTPException(status_code=500, detail={"error": "internal server error", "msg": str(e)})
    finally:
        if tmp_ref and os.path.exists(tmp_ref):
            try:
                os.remove(tmp_ref)
            except Exception:
                pass


@router.post("/train_and_compare/")
async def train_and_compare(reference_file: UploadFile = File(...),
                            test_file: UploadFile = File(...),
                            model_name: str = Form(None),
                            n_components: int = Form(8),
                            topk: float = Form(0.2)):
    tmp_ref = None
    tmp_test = None
    try:
        # simpan reference
        b_ref = await reference_file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as t:
            t.write(b_ref)
            tmp_ref = t.name

        # simpan test
        b_test = await test_file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as t2:
            t2.write(b_test)
            tmp_test = t2.name

        # ekstrak
        X_ref = mfcc_service.extract_mfcc_from_file(tmp_ref)
        X_test = mfcc_service.extract_mfcc_from_file(tmp_test)
        if X_ref is None or X_test is None:
            raise HTTPException(status_code=400, detail="gagal ekstrak mfcc dari salah satu file")

        if X_ref.shape[0] < max(2, int(n_components)):
            raise HTTPException(status_code=400, detail=f"reference audio terlalu pendek untuk n_components={n_components}")

        # train (synchronous)
        model_obj = gmm_service.train_model_from_features(X_ref, n_components)

        # simpan model sederhana
        if not model_name:
            model_name = f"gmm_{uuid.uuid4().hex}.pkl"
        else:
            model_name = _sanitize_model_name(model_name)
        model_path = MODEL_DIR / model_name
        joblib.dump(model_obj, model_path, compress=3)

        # score test
        scaler = model_obj["scaler"]
        Xs_test = gmm_service.transform_with_scaler(scaler, X_test)
        gmm = model_obj["gmm"]
        stats = model_obj["stats"]
        per_frame_test = gmm.score_samples(Xs_test)

        avg_mean = float(np.mean(per_frame_test))
        avg_topk = float(np.mean(np.sort(per_frame_test)[-max(1, int(len(per_frame_test) * topk)):]))

        train_mean = float(stats.get("train_mean", float("nan")))
        train_std = float(stats.get("train_std", float("nan")))
        threshold = float(stats.get("threshold", float("nan")))

        p_mean, z_mean = gmm_service.z_to_percent_normcdf(avg_mean, train_mean, train_std)
        p_topk, z_topk = gmm_service.z_to_percent_normcdf(avg_topk, train_mean, train_std)

        result = {
            "model_name": model_name,
            "model_path": str(model_path),
            "train_stats": {
                "n_samples": int(stats.get("n_samples", 0)),
                "n_features": int(stats.get("n_features", 0)),
                "train_mean": train_mean,
                "train_std": train_std,
                "threshold": threshold
            },
            "test_summary": {
                "test_file": test_file.filename,
                "n_frames": int(len(per_frame_test)),
                "avg_mean": avg_mean,
                "avg_topk": avg_topk,
                "z_score_mean": z_mean,
                "z_score_topk": z_topk,
                "percent_similarity_mean": p_mean,
                "percent_similarity_topk": p_topk,
                "is_match_mean": (not np.isnan(threshold)) and (avg_mean >= threshold),
                "is_match_topk": (not np.isnan(threshold)) and (avg_topk >= threshold)
            }
        }

        safe = make_json_safe(result)
        return JSONResponse(content=jsonable_encoder(safe))

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("train_and_compare error")
        raise HTTPException(status_code=500, detail={"error": "internal server error", "msg": str(e)})
    finally:
        if tmp_ref and os.path.exists(tmp_ref):
            try:
                os.remove(tmp_ref)
            except Exception:
                pass
        if tmp_test and os.path.exists(tmp_test):
            try:
                os.remove(tmp_test)
            except Exception:
                pass