"use client";

import { useState } from "react";
import WaveformViewer from "./WaveFormViewer";
import { SynthesisLogEntry } from "./SynthesisLogTable";

interface Props {
  logs: SynthesisLogEntry[];
}

export default function SynthTabs({ logs }: Props) {
  const [activeSource, setActiveSource] = useState<"STM32" | "Python">("Python");

  const filteredLog = logs.filter((l) => l.source === activeSource);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          className={`px-4 py-2 rounded ${activeSource === "Python" ? "bg-blue-600 text-white" : "bg-gray-200"}`}
          onClick={() => setActiveSource("Python")}
        >
          Python
        </button>
        <button
          className={`px-4 py-2 rounded ${activeSource === "STM32" ? "bg-blue-600 text-white" : "bg-gray-200"}`}
          onClick={() => setActiveSource("STM32")}
        >
          STM32
        </button>
      </div>

      <div className="space-y-4">
        {filteredLog.map((entry) => (
          <WaveformViewer key={entry.id} url={entry.audioUrl} label={`${entry.fileName} (${entry.source})`} />
        ))}
      </div>
    </div>
  );
}