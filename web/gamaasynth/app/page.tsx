"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import AudioUploader from "@/components/AudioUploader";
import WaveformViewer from "@/components/WaveFormViewer";
import FmControls from "@/components/FmControls";
import AudioRecorder from "@/components/AudioRecorder";
import SynthesisLogTable from "@/components/SynthesisLogTable";
import { SynthesisLogEntry } from "@/components/SynthesisLogTable";
import SpectrumPlot from "@/components/SpectrumPlot";


// ---------------------
// Type Definitions
// ---------------------

// Tipe untuk handleAnalyze
type FMParamsFastAPI = {
  carrier_frequency_fc: number;
  modulator_frequency_fm: number;
  modulation_index_I: number;
};

// [+] DIKEMBALIKAN: Tipe untuk FmControls
type FMParamsFrontend = {
  carrierFreq: number;
  modFreq: number;
  modIndex: number;
};

export default function Dashboard() {
  const { toast } = useToast();

  // --- State untuk Input (File Referensi) ---
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputAudioUrl, setInputAudioUrl] = useState<string | null>(null);
  const [fftReference, setFftReference] = useState<{frequency: number[], magnitude: number[]} | null>(null);

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

  // Helper untuk map 'paramsAPI' ke 'FmControls'
  const mapParams = (p: FMParamsFastAPI): FMParamsFrontend => ({
    carrierFreq: p.carrier_frequency_fc ?? 0,
    modFreq: p.modulator_frequency_fm ?? 0,
    modIndex: p.modulation_index_I ?? 0,
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
  // Analyze FM Params
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

      const fftRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/synthesize/FFT`,{
        method: "POST",
        body: formData,
      });

      const fftJson = await fftRes.json();
      if(!fftRes.ok)
        throw new Error("FFT Gagal!");

      setFftReference({
        frequency: fftJson.frequency,
        magnitude: fftJson.magnitude,
      })

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
      toast({ title: "Analisis Berhasil!", description: "Parameter FM dan FFT berhasil diambil." });
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
        `${process.env.NEXT_PUBLIC_API_URL!}/mfcc/extract_mfcc/`,
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
          fileName: inputFile?.name ?? "unknown.wav",
          fc: paramsAPI.carrier_frequency_fc ?? 0,
          fm: paramsAPI.modulator_frequency_fm ?? 0,
          index: paramsAPI.modulation_index_I ?? 0,
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
  // Handler untuk hasil rekaman live
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
  // GMM Evaluation (menggunakan audio live)
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
        `${process.env.NEXT_PUBLIC_API_URL!}/gmm/compare/`,
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
              <Button
                variant="outline"
                onClick={handleAnalyze}
                disabled={!inputFile}
              >
                Analyze FM
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Kolom 2: Live Capture & GMM */}
        <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
          <CardHeader>
            <CardTitle>Live Capture (STM32) & GMM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AudioRecorder onRecordingComplete={handleRecordingComplete} />
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
            <div className="space-y-2 mt-4 pt-4 border-t">
            <label className="block text-sm font-medium text-gray-700">
              Pilih model GMM:
            </label>

            <select
              className="border rounded p-1 w-full"
              value={gmmModelName}
              onChange={(e) => setGmmModelName(e.target.value)}
            >
              <option value="">-- pilih model --</option>
              <option value="saron_p1">Saron Pelog 1</option>
              <option value="saron_p2">Saron Pelog 2</option>
              <option value="saron_p3">Saron Pelog 3</option>
              <option value="saron_p4">Saron Pelog 4</option>
              <option value="saron_p5">Saron Pelog 5</option>
              <option value="saron_p6">Saron Pelog 6</option>
              <option value="saron_p7">Saron Pelog 7</option>
            </select>

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
      <div>
            {fftReference && (
              <Card className="mt-4 p-4 border shadow-sm rounded-xl">
                <h3 className="text-lg font-semibold mb-2">FFT Referensi</h3>
                <SpectrumPlot
                  frequency={fftReference.frequency}
                  magnitude={fftReference.magnitude}
                  title="FFT Audio Referensi"
                />
              </Card>
            )}
      </div>
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
    </div>
  );
}