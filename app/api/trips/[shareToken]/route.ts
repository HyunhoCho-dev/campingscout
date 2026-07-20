import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@root/db";
import { trips } from "@root/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = await params;
  await ensureSchema();
  const [record] = await getDb().select().from(trips).where(eq(trips.shareToken, shareToken)).limit(1);
  if (!record) return NextResponse.json({ error: "Shared trip not found" }, { status: 404 });
  return NextResponse.json({ trip: { ...record, userEmail: undefined, data: JSON.parse(record.data) } });
}
