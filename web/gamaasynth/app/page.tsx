"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// --- KOMPONEN CUSTOM ---
import AudioUploader from "@/components/AudioUploader";
import WaveformViewer from "@/components/WaveFormViewer";
import FmControls from "@/components/FmControls";
import AudioRecorder from "@/components/AudioRecorder";
import SynthesisLogTable, { SynthesisLogEntry } from "@/components/SynthesisLogTable"; 
import SynthTabs from "@/components/SynthTabs"; 
import SpectrumPlot from "@/components/SpectrumPlot";
import MFCCHeatmap from "@/components/MFCCHeatmap"; 

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

  // --- STATE: MANAGEMEN URL & MEMORY ---
  const generatedUrls = useRef<string[]>([]);

  // --- STATE: INPUT (FILE REFERENSI) ---
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputAudioUrl, setInputAudioUrl] = useState<string | null>(null);
  const [fftReference, setFftReference] = useState<{ frequency: number[]; magnitude: number[] } | null>(null);
  const [mfccDataRef, setMfccDataRef] = useState<number[][] | null>(null); // [BARU] Data MFCC Referensi

  // --- STATE: EVALUASI & KOMPARASI (TAB SYSTEM) ---
  const [activeEvalTab, setActiveEvalTab] = useState<"STM32" | "Python">("STM32");
  
  // 1. Data STM32 (Live Recording)
  const [liveRecordingFile, setLiveRecordingFile] = useState<File | null>(null);
  const [liveRecordingUrl, setLiveRecordingUrl] = useState<string | null>(null);
  const [mfccDataStm32, setMfccDataStm32] = useState<number[][] | null>(null); 

  // 2. Data Python (Synthesis Result)
  const [pythonSynthFile, setPythonSynthFile] = useState<File | null>(null);
  const [pythonSynthUrl, setPythonSynthUrl] = useState<string | null>(null);
  const [mfccDataPython, setMfccDataPython] = useState<number[][] | null>(null); 

  // --- STATE: PARAMETER HASIL ANALISIS ---
  const [paramsAPI, setParamsAPI] = useState<FMParamsFastAPI | null>(null);

  // --- STATE: GMM EVALUATION ---
  const [gmmResult, setGmmResult] = useState<any | null>(null);
  const [gmmModelName, setGmmModelName] = useState<string>("");
  const [evaluating, setEvaluating] = useState(false);
  const [extractingMfcc, setExtractingMfcc] = useState(false);
  
  // --- STATE: LOG HISTORY ---
  const [synthLog, setSynthLog] = useState<SynthesisLogEntry[]>([]);

  const mapParams = (p: FMParamsFastAPI): FMParamsFrontend => ({
    carrierFreq: p.carrier_frequency_fc ?? 0,
    modFreq: p.modulator_frequency_fm ?? 0,
    modIndex: p.modulation_index_I ?? 0,
  });

  // Cleanup
  useEffect(() => {
    return () => {
      generatedUrls.current.forEach((url) => URL.revokeObjectURL(url));
      if (inputAudioUrl) URL.revokeObjectURL(inputAudioUrl);
      if (liveRecordingUrl) URL.revokeObjectURL(liveRecordingUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // Reset hasil evaluasi jika tab berubah
  useEffect(() => {
    setGmmResult(null);
  }, [activeEvalTab]);


  // ---------------------
  // HANDLERS UTAMA
  // ---------------------
  
  const handleUpload = (file: File) => {
    if (inputAudioUrl) URL.revokeObjectURL(inputAudioUrl);
    const url = URL.createObjectURL(file);
    setInputAudioUrl(url);
    setInputFile(file);
    setMfccDataRef(null); // Reset MFCC Ref saat upload baru
    toast({ title: "File diunggah", description: `${file.name} siap.` });
  };

  // Handler Analisis & Sintesis Python
  const handleAnalyze = async () => {
    if (!inputFile) return toast({ title: "Upload referensi dulu!", variant: "destructive" });
    
    toast({ title: "Processing...", description: "Analisis parameter & Sintesis Python..." });

    try {
      // 1. Analisis Parameter
      const formDataBasic = new FormData();
      formDataBasic.append("file", inputFile);

      const resParams = await fetch("/api/approx-params-send", { method: "POST", body: formDataBasic });
      const resultParams = await resParams.json();
      if (!resParams.ok || !resultParams.params) throw new Error(resultParams.error || "Gagal param");

      const params = resultParams.params;
      setParamsAPI(params);

      // 2. Sintesis Python
      const formDataSynth = new FormData();
      formDataSynth.append("file", inputFile); 
      formDataSynth.append("carrier_frequency_fc", params.carrier_frequency_fc.toString());
      formDataSynth.append("modulator_frequency_fm", params.modulator_frequency_fm.toString());
      formDataSynth.append("modulation_index_I", params.modulation_index_I.toString());
      
      formDataSynth.append("attack_rate", "150.0");
      formDataSynth.append("decay_rate", "2.5");
      formDataSynth.append("noise_level", "10");
      formDataSynth.append("duration", "7.0"); // Durasi default 5 detik
      formDataSynth.append("sampling_rate", "44100");
      formDataSynth.append("add_partials", "10");
      formDataSynth.append("bp_bw", "0.25");
      formDataSynth.append("secondary_mod_ratio", "0.25");
      formDataSynth.append("detune_step", "0.0015");
      const resSynth = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/synthesize/synthesize`, {
        method: "POST",
        body: formDataSynth, 
      });

      if (!resSynth.ok) throw new Error("Gagal sintesis Python");

      const audioBlob = await resSynth.blob();
      const pyFile = new File([audioBlob], "python_synth_result.wav", { type: "audio/wav" });
      const pyUrl = URL.createObjectURL(audioBlob);
      generatedUrls.current.push(pyUrl);

      setPythonSynthFile(pyFile);
      setPythonSynthUrl(pyUrl);
      setMfccDataPython(null); 

      // 3. Get FFT (Reference)
      const fftRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/synthesize/FFT`, { method: "POST", body: formDataBasic });
      const fftJson = await fftRes.json();
      if (fftRes.ok) setFftReference({ frequency: fftJson.frequency, magnitude: fftJson.magnitude });

      // 4. Update Log
      setSynthLog((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          fileName: `Synth_Py_${inputFile.name}`,
          fc: params.carrier_frequency_fc,
          fm: params.modulator_frequency_fm,
          index: params.modulation_index_I,
          source: "Python", 
          audioUrl: pyUrl, 
        },
      ]);

      setActiveEvalTab("Python");
      toast({ title: "Selesai!", description: "Sintesis Python berhasil." });

    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

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
      setActiveEvalTab("STM32");
      toast({ title: "Terkirim!", description: "Silakan rekam output STM32." });
    } catch (err: any) {
      toast({ title: "Gagal kirim", description: err.message, variant: "destructive" });
    }
  };

  const handleRecordingComplete = (audioFile: File) => {
    if (liveRecordingUrl) URL.revokeObjectURL(liveRecordingUrl);
    const newUrl = URL.createObjectURL(audioFile);
    setLiveRecordingFile(audioFile);
    setLiveRecordingUrl(newUrl);
    setMfccDataStm32(null); 
    toast({ title: "Rekaman Selesai", description: "Siap dievaluasi." });
  };

  // ---------------------
  // FEATURE: EXTRACT MFCC (EVALUATION TABS)
  // ---------------------
  const handleExtractMFCC = async () => {
    const targetFile = activeEvalTab === "STM32" ? liveRecordingFile : pythonSynthFile;
    
    if (!targetFile) {
      return toast({ 
        title: "Tidak ada audio", 
        description: "Rekam audio atau jalankan sintesis dulu.", 
        variant: "destructive" 
      });
    }

    setExtractingMfcc(true);
    try {
      const formData = new FormData();
      formData.append("file", targetFile);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/mfcc/extract_mfcc/`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error(await res.text());
      
      const result = await res.json();
      
      if (activeEvalTab === "STM32") {
        setMfccDataStm32(result.mfcc);
      } else {
        setMfccDataPython(result.mfcc);
      }
      
      toast({ title: "Sukses", description: `MFCC ${activeEvalTab} berhasil diekstrak.` });

    } catch (err: any) {
      toast({ title: "Gagal Ekstraksi", description: err.message, variant: "destructive" });
    } finally {
      setExtractingMfcc(false);
    }
  };

  // ---------------------
  // [BARU] FEATURE: EXTRACT MFCC (AUDIO ASLI)
  // ---------------------
  const handleExtractMFCCRef = async () => {
    if (!inputFile) {
      return toast({ 
        title: "Tidak ada file input", 
        description: "Silakan upload file audio referensi dulu.", 
        variant: "destructive" 
      });
    }

    setExtractingMfcc(true);
    try {
      const formData = new FormData();
      formData.append("file", inputFile);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/mfcc/extract_mfcc/`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error(await res.text());
      
      const result = await res.json();
      setMfccDataRef(result.mfcc); // Simpan ke state MFCC Ref
      
      toast({ title: "Sukses", description: "MFCC Audio Asli berhasil diekstrak." });

    } catch (err: any) {
      toast({ title: "Gagal Ekstraksi", description: err.message, variant: "destructive" });
    } finally {
      setExtractingMfcc(false);
    }
  };

  const handleEvaluateGMM = async () => {
    const targetFile = activeEvalTab === "STM32" ? liveRecordingFile : pythonSynthFile;
    
    if (!targetFile) return toast({ title: "Audio Kosong!", variant: "destructive" });
    if (!gmmModelName) return toast({ title: "Pilih model GMM!", variant: "destructive" });

    setEvaluating(true);
    try {
      const formData = new FormData();
      formData.append("test_file", targetFile); 
      formData.append("reference_model", gmmModelName);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/gmm/compare/`, {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 text-gray-800 p-6 md:p-10 space-y-10">
      
      <header className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900">Capstone F-06 Dashboard</h1>
        <p className="text-gray-500">Analisis Audio, Sintesis FM (Python/STM32), dan Evaluasi GMM/MFCC.</p>
      </header>

      <div className="grid lg:grid-cols-2 gap-8">
        
        {/* KOLOM KIRI: INPUT & KONTROL */}
        <div className="space-y-8">
          <Card className="bg-white shadow-sm">
            <CardHeader><CardTitle>1. Input & Analisis</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <AudioUploader onUpload={handleUpload} />
              <WaveformViewer file={inputFile} label="Input Asli" />
              {inputAudioUrl && <audio controls src={inputAudioUrl} className="w-full mt-2" />}
              
              <div className="space-y-2">
                <Button onClick={handleAnalyze} disabled={!inputFile} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                  Analyze & Synthesize (Python)
                </Button>

                {/* [BARU] Tombol MFCC Audio Asli */}
                <Button 
                  variant="outline" 
                  onClick={handleExtractMFCCRef} 
                  disabled={!inputFile || extractingMfcc} 
                  className="w-full"
                >
                  {extractingMfcc ? "Mengekstrak..." : "Tampilkan Spektrum MFCC (Asli)"}
                </Button>
              </div>
              
              {/* [BARU] Heatmap MFCC Audio Asli */}
              {mfccDataRef && (
                <div className="mt-4 animate-in fade-in">
                  <MFCCHeatmap data={mfccDataRef} title="MFCC Spectrum: Audio Asli" />
                </div>
              )}

            </CardContent>
          </Card>

          {fftReference && (
            <Card className="shadow-sm"><CardContent className="pt-6">
              <SpectrumPlot frequency={fftReference.frequency} magnitude={fftReference.magnitude} title="FFT Input" />
            </CardContent></Card>
          )}

          <Card className="bg-white shadow-sm">
            <CardHeader><CardTitle>2. Kontrol Parameter</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {paramsAPI ? (
                <>
                  <FmControls params={mapParams(paramsAPI)} setParams={(u) => setParamsAPI({ ...paramsAPI, carrier_frequency_fc: u.carrierFreq ?? paramsAPI.carrier_frequency_fc, modulator_frequency_fm: u.modFreq ?? paramsAPI.modulator_frequency_fm, modulation_index_I: u.modIndex ?? paramsAPI.modulation_index_I })} />
                  <Button onClick={handleSaveParamsToSTM32} variant="secondary" className="w-full border">Kirim ke STM32</Button>
                </>
              ) : <p className="text-sm text-gray-500 text-center italic">Belum ada parameter.</p>}
            </CardContent>
          </Card>
        </div>

        {/* KOLOM KANAN: EVALUASI (TABS) */}
        <div className="space-y-8">
          <Card className="bg-white shadow-md rounded-xl overflow-hidden">
            <div className="bg-gray-50 border-b p-4">
              <CardTitle>3. Evaluasi & Komparasi</CardTitle>
              <p className="text-sm text-gray-500">Pilih sumber audio untuk dievaluasi.</p>
            </div>

            <div className="flex border-b">
              {["STM32", "Python"].map((tab) => (
                <button key={tab} onClick={() => setActiveEvalTab(tab as any)} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeEvalTab === tab ? "bg-white border-b-2 border-blue-600 text-blue-600" : "bg-gray-50 text-gray-500"}`}>
                  {tab === "STM32" ? "A. Hardware (STM32)" : "B. Software (Python)"}
                </button>
              ))}
            </div>

            <CardContent className="p-6 space-y-6 min-h-[400px]">
              
              {/* --- KONTEN TAB --- */}
              <div className="space-y-4 animate-in fade-in duration-300">
                {activeEvalTab === "STM32" ? (
                  <>
                    <div className="bg-blue-50 p-3 rounded text-sm text-blue-800 border border-blue-100">Klik rekam untuk menangkap suara STM32.</div>
                    <AudioRecorder onRecordingComplete={handleRecordingComplete} />
                    {/* Menambahkan kembali kontrol audio native untuk STM32 */}
                    {liveRecordingUrl && (
                      <div className="mt-4">
                        <WaveformViewer url={liveRecordingUrl} label="Rekaman STM32" />
                        <audio controls src={liveRecordingUrl} className="w-full mt-2" />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="bg-green-50 p-3 rounded text-sm text-green-800 border border-green-100">Hasil sintesis algoritma Python.</div>
                    {/* Menambahkan kembali kontrol audio native untuk Python */}
                    {pythonSynthUrl ? (
                      <div className="mt-4">
                        <WaveformViewer url={pythonSynthUrl} label="Sintesis Python" />
                        <audio controls src={pythonSynthUrl} className="w-full mt-2" />
                      </div>
                    ) : (
                      <p className="text-center text-sm text-gray-400 py-8 border-2 border-dashed rounded">Belum ada hasil sintesis.</p>
                    )}
                  </>
                )}

                {(activeEvalTab === "STM32" ? liveRecordingFile : pythonSynthFile) && (
                  <div className="mt-2">
                     <Button variant="outline" size="sm" onClick={handleExtractMFCC} disabled={extractingMfcc} className="w-full">
                       {extractingMfcc ? "Mengekstrak..." : "Tampilkan Spektrum MFCC"}
                     </Button>
                  </div>
                )}

                {activeEvalTab === "STM32" && mfccDataStm32 && (
                  <MFCCHeatmap data={mfccDataStm32} title="MFCC Spectrum: STM32" />
                )}
                {activeEvalTab === "Python" && mfccDataPython && (
                  <MFCCHeatmap data={mfccDataPython} title="MFCC Spectrum: Python" />
                )}
              </div>

              {/* --- EVALUASI GMM --- */}
              <div className="pt-6 mt-6 border-t border-gray-100 space-y-4">
                <h4 className="font-semibold text-gray-900">Evaluasi Similarity (GMM)</h4>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select className="border rounded px-3 py-2 flex-1 text-sm" value={gmmModelName} onChange={(e) => setGmmModelName(e.target.value)}>
                    <option value="">-- Pilih Model --</option>
                    <option value="saron_p1">Saron Pelog 1</option>
                    <option value="saron_p2">Saron Pelog 2</option>
                    <option value="saron_p3">Saron Pelog 3</option>
                    <option value="saron_p4">Saron Pelog 4</option>
                    <option value="saron_p5">Saron Pelog 5</option>
                    <option value="saron_p6">Saron Pelog 6</option>
                    <option value="saron_p7">Saron Pelog 7</option>
                  </select>
                  <Button onClick={handleEvaluateGMM} disabled={evaluating || !gmmModelName} className="bg-slate-800 text-white">
                    {evaluating ? "..." : "Nilai"}
                  </Button>
                </div>
                {gmmResult && (
                  <div className="bg-slate-800 text-white p-4 rounded shadow">
                    <p className="text-xs text-slate-400 font-semibold uppercase">Similarity Score</p>
                    <p className="text-3xl font-bold text-green-400">{gmmResult.percent_similarity_topk.toFixed(2)}%</p>
                  </div>
                )}
              </div>

            </CardContent>
          </Card>
        </div>
      </div>

      {/* HISTORY */}
      <Card className="mt-8"><CardHeader><CardTitle>Riwayat Log</CardTitle></CardHeader>
        <CardContent>
          <SynthTabs logs={synthLog} />
          <div className="mt-6"><SynthesisLogTable log={synthLog} /></div>
        </CardContent>
      </Card>
    </div>
  );
}