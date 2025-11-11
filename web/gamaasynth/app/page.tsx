"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import SynthesisLogTable, { SynthesisLogEntry } from "@/components/SynthesisLogTable";

import AudioUploader from "@/components/AudioUploader";
import WaveformViewer from "@/components/WaveFormViewer";
import FmControls from "@/components/FmControls";

// ---------------------
// Type Definitions
// ---------------------
type FMParamsFastAPI = {
  carrier_frequency_fc: number;
  modulator_frequency_fm: number;
  modulation_index_I: number;
  duration: number;
  sampling_rate: number;
  attack_rate: number;
  decay_rate: number;
  noise_level: number;
  add_partials: number;
  bp_bw: number;
  secondary_mod_ratio: number;
  detune_step: number;
};

type FMParamsFrontend = {
  carrierFreq: number;
  modFreq: number;
  modIndex: number;
  attack: number;
  decay: number;
  noiseLevel: number;
  add_partials: number;
  bp_bw: number;
  secondary_mod_ratio: number;
  detune_step: number;
};

// ---------------------
// Main Dashboard
// ---------------------
export default function Dashboard() {
  const { toast } = useToast();

  // --- State utama ---
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputAudioUrl, setInputAudioUrl] = useState<string | null>(null);
  const [paramsAPI, setParamsAPI] = useState<FMParamsFastAPI | null>(null);
  const [synthLog, setSynthLog] = useState<SynthesisLogEntry[]>([]);

  // --- Ref untuk blob hasil synth ---
  const synthUrlRef = useRef<string | null>(null);
  const [synthReady, setSynthReady] = useState(false);

  // ---------------------
  // Helper
  // ---------------------
  const mapParams = (p: FMParamsFastAPI): FMParamsFrontend => ({
    carrierFreq: p.carrier_frequency_fc ?? 0,
    modFreq: p.modulator_frequency_fm ?? 0,
    modIndex: p.modulation_index_I ?? 0,
    attack: p.attack_rate ?? 0,
    decay: p.decay_rate ?? 0,
    noiseLevel: p.noise_level ?? 0,
    add_partials: p.add_partials ?? 0,
    bp_bw: p.bp_bw ?? 0,
    secondary_mod_ratio: p.secondary_mod_ratio ?? 0,
    detune_step: p.detune_step ?? 0,
  });

  // ---------------------
  // Cleanup URL
  // ---------------------
  useEffect(() => {
    return () => {
      if (inputAudioUrl) URL.revokeObjectURL(inputAudioUrl);
      if (synthUrlRef.current) URL.revokeObjectURL(synthUrlRef.current);
    };
  }, [inputAudioUrl]);

  // ---------------------
  // Upload Handler
  // ---------------------
  const handleUpload = (file: File) => {
    if (inputAudioUrl) URL.revokeObjectURL(inputAudioUrl);

    const url = URL.createObjectURL(file);
    setInputAudioUrl(url);
    setInputFile(file);

    toast({
      title: "File berhasil diunggah",
      description: `${file.name} siap untuk dianalisis.`,
    });
  };

  // ---------------------
  // Analyze Handler
  // ---------------------
  const handleAnalyze = async () => {
    if (!inputFile)
      return toast({ title: "Upload audio dulu!", variant: "destructive" });

    toast({ title: "Analisis audio...", description: "Mengambil parameter dari FastAPI" });

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
      toast({ title: "Parameter diterima!", description: "Siap untuk sintesis." });
    } catch (err: any) {
      toast({
        title: "Gagal analisis",
        description: err.message || String(err),
        variant: "destructive",
      });
    }
  };

  // ---------------------
  // Synthesize Handler
  // ---------------------
  const handleSynthesize = async () => {
    if (!paramsAPI)
      return toast({ title: "Belum ada parameter", variant: "destructive" });

    toast({ title: "Sintesis dimulai...", description: "Harap tunggu beberapa saat." });

    try {
      const formData = new FormData();
      if (inputFile) formData.append("file", inputFile);
      Object.entries(paramsAPI).forEach(([k, v]) =>
        formData.append(k, String(v))
      );

      const res = await fetch("http://localhost:8080/synthesize/", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      console.log("📦 Blob dari FastAPI:", blob.size, blob.type);

      // Bersihkan URL blob lama
      if (synthUrlRef.current) {
        console.log("🧹 Revoke URL lama:", synthUrlRef.current);
        URL.revokeObjectURL(synthUrlRef.current);
      }

      // Buat URL baru
      const url = URL.createObjectURL(blob);
      synthUrlRef.current = url;
      setSynthReady(true);

      // Log synthesizer
      setSynthLog((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          audioUrl: url,
          fileName: inputFile?.name ?? "unknown.wav",
          fc: paramsAPI.carrier_frequency_fc ?? 0,
          fm: paramsAPI.modulator_frequency_fm ?? 0,
          index: paramsAPI.modulation_index_I ?? 0,
          attack: paramsAPI.attack_rate ?? 0,
          decay: paramsAPI.decay_rate ?? 0,
          noise: paramsAPI.noise_level ?? 0,
          add_partials: paramsAPI.add_partials ?? 0,
          bp_bw: paramsAPI.bp_bw ?? 0,
          secondary_mod_ratio: paramsAPI.secondary_mod_ratio ?? 0,
          detune_step: paramsAPI.detune_step ?? 0,
        },
      ]);

      toast({ title: "Sintesis berhasil!", description: "Audio siap diputar." });
    } catch (err: any) {
      toast({
        title: "Gagal sintesis",
        description: err.message || String(err),
        variant: "destructive",
      });
    }
  };

  // ---------------------
  // Cleanup saat unmount
  // ---------------------
  useEffect(() => {
    return () => {
      if (synthUrlRef.current) {
        console.log("🧹 Revoke saat unmount:", synthUrlRef.current);
        URL.revokeObjectURL(synthUrlRef.current);
      }
    };
  }, []);

  // ---------------------
  // UI Rendering
  // ---------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 text-gray-800 p-10 space-y-10">
      {/* Header */}
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900">
          Capstone F-06 Gamasynth Dashboard
        </h1>
        <p className="text-gray-500">
          Eksperimen sintesis suara gamelan menggunakan parameter FM.
        </p>
      </header>

      {/* Grid Input & Hasil */}
      <div className="grid md:grid-cols-2 gap-10">
        {/* Input */}
        <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
          <CardHeader>
            <CardTitle>Input Suara Gamelan</CardTitle>
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
                Analyze
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Hasil Sintesis */}
        <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
          <CardHeader>
            <CardTitle>Hasil Sintesis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {synthReady && synthUrlRef.current ? (
              <div key="synth-audio-block" className="space-y-2">
                <WaveformViewer
                  url={synthUrlRef.current}
                  label="Gelombang Sintesis"
                />

                <audio
                  key="synth-audio"
                  controls
                  src={synthUrlRef.current}
                  className="w-full rounded-lg border border-gray-300"
                  onError={(e) => {
                    const target = e.target as HTMLAudioElement;
                    console.error("❌ Audio playback error:", target.error);
                  }}
                />

                <Button
                  variant="secondary"
                  onClick={() => {
                    if (synthUrlRef.current) {
                      const a = document.createElement("a");
                      a.href = synthUrlRef.current;

                      // Dapatkan nama file asli tanpa ekstensi
                      const originalName = inputFile?.name || "audio";
                      const dotIndex = originalName.lastIndexOf(".");
                      const baseName =
                        dotIndex > 0 ? originalName.substring(0, dotIndex) : originalName;

                      // Format baru: namaAsli_synthesized.wav
                      a.download = `${baseName}_synthesized.wav`;

                      a.click();
                    }
                  }}
                >
                  Download Audio
                </Button>

              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">
                Belum ada hasil sintesis.
              </p>
            )}

            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                onClick={handleSynthesize}
                disabled={!paramsAPI}
              >
                Synthesize
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Kontrol FM */}
      <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
        <CardHeader>
          <CardTitle>Kontrol FM Synthesis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {paramsAPI ? (
            <FmControls
              params={mapParams(paramsAPI)}
              setParams={(updated) => {
                if (!paramsAPI) return;
                setParamsAPI({
                  ...paramsAPI,
                  carrier_frequency_fc:
                    updated.carrierFreq ?? paramsAPI.carrier_frequency_fc,
                  modulator_frequency_fm:
                    updated.modFreq ?? paramsAPI.modulator_frequency_fm,
                  modulation_index_I:
                    updated.modIndex ?? paramsAPI.modulation_index_I,
                  attack_rate: updated.attack ?? paramsAPI.attack_rate,
                  decay_rate: updated.decay ?? paramsAPI.decay_rate,
                  noise_level: updated.noiseLevel ?? paramsAPI.noise_level,
                  add_partials:
                    updated.add_partials ?? paramsAPI.add_partials,
                  bp_bw: updated.bp_bw ?? paramsAPI.bp_bw,
                  secondary_mod_ratio:
                    updated.secondary_mod_ratio ??
                    paramsAPI.secondary_mod_ratio,
                  detune_step:
                    updated.detune_step ?? paramsAPI.detune_step,
                });
              }}
            />
          ) : (
            <p className="text-sm text-gray-500 italic">
              Belum ada parameter dari analisis.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Log */}
      <Card className="bg-white border border-gray-200 shadow-md rounded-2xl">
        <CardHeader>
          <CardTitle>Log Iterasi Sintesis</CardTitle>
        </CardHeader>
        <CardContent>
          <SynthesisLogTable log={synthLog} />
        </CardContent>
      </Card>
    </div>
  );
}
