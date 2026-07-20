import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get("latitude"));
  const longitude = Number(request.nextUrl.searchParams.get("longitude"));
  const startDate = request.nextUrl.searchParams.get("startDate");
  const endDate = request.nextUrl.searchParams.get("endDate");
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return NextResponse.json({ error: "Valid coordinates are required" }, { status: 400 });

  const start = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? new Date(`${startDate}T00:00:00+09:00`) : null;
  const end = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? new Date(`${endDate}T00:00:00+09:00`) : start;
  const daysAhead = start ? Math.ceil((start.getTime() - Date.now()) / 86_400_000) : 0;
  if (start && (daysAhead < -1 || daysAhead > 15)) return NextResponse.json({ error: "Selected dates are outside the reliable live forecast window", live: false }, { status: 422 });

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max");
    url.searchParams.set("timezone", "Asia/Seoul");
    if (startDate && endDate && start && end) {
      url.searchParams.set("start_date", startDate);
      url.searchParams.set("end_date", new Date(Math.min(end.getTime(), start.getTime() + 4 * 86_400_000)).toISOString().slice(0, 10));
    } else url.searchParams.set("forecast_days", "3");
    const response = await fetch(url, { next: { revalidate: 1800 } });
    if (!response.ok) throw new Error("Weather provider returned an error");
    const data = await response.json() as { daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; wind_gusts_10m_max: number[] } };
    return NextResponse.json({ highC: Math.round(Math.max(...data.daily.temperature_2m_max)), lowC: Math.round(Math.min(...data.daily.temperature_2m_min)), rainChance: Math.round(Math.max(...data.daily.precipitation_probability_max)), gustKph: Math.round(Math.max(...data.daily.wind_gusts_10m_max)), fetchedAt: new Date().toISOString(), live: true });
  } catch {
    return NextResponse.json({ error: "Live weather temporarily unavailable" }, { status: 503 });
  }
}
