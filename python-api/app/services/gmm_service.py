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

MODEL_DIR = Path(os.environ.get("GMM_MODEL_DIR", "app/models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# ---------------- GMM helper ----------------
class GMMDiag:
    def __init__(self, n_components=8, reg_covar=1e-3, max_iter=200, tol=1e-4, verbose=False, random_state=0):
        self.n_components = n_components
        self.reg_covar = reg_covar
        self.max_iter = max_iter
        self.tol = tol
        self.verbose = verbose
        self.random_state = np.random.RandomState(random_state)

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

    def score_samples(self, X):
        log_prob = self._estimate_log_prob(X)
        return logsumexp(log_prob + np.log(self.weights_ + 1e-15), axis=1)

# ---------------- Load model ----------------
def load_model(model_name: str):
    """
    Load GMM model safely from .pkl or .joblib
    """
    path_pkl = MODEL_DIR / f"{model_name}.pkl"
    path_joblib = MODEL_DIR / f"{model_name}.joblib"

    if path_joblib.exists():
        # Prioritaskan joblib jika ada
        return joblib_load(path_joblib)
    elif path_pkl.exists():
        # Patch numpy MT19937 agar pickle lama bisa di-load
        try:
            # Python >= 3.8
            import numpy.random._pickle as np_pickle
        except ImportError:
            import numpy.random._pickle as np_pickle
        np.random._bit_generator = np.random.MT19937  # patch
        with open(path_pkl, "rb") as f:
            return pickle.load(f, encoding='latin1')
    else:
        raise FileNotFoundError(f"Model {model_name} tidak ditemukan di {MODEL_DIR}")

# ---------------- Compare ----------------
def topk_mean(vals: np.ndarray, k_ratio: float = 0.4):
    k = max(1, int(len(vals) * k_ratio))
    return float(np.mean(np.sort(vals)[-k:]))

def z_to_percent_normcdf(avg_ll: float, mean: float, std: float):
    if std <= 0:
        return (100.0 if avg_ll >= mean else 0.0), 0.0
    z = (avg_ll - mean) / std
    p = float(norm.cdf(z))
    return 100.0 * p, float(z)

def compare_with_model(model_name: str, mfcc: np.ndarray, topk: float = 0.2):
    data = load_model(model_name)
    gmm, scaler, stats = data['gmm'], data['scaler'], data['stats']
    Xs = scaler.transform(mfcc)
    per_frame = gmm.score_samples(Xs)

    avg_mean = float(np.mean(per_frame))
    avg_topk = float(topk_mean(per_frame, k_ratio=topk))

    train_mean, train_std = stats['train_mean'], stats['train_std']
    threshold = stats['threshold']

    p_mean, z_mean = z_to_percent_normcdf(avg_mean, train_mean, train_std)
    p_topk, z_topk = z_to_percent_normcdf(avg_topk, train_mean, train_std)

    return {
        'per_frame': per_frame,
        'avg_mean': avg_mean,
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
    }

# ---------------- Plot ----------------
def plot_histogram(model_name: str, mfcc: np.ndarray = None):
    data = load_model(model_name)
    gmm, scaler, stats = data['gmm'], data['scaler'], data['stats']

    per_frame_train = np.array(stats['per_frame_train'])
    train_mean = stats['train_mean']
    threshold = stats['threshold']

    arrs, labels = [per_frame_train], [f"train (n={len(per_frame_train)})"]
    if mfcc is not None:
        Xs = scaler.transform(mfcc)
        per_frame_test = gmm.score_samples(Xs)
        arrs.append(per_frame_test)
        labels.append(f"test (n={len(per_frame_test)})")

    plt.figure(figsize=(9,6))
    for i, a in enumerate(arrs):
        plt.hist(a, bins=60, alpha=0.5, label=labels[i])
    plt.axvline(train_mean, color='k', linestyle='--', linewidth=2)
    plt.axvline(threshold, color='r', linestyle=':', linewidth=2)
    plt.title(f"GMM (diag) Log-Likelihoods ({model_name})")
    plt.xlabel("Per-frame log-likelihood")
    plt.ylabel("Count")
    plt.legend()
    plt.grid(alpha=0.25)
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format='png')
    plt.close()
    buf.seek(0)
    return buf
