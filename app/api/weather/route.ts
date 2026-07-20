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
  if (start && (daysAhead < -1 || daysAhead > 15)) return NextResponse.json({
    highC: 0, lowC: 0, rainChance: 0, gustKph: 0, fetchedAt: new Date().toISOString(), live: false,
    provider: "Forecast available 15 days before departure",
  }, { headers: { "Cache-Control": "public, max-age=3600" } });

  try {
    return NextResponse.json(await fetchOpenMeteo(latitude, longitude, startDate, endDate, start, end));
  } catch (openMeteoError) {
    console.warn("Open-Meteo weather failed; trying MET Norway", openMeteoError);
    try {
      return NextResponse.json(await fetchMetNorway(latitude, longitude, start, end));
    } catch (metError) {
      console.error("All live weather providers failed", metError);
      return NextResponse.json({ error: "Live weather temporarily unavailable" }, { status: 503 });
    }
  }
}

async function fetchOpenMeteo(latitude: number, longitude: number, startDate: string | null, endDate: string | null, start: Date | null, end: Date | null) {
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
    return { highC: Math.round(Math.max(...data.daily.temperature_2m_max)), lowC: Math.round(Math.min(...data.daily.temperature_2m_min)), rainChance: Math.round(Math.max(...data.daily.precipitation_probability_max)), gustKph: Math.round(Math.max(...data.daily.wind_gusts_10m_max)), fetchedAt: new Date().toISOString(), live: true, provider: "Open-Meteo" };
}

type MetPeriod = {
  time: string;
  data: {
    instant: { details: { air_temperature?: number; wind_speed?: number; wind_speed_of_gust?: number } };
    next_1_hours?: { details?: { precipitation_amount?: number; probability_of_precipitation?: number } };
    next_6_hours?: { details?: { precipitation_amount?: number; probability_of_precipitation?: number } };
  };
};

async function fetchMetNorway(latitude: number, longitude: number, start: Date | null, end: Date | null) {
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
  url.searchParams.set("lat", latitude.toFixed(4));
  url.searchParams.set("lon", longitude.toFixed(4));
  const response = await fetch(url, {
    headers: { "User-Agent": "CamperLife/1.0 https://campingscout-wild.hyunhocho123.chatgpt.site" },
    next: { revalidate: 1800 },
  });
  if (!response.ok) throw new Error(`MET Norway returned ${response.status}`);
  const data = await response.json() as { properties?: { timeseries?: MetPeriod[] } };
  const now = Date.now();
  const windowStart = start ? Math.max(start.getTime(), now - 3_600_000) : now - 3_600_000;
  const windowEnd = end ? Math.min(end.getTime() + 86_400_000, now + 9 * 86_400_000) : now + 72 * 3_600_000;
  const periods = (data.properties?.timeseries || []).filter((period) => {
    const time = Date.parse(period.time);
    return time >= windowStart && time < windowEnd;
  });
  if (!periods.length) throw new Error("MET Norway returned no periods for the selected dates");
  const temperatures = periods.map((period) => period.data.instant.details.air_temperature).filter((value): value is number => Number.isFinite(value));
  const gusts = periods.map((period) => period.data.instant.details.wind_speed_of_gust ?? period.data.instant.details.wind_speed).filter((value): value is number => Number.isFinite(value));
  const rainProbabilities = periods.map((period) => period.data.next_1_hours?.details?.probability_of_precipitation ?? period.data.next_6_hours?.details?.probability_of_precipitation).filter((value): value is number => Number.isFinite(value));
  const precipitation = periods.map((period) => period.data.next_1_hours?.details?.precipitation_amount ?? period.data.next_6_hours?.details?.precipitation_amount ?? 0);
  if (!temperatures.length) throw new Error("MET Norway response did not include temperatures");
  return {
    highC: Math.round(Math.max(...temperatures)),
    lowC: Math.round(Math.min(...temperatures)),
    rainChance: rainProbabilities.length ? Math.round(Math.max(...rainProbabilities)) : (Math.max(...precipitation) > 0 ? 100 : 0),
    gustKph: gusts.length ? Math.round(Math.max(...gusts) * 3.6) : 0,
    fetchedAt: new Date().toISOString(),
    live: true,
    provider: "MET Norway",
  };
}
