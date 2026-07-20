import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { openRouter, temporaryKey } from "../../plan/route";

export const dynamic = "force-dynamic";
const MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";

export async function POST(request: NextRequest) {
  const apiKey = temporaryKey(request) || process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Enter an OpenRouter API key first" }, { status: 400 });
  try {
    const result = await openRouter(apiKey).chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "Reply with exactly: CampingScout connected" }],
      max_tokens: 20,
      temperature: 0,
    });
    return NextResponse.json({ connected: true, model: result.model || MODEL, response: result.choices[0]?.message?.content || "Connected" });
  } catch (error) {
    const status = error instanceof OpenAI.APIError && [401, 402, 403, 429].includes(error.status) ? error.status : 502;
    return NextResponse.json({ error: status === 401 ? "Invalid OpenRouter key" : error instanceof Error ? error.message.slice(0, 200) : "Connection failed" }, { status });
  }
}
