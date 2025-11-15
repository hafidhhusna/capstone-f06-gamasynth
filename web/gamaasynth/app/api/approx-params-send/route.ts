import { NextRequest, NextResponse } from "next/server";
import FormData from "form-data";
import fetch from "node-fetch";
import mqtt from "mqtt";

// export const config = { api: { bodyParser: false } };

export async function POST(req: NextRequest) {
  try {
    const formDataReq = await req.formData();
    const file = formDataReq.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // --- Baca file langsung sebagai buffer ---
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // --- Kirim ke FastAPI ---
    const formDataPython = new FormData();
    formDataPython.append("file", buffer, { filename: file.name, contentType: file.type });

    const fastapiRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/synthesize/analyze`, {
      method: "POST",
      body: formDataPython as any,
    });

    if (!fastapiRes.ok) throw new Error("Gagal analisis file audio");

    const params = await fastapiRes.json();

    // --- Kirim ke STM32 via MQTT ---
    const broker = process.env.MQTT_BROKER!;
    const topic = "stm32/upload";

    const client = mqtt.connect(broker, {
      clientId: "nextjs-fm-params",
      username: process.env.EMQX_USER || "gamasynth",
      password: process.env.EMQX_PASS || "gamasynth22",
    });

    await new Promise<void>((resolve, reject) => {
      client.on("connect", () => {
        client.publish(topic, JSON.stringify(params), { qos: 1 }, (err) => {
          client.end();
          if (err) reject(err);
          else resolve();
        });
      });
      client.on("error", (err) => reject(err));
    });

    // --- Return ke frontend ---
    return NextResponse.json({ params, mqttStatus: "sent" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process audio" }, { status: 500 });
  }
}
