import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    runtime: "cloudflare-workers",
    integrations: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gocamping: Boolean(process.env.GOCAMPING_SERVICE_KEY),
      mapbox: Boolean(process.env.MAPBOX_ACCESS_TOKEN),
      weather: true,
      auth: "sign-in-with-chatgpt",
      database: "d1",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
