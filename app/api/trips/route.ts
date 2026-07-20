import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureSchema, getDb } from "@root/db";
import { trips } from "@root/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in with ChatGPT to view saved trips" }, { status: 401 });
  await ensureSchema();
  const records = await getDb().select().from(trips).where(eq(trips.userEmail, user.email)).orderBy(desc(trips.updatedAt)).limit(20);
  return NextResponse.json({ trips: records.map((record) => ({ ...record, data: JSON.parse(record.data) })) });
}

export async function POST(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in with ChatGPT to save and share trips" }, { status: 401 });
  const body = await request.json() as { title?: unknown; data?: unknown };
  if (!body?.data || typeof body.data !== "object") return NextResponse.json({ error: "Trip data is required" }, { status: 400 });
  if (JSON.stringify(body.data).length > 200_000) return NextResponse.json({ error: "Trip payload is too large" }, { status: 413 });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const shareToken = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
  const record = { id, userEmail: user.email, shareToken, title: String(body.title || "CamperLife trip").slice(0, 120), data: JSON.stringify(body.data), createdAt: now, updatedAt: now };
  await ensureSchema();
  await getDb().insert(trips).values(record);
  return NextResponse.json({ trip: { ...record, data: body.data }, shareUrl: `/share/${shareToken}` }, { status: 201 });
}
