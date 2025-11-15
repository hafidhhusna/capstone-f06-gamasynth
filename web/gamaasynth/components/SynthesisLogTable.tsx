"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface SynthesisLogEntry {
  id: number;
  fileName: string;
  fc: number;
  fm: number;
  index: number;
}

interface Props {
  log: SynthesisLogEntry[];
}

export default function SynthesisLogTable({ log }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>No</TableHead>
          <TableHead>File</TableHead>
          <TableHead>Fc</TableHead>
          <TableHead>Fm</TableHead>
          <TableHead>Index</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {log.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>{entry.id}</TableCell>
            <TableCell>{entry.fileName}</TableCell>
            <TableCell>{entry.fc}</TableCell>
            <TableCell>{entry.fm}</TableCell>
            <TableCell>{entry.index}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
