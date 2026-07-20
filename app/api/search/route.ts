import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { searchCampgrounds } from "../campgrounds/route";
import { openRouter, temporaryKey } from "../plan/route";
import type { Campground, PlanResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
const MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";

type SearchIntent = {
  querySummary: string;
  quiet: number;
  wild: number;
  maxDriveMinutes: number;
  budget: number;
  dogFriendly: boolean;
  requiredFacilities: string[];
};

export async function POST(request: NextRequest) {
  const payload = await request.json() as Record<string, unknown> & {
    command?: unknown;
    trip?: { origin?: unknown; maxDriveMinutes?: unknown; budget?: unknown; startDate?: unknown; endDate?: unknown };
    preference?: { quiet?: unknown; wild?: unknown };
  };
  const origin = payload.trip?.origin;
  if (!validCoordinate(origin)) return NextResponse.json({ error: "A valid trip origin is required" }, { status: 400 });
  const apiKey = temporaryKey(request) || process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OpenRouter is not configured" }, { status: 503 });

  try {
    const client = openRouter(apiKey);
    const intent = validateIntent(await completeJson(client, [
      { role: "system", content: "You are CampingScout's search controller. Translate the traveler, profile, trip settings, and request into strict JSON search constraints. Do not invent facts." },
      { role: "user", content: `Return JSON with querySummary, quiet (0-100), wild (0-100), maxDriveMinutes (15-240), budget (KRW integer), dogFriendly (boolean), requiredFacilities (string array). Preserve explicit UI values unless the request changes them. Infer dogFriendly from the party/profile when a dog is present. Input:\n${JSON.stringify(payload)}` },
    ]), payload);

    const radius = Math.min(200000, Math.max(50000, intent.maxDriveMinutes * 1300));
    const factual = await searchCampgrounds(origin[1], origin[0], radius);
    if (!factual.camps.length) return NextResponse.json({ error: "No live campground records were found for this search area", source: factual.source }, { status: 404 });

    const routed = await enrichRoutes(origin, factual.camps.slice(0, 60));
    const withinDrive = routed.filter((camp) => !camp.driveMinutes || camp.driveMinutes <= intent.maxDriveMinutes + 15);
    const candidates = (withinDrive.length >= 8 ? withinDrive : routed).slice(0, 40);
    const weatherEnriched = await enrichWeather(candidates, String(payload.trip?.startDate || ""), String(payload.trip?.endDate || ""));
    const candidateFacts = weatherEnriched.map((camp) => ({
      id: camp.id, name: camp.name, area: camp.area, landscape: camp.landscape,
      driveMinutes: camp.driveMinutes || null, distanceKm: camp.distanceKm || null, price: camp.price || null,
      facilities: camp.facilities, dogFriendly: camp.dogFriendly, highC: camp.highC || null, lowC: camp.lowC || null,
      rainChance: camp.rainChance || null, gustKph: camp.gustKph || null, bookingUrl: camp.bookingUrl || null, source: camp.source,
      dataCompleteness: (camp.name && !/^Campground \d+$/i.test(camp.name) ? 1 : 0) + (camp.area !== "Korea" ? 1 : 0) + (camp.facilities[0] !== "Verify facilities" ? 1 : 0) + (camp.bookingUrl ? 1 : 0) + (camp.dogFriendly !== null ? 1 : 0),
    }));
    const rawPlan = await completeJson(client, [
      { role: "system", content: "You are CampingScout, an evidence-aware camping search ranker and trip planner. Use only the supplied live candidates, road metrics, weather, profile, and trip facts. Never invent policies, prices, availability, facilities, weather, or routes. Unknown pet policy is not proof of dog friendliness. Respond in Korean when the request is Korean." },
      { role: "user", content: `Rank the factual candidates for this exact traveler and build a trip plan. Return strict JSON with summary, changes (2-5 strings), packing (3-8 strings), search (the supplied intent fields), rankedCampIds (candidate IDs only, best first), recommendations (top 12 objects: id, score 0-100, reason, tradeoff, quiet 0-100, wild 0-100), and itinerary (3-6 objects: time, title, detail). Make every explanation traceable to supplied facts and say what needs operator verification. Strongly prefer identifiable operator records with higher dataCompleteness; do not rank an anonymous, oddly named, or unverifiable record above a complete record merely because it is closer.\nSearch intent:${JSON.stringify(intent)}\nTraveler input:${JSON.stringify(payload)}\nLive candidate facts:${JSON.stringify(candidateFacts)}` },
    ]);
    const plan = validateSearchPlan(rawPlan, intent, new Set(weatherEnriched.map((camp) => camp.id)));
    const recommendationMap = new Map(plan.recommendations?.map((item) => [item.id, item]) || []);
    const rankMap = new Map(plan.rankedCampIds?.map((id, index) => [id, index]) || []);
    const rankedCamps = weatherEnriched.map((camp) => {
      const recommendation = recommendationMap.get(camp.id); const rank = rankMap.get(camp.id);
      return {
        ...camp,
        score: recommendation?.score ?? camp.score,
        quiet: recommendation?.quiet ?? camp.quiet,
        wild: recommendation?.wild ?? camp.wild,
        reason: recommendation?.reason ?? camp.reason,
        tradeoff: recommendation?.tradeoff ?? camp.tradeoff,
        status: rank === 0 ? "best" as const : rank === 1 ? "safe" as const : rank === 2 ? "wild" as const : "verify" as const,
      };
    }).sort((a, b) => (rankMap.get(a.id) ?? 999) - (rankMap.get(b.id) ?? 999));

    return NextResponse.json({
      camps: rankedCamps,
      plan: { ...plan, source: "deepseek-v4-flash", model: MODEL } satisfies PlanResponse,
      source: `${factual.source} + OSRM road matrix + live weather + DeepSeek ranking`,
      counts: { discovered: factual.camps.length, routed: routed.filter((camp) => camp.driveMinutes > 0).length, weather: weatherEnriched.filter((camp) => camp.lowC || camp.highC).length, ranked: plan.rankedCampIds?.length || 0 },
      live: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof OpenAI.APIError && [401, 402, 403, 429].includes(error.status) ? error.status : 502;
    const message = error instanceof Error ? error.message : "AI campground search failed";
    return NextResponse.json({ error: message.slice(0, 240), model: MODEL }, { status });
  }
}

async function completeJson(client: OpenAI, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  let completion = await client.chat.completions.create({ model: MODEL, messages, response_format: { type: "json_object" }, temperature: 0.15, max_tokens: 2600 });
  let content = completion.choices[0]?.message?.content || "";
  try { return parseJson(content); } catch {
    completion = await client.chat.completions.create({ model: MODEL, messages: [...messages, { role: "assistant", content }, { role: "user", content: "Return the same result again as one complete strict JSON object only. No markdown or reasoning." }], response_format: { type: "json_object" }, temperature: 0, max_tokens: 3200 });
    content = completion.choices[0]?.message?.content || "";
    return parseJson(content);
  }
}

async function enrichRoutes(origin: [number, number], camps: Campground[]) {
  try {
    const coordinates = [origin, ...camps.map((camp) => camp.coordinates)].map((item) => `${item[0]},${item[1]}`).join(";");
    const response = await fetch(`https://router.project-osrm.org/table/v1/driving/${coordinates}?sources=0&annotations=duration,distance`, { headers: { "User-Agent": "CampingScout/1.0" }, signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`OSRM table returned ${response.status}`);
    const data = await response.json() as { code?: string; durations?: Array<Array<number | null>>; distances?: Array<Array<number | null>> };
    if (data.code !== "Ok") throw new Error("OSRM table did not return routes");
    return camps.map((camp, index) => ({ ...camp, driveMinutes: data.durations?.[0]?.[index + 1] ? Math.round(data.durations[0][index + 1]! / 60) : 0, distanceKm: data.distances?.[0]?.[index + 1] ? Math.round(data.distances[0][index + 1]! / 1000) : camp.distanceKm }));
  } catch (error) {
    console.error("Road matrix enrichment failed", error);
    return camps;
  }
}

async function enrichWeather(camps: Campground[], startDate: string, endDate: string) {
  const enriched = await Promise.all(camps.slice(0, 12).map(async (camp) => {
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", String(camp.coordinates[1])); url.searchParams.set("longitude", String(camp.coordinates[0]));
      url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max"); url.searchParams.set("timezone", "Asia/Seoul");
      if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) { url.searchParams.set("start_date", startDate); url.searchParams.set("end_date", endDate); } else url.searchParams.set("forecast_days", "3");
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
      const data = await response.json() as { daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[]; wind_gusts_10m_max?: number[] } };
      const daily = data.daily; if (!daily?.temperature_2m_max?.length || !daily.temperature_2m_min?.length) throw new Error("Open-Meteo returned no forecast");
      return { ...camp, highC: Math.round(Math.max(...daily.temperature_2m_max)), lowC: Math.round(Math.min(...daily.temperature_2m_min)), rainChance: Math.round(Math.max(...(daily.precipitation_probability_max || [0]))), gustKph: Math.round(Math.max(...(daily.wind_gusts_10m_max || [0]))) };
    } catch { return fetchMetCampWeather(camp, startDate, endDate); }
  }));
  return [...enriched, ...camps.slice(12)];
}

async function fetchMetCampWeather(camp: Campground, startDate: string, endDate: string) {
  try {
    const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
    url.searchParams.set("lat", camp.coordinates[1].toFixed(4)); url.searchParams.set("lon", camp.coordinates[0].toFixed(4));
    const response = await fetch(url, { headers: { "User-Agent": "CampingScout/1.0 https://campingscout-wild.hyunhocho123.chatgpt.site" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return camp;
    const data = await response.json() as { properties?: { timeseries?: Array<{ time: string; data: { instant: { details: { air_temperature?: number; wind_speed?: number; wind_speed_of_gust?: number } }; next_1_hours?: { details?: { probability_of_precipitation?: number; precipitation_amount?: number } } } }> } };
    const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? Date.parse(`${startDate}T00:00:00+09:00`) : Date.now();
    const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? Date.parse(`${endDate}T23:59:59+09:00`) : Date.now() + 72 * 3_600_000;
    const periods = (data.properties?.timeseries || []).filter((item) => { const time = Date.parse(item.time); return time >= start && time <= end; });
    const temperatures = periods.map((item) => item.data.instant.details.air_temperature).filter((value): value is number => Number.isFinite(value));
    if (!temperatures.length) return camp;
    const gusts = periods.map((item) => item.data.instant.details.wind_speed_of_gust ?? item.data.instant.details.wind_speed).filter((value): value is number => Number.isFinite(value));
    const rain = periods.map((item) => item.data.next_1_hours?.details?.probability_of_precipitation).filter((value): value is number => Number.isFinite(value));
    return { ...camp, highC: Math.round(Math.max(...temperatures)), lowC: Math.round(Math.min(...temperatures)), rainChance: rain.length ? Math.round(Math.max(...rain)) : 0, gustKph: gusts.length ? Math.round(Math.max(...gusts) * 3.6) : 0 };
  } catch { return camp; }
}

function validateIntent(value: unknown, payload: { trip?: { maxDriveMinutes?: unknown; budget?: unknown }; preference?: { quiet?: unknown; wild?: unknown } }): SearchIntent {
  if (!value || typeof value !== "object") throw new Error("AI search intent was not valid"); const item = value as Record<string, unknown>;
  return { querySummary: String(item.querySummary || "Personalized campground search").slice(0, 300), quiet: clamp(item.quiet, 0, 100, Number(payload.preference?.quiet) || 50), wild: clamp(item.wild, 0, 100, Number(payload.preference?.wild) || 50), maxDriveMinutes: clamp(item.maxDriveMinutes, 15, 240, Number(payload.trip?.maxDriveMinutes) || 120), budget: clamp(item.budget, 0, 10_000_000, Number(payload.trip?.budget) || 200000), dogFriendly: Boolean(item.dogFriendly), requiredFacilities: Array.isArray(item.requiredFacilities) ? item.requiredFacilities.filter((entry): entry is string => typeof entry === "string").slice(0, 8) : [] };
}

function validateSearchPlan(value: unknown, intent: SearchIntent, validIds: Set<string>): Omit<PlanResponse, "source" | "model"> {
  if (!value || typeof value !== "object") throw new Error("AI ranking was not valid"); const item = value as Record<string, unknown>;
  const rankedCampIds = Array.isArray(item.rankedCampIds) ? item.rankedCampIds.filter((id): id is string => typeof id === "string" && validIds.has(id)) : [];
  if (!rankedCampIds.length) throw new Error("AI did not rank any factual campground candidates");
  const recommendations = Array.isArray(item.recommendations) ? item.recommendations.flatMap((entry) => { if (!entry || typeof entry !== "object") return []; const row = entry as Record<string, unknown>; if (typeof row.id !== "string" || !validIds.has(row.id)) return []; return [{ id: row.id, score: clamp(row.score, 0, 100, 70), reason: String(row.reason || "Matched against the supplied profile").slice(0, 500), tradeoff: String(row.tradeoff || "Confirm unlisted operator policies").slice(0, 400), quiet: clamp(row.quiet, 0, 100, 50), wild: clamp(row.wild, 0, 100, 50) }]; }).slice(0, 12) : [];
  const itinerary = Array.isArray(item.itinerary) ? item.itinerary.flatMap((entry) => { if (!entry || typeof entry !== "object") return []; const row = entry as Record<string, unknown>; return typeof row.time === "string" && typeof row.title === "string" && typeof row.detail === "string" ? [{ time: row.time.slice(0, 40), title: row.title.slice(0, 120), detail: row.detail.slice(0, 240) }] : []; }).slice(0, 6) : [];
  return { summary: String(item.summary || intent.querySummary).slice(0, 1200), changes: Array.isArray(item.changes) ? item.changes.filter((entry): entry is string => typeof entry === "string").slice(0, 5) : [], packing: Array.isArray(item.packing) ? item.packing.filter((entry): entry is string => typeof entry === "string").slice(0, 8) : [], search: intent, rankedCampIds, recommendations, itinerary };
}

function parseJson(content: string) { const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); try { return JSON.parse(cleaned); } catch { const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}"); if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)); throw new Error("The AI response was not valid JSON"); } }
function clamp(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) ? Math.round(Math.max(min, Math.min(max, number))) : fallback; }
function validCoordinate(value: unknown): value is [number, number] { return Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90; }
