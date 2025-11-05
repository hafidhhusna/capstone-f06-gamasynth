"use client";

import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input"; // ✅ Tambahkan input dari shadcn

interface FMParamsFrontend {
  carrierFreq?: number;
  modFreq?: number;
  modIndex?: number;
  attack?: number;
  decay?: number;
  noiseLevel?: number;
}

interface Props {
  params: FMParamsFrontend;
  setParams: (p: FMParamsFrontend) => void;
}

export default function FmControls({ params, setParams }: Props) {
  const update = (key: keyof FMParamsFrontend, val: number) =>
    setParams({ ...params, [key]: val });

  const control = (
    label: string,
    key: keyof FMParamsFrontend,
    min: number,
    max: number,
    step = 1,
    fallback = 0
  ) => {
    const value = params[key] ?? fallback;

    return (
      <div key={key} className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">
          {label}
        </Label>

        <div className="flex items-center gap-3">
          {/* ✅ Slider */}
          <Slider
            value={[value]}
            min={min}
            max={max}
            step={step}
            onValueChange={(v) => update(key, v[0])}
            className="flex-1 [&>[data-state=on]]:bg-blue-600"
          />

          {/* ✅ Input Manual */}
          <Input
            type="number"
            value={value}
            onChange={(e) => {
              const newVal = parseFloat(e.target.value);
              if (!isNaN(newVal)) update(key, newVal);
            }}
            min={min}
            max={max}
            step={step}
            className="w-24 text-right"
          />
        </div>

        <div className="text-xs text-gray-500">
          Range: {min} – {max}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {control("Carrier Frequency", "carrierFreq", 0, 5000, 10, 220)}
      {control("Modulator Frequency", "modFreq", 0, 5000, 10, 440)}
      {control("Modulation Index", "modIndex", 0, 1000, 0.1, 2)}
      {control("Attack", "attack", 0, 10000, 0.01, 0.1)}
      {control("Decay", "decay", 0, 10000, 0.01, 0.5)}
      {control("Noise Level", "noiseLevel", 0, 20, 0.1, 10)}
    </div>
  );
}
