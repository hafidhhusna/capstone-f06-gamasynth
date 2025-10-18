"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Card } from "@/components/ui/card";

interface Props {
  file?: File | null;
  url?: string;
  label?: string;
}

export default function WaveformViewer({ file, url, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [timestamp, setTimestamp] = useState<number>(0);
  const [amplitude, setAmplitude] = useState<number>(0);

  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;
    if (!file && !url) return;

    let isDestroyed = false;

    // Hancurkan instance lama jika ada
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
      wavesurfer.setOptions({
        height: 200,
        waveColor: "#93c5fd",
        progressColor: "#2563eb",
      });
    });
    resizeObserver.observe(containerEl);

    let audioBuffer: AudioBuffer | null = null;

    wavesurfer.on("decode", async () => {
      try {
        const buffer = await wavesurfer.getDecodedData();
        if (buffer) audioBuffer = buffer;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          console.debug("WaveSurfer decoding aborted safely.");
        } else {
          console.error("WaveSurfer decode error:", err);
        }
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
      const value = channelData[index] || 0;
      setAmplitude(value);
    };

    containerEl.addEventListener("mousemove", handleMove);

    const loadAudio = async () => {
      try {
        if (file) {
          const objectUrl = URL.createObjectURL(file);
          await wavesurfer.load(objectUrl);
          URL.revokeObjectURL(objectUrl);
        } else if (url) {
          await wavesurfer.load(url);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          console.debug("WaveSurfer load aborted safely.");
        } else {
          console.error("WaveSurfer load error:", err);
        }
      }
    };

    loadAudio();

    return () => {
      isDestroyed = true;
      resizeObserver.disconnect();
      containerEl.removeEventListener("mousemove", handleMove);
      wavesurfer.destroy();
    };
  }, [file, url]);

  return (
    <Card className="my-6 border border-gray-200 shadow-sm p-4 bg-white/60 backdrop-blur-sm">
      {label && (
        <p className="text-sm mb-3 text-gray-700 font-semibold text-center">
          {label}
        </p>
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
