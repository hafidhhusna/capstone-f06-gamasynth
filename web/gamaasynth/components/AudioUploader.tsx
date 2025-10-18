"use client";

import { Input } from "@/components/ui/input";
import { useRef } from "react";

interface Props {
  onUpload: (file: File) => void;
}

export default function AudioUploader({ onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-700">
        Unggah file audio (.wav, .mp3)
      </label>
      <Input
        type="file"
        accept="audio/*"
        ref={inputRef}
        onChange={handleChange}
        className="cursor-pointer border-gray-300 hover:border-blue-500 transition"
      />
    </div>
  );
}
