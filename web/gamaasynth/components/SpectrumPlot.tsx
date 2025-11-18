"use client";

import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js";

ChartJS.register(
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend
);

export default function SpectrumPlot({
  frequency,
  magnitude,
  title = "FFT Spectrum",
}: {
  frequency: number[];
  magnitude: number[];
  title?: string;
}) {
  if (!frequency || !magnitude) {
    return <p className="text-sm text-muted-foreground">Tidak ada data FFT.</p>;
  }

  const scaledMagnitude = magnitude.map((v) => v / 1e8);

  const data = {
    labels: frequency,
    datasets: [
      {
        label: title + " Scaled (1e8)",
        data: scaledMagnitude,
        borderWidth: 1.2,
        tension: 0.15,
        pointRadius: 0,
        borderColor: "rgba(75, 192, 192, 1)",
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    animation: false,
    scales: {
      x: {
        type: "linear",
        title: { display: true, text: "Frequency (Hz)" },
      },
      y: {
        title: { display: true, text: "Magnitude" },
      },
    },
  };

  return (
    <div className="w-full">
      <Line data={data} options={options} />
    </div>
  );
}
