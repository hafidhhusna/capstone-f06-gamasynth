"use client";

import { Button } from "@/components/ui/button";
import AudioUploader from "./AudioUploader";
import { useToast } from "@/hooks/use-toast";

interface Props {
  onUpload: (file: File) => void;
  onAnalyze?: () => void;
  onSynthesize?: () => void;
  disabledAnalyze?: boolean;
  disabledSynth?: boolean;
}

export default function DashboardControls({
  onUpload,
  onAnalyze,
  onSynthesize,
  disabledAnalyze,
  disabledSynth
}: Props) {
  const { toast } = useToast();

  return (
    <div className="space-y-4">
      <AudioUploader onUpload={onUpload} />
      <div className="flex gap-2">
        <Button variant="outline" onClick={onAnalyze} disabled={disabledAnalyze}>Analyze</Button>
        <Button variant="outline" onClick={onSynthesize} disabled={disabledSynth}>Synthesize</Button>
      </div>
    </div>
  );
}
