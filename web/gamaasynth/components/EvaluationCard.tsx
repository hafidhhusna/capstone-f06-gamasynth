import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface Props {
  score: number;
}

export default function EvaluationCard({ score }: Props) {
  const percent = Math.round(score * 100);

  return (
    <Card className="bg-white border border-gray-200 shadow-md rounded-2xl">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-gray-800">
          Hasil Evaluasi Kemiripan
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Tingkat kemiripan antara suara asli dan hasil sintesis:
          </p>
          <Progress
            value={percent}
            className="h-2 rounded-full bg-gray-200"
          />
          <p className="text-lg font-semibold text-blue-600">{percent}%</p>
        </div>
      </CardContent>
    </Card>
  );
}
