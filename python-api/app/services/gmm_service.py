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
from joblib import load as joblib_load, dump as joblib_dump

MODEL_DIR = Path(os.environ.get("GMM_MODEL_DIR", "app/models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)


# ---------------- helpers ----------------
class GMMDiag:
    """
      - means_: shape (n_components, n_features)
      - covariances_: shape (n_components, n_features) (variances per-dim)
      - weights_: shape (n_components,)
    """
    def __init__(self, n_components=8, reg_covar=1e-6, max_iter=200, tol=1e-4, random_state=0):
        self.n_components = int(n_components)
        self.reg_covar = float(reg_covar)
        self.max_iter = int(max_iter)
        self.tol = float(tol)
        self.random_state = np.random.RandomState(int(random_state))

        # atribut yang diisi setelah training
        self.means_ = None
        self.covariances_ = None
        self.weights_ = None

    def _estimate_log_prob(self, X):
        """Compute per-component log-probabilities for diagonal covariance."""
        n_samples, n_features = X.shape
        k = self.n_components
        log_prob = np.empty((n_samples, k), dtype=float)
        const = -0.5 * n_features * math.log(2 * math.pi)
        for j in range(k):
            var = self.covariances_[j]
            # pastikan positif
            var = np.maximum(var, self.reg_covar)
            prec = 1.0 / var
            log_det = -0.5 * np.sum(np.log(var))
            diff = X - self.means_[j]
            # jumlahkan per fitur: diff^2 * prec
            log_prob[:, j] = const + log_det - 0.5 * np.sum(diff * diff * prec, axis=1)
        return log_prob

    def score_samples(self, X):
        """Return per-sample log-likelihood log p(x)."""
        log_prob = self._estimate_log_prob(X)
        # tambahkan log weights (hindari nol)
        return logsumexp(log_prob + np.log(self.weights_ + 1e-15), axis=1)


# ---------------- utilitas: inisialisasi kmeans++ + mini-kmeans ----------------
def _kmeans_plus_plus_init(X, n_clusters, random_state=None):
    """
    kmeans++ seeding: return 'n_clusters' chosen indices (not full kmeans).
    """
    rng = np.random.RandomState(random_state)
    n_samples = X.shape[0]
    centers = np.empty((n_clusters, X.shape[1]), dtype=float)
    # pilih center pertama secara acak
    idx = rng.randint(0, n_samples)
    centers[0] = X[idx]
    # jarak
    closest_dist_sq = np.sum((X - centers[0]) ** 2, axis=1)
    for c in range(1, n_clusters):
        probs = closest_dist_sq / np.sum(closest_dist_sq)
        r = rng.rand()
        cumulative = np.cumsum(probs)
        idx = int(np.searchsorted(cumulative, r))
        centers[c] = X[idx]
        # perbarui jarak
        dist_sq = np.sum((X - centers[c]) ** 2, axis=1)
        closest_dist_sq = np.minimum(closest_dist_sq, dist_sq)
    return centers


def _mini_kmeans(X, init_centers, n_iter=5):
    """
    Jalankan beberapa iterasi kmeans kecil untuk penyempurnaan (cepat, bukan KMeans penuh).
    Mengembalikan centers yang sudah disempurnakan.
    """
    centers = init_centers.copy()
    k = centers.shape[0]
    for _ in range(n_iter):
        # penugasan
        dists = np.sum((X[:, None, :] - centers[None, :, :]) ** 2, axis=2)  # (n_samples, k)
        labels = np.argmin(dists, axis=1)
        for j in range(k):
            members = X[labels == j]
            if len(members) > 0:
                centers[j] = members.mean(axis=0)
    return centers


# ---------------- pemuat model ----------------
def _ensure_ext(name: str, ext: str = ".pkl") -> str:
    base = os.path.basename(name)
    return base if base.lower().endswith(ext) else base + ext

def _find_model_path(model_name: str):
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
        # prefer joblib untuk load lebih cepat jika tersedia
        if model_path.suffix.lower() == ".joblib":
            data = joblib_load(model_path)
        else:
            try:
                data = joblib_load(model_path)
            except Exception:
                with open(model_path, "rb") as f:
                    data = pickle.load(f, encoding="latin1")
    except Exception as e:
        raise RuntimeError(f"gagal memuat model {model_path}: {repr(e)}") from e

    if not isinstance(data, dict):
        data = {"gmm": data}

    if "gmm" not in data:
        raise RuntimeError(f"file {model_path} tidak berisi objek 'gmm' yang valid")

    if "scaler" not in data:
        raise RuntimeError(f"model {model_path.name} tidak punya 'scaler'. harap retrain model di environment ini.")

    if "stats" not in data:
        data["stats"] = {}

    stats = data.get("stats", {})
    if "per_frame_train" in stats and not isinstance(stats["per_frame_train"], np.ndarray):
        try:
            stats["per_frame_train"] = np.array(stats["per_frame_train"], dtype=float)
            data["stats"] = stats
        except Exception:
            pass

    return data


# ---------------- adaptor scaler ----------------
def transform_with_scaler(scaler, X: np.ndarray):
    if scaler is None:
        return X
    if hasattr(scaler, "transform") and callable(getattr(scaler, "transform")):
        return scaler.transform(X)
    if isinstance(scaler, dict) and "mean" in scaler and "std" in scaler:
        mean = np.array(scaler["mean"])
        std = np.array(scaler["std"]) + 1e-12
        return (X - mean) / std
    if callable(scaler):
        return scaler(X)
    raise RuntimeError("unknown scaler format: harus sklearn-like atau dict{'mean','std'}")


# ---------------- pelatihan (GMM manual sepenuhnya tapi ditingkatkan) ----------------
def train_model_from_features(X: np.ndarray,
                              n_components: int = 8,
                              reg_covar: float = 1e-6,
                              max_iter: int = 200,
                              tol: float = 1e-4,
                              random_state: int = 0,
                              n_init: int = 3,
                              kmeans_init_iter: int = 5):
    """
    Train a diagonal-covariance GMM using EM with:
      - kmeans++ + mini-kmeans for initialization
      - n_init restarts (choose best by log-likelihood)
    Returns dict {"gmm": GMMDiag_instance, "scaler": {"mean","std"}, "stats": {...}}
    """
    # validasi
    if X is None or not isinstance(X, np.ndarray) or X.ndim != 2:
        raise ValueError("X harus numpy array 2d (n_samples, n_features)")

    n_samples, n_features = X.shape
    k = int(n_components)
    if k <= 0 or k > n_samples:
        raise ValueError("n_components harus >0 dan <= n_samples")

    # hitung scaler (standarisasi) pada fitur mentah
    mean = np.mean(X, axis=0)
    std = np.std(X, axis=0)
    std = std + 1e-8
    Xs = (X - mean) / std  # standar

    best_ll = -np.inf
    best_model = None

    rng = np.random.RandomState(int(random_state))

    for init_i in range(max(1, int(n_init))):
        # inisialisasi kmeans++
        try:
            centers = _kmeans_plus_plus_init(Xs, k, random_state=rng.randint(0, 2**31 - 1))
            centers = _mini_kmeans(Xs, centers, n_iter=kmeans_init_iter)
        except Exception:
            # fallback ke pemilihan acak
            idx = rng.choice(n_samples, k, replace=False)
            centers = Xs[idx].astype(float)

        means = centers.copy()
        covariances = np.ones((k, n_features), dtype=float)
        weights = np.ones(k, dtype=float) / k

        prev_ll = -np.inf

        for iteration in range(int(max_iter)):
            # E-step: hitung log probability komponen
            const = -0.5 * n_features * math.log(2 * math.pi)
            log_prob = np.empty((n_samples, k), dtype=float)
            for j in range(k):
                var = covariances[j]
                var = np.maximum(var, reg_covar)
                prec = 1.0 / var
                log_det = -0.5 * np.sum(np.log(var))
                diff = Xs - means[j]
                log_prob[:, j] = const + log_det - 0.5 * np.sum(diff * diff * prec, axis=1) + np.log(weights[j] + 1e-15)

            # normalisasi log-sum-exp
            log_resp_norm = logsumexp(log_prob, axis=1)  # per-sample log p(x)
            ll = float(np.sum(log_resp_norm))

            # responsibilities (stabil)
            resp = np.exp(log_prob - log_resp_norm[:, None])

            # M-step
            nk = resp.sum(axis=0) + 10 * np.finfo(float).eps  # effective counts
            weights = nk / n_samples
            means = (resp.T @ Xs) / nk[:, None]

            new_cov = np.empty((k, n_features), dtype=float)
            for j in range(k):
                diff = Xs - means[j]
                new_cov[j] = (resp[:, j][:, None] * diff * diff).sum(axis=0) / nk[j]
                # regularisasi
                new_cov[j] += reg_covar

            covariances = new_cov

            # cek konvergensi
            if abs(ll - prev_ll) < tol:
                break
            prev_ll = ll

        # setelah satu inisialisasi, evaluasi log-likelihood pada data training
        # hitung per-sample log p(x) final
        gm = GMMDiag(n_components=k, reg_covar=reg_covar, max_iter=max_iter, tol=tol, random_state=random_state)
        gm.means_ = means
        gm.covariances_ = covariances
        gm.weights_ = weights
        per_frame_train = gm.score_samples(Xs)
        total_ll = float(np.sum(per_frame_train))

        if total_ll > best_ll:
            best_ll = total_ll
            best_model = {"gmm_obj": gm, "per_frame_train": per_frame_train, "means": means.copy(), "covariances": covariances.copy(), "weights": weights.copy()}

    if best_model is None:
        raise RuntimeError("gagal melatih GMM (tidak ada model terbaik ditemukan)")

    per_frame_train = best_model["per_frame_train"]
    train_mean = float(np.mean(per_frame_train))
    train_std = float(np.std(per_frame_train))
    threshold = train_mean - 1.5 * train_std

    stats = {
        "train_mean": train_mean,
        "train_std": train_std,
        "threshold": threshold,
        "n_samples": int(n_samples),
        "n_features": int(n_features),
        "per_frame_train": per_frame_train.tolist()
    }

    scaler = {"mean": mean.tolist(), "std": std.tolist()}

    return {"gmm": best_model["gmm_obj"], "scaler": scaler, "stats": stats}


# ---------------- compare & helper ----------------
def topk_mean(vals: np.ndarray, k_ratio: float = 0.4):
    k = max(1, int(len(vals) * k_ratio))
    return float(np.mean(np.sort(vals)[-k:]))

def z_to_percent_normcdf(avg_ll: float, mean: float, std: float):
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

    if mfcc is None or not isinstance(mfcc, np.ndarray) or mfcc.ndim != 2:
        raise ValueError("mfcc harus berupa numpy array 2d (n_frames, n_features)")

    Xs = transform_with_scaler(scaler, mfcc)
    # gmm adalah container GMMDiag dengan score_samples
    if not hasattr(gmm, "score_samples") or not callable(getattr(gmm, "score_samples")):
        raise RuntimeError("model tidak mendukung score_samples()")

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


# ---------------- plotting ----------------
def plot_histogram(model_name: str, mfcc: np.ndarray = None):
    data = load_model(model_name)
    gmm, scaler, stats = data["gmm"], data["scaler"], data["stats"]

    pft = stats.get("per_frame_train", None)
    if pft is None:
        raise RuntimeError("model tidak memiliki statistik 'per_frame_train' yang diperlukan untuk plotting. retrain model agar stats lengkap.")
    per_frame_train = np.array(pft, dtype=float)

    train_mean = stats.get("train_mean", None)
    threshold = stats.get("threshold", None)

    arrs, labels = [per_frame_train], [f"train (n={len(per_frame_train)})"]
    if mfcc is not None:
        Xs = transform_with_scaler(scaler, mfcc)
        per_frame_test = gmm.score_samples(Xs)
        arrs.append(per_frame_test)
        labels.append(f"test (n={len(per_frame_test)})")

    plt.figure(figsize=(9, 6))
    for i, a in enumerate(arrs):
        plt.hist(a, bins=60, alpha=0.5, label=labels[i])
    if train_mean is not None:
        plt.axvline(train_mean, color="k", linestyle="--", linewidth=2)
    if threshold is not None:
        plt.axvline(threshold, color="r", linestyle=":", linewidth=2)
    plt.title(f"gmm log-likelihoods")
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
