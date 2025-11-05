"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type LogEntry = {
  no: number;
  fileName: string;
  fc: number;
  fm: number;
  index: number;
  attack: number;
  decay: number;
  noise: number;
};

interface SynthesisLogTableProps {
  logs: LogEntry[];
}

export default function SynthesisLogTable({ logs }: SynthesisLogTableProps) {
  if (!logs.length) {
    return (
      <p className="text-sm text-gray-500 italic">
        Belum ada log sintesis yang tersimpan.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
      <Table>
        <TableHeader className="bg-gray-50">
          <TableRow>
            <TableHead>No</TableHead>
            <TableHead>Nama File</TableHead>
            <TableHead>Frekuensi Carrier</TableHead>
            <TableHead>Frekuensi Modulator</TableHead>
            <TableHead>Index</TableHead>
            <TableHead>Attack</TableHead>
            <TableHead>Decay</TableHead>
            <TableHead>Noise</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.no}>
              <TableCell>{log.no}</TableCell>
              <TableCell>{log.fileName}</TableCell>
              <TableCell>{log.fc.toFixed(2)}</TableCell>
              <TableCell>{log.fm.toFixed(2)}</TableCell>
              <TableCell>{log.index.toFixed(2)}</TableCell>
              <TableCell>{log.attack.toFixed(2)}</TableCell>
              <TableCell>{log.decay.toFixed(2)}</TableCell>
              <TableCell>{log.noise.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
