// src/components/AudioRecorder.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, StopCircle, AlertTriangle, Radio } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// --- PENGATURAN PEREKAMAN OTOMATIS (Sama) ---
const RECORDING_THRESHOLD = 30; // (0-127)
const SILENCE_DURATION_MS = 500; // 1.5 detik

// --- PENGATURAN WAV ENCODER ---
const BUFFER_SIZE = 4096; // Ukuran buffer untuk ScriptProcessorNode

type AudioRecorderProps = {
  onRecordingComplete: (audioFile: File) => void;
};

const AudioRecorder: React.FC<AudioRecorderProps> = ({ onRecordingComplete }) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs untuk Web Audio API
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // [PERUBAHAN] Refs untuk Perekaman WAV (menggantikan MediaRecorder)
  const scriptProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const rawAudioBufferRef = useRef<Float32Array[]>([]);

  // Refs untuk Logika Perekaman Otomatis (Sama)
  type RecordingState = "IDLE" | "RECORDING";
  const recordingStateRef = useRef<RecordingState>("IDLE");
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fungsi untuk memulai capture
  const startCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
      });

      const context = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const source = context.createMediaStreamSource(stream);

      // [PERUBAHAN] Buat ScriptProcessorNode untuk menangkap data mentah
      // Catatan: Ini deprecated, tapi paling kompatibel dan mudah untuk diimplementasikan
      // (Alternatif modernnya adalah AudioWorklet)
      const scriptProcessorNode = context.createScriptProcessor(
        BUFFER_SIZE,
        1, // 1 channel input (mono)
        1  // 1 channel output (mono)
      );

      // 'onaudioprocess' adalah inti perekam kita
      scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (recordingStateRef.current !== "RECORDING") return;

        // Salin data dari buffer input
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        // Kita perlu *mengkloning* array-nya, karena akan didaur ulang
        rawAudioBufferRef.current.push(new Float32Array(inputData));
      };

      // Hubungkan node
      source.connect(analyser);
      // Hubungkan sumber ke script processor agar 'onaudioprocess' berjalan
      source.connect(scriptProcessorNode);
      // Hubungkan script processor ke 'destination' agar audio tetap berjalan
      scriptProcessorNode.connect(context.destination);

      audioContextRef.current = context;
      analyserRef.current = analyser;
      mediaStreamSourceRef.current = source;
      scriptProcessorNodeRef.current = scriptProcessorNode;

      setIsCapturing(true);
      setError(null);
      recordingStateRef.current = "IDLE";
      draw(); // Mulai visualisasi DAN loop pendeteksi audio
    } catch (err) {
      setError("Gagal mengakses mikrofon. Pastikan izin telah diberikan.");
      console.error(err);
    }
  };

  // Fungsi untuk menghentikan capture
  const stopCapture = () => {
    if (isRecording) {
      stopRecordingInternal(); // Pastikan rekaman juga berhenti
    }

    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // [PERUBAHAN] Putuskan koneksi node perekam
    scriptProcessorNodeRef.current?.disconnect();
    mediaStreamSourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    
    mediaStreamSourceRef.current?.mediaStream
      .getTracks()
      .forEach((track) => track.stop());
    
    audioContextRef.current?.close();

    setIsCapturing(false);
    setIsRecording(false);
    recordingStateRef.current = "IDLE";
    
    // Reset refs
    audioContextRef.current = null;
    analyserRef.current = null;
    mediaStreamSourceRef.current = null;
    scriptProcessorNodeRef.current = null;
    animationFrameIdRef.current = null;
    rawAudioBufferRef.current = [];

    // (Pembersihan canvas sisa dari kode sebelumnya, bisa dihapus jika mau)
  };

  // Fungsi internal untuk MULAI MEREKAM
  const startRecordingInternal = () => {
    rawAudioBufferRef.current = []; // Bersihkan buffer lama
    setIsRecording(true);
    recordingStateRef.current = "RECORDING";
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  };

  // Fungsi internal untuk STOP MEREKAM
  const stopRecordingInternal = () => {
    setIsRecording(false);
    recordingStateRef.current = "IDLE";
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;

    // [PERUBAHAN] Ekspor audio sebagai WAV
    const audioFile = exportWAV(rawAudioBufferRef.current);
    onRecordingComplete(audioFile); // Kirim file .wav asli ke Dashboard
    rawAudioBufferRef.current = []; // Kosongkan memori
  };

  // Fungsi draw (visualisasi + logika perekam otomatis)
  const draw = () => {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;

    const canvasCtx = canvas.getContext("2d");
    if (!canvasCtx) return;

    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    // [PERBAIKAN] Menggunakan warna hardcode untuk menghindari error
    const bgStyle = 'rgb(255, 255, 255)'; // Putih
    const textStyle = 'rgb(0, 0, 0)';     // Hitam

    const drawFrame = () => {
      animationFrameIdRef.current = requestAnimationFrame(drawFrame);
      analyser.getByteTimeDomainData(dataArray);

      // --- LOGIKA VISUALISASI ---
      canvasCtx.fillStyle = bgStyle;
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = textStyle;
      canvasCtx.beginPath();
      const sliceWidth = (canvas.width * 1.0) / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);
        x += sliceWidth;
      }
      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
      
      // --- LOGIKA PEREKAM OTOMATIS (Sama) ---
      let maxDeviation = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = Math.abs(dataArray[i] - 128);
        if (v > maxDeviation) maxDeviation = v;
      }
      const isLoud = maxDeviation > RECORDING_THRESHOLD;

      if (recordingStateRef.current === "IDLE" && isLoud) {
        console.log("Auto-trigger: START");
        startRecordingInternal();
      } else if (recordingStateRef.current === "RECORDING") {
        if (isLoud) {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              console.log("Auto-trigger: STOP (setelah hening)");
              stopRecordingInternal();
            }, SILENCE_DURATION_MS);
          }
        }
      }
    };
    drawFrame();
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (isCapturing) {
        stopCapture();
      }
    };
  }, [isCapturing]);

  // --- [BARU] Kumpulan Fungsi WAV ENCODER ---

  const exportWAV = (buffers: Float32Array[]): File => {
    const pcmData = flattenBuffers(buffers);
    const sampleRate = audioContextRef.current?.sampleRate || 44100;
    const dataView = encodeWAV(pcmData, sampleRate);
    const audioBlob = new Blob([dataView.buffer as ArrayBuffer], { type: "audio/wav" });
    const audioFile = new File([audioBlob], "live_recording.wav", { type: "audio/wav" });
    return audioFile;
  };

  const flattenBuffers = (buffers: Float32Array[]): Float32Array => {
    let totalLength = 0;
    for (const buffer of buffers) {
      totalLength += buffer.length;
    }
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      result.set(buffer, offset);
      offset += buffer.length;
    }
    return result;
  };

  const encodeWAV = (samples: Float32Array, sampleRate: number): DataView => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // Helper
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    const floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
      for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
    };

    // RIFF Header
    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    
    // 'fmt ' chunk
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // Chunk size
    view.setUint16(20, 1, true); // Audio format 1 = PCM
    view.setUint16(22, 1, true); // 1 Channel (Mono)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // 16 bits per sample

    // 'data' chunk
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);

    // Tulis data PCM
    floatTo16BitPCM(view, 44, samples);

    return view;
  };

  // --- Render (Sama persis seperti sebelumnya) ---
  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        onClick={isCapturing ? stopCapture : startCapture}
        variant={isCapturing ? "outline" : "default"}
        className="w-full"
      >
        {isCapturing ? (
          <><StopCircle className="mr-2 h-4 w-4" /> Matikan Mikrofon</>
        ) : (
          <><Mic className="mr-2 h-4 w-4" /> Aktifkan Mikrofon (Live)</>
        )}
      </Button>

      <div className="w-full h-[200px] bg-card rounded-md border border-input">
        <canvas
          ref={canvasRef}
          width="600"
          height="200"
          className="w-full h-full"
        />
      </div>

      <div className="text-center text-sm text-gray-600 h-6">
        {isCapturing && !isRecording && (
          <p className="flex items-center justify-center">
            <Radio className="mr-2 h-4 w-4 text-blue-500 animate-pulse" />
            Menunggu sinyal audio dari STM32...
          </p>
        )}
        {isRecording && (
          <p className="flex items-center justify-center text-destructive font-medium animate-pulse">
            <Radio className="mr-2 h-4 w-4" />
            Merekam sinyal...
          </p>
        )}
        {!isCapturing && (
          <p>Mikrofon tidak aktif.</p>
        )}
      </div>
    </div>
  );
};

export default AudioRecorder;