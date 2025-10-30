import { NextRequest, NextResponse } from "next/server";
import mqtt from "mqtt";

export const runtime = "nodejs";

const CHUNK_SIZE = 50_000; // 50 KB per chunk
const CHUNK_DELAY_MS = 50;  // delay 50ms antar chunk

export async function POST(req: NextRequest) {
  try {
    // Ambil file dari form data
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");

    // Split menjadi chunk
    const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);
    const chunks: string[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(base64Data.length, (i + 1) * CHUNK_SIZE);
      chunks.push(base64Data.slice(start, end));
    }

    console.log(`📦 File dibagi menjadi ${chunks.length} chunk`);

    // Connect ke EMQX broker port 1883 (TCP, non-SSL)
    const client = mqtt.connect("mqtt://wff11500.ala.dedicated.aws.emqxcloud.com:1883", {
      protocolId: "MQTT",
      protocolVersion: 4,
      connectTimeout: 15_000,
      reconnectPeriod: 5000,
      clean: true,
      clientId: "nextjs-uploader-gamasynth",
      username: process.env.EMQX_USER || "gamasynth", // optional
      password: process.env.EMQX_PASS || "gamasynth22", // optional
    });

    // Tunggu koneksi MQTT siap
    await new Promise<void>((resolve, reject) => {
      client.on("connect", () => {
        console.log("✅ MQTT connected");
        resolve();
      });
      client.on("error", (err) => reject(err));
    });

    // Helper delay
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Kirim tiap chunk
    for (let i = 0; i < chunks.length; i++) {
      const payload = JSON.stringify({
        filename: file.name,
        index: i + 1,
        total: totalChunks,
        data: chunks[i],
      });

      await new Promise<void>((resolve, reject) => {
        client.publish("stm32/upload", payload, { qos: 1 }, (err) => {
          if (err) reject(err);
          else {
            console.log(`🚀 Chunk ${i + 1}/${totalChunks} terkirim (${payload.length} bytes)`);
            resolve();
          }
        });
      });

      // Throttle untuk stabilitas
      await delay(CHUNK_DELAY_MS);
    }

    client.end();

    return NextResponse.json({
      message: `Audio "${file.name}" terkirim ke MQTT dalam ${totalChunks} chunk.`,
      chunks: totalChunks,
    });
  } catch (err: any) {
    console.error("❌ MQTT Upload error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to upload audio via MQTT" },
      { status: 500 }
    );
  }
}
