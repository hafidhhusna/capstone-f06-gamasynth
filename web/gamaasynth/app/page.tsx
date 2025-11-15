"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import AudioUploader from "@/components/AudioUploader";
import WaveformViewer from "@/components/WaveFormViewer";
// [+] DIKEMBALIKAN: Komponen untuk menampilkan parameter
import FmControls from "@/components/FmControls";
// [=] TETAP: Komponen perekam live
import AudioRecorder from "@/components/AudioRecorder";
import SynthesisLogTable from "@/components/SynthesisLogTable";
import { SynthesisLogEntry } from "@/components/SynthesisLogTable";

// ---------------------
// Type Definitions
// ---------------------

// [+] DIKEMBALIKAN: Tipe untuk handleAnalyze
type FMParamsFastAPI = {
  carrier_frequency_fc: number;
  modulator_frequency_fm: number;
  modulation_index_I: number;
  // Anda bisa uncomment sisanya jika API Anda mengembalikannya
  // duration: number;
  // sampling_rate: number;
  // attack_rate: number;
  // decay_rate: number;
  // noise_level: number;
  // add_partials: number;
  // bp_bw: number;
  // secondary_mod_ratio: number;
  // detune_step: number;
};

// [+] DIKEMBALIKAN: Tipe untuk FmControls
type FMParamsFrontend = {
  carrierFreq: number;
  modFreq: number;
  modIndex: number;
  // attack: number;
  // decay: number;
  // noiseLevel: number;
  // add_partials: number;
  // bp_bw: number;
  // secondary_mod_ratio: number;
  // detune_step: number;
};

