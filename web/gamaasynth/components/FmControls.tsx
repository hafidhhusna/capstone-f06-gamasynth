"use client";

import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

interface Props {
  params: {
    carrierFreq: number;
    modFreq: number;
    modIndex: number;
    attack: number;
    decay: number;
  };
  setParams: (p: any) => void;
}

export default function FmControls({ params, setParams }: Props) {
  const update = (key: string, val: number) =>
    setParams((prev: any) => ({ ...prev, [key]: val }));

  const control = (
    label: string,
    key: keyof typeof params,
    min: number,
    max: number,
    step = 1
  ) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-gray-700">
        {label}:{" "}
        <span className="text-gray-900 font-semibold">
          {params[key].toFixed(2)}
        </span>
      </Label>
      <Slider
        value={[params[key]]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => update(key, v[0])}
        className="[&>[data-state=on]]:bg-blue-600"
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {control("Carrier Frequency", "carrierFreq", 100, 1000, 10)}
      {control("Modulator Frequency", "modFreq", 100, 1000, 10)}
      {control("Modulation Index", "modIndex", 0, 10, 0.1)}
      {control("Attack", "attack", 0, 1, 0.01)}
      {control("Decay", "decay", 0, 1, 0.01)}
    </div>
  );
}
