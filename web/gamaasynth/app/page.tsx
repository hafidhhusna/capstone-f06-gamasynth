"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// --- KOMPONEN CUSTOM ---
// Pastikan path ini sesuai dengan struktur project Anda
import AudioUploader from "@/components/AudioUploader";
import WaveformViewer from "@/components/WaveFormViewer";
import FmControls from "@/components/FmControls";
import AudioRecorder from "@/components/AudioRecorder";
import SynthesisLogTable, { SynthesisLogEntry } from "@/components/SynthesisLogTable"; 
import SynthTabs from "@/components/SynthTabs"; 
import SpectrumPlot from "@/components/SpectrumPlot";

// ---------------------
// TYPE DEFINITIONS
// ---------------------

type FMParamsFastAPI = {
  carrier_frequency_fc: number;
  modulator_frequency_fm: number;
  modulation_index_I: number;
};

type FMParamsFrontend = {
  carrierFreq: number;
  modFreq: number;
  modIndex: number;
};

export default function Dashboard() {
  const { toast } = useToast();

  // --- STATE: MANAGEMEN URL & MEMORY (PENTING UNTUK MENCEGAH BLOB HILANG) ---
  // Kita gunakan useRef untuk menyimpan daftar URL yang digenerate
  // agar tidak ter-revoke saat state React berubah.
  const generatedUrls = useRef<string[]>([]);

  // --- STATE: INPUT (FILE REFERENSI) ---
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputAudioUrl, setInputAudioUrl] = useState<string | null>(null);
  const [fftReference, setFftReference] = useState<{ frequency: number[]; magnitude: number[] } | null>(null);

  // --- STATE: EVALUASI & KOMPARASI (TAB SYSTEM) ---
  const [activeEvalTab, setActiveEvalTab] = useState<"STM32" | "Python">("STM32");
  
  // 1. Data STM32 (Live Recording)
  const [liveRecordingFile, setLiveRecordingFile] = useState<File | null>(null);
  const [liveRecordingUrl, setLiveRecordingUrl] = useState<string | null>(null);

  // 2. Data Python (Synthesis Result)
  const [pythonSynthFile, setPythonSynthFile] = useState<File | null>(null);
  const [pythonSynthUrl, setPythonSynthUrl] = useState<string | null>(null);

  // --- STATE: PARAMETER HASIL ANALISIS ---
  const [paramsAPI, setParamsAPI] = useState<FMParamsFastAPI | null>(null);

  // --- STATE: GMM EVALUATION ---
  const [gmmResult, setGmmResult] = useState<any | null>(null);
  const [gmmModelName, setGmmModelName] = useState<string>("");
  const [evaluating, setEvaluating] = useState(false);
  
  // --- STATE: LOG HISTORY ---
  const [synthLog, setSynthLog] = useState<SynthesisLogEntry[]>([]);

  // Helper: Map Backend Params -> Frontend Controls
  const mapParams = (p: FMParamsFastAPI): FMParamsFrontend => ({
    carrierFreq: p.carrier_frequency_fc ?? 0,
    modFreq: p.modulator_frequency_fm ?? 0,
    modIndex: p.modulation_index_I ?? 0,
  });

  // ---------------------------------------------------------
  // EFFECT: CLEANUP (MEMORY MANAGEMENT)
  // ---------------------------------------------------------
  // Cleanup hanya dijalankan SEKALI saat komponen di-unmount (halaman ditutup/refresh).
  // Ini mencegah URL audio hilang saat user melakukan interaksi UI (re-render).
  useEffect(() => {
    return () => {
      console.log("🧹 Cleaning up audio resources...");
      // Bersihkan semua URL hasil sintesis Python
      generatedUrls.current.forEach((url) => URL.revokeObjectURL(url));
      // Bersihkan URL input & live recording
      if (inputAudioUrl) URL.revokeObjectURL(inputAudioUrl);
      if (liveRecordingUrl) URL.revokeObjectURL(liveRecordingUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // Reset hasil GMM jika tab berpindah agar tidak membingungkan user
  useEffect(() => {
    setGmmResult(null);
  }, [activeEvalTab]);


  // ---------------------
  // HANDLER 1: UPLOAD REFERENSI
  // ---------------------
  const handleUpload = (file: File) => {
    // Revoke url input lama jika ada
    if (inputAudioUrl) URL.revokeObjectURL(inputAudioUrl);
    
    const url = URL.createObjectURL(file);
    setInputAudioUrl(url);
    setInputFile(file);

    toast({ title: "File diunggah", description: `${file.name} siap.` });
  };


  // ---------------------
  // HANDLER 2: ANALYZE & SYNTHESIZE (PYTHON)
  // ---------------------
  const handleAnalyze = async () => {
    if (!inputFile) return toast({ title: "Upload referensi dulu!", variant: "destructive" });
    
    toast({ title: "Processing...", description: "Analisis parameter & Sintesis Python..." });

    try {
      // --- STEP A: GET PARAMETERS (ANALISIS) ---
      const formDataBasic = new FormData();
      formDataBasic.append("file", inputFile);

      const resParams = await fetch("/api/approx-params-send", { method: "POST", body: formDataBasic });
      const resultParams = await resParams.json();
      if (!resParams.ok || !resultParams.params) throw new Error(resultParams.error || "Gagal param");

      const params = resultParams.params;
      setParamsAPI(params);

      // --- STEP B: PYTHON SYNTHESIS ---
      // Membuat FormData BARU yang menggabungkan File + Parameter Angka
      const formDataSynth = new FormData();
      formDataSynth.append("file", inputFile); // File Referensi
      
      // Parameter Kunci dari hasil analisis
      formDataSynth.append("carrier_frequency_fc", params.carrier_frequency_fc.toString());
      formDataSynth.append("modulator_frequency_fm", params.modulator_frequency_fm.toString());
      formDataSynth.append("modulation_index_I", params.modulation_index_I.toString());
      
      // Parameter Default (Wajib untuk endpoint Python Anda)
        formDataSynth.append("attack_rate", "150.0");
        formDataSynth.append("decay_rate", "2.5");
        formDataSynth.append("noise_level", "10");
        formDataSynth.append("duration", "7.0"); // Durasi default 5 detik
        formDataSynth.append("sampling_rate", "44100");
        formDataSynth.append("add_partials", "10");
        formDataSynth.append("bp_bw", "0.25");
        formDataSynth.append("secondary_mod_ratio", "0.25");
        formDataSynth.append("detune_step", "0.0015");

      // Panggil Endpoint Python
      const resSynth = await fetch(`http://localhost:8080/synthesize/synthesize`, {
        method: "POST",
        body: formDataSynth, 
      });

      if (!resSynth.ok) throw new Error("Gagal sintesis Python");

      // Proses Blob Hasil Sintesis
      const audioBlob = await resSynth.blob();
      const pyFile = new File([audioBlob], "python_synth_result.wav", { type: "audio/wav" });
      const pyUrl = URL.createObjectURL(audioBlob);
      
      // PENTING: Simpan URL ke ref agar tidak terhapus otomatis
      generatedUrls.current.push(pyUrl);

      // Update State
      setPythonSynthFile(pyFile);
      setPythonSynthUrl(pyUrl);

      // --- STEP C: GET FFT (OPTIONAL) ---
      const fftRes = await fetch(`http://localhost:8080/synthesize/FFT`, { method: "POST", body: formDataBasic });
      const fftJson = await fftRes.json();
      if (fftRes.ok) setFftReference({ frequency: fftJson.frequency, magnitude: fftJson.magnitude });

      // --- STEP D: UPDATE LOG HISTORY ---
      setSynthLog((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          fileName: `Synth_Py_${inputFile.name}`,
          fc: params.carrier_frequency_fc,
          fm: params.modulator_frequency_fm,
          index: params.modulation_index_I,
          source: "Python", 
          audioUrl: pyUrl, // URL aman digunakan
        },
      ]);

      // Otomatis pindah ke Tab Python untuk melihat hasil
      setActiveEvalTab("Python");

      toast({ title: "Selesai!", description: "Sintesis Python berhasil." });

    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };


  // ---------------------
  // HANDLER 3: SAVE TO STM32 (MQTT)
  // ---------------------
  const handleSaveParamsToSTM32 = async () => {
    if (!paramsAPI) return toast({ title: "Error", description: "Belum ada parameter!", variant: "destructive" });

    try {
      toast({ title: "Mengirim...", description: "Kirim parameter ke STM32 via MQTT." });
      const res = await fetch("/api/save-params", {
        method: "POST",
        body: JSON.stringify({ params: paramsAPI }),
        headers: { "Content-Type": "application/json" },
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      // Update log (tanpa audio url karena STM32 belum kirim balik audio)
      setSynthLog((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          fileName: inputFile?.name ?? "unknown.wav",
          fc: paramsAPI.carrier_frequency_fc,
          fm: paramsAPI.modulator_frequency_fm,
          index: paramsAPI.modulation_index_I,
          source: "STM32",
          audioUrl: "", 
        },
      ]);

      // Pindah ke tab STM32 agar user siap merekam
      setActiveEvalTab("STM32");
      
      toast({ title: "Terkirim!", description: "Silakan rekam output STM32." });
    } catch (err: any) {
      toast({ title: "Gagal kirim", description: err.message, variant: "destructive" });
    }
  };


  // ---------------------
  // HANDLER 4: LIVE RECORDING (STM32)
  // ---------------------
  const handleRecordingComplete = (audioFile: File) => {
    if (liveRecordingUrl) URL.revokeObjectURL(liveRecordingUrl);
    
    const newUrl = URL.createObjectURL(audioFile);
    setLiveRecordingFile(audioFile);
    setLiveRecordingUrl(newUrl);

    toast({ title: "Rekaman STM32 Selesai", description: "Siap dievaluasi." });
  };


  // ---------------------
  // HANDLER 5: EVALUASI GMM (DINAMIS)
  // ---------------------
  const handleEvaluateGMM = async () => {
    // Tentukan file mana yang akan dikirim ke API (Tergantung Tab)
    let targetFile: File | null = null;
    let sourceLabel = "";

    if (activeEvalTab === "STM32") {
      targetFile = liveRecordingFile;
      sourceLabel = "Live Recording (STM32)";
    } else {
      targetFile = pythonSynthFile;
      sourceLabel = "Python Synthesis";
    }

    // Validasi File
    if (!targetFile) {
      return toast({
        title: `Audio ${activeEvalTab} Kosong!`,
        description: activeEvalTab === "STM32" ? "Lakukan rekaman dulu." : "Lakukan Analyze dulu.",
        variant: "destructive",
      });
    }

    // Validasi Model
    if (!gmmModelName) return toast({ title: "Pilih model GMM!", variant: "destructive" });

    setEvaluating(true);
    toast({ title: "Evaluasi GMM...", description: `Menguji ${sourceLabel} vs ${gmmModelName}` });

    try {
      const formData = new FormData();
      formData.append("test_file", targetFile); 
      formData.append("reference_model", gmmModelName);

      const res = await fetch(`http://localhost:8080/gmm/compare/`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      
      setGmmResult(result);
      toast({ title: "Evaluasi Selesai", description: `Similarity: ${result.percent_similarity_topk.toFixed(2)}%` });
    } catch (err: any) {
      toast({ title: "Gagal Evaluasi", description: err.message, variant: "destructive" });
    } finally {
      setEvaluating(false);
    }
  };

  // ---------------------------------------------------------
  // RENDER UI
  // ---------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 text-gray-800 p-6 md:p-10 space-y-10">
      
      {/* --- HEADER --- */}
      <header className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900">
          Capstone F-06 Gamasynth Dashboard
        </h1>
        <p className="text-gray-500">
          Sistem Sintesis Audio Gamelan: Analisis, Sintesis, dan Evaluasi.
        </p>
      </header>

      <div className="grid lg:grid-cols-2 gap-8">
        
        {/* ========================================= */}
        {/* KOLOM KIRI: INPUT, FFT, KONTROL PARAMETER */}
        {/* ========================================= */}
        <div className="space-y-8">
          
          {/* 1. Input Audio Card */}
          <Card className="bg-white border-gray-200 shadow-sm hover:shadow-md transition-all">
            <CardHeader>
              <CardTitle>1. Input Audio Referensi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <AudioUploader onUpload={handleUpload} />
              <WaveformViewer file={inputFile} label="Gelombang Asli" />
              {inputAudioUrl && <audio controls src={inputAudioUrl} className="w-full mt-2" />}
              
              <Button 
                onClick={handleAnalyze} 
                disabled={!inputFile} 
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                Analyze FM & Synthesize (Python)
              </Button>
            </CardContent>
          </Card>

          {/* 2. FFT Plot (Muncul setelah analyze) */}
          {fftReference && (
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="pt-6">
                <SpectrumPlot frequency={fftReference.frequency} magnitude={fftReference.magnitude} title="FFT Spectrum (Referensi)" />
              </CardContent>
            </Card>
          )}

          {/* 3. Parameter Controls */}
          <Card className="bg-white border-gray-200 shadow-sm hover:shadow-md transition-all">
            <CardHeader>
              <CardTitle>2. Kontrol Parameter FM</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {paramsAPI ? (
                <>
                  <FmControls
                    params={mapParams(paramsAPI)}
                    setParams={(updated) => {
                      setParamsAPI({
                        ...paramsAPI,
                        carrier_frequency_fc: updated.carrierFreq ?? paramsAPI.carrier_frequency_fc,
                        modulator_frequency_fm: updated.modFreq ?? paramsAPI.modulator_frequency_fm,
                        modulation_index_I: updated.modIndex ?? paramsAPI.modulation_index_I,
                      });
                    }}
                  />
                  <Button onClick={handleSaveParamsToSTM32} variant="secondary" className="w-full border border-gray-300">
                    Kirim Parameter ke STM32 (MQTT)
                  </Button>
                </>
              ) : (
                <p className="text-sm text-gray-500 italic text-center py-4">Silakan jalankan analisis terlebih dahulu.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ========================================= */}
        {/* KOLOM KANAN: EVALUASI & KOMPARASI (TABS)  */}
        {/* ========================================= */}
        <div className="space-y-8">
          <Card className="bg-white border-gray-200 shadow-md rounded-xl overflow-hidden h-fit">
            <div className="bg-gray-50 border-b p-4">
              <CardTitle>3. Evaluasi & Komparasi Sintesis</CardTitle>
              <p className="text-sm text-gray-500 mt-1">Pilih sumber audio untuk dievaluasi dengan GMM.</p>
            </div>

            {/* TABS HEADER */}
            <div className="flex border-b">
              <button
                onClick={() => setActiveEvalTab("STM32")}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeEvalTab === "STM32" 
                    ? "bg-white border-b-2 border-blue-600 text-blue-600" 
                    : "bg-gray-50 text-gray-500 hover:text-gray-700"
                }`}
              >
                A. Hardware (STM32)
              </button>
              <button
                onClick={() => setActiveEvalTab("Python")}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeEvalTab === "Python" 
                    ? "bg-white border-b-2 border-blue-600 text-blue-600" 
                    : "bg-gray-50 text-gray-500 hover:text-gray-700"
                }`}
              >
                B. Software (Python)
              </button>
            </div>

            <CardContent className="p-6 space-y-6 min-h-[400px]">
              
              {/* --- TAB KONTEN: STM32 --- */}
              {activeEvalTab === "STM32" && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-blue-50 p-3 rounded border border-blue-100 text-sm text-blue-800">
                    <strong>Instruksi:</strong> Klik tombol rekam untuk menangkap suara dari STM32 melalui Soundcard.
                  </div>
                  <AudioRecorder onRecordingComplete={handleRecordingComplete} />
                  
                  {liveRecordingUrl ? (
                    <div className="space-y-2 mt-2">
                      <WaveformViewer url={liveRecordingUrl} label="Waveform: Rekaman STM32" />
                      <audio controls src={liveRecordingUrl} className="w-full" />
                    </div>
                  ) : (
                    <div className="h-32 flex items-center justify-center border-2 border-dashed rounded-lg bg-gray-50 text-gray-400 text-sm">
                      Belum ada rekaman
                    </div>
                  )}
                </div>
              )}

              {/* --- TAB KONTEN: PYTHON --- */}
              {activeEvalTab === "Python" && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-green-50 p-3 rounded border border-green-100 text-sm text-green-800">
                    <strong>Info:</strong> Ini adalah hasil sintesis langsung dari algoritma Python.
                  </div>
                  
                  {pythonSynthUrl ? (
                    <div className="space-y-2">
                      {/* Menggunakan URL Blob yang aman dari useRef */}
                      <WaveformViewer url={pythonSynthUrl} label="Waveform: Sintesis Python" />
                      <audio controls src={pythonSynthUrl} className="w-full" />
                      <div className="text-xs text-gray-500 text-center mt-1">
                        File: {pythonSynthFile?.name}
                      </div>
                    </div>
                  ) : (
                    <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed rounded-lg bg-gray-50 text-gray-400 text-sm gap-2">
                      <p>Belum ada hasil sintesis.</p>
                      <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={!inputFile}>
                        Jalankan "Analyze FM" Dulu
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* --- BAGIAN GMM EVALUATION (SHARED) --- */}
              <div className="pt-6 mt-6 border-t border-gray-100 space-y-4">
                <h4 className="font-semibold text-gray-900">Evaluasi Similarity (GMM)</h4>
                
                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    className="border rounded px-3 py-2 flex-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={gmmModelName}
                    onChange={(e) => setGmmModelName(e.target.value)}
                  >
                    <option value="">-- Pilih Model Referensi --</option>
                    <option value="saron_p1">Saron Pelog 1</option>
                    <option value="saron_p2">Saron Pelog 2</option>
                    <option value="saron_p3">Saron Pelog 3</option>
                    <option value="saron_p4">Saron Pelog 4</option>
                    <option value="saron_p5">Saron Pelog 5</option>
                    <option value="saron_p6">Saron Pelog 6</option>
                    <option value="saron_p7">Saron Pelog 7</option>
                  </select>

                  <Button 
                    onClick={handleEvaluateGMM}
                    disabled={evaluating || !gmmModelName || (activeEvalTab === "STM32" ? !liveRecordingFile : !pythonSynthFile)}
                    className={`min-w-[140px] ${activeEvalTab === "STM32" ? "bg-blue-600" : "bg-green-600"} hover:opacity-90 text-white`}
                  >
                    {evaluating ? "Menilai..." : `Nilai (${activeEvalTab})`}
                  </Button>
                </div>

                {/* Hasil GMM */}
                {gmmResult && (
                  <div className="bg-slate-800 text-white p-4 rounded-lg shadow-lg animate-in zoom-in-95 duration-300">
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Similarity Score</p>
                        <p className="text-3xl font-bold text-green-400">
                          {gmmResult.percent_similarity_topk.toFixed(2)}%
                        </p>
                      </div>
                      <div className="text-right text-xs text-slate-400">
                        <p>Source: {activeEvalTab}</p>
                        <p>Model: {gmmModelName}</p>
                        <p>Frames: {gmmResult.n_frames}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* --- LOG HISTORY (TABLE & TABS) --- */}
      <Card className="bg-white border-gray-200 shadow-md mt-8">
        <CardHeader>
          <CardTitle>Riwayat Log Sintesis</CardTitle>
        </CardHeader>
        <CardContent>
          <SynthTabs logs={synthLog} />
          <div className="mt-6">
            <SynthesisLogTable log={synthLog} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}