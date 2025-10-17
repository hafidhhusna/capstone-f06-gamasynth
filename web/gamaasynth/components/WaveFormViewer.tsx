"use client";

import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

interface Props {
  file?: File | null;
  url?: string;
  label?: string;
}

export default function WaveformViewer({ file, url, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!file && !url) return;

    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#93c5fd",
      progressColor: "#2563eb",
      cursorColor: "#1e3a8a",
      height: 80,
    });

    if (file) {
      const objectUrl = URL.createObjectURL(file);
      wavesurfer.load(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else if (url) {
      wavesurfer.load(url);
    }

    return () => wavesurfer.destroy();
  }, [file, url]);

  return (
    <div className="my-4">
      {label && (
        <p className="text-sm mb-2 text-gray-600 font-medium">{label}</p>
      )}
      <div
        ref={containerRef}
        className="border border-gray-200 rounded-xl shadow-inner p-2 bg-gray-50"
      />
    </div>
  );
}
