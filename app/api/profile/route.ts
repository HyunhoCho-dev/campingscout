import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureSchema, getDb } from "@root/db";
import { profiles } from "@root/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in with ChatGPT to load your profile" }, { status: 401 });
  await ensureSchema();
  const [record] = await getDb().select().from(profiles).where(eq(profiles.userEmail, user.email)).limit(1);
  return NextResponse.json({ profile: record ? JSON.parse(record.data) : null });
}

export async function PUT(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in with ChatGPT to save your profile" }, { status: 401 });
  const body = await request.json() as { profile?: unknown };
  if (!body?.profile || typeof body.profile !== "object") return NextResponse.json({ error: "Profile is required" }, { status: 400 });
  if (JSON.stringify(body.profile).length > 20_000) return NextResponse.json({ error: "Profile is too large" }, { status: 413 });
  const record = { userEmail: user.email, data: JSON.stringify(body.profile), updatedAt: new Date().toISOString() };
  await ensureSchema();
  await getDb().insert(profiles).values(record).onConflictDoUpdate({ target: profiles.userEmail, set: { data: record.data, updatedAt: record.updatedAt } });
  return NextResponse.json({ profile: body.profile, updatedAt: record.updatedAt });
}
