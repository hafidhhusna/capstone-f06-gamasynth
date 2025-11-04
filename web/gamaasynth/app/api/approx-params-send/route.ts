import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import FormData from "form-data";
import fetch from "node-fetch";
import mqtt from "mqtt";

export const config = { api: { bodyParser: false } };

export async function POST(req: NextRequest) {
  try {
    // --- 1️⃣ Ambil file dari request ---
    const formDataReq = await req.formData();
    const file = formDataReq.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const tmpPath = `/tmp/upload_${Date.now()}.wav`;
    fs.writeFileSync(tmpPath, Buffer.from(arrayBuffer));

    // --- 2️⃣ Kirim ke Python FastAPI untuk analisis parameter ---
    const formDataPython = new FormData();
    formDataPython.append("file", fs.createReadStream(tmpPath), { filename: "file.wav" });

    const fastapiRes = await fetch("http://localhost:8080/analyze/", {
      method: "POST",
      body: formDataPython as any,
    });

    if (!fastapiRes.ok) throw new Error("Gagal analisis file audio");

    const params = await fastapiRes.json(); // JSON berisi parameter FM

    // --- 3️⃣ Kirim parameter ke STM32 via MQTT ---
    const broker = "mqtt://wff11500.ala.dedicated.aws.emqxcloud.com:1883";
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

    fs.unlinkSync(tmpPath); // hapus file sementara

    // --- 4️⃣ Return parameter JSON ke frontend ---
    return NextResponse.json({ params, mqttStatus: "sent" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process audio" }, { status: 500 });
  }
}
