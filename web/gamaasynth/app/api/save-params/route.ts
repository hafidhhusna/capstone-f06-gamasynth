import { NextRequest, NextResponse } from "next/server";
import mqtt from "mqtt";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const params = body.params;
    if (!params) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    // MQTT setup
    const broker = process.env.MQTT_BROKER!;
    const topic = "stm32/upload";

    const client = mqtt.connect(broker, {
      clientId: "nextjs-send-fm-params",
      username: process.env.EMQX_USER || "gamasynth",
      password: process.env.EMQX_PASS || "gamasynth22",
    });

    // Publish FM parameters to STM32
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

    return NextResponse.json({
      status: "ok",
      sent: params,
      mqtt: "delivered"
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to send parameters" },
      { status: 500 }
    );
  }
}
