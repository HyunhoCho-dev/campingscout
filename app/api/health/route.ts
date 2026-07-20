import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    runtime: "cloudflare-workers",
    integrations: {
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      aiModel: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
      gocamping: Boolean(process.env.GOCAMPING_SERVICE_KEY),
      mapbox: Boolean(process.env.MAPBOX_ACCESS_TOKEN),
      weather: true,
      auth: "sign-in-with-chatgpt",
      database: "d1",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
