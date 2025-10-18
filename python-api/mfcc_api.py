from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
import numpy as np
import matplotlib.pyplot as plt
import librosa
import os
import uuid

# ====================
# Kelas Ekstraktor MFCC
# ====================
class MFCCExtractor:
    def __init__(self, sr, num_ceps=13, nfilt=26, NFFT=512, frame_size=0.025, frame_stride=0.01, pre_emphasis=0.97):
        self.sr = sr
        self.num_ceps = num_ceps
        self.nfilt = nfilt
        self.NFFT = NFFT
        self.frame_size = frame_size
        self.frame_stride = frame_stride
        self.pre_emphasis = pre_emphasis

    @staticmethod
    def hz_to_mel(hz):
        return 2595 * np.log10(1 + hz / 700)

    @staticmethod
    def mel_to_hz(mel):
        return 700 * (10**(mel / 2595) - 1)

    def get_mel_filterbank(self):
        low_freq_mel = 0
        high_freq_mel = self.hz_to_mel(self.sr / 2)
        mel_points = np.linspace(low_freq_mel, high_freq_mel, self.nfilt + 2)
        hz_points = self.mel_to_hz(mel_points)
        bin = np.floor((self.NFFT + 1) * hz_points / self.sr).astype(int)

        fbank = np.zeros((self.nfilt, self.NFFT // 2 + 1))
        for m in range(1, self.nfilt + 1):
            f_m_minus, f_m, f_m_plus = bin[m - 1], bin[m], bin[m + 1]
            for k in range(f_m_minus, f_m):
                fbank[m - 1, k] = (k - f_m_minus) / (f_m - f_m_minus)
            for k in range(f_m, f_m_plus):
                fbank[m - 1, k] = (f_m_plus - k) / (f_m_plus - f_m)
        return fbank

    @staticmethod
    def dct(x):
        N = x.shape[1]
        result = np.zeros_like(x)
        for k in range(N):
            result[:, k] = np.sum(
                x * np.cos(np.pi * k * (2 * np.arange(N) + 1) / (2 * N)),
                axis=1
            )
        result[:, 0] *= 1 / np.sqrt(N)
        result[:, 1:] *= np.sqrt(2 / N)
        return result

    def extract(self, y):
        emphasized = np.append(y[0], y[1:] - self.pre_emphasis * y[:-1])

        frame_length = int(self.frame_size * self.sr)
        frame_step = int(self.frame_stride * self.sr)
        signal_length = len(emphasized)
        num_frames = int(np.ceil(float(np.abs(signal_length - frame_length)) / frame_step)) + 1
        pad_signal_length = num_frames * frame_step + frame_length
        pad_signal = np.append(emphasized, np.zeros((pad_signal_length - signal_length)))
        indices = np.tile(np.arange(0, frame_length), (num_frames, 1)) + \
                  np.tile(np.arange(0, num_frames * frame_step, frame_step), (frame_length, 1)).T
        frames = pad_signal[indices.astype(np.int32, copy=False)]

        frames *= np.hamming(frame_length)

        mag_frames = np.abs(np.fft.rfft(frames, self.NFFT))
        pow_frames = (1.0 / self.NFFT) * (mag_frames ** 2)

        fbank = self.get_mel_filterbank()
        filter_banks = np.dot(pow_frames, fbank.T)
        filter_banks = np.where(filter_banks == 0, np.finfo(float).eps, filter_banks)
        filter_banks = 20 * np.log10(filter_banks)

        mfcc = self.dct(filter_banks)[:, :self.num_ceps]
        return mfcc

    def save_plot(self, mfcc, filename):
        frame_stride = self.frame_stride
        time_axis = np.arange(mfcc.shape[0]) * frame_stride
        plt.figure(figsize=(10, 4))
        plt.imshow(mfcc.T, aspect='auto', origin='lower', cmap='coolwarm',
                   vmin=-500, vmax=100, extent=[time_axis[0], time_axis[-1], 0, mfcc.shape[1]])
        plt.title('MFCC')
        plt.xlabel('Time (s)')
        plt.ylabel('MFCC Coefficient')
        plt.colorbar(format='%+2.0f dB')
        plt.tight_layout()
        plt.savefig(filename)
        plt.close()

# ====================
# FastAPI Setup
# ====================
app = FastAPI()

@app.post("/extract_mfcc/")
async def extract_mfcc(file: UploadFile = File(...)):
    # Simpan file sementara
    temp_filename = f"temp_{uuid.uuid4().hex}_{file.filename}"
    with open(temp_filename, "wb") as f:
        f.write(await file.read())

    # Load audio
    y, sr = librosa.load(temp_filename, sr=None)

    # Ekstraksi MFCC
    extractor = MFCCExtractor(sr=sr)
    mfcc_result = extractor.extract(y)

    # Simpan plot
    png_filename = f"mfcc_{uuid.uuid4().hex}.png"
    extractor.save_plot(mfcc_result, png_filename)

    # Hapus file audio sementara
    os.remove(temp_filename)

    # Kembalikan hasil
    return {
        "mfcc": mfcc_result.tolist(),
        "plot_file": png_filename
    }
