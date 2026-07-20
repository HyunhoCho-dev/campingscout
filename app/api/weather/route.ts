import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get("latitude"));
  const longitude = Number(request.nextUrl.searchParams.get("longitude"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return NextResponse.json({ error: "Valid coordinates are required" }, { status: 400 });

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max");
    url.searchParams.set("timezone", "Asia/Seoul");
    url.searchParams.set("forecast_days", "3");
    const response = await fetch(url, { next: { revalidate: 1800 } });
    if (!response.ok) throw new Error("Weather provider returned an error");
    const data = await response.json() as { daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; wind_gusts_10m_max: number[] } };
    return NextResponse.json({ highC: Math.round(data.daily.temperature_2m_max[0]), lowC: Math.round(data.daily.temperature_2m_min[0]), rainChance: Math.round(data.daily.precipitation_probability_max[0]), gustKph: Math.round(data.daily.wind_gusts_10m_max[0]), fetchedAt: new Date().toISOString(), live: true });
  } catch {
    return NextResponse.json({ error: "Live weather temporarily unavailable" }, { status: 503 });
  }
}
