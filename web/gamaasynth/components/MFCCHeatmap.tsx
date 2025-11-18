"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  data: number[][]; // Matriks 2D: [n_mfcc, time_frames]
  title?: string;
}

export default function MFCCHeatmap({ data, title = "MFCC Spectrogram" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // State untuk menyimpan data tooltip saat hover
  const [hoverInfo, setHoverInfo] = useState<{ 
    frame: number; 
    coeff: number; 
    value: number; 
    x: number; 
    y: number 
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nMfcc = data.length;       // Jumlah baris (Y axis)
    const nFrames = data[0].length;  // Jumlah kolom (X axis)

    // Set ukuran canvas internal agar resolusi tajam 1:1 dengan data
    canvas.width = nFrames;
    canvas.height = nMfcc;

    // Cari Min/Max untuk normalisasi warna
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < nMfcc; i++) {
      for (let j = 0; j < nFrames; j++) {
        const val = data[i][j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }

    // Helper function: Map nilai ke warna (Viridis-like custom)
    const getColor = (value: number) => {
      const t = (value - min) / (max - min || 1); // Normalisasi 0 - 1
      
      // Skema Warna: Biru Gelap (Rendah) -> Hijau -> Kuning (Tinggi)
      const r = Math.floor(255 * t);
      const g = Math.floor(200 * t + 55 * Math.sin(t * Math.PI));
      const b = Math.floor(255 * (1 - t));
      
      return `rgb(${r},${g},${b})`;
    };

    // Gambar Heatmap pixel demi pixel
    // Kita gambar di canvas offscreen atau langsung pixel manipulation untuk performa jika data sangat besar,
    // tapi untuk MFCC standar (13x500), fillRect masih cukup cepat.
    ctx.clearRect(0, 0, nFrames, nMfcc);
    
    for (let y = 0; y < nMfcc; y++) {
      for (let x = 0; x < nFrames; x++) {
        ctx.fillStyle = getColor(data[y][x]);
        // Note: y di canvas mulai dari atas (0), sedangkan koefisien 0 biasanya di bawah grafik.
        // Kita balik Y-nya: (nMfcc - 1 - y)
        ctx.fillRect(x, nMfcc - 1 - y, 1, 1); 
      }
    }

  }, [data]);

  // Handler: Saat mouse bergerak di atas canvas
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || data.length === 0) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const nMfcc = data.length;
    const nFrames = data[0].length;

    // 1. Hitung posisi mouse relatif terhadap ukuran elemen canvas di layar
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    // 2. Konversi posisi mouse ke indeks array data
    // Rumus: (posisi_mouse / lebar_total_px) * jumlah_total_data
    const frameIndex = Math.floor((clientX / rect.width) * nFrames);
    
    // Untuk Y, ingat kita membalik gambarnya tadi (nMfcc - 1 - y), jadi kita balik lagi logikanya
    const canvasYIndex = Math.floor((clientY / rect.height) * nMfcc);
    const coeffIndex = nMfcc - 1 - canvasYIndex;

    // 3. Ambil nilai data & update state tooltip
    if (
      frameIndex >= 0 && frameIndex < nFrames &&
      coeffIndex >= 0 && coeffIndex < nMfcc
    ) {
      const val = data[coeffIndex][frameIndex];
      
      // Posisi tooltip mengikuti mouse tapi dibatasi container
      setHoverInfo({
        frame: frameIndex,
        coeff: coeffIndex,
        value: val,
        x: clientX, 
        y: clientY
      });
    }
  };

  const handleMouseLeave = () => {
    setHoverInfo(null);
  };

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm w-full relative group">
      <h4 className="text-sm font-semibold text-gray-700 mb-2 flex justify-between items-center">
        {title}
        <span className="text-xs font-normal text-gray-400">Hover untuk detail</span>
      </h4>
      
      {/* Container Relative untuk Canvas & Tooltip */}
      <div className="relative w-full h-40 bg-gray-900 rounded overflow-hidden border border-gray-200 cursor-crosshair">
        <canvas 
          ref={canvasRef} 
          className="w-full h-full" 
          style={{ imageRendering: "pixelated" }} 
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* Tooltip Floating */}
        {hoverInfo && (
          <div 
            className="absolute bg-black/80 text-white text-[10px] p-2 rounded pointer-events-none shadow-lg border border-white/10 z-10"
            style={{
              left: Math.min(hoverInfo.x + 15, 1000), // Prevent overflow right (simple logic)
              top: Math.min(hoverInfo.y + 15, 120),   // Prevent overflow bottom
            }}
          >
            <div className="font-bold text-yellow-400 mb-1">Value: {hoverInfo.value.toFixed(4)}</div>
            <div className="grid grid-cols-2 gap-x-3 text-gray-300">
              <span>Frame:</span> <span>{hoverInfo.frame}</span>
              <span>Coeff:</span> <span>{hoverInfo.coeff}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between text-xs text-gray-500 mt-2 px-1 font-mono">
        <span>Time Frames (0 → {data && data.length > 0 ? data[0].length : 0})</span>
        <span>Coefficients (0 → {data ? data.length : 0})</span>
      </div>
    </div>
  );
}