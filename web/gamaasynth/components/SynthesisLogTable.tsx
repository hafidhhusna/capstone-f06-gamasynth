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
  // attack: number;
  // decay: number;
  // noise: number;
  audioUrl: string;
  // noisems?: number;
  // add_partials?: number;
  // bp_bw?: number;
  // secondary_mod_ratio?: number;
  // detune_step?: number;
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
          {/* <TableHead>Source</TableHead> */}
          <TableHead>Fc</TableHead>
          <TableHead>Fm</TableHead>
          <TableHead>Index</TableHead>
          <TableHead>Attack</TableHead>
          <TableHead>Decay</TableHead>
          <TableHead>Noise</TableHead>
          <TableHead>Additional Partials</TableHead>
          <TableHead>Bandpass Bandwidth</TableHead>
          <TableHead>Secondary Modulator Ratio</TableHead>
          <TableHead>Detune Step</TableHead>
          <TableHead>Play</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {log.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>{entry.id}</TableCell>
            <TableCell>{entry.fileName}</TableCell>
            {/* <TableCell>{entry.source}</TableCell> */}
            <TableCell>{entry.fc}</TableCell>
            <TableCell>{entry.fm}</TableCell>
            <TableCell>{entry.index}</TableCell>
            {/* <TableCell>{entry.attack}</TableCell>
            <TableCell>{entry.decay}</TableCell>
            <TableCell>{entry.noise}</TableCell>
            <TableCell>{entry.add_partials}</TableCell>
            <TableCell>{entry.bp_bw}</TableCell>
            <TableCell>{entry.secondary_mod_ratio}</TableCell>
            <TableCell>{entry.detune_step}</TableCell>
            <TableCell>
              {onPlay && <Button size="sm" onClick={() => onPlay(entry.audioUrl)}>Play</Button>}
            </TableCell> */}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
