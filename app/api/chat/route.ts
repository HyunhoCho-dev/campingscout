import { NextRequest, NextResponse } from "next/server";
import { openRouter, temporaryKey } from "../plan/route";

export const dynamic = "force-dynamic";
const MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    message?: unknown;
    context?: unknown;
  };
  const question =
    typeof payload.message === "string"
      ? payload.message.trim().slice(0, 1200)
      : "";
  if (!question)
    return NextResponse.json({ error: "Enter a question" }, { status: 400 });
  const apiKey = temporaryKey(request) || process.env.OPENROUTER_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "OpenRouter is not configured" },
      { status: 503 },
    );
  try {
    const completion = await withTimeout(
      openRouter(apiKey).chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are CamperLife's conversational camping assistant. Answer the user's question directly and concisely in the same language they used. Use only the supplied current-trip and live-data context. Clearly say when a fact is unknown or must be verified. This endpoint is read-only: do not claim that you changed the trip, itinerary, campground, or route.",
          },
          {
            role: "user",
            content:
              "Question:" +
              question +
              "\nCurrent context:" +
              JSON.stringify(payload.context).slice(0, 24000),
          },
        ],
        temperature: 0.2,
        max_tokens: 800,
      }),
      15_000,
    );
    const answer = completion.choices[0]?.message?.content?.trim();
    if (!answer) throw new Error("The AI returned an empty answer");
    return NextResponse.json(
      { answer, source: "deepseek-v4-flash", model: MODEL },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI answer failed";
    return NextResponse.json(
      { error: message.slice(0, 240), model: MODEL },
      { status: 502 },
    );
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("AI answer timed out")), milliseconds),
    ),
  ]);
}
