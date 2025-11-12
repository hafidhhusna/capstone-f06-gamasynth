import os, io, math, pickle
from pathlib import Path
from typing import List, Optional

import numpy as np
from scipy import linalg
from scipy.special import logsumexp
from scipy.stats import norm
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sklearn.preprocessing import StandardScaler
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import requests as _requests

# ---------------- CONFIG ----------------
MFCC_API_URL = os.environ.get("MFCC_API_URL", "http://127.0.0.1:8000/extract_mfcc/")
MODEL_DIR = Path(os.environ.get("GMM_MODEL_DIR", "gmm_models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Gamelan GMM (Optimized Diagonal Covariance)")

# ---------------- HELPERS ----------------
def call_mfcc_api_bytes(file_bytes: bytes, filename: str, timeout=30.0):
    files = {"file": (filename, file_bytes, "audio/wav")}
    resp = _requests.post(MFCC_API_URL, files=files, timeout=timeout)
    if resp.status_code != 200:
        raise RuntimeError(f"MFCC API error {resp.status_code}: {resp.text[:300]}")
    j = resp.json()
    if "mfcc" not in j:
        raise RuntimeError("MFCC API did not return 'mfcc'")
    return np.array(j["mfcc"], dtype=np.float64)

def topk_mean(vals: np.ndarray, k_ratio: float = 0.4):
    if len(vals) == 0:
        return float("nan")
    k = max(1, int(len(vals) * float(k_ratio)))
    return float(np.mean(np.sort(vals)[-k:]))

def z_to_percent_normcdf(avg_ll: float, mean: float, std: float):
    if std <= 0:
        return (100.0 if avg_ll >= mean else 0.0), 0.0
    z = (avg_ll - mean) / std
    p = float(norm.cdf(z))
    return 100.0 * p, float(z)

def save_model(model_name: str, obj):
    p = MODEL_DIR / f"{model_name}.pkl"
    with open(p, "wb") as fh:
        pickle.dump(obj, fh)
    return str(p)

def load_model(model_name: str):
    p = MODEL_DIR / f"{model_name}.pkl"
    if not p.exists():
        raise FileNotFoundError("Model not found")
    with open(p, "rb") as fh:
        return pickle.load(fh)

# ---------------- OPTIMIZED DIAGONAL GMM ----------------
class GMMDiag:
    """
    Optimized Gaussian Mixture Model (Diagonal covariance only).
    Lebih efisien daripada versi full covariance.
    """

    def __init__(self, n_components=8, reg_covar=1e-3, max_iter=200, tol=1e-4, verbose=False, random_state=0):
        self.n_components = int(n_components)
        self.reg_covar = float(reg_covar)
        self.max_iter = int(max_iter)
        self.tol = float(tol)
        self.verbose = verbose
        self.random_state = np.random.RandomState(random_state)

    def _initialize(self, X):
        n_samples, n_features = X.shape
        self.weights_ = np.ones(self.n_components) / self.n_components
        idx = self.random_state.choice(n_samples, self.n_components, replace=False)
        self.means_ = X[idx]
        var = np.var(X, axis=0) + self.reg_covar
        self.covariances_ = np.tile(var, (self.n_components, 1))

    def _estimate_log_prob(self, X):
        n_samples, n_features = X.shape
        log_prob = np.empty((n_samples, self.n_components))
        const = -0.5 * n_features * math.log(2 * math.pi)
        for k in range(self.n_components):
            var = self.covariances_[k]
            prec = 1.0 / var
            log_det = -0.5 * np.sum(np.log(var))
            diff = X - self.means_[k]
            log_prob[:, k] = const + log_det - 0.5 * np.sum(diff * diff * prec, axis=1)
        return log_prob

    def fit(self, X):
        X = np.asarray(X, dtype=float)
        n_samples, n_features = X.shape
        self._initialize(X)
        lower_bound = -np.inf

        for i in range(self.max_iter):
            # ---- E-step ----
            log_prob = self._estimate_log_prob(X)
            log_prob_weighted = log_prob + np.log(self.weights_ + 1e-15)
            log_prob_norm = logsumexp(log_prob_weighted, axis=1)
            log_resp = log_prob_weighted - log_prob_norm[:, None]
            resp = np.exp(log_resp)

            # ---- M-step ----
            nk = resp.sum(axis=0) + 10 * np.finfo(resp.dtype).eps
            self.weights_ = nk / n_samples
            self.means_ = (resp.T @ X) / nk[:, None]

            for k in range(self.n_components):
                diff = X - self.means_[k]
                var = np.average(diff * diff, axis=0, weights=resp[:, k]) + self.reg_covar
                self.covariances_[k] = var

            new_lower = float(np.mean(log_prob_norm))
            if abs(new_lower - lower_bound) < self.tol:
                break
            lower_bound = new_lower

        self.lower_bound_ = lower_bound
        return self

    def score_samples(self, X):
        log_prob = self._estimate_log_prob(X)
        return logsumexp(log_prob + np.log(self.weights_ + 1e-15), axis=1)

# ---------------- ENDPOINTS ----------------
@app.post("/train_model/")
async def train_model(files: List[UploadFile] = File(...),
                      model_name: str = Form(...),
                      n_components: int = Form(8)):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    feats = []
    for f in files:
        b = await f.read()
        mfcc = call_mfcc_api_bytes(b, f.filename)
        feats.append(mfcc)
    X = np.vstack(feats)
    if X.size == 0:
        raise HTTPException(status_code=400, detail="Empty features")

    scaler = StandardScaler().fit(X)
    Xs = scaler.transform(X)

    gmm = GMMDiag(n_components=n_components, reg_covar=1e-3, max_iter=200, tol=1e-4, verbose=False)
    gmm.fit(Xs)

    per_frame = gmm.score_samples(Xs)
    train_mean = float(np.mean(per_frame))
    train_std = float(np.std(per_frame))
    q10, q90 = np.quantile(per_frame, [0.1, 0.9])
    threshold = train_mean - 2.0 * train_std

    stats = {'train_mean': train_mean, 'train_std': train_std, 'q10': q10, 'q90': q90,
             'threshold': threshold, 'per_frame_train': per_frame}

    save_model(model_name, {'gmm': gmm, 'scaler': scaler, 'stats': stats})

    return JSONResponse({
        'model_name': model_name,
        'n_ref_frames': int(Xs.shape[0]),
        'train_mean': train_mean,
        'train_std': train_std,
        'q10': q10,
        'q90': q90,
        'threshold': threshold
    })

@app.post("/compare/")
async def compare(reference_model: str = Form(...),
                  test_file: UploadFile = File(...),
                  pooling_mode: str = Form("topk"),
                  topk: float = Form(0.2)):
    data = load_model(reference_model)
    gmm, scaler, stats = data['gmm'], data['scaler'], data['stats']

    b = await test_file.read()
    mfcc = call_mfcc_api_bytes(b, test_file.filename)
    Xs = scaler.transform(mfcc)

    per_frame = gmm.score_samples(Xs)
    avg_mean = float(np.mean(per_frame))
    avg_median = float(np.median(per_frame))
    avg_topk = float(topk_mean(per_frame, k_ratio=topk))

    train_mean, train_std = stats['train_mean'], stats['train_std']
    threshold = stats['threshold']

    p_mean, z_mean = z_to_percent_normcdf(avg_mean, train_mean, train_std)
    p_topk, z_topk = z_to_percent_normcdf(avg_topk, train_mean, train_std)

    return JSONResponse({
        'test_file': test_file.filename,
        'n_frames': len(per_frame),
        'avg_mean': avg_mean,
        'avg_median': avg_median,
        'avg_topk': avg_topk,
        'train_mean': train_mean,
        'train_std': train_std,
        'threshold': threshold,
        'z_score_mean': z_mean,
        'z_score_topk': z_topk,
        'percent_similarity_mean': p_mean,
        'percent_similarity_topk': p_topk,
        'is_match_mean': avg_mean >= threshold,
        'is_match_topk': avg_topk >= threshold
    })

@app.post("/plot_histogram/")
async def plot_histogram(reference_model: str = Form(...),
                         test_file: Optional[UploadFile] = File(None)):
    data = load_model(reference_model)
    stats = data['stats']
    per_frame_train = np.array(stats['per_frame_train'])
    train_mean, threshold = stats['train_mean'], stats['threshold']

    arrs, labels = [per_frame_train], [f"train (n={len(per_frame_train)})"]
    if test_file:
        b = await test_file.read()
        mfcc = call_mfcc_api_bytes(b, test_file.filename)
        Xs = data['scaler'].transform(mfcc)
        per_frame_test = data['gmm'].score_samples(Xs)
        arrs.append(per_frame_test)
        labels.append(f"test ({test_file.filename}) n={len(per_frame_test)}")

    plt.figure(figsize=(9,6))
    for i, a in enumerate(arrs):
        plt.hist(a, bins=60, alpha=0.5, label=labels[i], density=False)
    plt.axvline(train_mean, color='k', linestyle='--', linewidth=2, label=f"mean={train_mean:.3f}")
    plt.axvline(threshold, color='r', linestyle=':', linewidth=2, label=f"threshold={threshold:.3f}")
    plt.title(f"GMM (diag) Log-Likelihoods ({reference_model})")
    plt.xlabel("Per-frame log-likelihood")
    plt.ylabel("Count")
    plt.legend()
    plt.grid(alpha=0.25)
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format='png')
    plt.close()
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")

@app.get("/")
def root():
    return {"msg": "Optimized Diagonal GMM service running", "mfcc_api": MFCC_API_URL}
