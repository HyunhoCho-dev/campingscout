import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import type { PlanResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    changes: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
    packing: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 8 },
  },
  required: ["summary", "changes", "packing"],
};

export async function POST(request: NextRequest) {
  const payload = await request.json() as Record<string, unknown> & { command?: unknown };
  if (!payload.command || typeof payload.command !== "string") return NextResponse.json({ error: "A planning request is required" }, { status: 400 });
  if (payload.command.length > 1000) return NextResponse.json({ error: "Planning request is too long" }, { status: 413 });

  if (!process.env.OPENAI_API_KEY) return NextResponse.json(demoPlan(payload.command));

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6",
      instructions: "You are CampingScout, a cautious camping trip planning engine. Use only the supplied facts. Never invent campground policies, availability, weather, or safety claims. Distinguish preferences from hard constraints. Give specific concise changes and a packing list. Do not claim a trip is safe; tell users to verify official alerts and operator policies.",
      input: JSON.stringify(payload),
      text: { format: { type: "json_schema", name: "camping_plan", strict: true, schema } },
    });
    const parsed = JSON.parse(response.output_text);
    return NextResponse.json({ ...parsed, source: "gpt-5.6" } satisfies PlanResponse);
  } catch (error) {
    console.error("GPT-5.6 planning failed", error);
    return NextResponse.json(demoPlan(payload.command));
  }
}

function demoPlan(command: string): PlanResponse {
  return {
    source: "demo",
    summary: `Scout interpreted “${command.slice(0, 90)}” and prepared a reliable preview using the current trip facts. Add OPENAI_API_KEY to enable live GPT-5.6 reasoning.`,
    changes: ["Kept dog-friendly camps with essential facilities", "Preserved the three-hour maximum drive time", "Flagged the sleeping-bag temperature mismatch for review"],
    packing: ["Warm sleeping bag or liner", "Rain shell", "Headlamp", "Dog lead and bowl", "Offline map", "Water for the full party"],
  };
}
