# app/routes/gmm.py
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.encoders import jsonable_encoder
from app.services import gmm_service, mfcc_service
import io, tempfile, os, traceback, joblib, uuid
import numpy as np
from pathlib import Path

router = APIRouter()

MODEL_DIR = Path(os.environ.get("GMM_MODEL_DIR", "models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# ---------------- helper json ----------------
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


# ---------------- endpoints: compare + plot ----------------
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
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})
    finally:
        try:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


# ---------------- endpoint: retrain_gmm ----------------
@router.post("/retrain_gmm/")
async def retrain_gmm(file: UploadFile = File(...),
                      model_name: str = Form(None),
                      n_components: int = Form(8)):
    tmp_ref = None
    try:
        # simpan sementara file referensi
        b = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(b)
            tmp_ref = tmp.name

        # ekstrak mfcc dari file referensi
        X = mfcc_service.extract_mfcc_from_file(tmp_ref)
        if X is None or not isinstance(X, np.ndarray) or X.ndim != 2:
            raise HTTPException(status_code=400, detail="gagal ekstrak mfcc: pastikan file audio valid (.wav)")

        # panggil service untuk training (semua logic EM ada di service)
        model_obj = gmm_service.train_model_from_features(X, n_components=n_components)

        # tentukan nama file model (normalisasi ekstensi)
        if not model_name:
            model_name = f"gmm_{uuid.uuid4().hex}.pkl"
        else:
            if not model_name.lower().endswith(".pkl"):
                model_name = model_name + ".pkl"

        model_path = MODEL_DIR / model_name

        # simpan model dengan joblib (tanpa mmap_mode)
        joblib.dump(model_obj, model_path, compress=3)

        # balikan ringkasan hasil
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
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})
    finally:
        try:
            if tmp_ref and os.path.exists(tmp_ref):
                os.remove(tmp_ref)
        except Exception:
            pass


# ---------------- endpoint: train_and_compare ----------------
@router.post("/train_and_compare/")
async def train_and_compare(reference_file: UploadFile = File(...),
                            test_file: UploadFile = File(...),
                            model_name: str = Form(None),
                            n_components: int = Form(8),
                            topk: float = Form(0.2)):
    tmp_ref = None
    tmp_test = None
    try:
        # simpan reference sementara
        b_ref = await reference_file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as t:
            t.write(b_ref)
            tmp_ref = t.name

        # simpan test sementara
        b_test = await test_file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as t2:
            t2.write(b_test)
            tmp_test = t2.name

        # ekstrak mfcc reference untuk training
        X_ref = mfcc_service.extract_mfcc_from_file(tmp_ref)
        if X_ref is None or not isinstance(X_ref, np.ndarray) or X_ref.ndim != 2:
            raise HTTPException(status_code=400, detail="gagal ekstrak mfcc dari reference file")

        # ekstrak mfcc test untuk perbandingan (validasi awal)
        X_test = mfcc_service.extract_mfcc_from_file(tmp_test)
        if X_test is None or not isinstance(X_test, np.ndarray) or X_test.ndim != 2:
            raise HTTPException(status_code=400, detail="gagal ekstrak mfcc dari test file")

        # train model via service
        model_obj = gmm_service.train_model_from_features(X_ref, n_components=n_components)

        # simpan model
        if not model_name:
            model_name = f"gmm_{uuid.uuid4().hex}.pkl"
        else:
            if not model_name.lower().endswith(".pkl"):
                model_name = model_name + ".pkl"
        model_path = MODEL_DIR / model_name
        joblib.dump(model_obj, model_path, compress=3)

        # transform test pake scaler dari model (service adapter)
        scaler = model_obj["scaler"]
        Xs_test = gmm_service.transform_with_scaler(scaler, X_test)

        # scoring
        gmm = model_obj["gmm"]
        stats = model_obj["stats"]
        per_frame_test = gmm.score_samples(Xs_test)
        avg_mean = float(np.mean(per_frame_test))
        avg_topk = float(np.mean(np.sort(per_frame_test)[-max(1, int(len(per_frame_test)*topk)):]))

        # ambil statistik training
        train_mean = float(stats.get("train_mean", float("nan")))
        train_std = float(stats.get("train_std", float("nan")))
        threshold = float(stats.get("threshold", float("nan")))

        # compute percent/z
        def _z_to_percent(a, m, s):
            if s <= 0 or np.isnan(s):
                return (100.0 if a >= m else 0.0), 0.0
            z = (a - m) / s
            from scipy.stats import norm
            p = float(norm.cdf(z))
            return 100.0 * p, float(z)

        p_mean, z_mean = _z_to_percent(avg_mean, train_mean, train_std)
        p_topk, z_topk = _z_to_percent(avg_topk, train_mean, train_std)

        # hasil ringkas
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
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})
    finally:
        # hapus file sementara
        try:
            if tmp_ref and os.path.exists(tmp_ref):
                os.remove(tmp_ref)
            if tmp_test and os.path.exists(tmp_test):
                os.remove(tmp_test)
        except Exception:
            pass
