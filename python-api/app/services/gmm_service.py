# app/services/gmm_service.py
import os
from pathlib import Path
import pickle
import io
import math
import numpy as np
from scipy.special import logsumexp
from scipy.stats import norm
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from joblib import load as joblib_load

# direktori model
MODEL_DIR = Path(os.environ.get("GMM_MODEL_DIR", "models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# ---------------- gmm helper ----------------
class GMMDiag:
    def __init__(self, n_components=8, reg_covar=1e-3, max_iter=200, tol=1e-4, verbose=False, random_state=0):
        # inisialisasi parameter training (objek ini digunakan sebagai container parameter)
        self.n_components = n_components
        self.reg_covar = reg_covar
        self.max_iter = max_iter
        self.tol = tol
        self.verbose = verbose
        self.random_state = np.random.RandomState(random_state)
        # atribut model (diisi setelah training atau diset langsung)
        self.means_ = None
        self.covariances_ = None
        self.weights_ = None

    def _estimate_log_prob(self, X):
        # hitung log-likelihood tiap komponen (diagonal covariance)
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

    def score_samples(self, X):
        # return per-frame log-likelihood gabungan (log p(x))
        log_prob = self._estimate_log_prob(X)
        return logsumexp(log_prob + np.log(self.weights_ + 1e-15), axis=1)

# ---------------- model loader ----------------
def _ensure_ext(name: str, ext: str = ".pkl") -> str:
    # tambahkan ekstensi jika belum ada
    base = os.path.basename(name)
    return base if base.lower().endswith(ext) else base + ext

def _find_model_path(model_name: str):
    # cek beberapa kandidat path untuk model
    p = Path(model_name)
    if p.exists():
        return p
    candidates = [
        MODEL_DIR / model_name,
        MODEL_DIR / _ensure_ext(model_name, ".pkl"),
        MODEL_DIR / (os.path.splitext(_ensure_ext(model_name, ".pkl"))[0] + ".joblib"),
    ]
    for c in candidates:
        if c.exists():
            return c
    return None

def load_model(model_name: str):
    model_path = _find_model_path(model_name)
    if model_path is None:
        raise FileNotFoundError(f"model {model_name} tidak ditemukan di {MODEL_DIR}")

    try:
        # prioritas joblib jika extension .joblib
        if model_path.suffix.lower() == ".joblib":
            data = joblib_load(model_path)
        else:
            try:
                # joblib dapat membuka file .pkl yang dibuat joblib.dump juga
                data = joblib_load(model_path)
            except Exception:
                # fallback ke pickle, encoding latin1 untuk kompatibilitas python2/3 atau colab
                with open(model_path, "rb") as f:
                    data = pickle.load(f, encoding="latin1")
    except Exception as e:
        raise RuntimeError(f"gagal memuat model {model_path}: {repr(e)}") from e

    # jika file menyimpan langsung gmm object, bungkus jadi dict
    if not isinstance(data, dict):
        data = {"gmm": data}

    if "gmm" not in data:
        raise RuntimeError(f"file {model_path} tidak berisi objek 'gmm' yang valid")

    if "scaler" not in data:
        # jangan silent fallback: minta retrain agar statistik konsisten
        raise RuntimeError(f"model {model_path.name} tidak punya 'scaler'. harap retrain model di environment ini.")

    if "stats" not in data:
        data["stats"] = {}

    return data

# ---------------- scaler adapter ----------------
def transform_with_scaler(scaler, X: np.ndarray):
    if hasattr(scaler, "transform") and callable(getattr(scaler, "transform")):
        return scaler.transform(X)
    if isinstance(scaler, dict) and "mean" in scaler and "std" in scaler:
        mean = np.array(scaler["mean"])
        std = np.array(scaler["std"]) + 1e-12
        return (X - mean) / std
    # jika format unknown, coba panggil sebagai callable
    if callable(scaler):
        return scaler(X)
    raise RuntimeError("unknown scaler format: harus sklearn-like atau dict{'mean','std'}")

# ---------------- training (service) ----------------
def train_model_from_features(X: np.ndarray,
                              n_components: int = 8,
                              reg_covar: float = 1e-3,
                              max_iter: int = 200,
                              tol: float = 1e-4):
    # validasi input
    if X is None or not isinstance(X, np.ndarray) or X.ndim != 2:
        raise ValueError("x harus numpy array 2d (n_samples, n_features)")

    n_samples, n_features = X.shape
    k = int(n_components)
    if k <= 0 or k > n_samples:
        raise ValueError("n_components harus >0 dan <= n_samples")

    # standar manual (scaler)
    mean = np.mean(X, axis=0)
    std = np.std(X, axis=0)
    std = std + 1e-8  # hindari nol
    Xs = (X - mean) / std

    # inisialisasi parameter gmm
    rng = np.random.RandomState(0)
    init_idx = rng.choice(n_samples, k, replace=False)
    means = Xs[init_idx].astype(float)
    covariances = np.ones((k, n_features), dtype=float)
    weights = np.ones(k, dtype=float) / k

    prev_ll = -np.inf

    # em loop
    for iteration in range(int(max_iter)):
        # e-step: hitung log prob tiap komponen
        log_prob = np.empty((n_samples, k), dtype=float)
        const = -0.5 * n_features * math.log(2 * math.pi)
        for j in range(k):
            var = covariances[j]
            prec = 1.0 / var
            log_det = -0.5 * np.sum(np.log(var))
            diff = Xs - means[j]
            log_prob[:, j] = const + log_det - 0.5 * np.sum(diff * diff * prec, axis=1) + np.log(weights[j] + 1e-15)

        # normalizer log-sum-exp
        logsum = np.logaddexp.reduce(log_prob, axis=1)
        ll = float(np.sum(logsum))

        # tangani numerical issues
        resp = np.exp(log_prob - logsum[:, np.newaxis])

        # m-step
        nk = resp.sum(axis=0) + 10 * np.finfo(float).eps
        weights = nk / n_samples
        means = (resp.T @ Xs) / nk[:, np.newaxis]

        new_cov = np.empty((k, n_features), dtype=float)
        for j in range(k):
            diff = Xs - means[j]
            new_cov[j] = (resp[:, j][:, np.newaxis] * diff * diff).sum(axis=0) / nk[j]
            new_cov[j] += reg_covar

        covariances = new_cov

        # cek konvergensi
        if abs(ll - prev_ll) < tol:
            break
        prev_ll = ll

    # buat objek gmmdiag dan set param
    gmm = GMMDiag(n_components=k, reg_covar=reg_covar, max_iter=max_iter, tol=tol)
    gmm.means_ = means
    gmm.covariances_ = covariances
    gmm.weights_ = weights

    # hitung statistik training
    per_frame_train = gmm.score_samples(Xs)
    train_mean = float(np.mean(per_frame_train))
    train_std = float(np.std(per_frame_train))
    threshold = float(np.percentile(per_frame_train, 5))  # contoh threshold: 5th percentile

    stats = {
        "train_mean": train_mean,
        "train_std": train_std,
        "threshold": threshold,
        "n_samples": int(n_samples),
        "n_features": int(n_features)
    }

    scaler = {"mean": mean.tolist(), "std": std.tolist()}

    return {"gmm": gmm, "scaler": scaler, "stats": stats}

# ---------------- compare ----------------
def topk_mean(vals: np.ndarray, k_ratio: float = 0.4):
    # rata-rata top-k tertinggi
    k = max(1, int(len(vals) * k_ratio))
    return float(np.mean(np.sort(vals)[-k:]))

def z_to_percent_normcdf(avg_ll: float, mean: float, std: float):
    # z -> prosentase berdasarkan normal cdf
    if std <= 0 or math.isnan(std):
        return (100.0 if avg_ll >= mean else 0.0), 0.0
    z = (avg_ll - mean) / std
    p = float(norm.cdf(z))
    return 100.0 * p, float(z)

def compare_with_model(model_name: str, mfcc: np.ndarray, topk: float = 0.2):

    data = load_model(model_name)
    gmm = data["gmm"]
    scaler = data["scaler"]
    stats = data.get("stats", {})

    # validasi mfcc
    if mfcc is None or not isinstance(mfcc, np.ndarray) or mfcc.ndim != 2:
        raise ValueError("mfcc harus berupa numpy array 2d (n_frames, n_features)")

    # transform dengan scaler (bisa dict atau sklearn-like)
    Xs = transform_with_scaler(scaler, mfcc)
    per_frame = gmm.score_samples(Xs)

    avg_mean = float(np.mean(per_frame))
    avg_topk = float(topk_mean(per_frame, k_ratio=topk))

    train_mean = float(stats.get("train_mean", np.nan))
    train_std = float(stats.get("train_std", np.nan))
    threshold = float(stats.get("threshold", np.nan))

    p_mean, z_mean = z_to_percent_normcdf(avg_mean, train_mean, train_std)
    p_topk, z_topk = z_to_percent_normcdf(avg_topk, train_mean, train_std)

    return {
        "per_frame": per_frame,
        "avg_mean": avg_mean,
        "avg_topk": avg_topk,
        "train_mean": train_mean,
        "train_std": train_std,
        "threshold": threshold,
        "z_score_mean": z_mean,
        "z_score_topk": z_topk,
        "percent_similarity_mean": p_mean,
        "percent_similarity_topk": p_topk,
        "is_match_mean": (not math.isnan(threshold)) and (avg_mean >= threshold),
        "is_match_topk": (not math.isnan(threshold)) and (avg_topk >= threshold),
    }

# ---------------- plot ----------------
def plot_histogram(model_name: str, mfcc: np.ndarray = None):
    data = load_model(model_name)
    gmm, scaler, stats = data["gmm"], data["scaler"], data["stats"]

    per_frame_train = np.array(stats["per_frame_train"])
    train_mean = stats["train_mean"]
    threshold = stats["threshold"]

    arrs, labels = [per_frame_train], [f"train (n={len(per_frame_train)})"]
    if mfcc is not None:
        Xs = transform_with_scaler(scaler, mfcc)
        per_frame_test = gmm.score_samples(Xs)
        arrs.append(per_frame_test)
        labels.append(f"test (n={len(per_frame_test)})")

    plt.figure(figsize=(9, 6))
    for i, a in enumerate(arrs):
        plt.hist(a, bins=60, alpha=0.5, label=labels[i])
    plt.axvline(train_mean, color="k", linestyle="--", linewidth=2)
    plt.axvline(threshold, color="r", linestyle=":", linewidth=2)
    plt.title(f"gmm log-likelihoods ({model_name})")
    plt.xlabel("per-frame log-likelihood")
    plt.ylabel("count")
    plt.legend()
    plt.grid(alpha=0.25)
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format="png")
    plt.close()
    buf.seek(0)
    return buf
