import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import type { PlanResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
const MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";
const SYSTEM_PROMPT = "You are CampingScout, a cautious camping trip planning engine. Use only supplied facts. Never invent campground policies, availability, weather, prices, routes, or safety claims. Distinguish preference from hard constraints. Return concise Korean text when the user's command is Korean, otherwise use the user's language. Always remind the user to verify official alerts and operator policies.";

export async function POST(request: NextRequest) {
  const payload = await request.json() as Record<string, unknown> & { command?: unknown };
  if (!payload.command || typeof payload.command !== "string") return NextResponse.json({ error: "A planning request is required" }, { status: 400 });
  if (payload.command.length > 1000) return NextResponse.json({ error: "Planning request is too long" }, { status: 413 });

  const apiKey = temporaryKey(request) || process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json(demoPlan(payload.command));

  try {
    const client = openRouter(apiKey);
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Act as both a search controller and trip planner. Return one JSON object with exactly these keys: summary (string), changes (array of 2-5 strings), packing (array of 3-8 strings), search (object with quiet 0-100, wild 0-100, maxDriveMinutes 15-240, budget nonnegative integer KRW, dogFriendly boolean, requiredFacilities string array), rankedCampIds (array containing only candidate IDs, best first), itinerary (array of 3-6 objects with time, title, detail strings). Infer filter changes from the user's command, preserve existing values when not requested, and rank only from supplied candidates. Trip facts:\n${JSON.stringify(payload)}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.25,
      max_tokens: 900,
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("The model returned an empty response");
    const parsed = validatePlan(parseJson(content));
    return NextResponse.json({ ...parsed, source: "deepseek-v4-flash", model: completion.model || MODEL } satisfies PlanResponse);
  } catch (error) {
    const status = error instanceof OpenAI.APIError && [401, 402, 403, 429].includes(error.status) ? error.status : 502;
    const message = error instanceof OpenAI.APIError ? error.message : error instanceof Error ? error.message : "OpenRouter request failed";
    return NextResponse.json({ error: safeProviderMessage(status, message), provider: "openrouter", model: MODEL }, { status });
  }
}

export function openRouter(apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://campingscout-wild.hyunhocho123.chatgpt.site",
      "X-OpenRouter-Title": "CampingScout",
    },
  });
}

export function temporaryKey(request: NextRequest) {
  const value = request.headers.get("x-openrouter-key")?.trim();
  return value && value.length <= 500 ? value : undefined;
}

function parseJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function validatePlan(value: unknown): Omit<PlanResponse, "source" | "model"> {
  if (!value || typeof value !== "object") throw new Error("The model response was not a JSON object");
  const item = value as { summary?: unknown; changes?: unknown; packing?: unknown; search?: unknown; rankedCampIds?: unknown; itinerary?: unknown };
  if (typeof item.summary !== "string" || !Array.isArray(item.changes) || !Array.isArray(item.packing)) throw new Error("The model response did not match the plan schema");
  const changes = item.changes.filter((entry): entry is string => typeof entry === "string").slice(0, 5);
  const packing = item.packing.filter((entry): entry is string => typeof entry === "string").slice(0, 8);
  if (changes.length < 2 || packing.length < 3) throw new Error("The model returned an incomplete plan");
  const rawSearch = item.search && typeof item.search === "object" ? item.search as Record<string, unknown> : {};
  const search = {
    quiet: clampNumber(rawSearch.quiet, 0, 100, 50), wild: clampNumber(rawSearch.wild, 0, 100, 50),
    maxDriveMinutes: clampNumber(rawSearch.maxDriveMinutes, 15, 240, 120), budget: clampNumber(rawSearch.budget, 0, 10_000_000, 200000),
    dogFriendly: Boolean(rawSearch.dogFriendly), requiredFacilities: Array.isArray(rawSearch.requiredFacilities) ? rawSearch.requiredFacilities.filter((entry): entry is string => typeof entry === "string").slice(0, 8) : [],
  };
  const rankedCampIds = Array.isArray(item.rankedCampIds) ? item.rankedCampIds.filter((entry): entry is string => typeof entry === "string").slice(0, 40) : [];
  const itinerary = Array.isArray(item.itinerary) ? item.itinerary.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    return typeof row.time === "string" && typeof row.title === "string" && typeof row.detail === "string" ? [{ time: row.time.slice(0, 40), title: row.title.slice(0, 120), detail: row.detail.slice(0, 240) }] : [];
  }).slice(0, 6) : [];
  return { summary: item.summary.slice(0, 1200), changes, packing, search, rankedCampIds, itinerary };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) ? Math.round(Math.max(min, Math.min(max, number))) : fallback; }

function safeProviderMessage(status: number, message: string) {
  if (status === 401) return "OpenRouter API key is invalid or revoked.";
  if (status === 402) return "OpenRouter account has insufficient credits.";
  if (status === 403) return "OpenRouter blocked this request or the key lacks permission.";
  if (status === 429) return "OpenRouter is rate limiting requests. Please try again shortly.";
  return message.slice(0, 240) || "OpenRouter is temporarily unavailable.";
}

function demoPlan(command: string): PlanResponse {
  return {
    source: "demo",
    summary: `Scout interpreted “${command.slice(0, 90)}” in offline preview mode. Connect an OpenRouter key to use DeepSeek V4 Flash.`,
    changes: ["Kept camps matching the stated facilities", "Preserved the selected drive-time constraint", "Flagged gear and weather facts for verification"],
    packing: ["Weather-appropriate sleeping system", "Rain shell", "Headlamp", "Offline map", "Water for the full party"],
  };
}
