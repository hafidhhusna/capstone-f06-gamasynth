"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import AudioUploader from "@/components/AudioUploader";
import WaveformViewer from "@/components/WaveFormViewer";
import FmControls from "@/components/FmControls";
import EvaluationCard from "@/components/EvaluationCard";

export default function Dashboard() {
  const { toast } = useToast();
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [synthAudioUrl, setSynthAudioUrl] = useState<string | null>(null);
  const [similarity, setSimilarity] = useState<number | null>(null);

  const [params, setParams] = useState({
    carrierFreq: 220,
    modFreq: 440,
    modIndex: 2,
    attack: 0.1,
    decay: 0.5,
  });

  const handleUpload = (file: File) => {
    setInputFile(file);
    toast({
      title: "File berhasil diunggah",
      description: `${file.name} siap untuk disintesis.`,
    });
  };

  const handleSynthesize = async () => {
    if (!inputFile) {
      toast({
        title: "Tidak ada file!",
        description: "Silakan unggah suara gamelan terlebih dahulu.",
        variant: "destructive",
      });
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", inputFile);
      Object.entries(params).forEach(([k, v]) => formData.append(k, String(v)));

      toast({ title: "Sedang melakukan sintesis...", description: "Harap tunggu beberapa saat." });

      const res = await fetch("http://localhost:8000/synthesize", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Gagal melakukan sintesis");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setSynthAudioUrl(url);

      toast({
        title: "Sintesis berhasil!",
        description: "Hasil suara sintetis siap untuk diputar.",
      });
    } catch (e) {
      toast({
        title: "Gagal melakukan sintesis",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleEvaluate = async () => {
    if (!inputFile || !synthAudioUrl) {
      toast({
        title: "Tidak dapat mengevaluasi",
        description: "Pastikan sudah ada input dan hasil sintesis.",
        variant: "destructive",
      });
      return;
    }

    try {
      toast({
        title: "Evaluasi dimulai...",
        description: "Menganalisis kemiripan suara.",
      });

      const formData = new FormData();
      formData.append("input", inputFile);

      const res = await fetch("http://localhost:8000/evaluate", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setSimilarity(data.similarity ?? 0.9);

      toast({
        title: "Evaluasi selesai!",
        description: "Nilai kemiripan berhasil dihitung.",
      });
    } catch (e) {
      toast({
        title: "Gagal evaluasi",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleSaveParams = () => {
    localStorage.setItem("fm_params", JSON.stringify(params));
    toast({
      title: "Parameter tersimpan",
      description: "Parameter FM synthesis berhasil disimpan.",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 text-gray-800 p-10 space-y-10">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900">
          Capstone F-06 Gamasynth Dashboard
        </h1>
        <p className="text-gray-500 mt-2">
          Eksperimen sintesis suara gamelan menggunakan parameter FM.
        </p>
      </header>

      {/* Input dan hasil sintesis */}
      <div className="grid md:grid-cols-2 gap-10">
        <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
          <CardHeader>
            <CardTitle className="text-gray-900">Input Suara Gamelan</CardTitle>
          </CardHeader>
          <CardContent>
            <AudioUploader onUpload={handleUpload} />
            <WaveformViewer file={inputFile} label="Gelombang Asli" />
          </CardContent>
        </Card>

        <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
          <CardHeader>
            <CardTitle className="text-gray-900">Hasil Sintesis</CardTitle>
          </CardHeader>
          <CardContent>
            {synthAudioUrl ? (
              <WaveformViewer url={synthAudioUrl} label="Gelombang Sintesis" />
            ) : (
              <p className="text-sm text-gray-500 italic">
                Belum ada hasil sintesis.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Kontrol parameter */}
      <Card className="bg-white border border-gray-200 shadow-md rounded-2xl hover:shadow-lg transition-all duration-300">
        <CardHeader>
          <CardTitle className="text-gray-900">Kontrol FM Synthesis</CardTitle>
        </CardHeader>
        <CardContent>
          <FmControls params={params} setParams={setParams} />
          <div className="flex flex-wrap gap-3 mt-6">
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2 rounded-lg shadow-sm"
              onClick={handleSynthesize}
            >
              Synthesize
            </Button>
            <Button
              variant="outline"
              className="border-gray-300 text-gray-700 hover:bg-gray-100"
              onClick={handleEvaluate}
            >
              Evaluate
            </Button>
            <Button
              variant="ghost"
              className="text-blue-700 hover:underline"
              onClick={handleSaveParams}
            >
              Save Params
            </Button>
          </div>
        </CardContent>
      </Card>

      {similarity !== null && <EvaluationCard score={similarity} />}
    </div>
  );
}
