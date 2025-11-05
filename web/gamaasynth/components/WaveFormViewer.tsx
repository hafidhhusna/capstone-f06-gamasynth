"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Card } from "@/components/ui/card";

interface Props {
  file?: File | null;
  url?: string | string[]; // Bisa single URL atau array URL
  label?: string;
}

interface Track {
  url: string;
  label?: string;
}

export default function WaveformViewer({ file, url, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [timestamp, setTimestamp] = useState<number>(0);
  const [amplitude, setAmplitude] = useState<number>(0);

  // Konversi URL/file ke track array
  // ubah pembuatan tracks
  const tracks: Track[] = [];
  if (file) {
    const fileUrl = URL.createObjectURL(file);
    tracks.push({ url: fileUrl, label: "Input File" });
  } else if (Array.isArray(url)) {
    url.forEach((u, idx) => tracks.push({ url: u, label: `Track ${idx + 1}` }));
  } else if (url) {
    tracks.push({ url, label: "Track" });
  }


  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl || tracks.length === 0) return;

    let isDestroyed = false;

    // Cleanup lama
    if (waveSurferRef.current) {
      waveSurferRef.current.destroy();
    }

    const wavesurfer = WaveSurfer.create({
      container: containerEl,
      waveColor: "#93c5fd",
      progressColor: "#2563eb",
      cursorColor: "#1e3a8a",
      height: 200,
      normalize: true,
      barWidth: 2,
      autoScroll: false,
    });

    waveSurferRef.current = wavesurfer;

    const resizeObserver = new ResizeObserver(() => {
      if (isDestroyed) return;
      wavesurfer.setOptions({ height: 200 });
    });
    resizeObserver.observe(containerEl);

    let audioBuffer: AudioBuffer | null = null;

    wavesurfer.on("decode", async () => {
      try {
        const buffer = await wavesurfer.getDecodedData();
        if (buffer) audioBuffer = buffer;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("WaveSurfer decode error:", err);
      }
    });

    const handleMove = (e: MouseEvent) => {
      if (!audioBuffer || !containerEl) return;
      const rect = containerEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const relX = Math.min(Math.max(x / rect.width, 0), 1);
      const duration = wavesurfer.getDuration();
      const currentTime = relX * duration;

      setTimestamp(currentTime);

      const channelData = audioBuffer.getChannelData(0);
      const index = Math.floor(relX * channelData.length);
      setAmplitude(channelData[index] || 0);
    };

    containerEl.addEventListener("mousemove", handleMove);

    const loadTracks = async () => {
      for (const t of tracks) {
        try {
          await wavesurfer.load(t.url);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          console.error("WaveSurfer load error:", err);
        }
      }
    };

    loadTracks();

    return () => {
      isDestroyed = true;
      resizeObserver.disconnect();
      containerEl.removeEventListener("mousemove", handleMove);
      wavesurfer.destroy();

      // revoke URL dari File object
      if (file) {
        tracks.forEach((t) => URL.revokeObjectURL(t.url));
      }
    };

  }, [file, url]); // Perbarui jika file atau url berubah

  return (
    <Card className="my-6 border border-gray-200 shadow-sm p-4 bg-white/60 backdrop-blur-sm">
      {label && (
        <p className="text-sm mb-3 text-gray-700 font-semibold text-center">{label}</p>
      )}

      <div className="relative">
        <div
          ref={containerRef}
          className="border border-gray-200 rounded-2xl shadow-inner bg-gray-50 w-full h-[220px] overflow-hidden"
        />
        <div className="absolute top-2 right-3 text-sm bg-white/70 backdrop-blur-md px-3 py-1 rounded-md shadow-sm font-mono text-gray-700">
          t = {timestamp.toFixed(3)} s | A = {amplitude.toFixed(3)}
        </div>
      </div>
    </Card>
  );
}