export default function Dashboard() {
  const { toast } = useToast();

  // --- State untuk Input (File Referensi) ---
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputAudioUrl, setInputAudioUrl] = useState<string | null>(null);

  // --- State untuk Hasil Rekaman Live (STM32) ---
  const [liveRecordingFile, setLiveRecordingFile] = useState<File | null>(null);
  const [liveRecordingUrl, setLiveRecordingUrl] = useState<string | null>(null);

  // [+] DIKEMBALIKAN: State untuk hasil analisis FM
  const [paramsAPI, setParamsAPI] = useState<FMParamsFastAPI | null>(null);

  // --- State untuk GMM (Sama) ---
  const [mfccResult, setMfccResult] = useState<number[][] | null>(null);
  const [gmmResult, setGmmResult] = useState<any | null>(null);
  const [gmmModelName, setGmmModelName] = useState<string>("");
  const [evaluating, setEvaluating] = useState(false);
  const [synthLog, setSynthLog] = useState<SynthesisLogEntry[]>([]);

  // [+] DIKEMBALIKAN: Helper untuk map 'paramsAPI' ke 'FmControls'
  const mapParams = (p: FMParamsFastAPI): FMParamsFrontend => ({
    carrierFreq: p.carrier_frequency_fc ?? 0,
    modFreq: p.modulator_frequency_fm ?? 0,
    modIndex: p.modulation_index_I ?? 0,
    // attack: p.attack_rate ?? 0,
    // decay: p.decay_rate ?? 0,
    // noiseLevel: p.noise_level ?? 0,
    // add_partials: p.add_partials ?? 0,
    // bp_bw: p.bp_bw ?? 0,
    // secondary_mod_ratio: p.secondary_mod_ratio ?? 0,
    // detune_step: p.detune_step ?? 0,
  });

  // Cleanup URL saat unmount
  useEffect(() => {
    return () => {
      if (inputAudioUrl) URL.revokeObjectURL(inputAudioUrl);
      if (liveRecordingUrl) URL.revokeObjectURL(liveRecordingUrl);
    };
  }, [inputAudioUrl, liveRecordingUrl]);

  // ---------------------
  // Upload Handler (Referensi)
  // ---------------------
  const handleUpload = (file: File) => {
    if (inputAudioUrl) URL.revokeObjectURL(inputAudioUrl);
    setInputAudioUrl(URL.createObjectURL(file));
    setInputFile(file);

    toast({
      title: "File referensi diunggah",
      description: `${file.name} siap untuk dianalisis.`,
    });
  };

  // ---------------------
  // [+] DIKEMBALIKAN: Analyze FM Params
  // ---------------------
  const handleAnalyze = async () => {
    if (!inputFile)
      return toast({
        title: "Upload audio referensi dulu!",
        variant: "destructive",
      });
    toast({
      title: "Analisis audio...",
      description: "Mengambil parameter dari FastAPI",
    });

    try {
      const formData = new FormData();
      formData.append("file", inputFile);

      const res = await fetch("/api/approx-params-send", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      if (!res.ok || !result.params)
        throw new Error(result.error || "Gagal analisis");

      setParamsAPI(result.params);
      setSynthLog((prev) => [
      ...prev,
      {
      id: prev.length + 1,
      fileName: inputFile.name,
      fc: result.params.carrier_frequency_fc,
      fm: result.params.modulator_frequency_fm,
      index: result.params.modulation_index_I,
      },
      ]);
      toast({ title: "Parameter diterima!", description: "Siap ditampilkan." });
    } catch (err: any) {
      toast({
        title: "Gagal analisis",
        description: err.message || String(err),
        variant: "destructive",
      });
    }
  };

  // ---------------------
  // MFCC Extraction (Referensi)
  // ---------------------
  const handleMFCC = async () => {
    if (!inputFile)
      return toast({
        title: "Upload audio referensi dulu!",
        variant: "destructive",
      });
    try {
      const formData = new FormData();
      formData.append("file", inputFile);

      const res = await fetch(
        "https://gamasynth-api-production.up.railway.app/mfcc/extract_mfcc/",
        {
          method: "POST",
          body: formData,
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      setMfccResult(result.mfcc);
      toast({ title: "MFCC referensi berhasil diekstrak!" });
    } catch (err: any) {
      toast({
        title: "Gagal ekstrak MFCC",
        description: err.message || String(err),
        variant: "destructive",
      });
    }
  };

  const handleSaveParamsToSTM32 = async () => {
  if (!paramsAPI) {
    return toast({
      title: "Tidak ada parameter FM!",
      description: "Lakukan Analyze FM terlebih dahulu.",
      variant: "destructive",
    });
  }

  try {
    toast({ title: "Mengirim ke STM32...", description: "Mohon tunggu." });

    const res = await fetch("/api/save-params", {
      method: "POST",
      body: JSON.stringify({ params: paramsAPI }),
      headers: { "Content-Type": "application/json" },
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

          setSynthLog((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          // source: "Python",
          // audioUrl: url,
          fileName: inputFile?.name ?? "unknown.wav",
          fc: paramsAPI.carrier_frequency_fc ?? 0,
          fm: paramsAPI.modulator_frequency_fm ?? 0,
          index: paramsAPI.modulation_index_I ?? 0,
          // attack: paramsAPI.attack_rate ?? 0,
          // decay: paramsAPI.decay_rate ?? 0,
          // noise: paramsAPI.noise_level ?? 0,
        },
      ]);

    toast({
      title: "Terkirim ke STM32!",
      description: "Parameter FM berhasil dikirim melalui MQTT.",
    });

  } catch (err: any) {
    toast({
      title: "Gagal mengirim",
      description: err.message,
      variant: "destructive",
    });
  }
};


  // ---------------------
  // [=] TETAP: Handler untuk hasil rekaman live
  // ---------------------
  const handleRecordingComplete = (audioFile: File) => {
    if (liveRecordingUrl) {
      URL.revokeObjectURL(liveRecordingUrl);
    }
    const newUrl = URL.createObjectURL(audioFile);
    setLiveRecordingFile(audioFile);
    setLiveRecordingUrl(newUrl);

    toast({
      title: "Rekaman Selesai",
      description: "Audio dari soundcard (STM32) siap dievaluasi.",
    });
  };

  // ---------------------
  // [=] TETAP: GMM Evaluation (menggunakan audio live)
  // ---------------------
  const handleEvaluateGMM = async () => {
    if (!liveRecordingFile)
      return toast({
        title: "Belum ada audio rekaman live!",
        variant: "destructive",
      });
    if (!gmmModelName)
      return toast({ title: "Pilih model GMM dulu!", variant: "destructive" });

    setEvaluating(true);
    toast({
      title: "Evaluasi GMM...",
      description: "Menggunakan audio hasil rekaman live.",
    });

    try {
      const formData = new FormData();
      formData.append("test_file", liveRecordingFile);
      formData.append("reference_model", gmmModelName);

      const res = await fetch(
        "https://gamasynth-api-production.up.railway.app/gmm/compare/",
        {
          method: "POST",
          body: formData,
        }
      );

      if (!res.ok) throw new Error(await res.text());

      const result = await res.json();
      setGmmResult(result);
      toast({
        title: "Evaluasi selesai!",
        description: `Similarity: ${result.percent_similarity_topk.toFixed(
          2
        )}%`,
      });
    } catch (err: any) {
      toast({
        title: "Gagal evaluasi GMM",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setEvaluating(false);
    }
  };

  // ---------------------
  // Render
  // ---------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 text-gray-800 p-10 space-y-10">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900">
          Capstone F-06 Gamasynth Dashboard
        </h1>
        <p className="text-gray-500">
          Analisis audio referensi dan evaluasi audio live (STM32).
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-10">
        {/* Kolom 1: Input Audio Referensi */}
        <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
          <CardHeader>
            <CardTitle>Input Suara Gamelan (Referensi)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AudioUploader onUpload={handleUpload} />
            <WaveformViewer file={inputFile} label="Gelombang Asli" />
            {inputAudioUrl && (
              <audio
                controls
                src={inputAudioUrl}
                className="w-full rounded-lg border border-gray-300"
              />
            )}
            <div className="flex gap-2 mt-2">
              {/* [+] DIKEMBALIKAN: Tombol Analyze FM */}
              <Button
                variant="outline"
                onClick={handleAnalyze}
                disabled={!inputFile}
              >
                Analyze FM
              </Button>
              {/* <Button
                variant="outline"
                onClick={handleMFCC}
                disabled={!inputFile}
              >
                Extract MFCC (Ref)
              </Button> */}
            </div>
          </CardContent>
        </Card>

        {/* Kolom 2: Live Capture & GMM */}
        <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
          <CardHeader>
            <CardTitle>Live Capture (STM32) & GMM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* [=] TETAP: Komponen Perekam Live */}
            <AudioRecorder onRecordingComplete={handleRecordingComplete} />

            {/* [=] TETAP: Menampilkan hasil rekaman */}
            {liveRecordingUrl && (
              <div className="space-y-2 pt-4 border-t">
                <h4 className="text-md font-medium">Hasil Rekaman Live:</h4>
                <WaveformViewer
                  url={liveRecordingUrl}
                  label="Gelombang Rekaman"
                />
                <audio
                  controls
                  src={liveRecordingUrl}
                  className="w-full rounded-lg border border-gray-300"
                />
              </div>
            )}

            {/* [=] TETAP: GMM Evaluation */}
            <div className="space-y-2 mt-4 pt-4 border-t">
              <label className="block text-sm font-medium text-gray-700">
                Pilih model GMM:
              </label>
              <input
                type="text"
                className="border rounded p-1 w-full"
                placeholder="contoh: gamelan_model_01"
                value={gmmModelName}
                onChange={(e) => setGmmModelName(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={handleEvaluateGMM}
                disabled={!liveRecordingFile || !gmmModelName || evaluating}
              >
                {evaluating ? "Evaluating..." : "Evaluate GMM (Live Audio)"}
              </Button>
              {gmmResult && (
                <div className="text-sm text-gray-700 mt-2">
                  <p>
                    Similarity Top-k:{" "}
                    {gmmResult.percent_similarity_topk.toFixed(2)}%
                  </p>
                  <p>Frames: {gmmResult.n_frames}</p>
                  <p>File: {gmmResult.test_file}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* [+] DIKEMBALIKAN: Card untuk Kontrol FM (Hasil Analisis) */}
      <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
        <CardHeader>
          <CardTitle>Kontrol FM (Hasil Analisis)</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {paramsAPI ? (
            <div className="space-y-4">
              <FmControls
                params={mapParams(paramsAPI)}
                setParams={(updated) => {
                  if (!paramsAPI) return;
                  setParamsAPI({
                    ...paramsAPI,
                    carrier_frequency_fc: updated.carrierFreq ?? paramsAPI.carrier_frequency_fc,
                    modulator_frequency_fm: updated.modFreq ?? paramsAPI.modulator_frequency_fm,
                    modulation_index_I: updated.modIndex ?? paramsAPI.modulation_index_I,
                  });
                }}
              />
              <Button
                variant="default"
                onClick={handleSaveParamsToSTM32}
                className="w-full"
              >
                Save Parameter to STM32 (MQTT)
              </Button>
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">
              Belum ada parameter. Klik Analyze FM pada file referensi.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
        <CardHeader>
          <CardTitle>Log Parameter Sintesis</CardTitle>
          <CardContent>
            <SynthesisLogTable log={synthLog}></SynthesisLogTable>
          </CardContent>
        </CardHeader>
      </Card>

      {/* Card 'Log Iterasi Sintesis' tetap dihapus */}
    </div>
  );
}