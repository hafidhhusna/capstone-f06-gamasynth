"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export interface SynthesisLogEntry {
  id: number;
  fileName: string;
  source: "STM32" | "Python";
  fc: number;
  fm: number;
  index: number;
  attack: number;
  decay: number;
  noise: number;
  audioUrl: string;
}

interface Props {
  log: SynthesisLogEntry[];
  onPlay?: (url: string) => void;
}

export default function SynthesisLogTable({ log, onPlay }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>No</TableHead>
          <TableHead>File</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Fc</TableHead>
          <TableHead>Fm</TableHead>
          <TableHead>Index</TableHead>
          <TableHead>Attack</TableHead>
          <TableHead>Decay</TableHead>
          <TableHead>Noise</TableHead>
          <TableHead>Play</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {log.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>{entry.id}</TableCell>
            <TableCell>{entry.fileName}</TableCell>
            <TableCell>{entry.source}</TableCell>
            <TableCell>{entry.fc}</TableCell>
            <TableCell>{entry.fm}</TableCell>
            <TableCell>{entry.index}</TableCell>
            <TableCell>{entry.attack}</TableCell>
            <TableCell>{entry.decay}</TableCell>
            <TableCell>{entry.noise}</TableCell>
            <TableCell>
              {onPlay && <Button size="sm" onClick={() => onPlay(entry.audioUrl)}>Play</Button>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
