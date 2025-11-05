"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import SynthesisLogTable, { SynthesisLogEntry } from "@/components/SynthesisLogTable";

import AudioUploader from "@/components/AudioUploader";
import WaveformViewer from "@/components/WaveFormViewer";
import FmControls from "@/components/FmControls";
import SynthTabs from "@/components/SynthTabs";

// FastAPI param type
type FMParamsFastAPI = {
  carrier_frequency_fc: number;
  modulator_frequency_fm: number;
  modulation_index_I: number;
  duration: number;
  sampling_rate: number;
  attack_rate: number;
  decay_rate: number;
  noise_level: number;
  noise_ms: number;
  add_partials: number;
  bp_bw: number;
  secondary_mod_ratio: number;
  detune_step: number;
};

// Frontend param type untuk FmControls
type FMParamsFrontend = {
  carrierFreq: number;
  modFreq: number;
  modIndex: number;
  attack: number;
  decay: number;
  noiseLevel: number;
};

export default function Dashboard() {
  const { toast } = useToast();

  // --- States utama ---
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputAudioUrl, setInputAudioUrl] = useState<string | null>(null);
  const [synthAudioUrl, setSynthAudioUrl] = useState<string | null>(null);
  const [paramsAPI, setParamsAPI] = useState<FMParamsFastAPI | null>(null);
  const [synthLog, setSynthLog] = useState<SynthesisLogEntry[]>([]);

  // --- Mapping FastAPI params ke FmControls ---
  const mapParams = (p: FMParamsFastAPI): FMParamsFrontend => ({
    carrierFreq: p.carrier_frequency_fc ?? 0,
    modFreq: p.modulator_frequency_fm ?? 0,
    modIndex: p.modulation_index_I ?? 0,
    attack: p.attack_rate ?? 0,
    decay: p.decay_rate ?? 0,
    noiseLevel: p.noise_level ?? 0,
  });

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (inputAudioUrl) URL.revokeObjectURL(inputAudioUrl);
      if (synthAudioUrl) URL.revokeObjectURL(synthAudioUrl);
    };
  }, );

  // --- Handler Upload ---
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

  // --- Handler Analyze ---
  const handleAnalyze = async () => {
    if (!inputFile) return toast({ title: "Upload audio dulu!", variant: "destructive" });

    toast({ title: "Analisis audio...", description: "Mengambil parameter dari FastAPI" });

    try {
      const formData = new FormData();
      formData.append("file", inputFile);

      const res = await fetch("/api/approx-params-send", { method: "POST", body: formData });
      const result = await res.json();

      if (!res.ok || !result.params) throw new Error(result.error || "Gagal analisis");

      setParamsAPI(result.params);

      toast({ title: "Parameter diterima!", description: "Siap untuk sintesis." });
    } catch (err: any) {
      toast({ title: "Gagal analisis", description: err.message || String(err), variant: "destructive" });
    }
  };

  // --- Handler Synthesize ---
  const handleSynthesize = async () => {
    if (!paramsAPI) return toast({ title: "Belum ada parameter", variant: "destructive" });

    toast({ title: "Sintesis dimulai...", description: "Harap tunggu beberapa saat." });

    try {
      if (synthAudioUrl) {
        URL.revokeObjectURL(synthAudioUrl);
        setSynthAudioUrl(null);
      }

      const formData = new FormData();
      if (inputFile) formData.append("file", inputFile);
      Object.entries(paramsAPI).forEach(([k, v]) => formData.append(k, String(v)));

      const res = await fetch("http://localhost:8080/synthesize/", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // Tambahkan log sesuai tipe SynthesisLogEntry
      setSynthLog((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          source: "Python",
          audioUrl: url,
          fileName: inputFile?.name ?? "unknown.wav",
          fc: paramsAPI.carrier_frequency_fc ?? 0,
          fm: paramsAPI.modulator_frequency_fm ?? 0,
          index: paramsAPI.modulation_index_I ?? 0,
          attack: paramsAPI.attack_rate ?? 0,
          decay: paramsAPI.decay_rate ?? 0,
          noise: paramsAPI.noise_level ?? 0,
        },
      ]);

      setSynthAudioUrl(url);

      toast({ title: "Sintesis berhasil!", description: "Audio siap diputar." });
    } catch (err: any) {
      toast({ title: "Gagal sintesis", description: err.message || String(err), variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 text-gray-800 p-10 space-y-10">
      {/* Header */}
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900">Capstone F-06 Gamasynth Dashboard</h1>
        <p className="text-gray-500">Eksperimen sintesis suara gamelan menggunakan parameter FM.</p>
      </header>

      {/* Grid Input & Hasil Sintesis */}
      <div className="grid md:grid-cols-2 gap-10">
        {/* Input Card */}
        <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
          <CardHeader><CardTitle>Input Suara Gamelan</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <AudioUploader onUpload={handleUpload} />
            <WaveformViewer file={inputFile} label="Gelombang Asli" />
            {inputAudioUrl && <audio controls src={inputAudioUrl} className="w-full rounded-lg border border-gray-300" />}
            <div className="flex gap-2 mt-2">
              <Button variant="outline" onClick={handleAnalyze} disabled={!inputFile}>Analyze</Button>
            </div>
          </CardContent>
        </Card>

        {/* Synth Card */}
        <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
          <CardHeader><CardTitle>Hasil Sintesis</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {synthAudioUrl ? (
              <div className="space-y-2">
                <WaveformViewer url={synthAudioUrl} label="Gelombang Sintesis" />
                <audio controls src={synthAudioUrl} className="w-full rounded-lg border border-gray-300" />
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">Belum ada hasil sintesis.</p>
            )}
            <div className="flex gap-2 mt-2">
              <Button variant="outline" onClick={handleSynthesize} disabled={!paramsAPI}>Synthesize</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Kontrol FM */}
      <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
        <CardHeader><CardTitle>Kontrol FM Synthesis</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {paramsAPI ? (
            <FmControls
              params={mapParams(paramsAPI)}
              setParams={(updated) => {
                if (!paramsAPI) return;
                setParamsAPI({
                  ...paramsAPI,
                  carrier_frequency_fc: updated.carrierFreq ?? paramsAPI.carrier_frequency_fc,
                  modulator_frequency_fm: updated.modFreq ?? paramsAPI.modulator_frequency_fm,
                  modulation_index_I: updated.modIndex ?? paramsAPI.modulation_index_I,
                  attack_rate: updated.attack ?? paramsAPI.attack_rate,
                  decay_rate: updated.decay ?? paramsAPI.decay_rate,
                  noise_level: updated.noiseLevel ?? paramsAPI.noise_level,
                });
              }}
            />
          ) : (
            <p className="text-sm text-gray-500 italic">Belum ada parameter dari analisis.</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white border border-gray-200 shadow-md rounded-2xl">
        <CardHeader>
          <CardTitle>Komparasi Hasil Sintesis</CardTitle>
        </CardHeader>
        <CardContent>
          <SynthTabs logs={synthLog} />
        </CardContent>
      </Card>

      {/* Log Iterasi Sintesis */}
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
