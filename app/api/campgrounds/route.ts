import { NextRequest, NextResponse } from "next/server";
import { campgrounds } from "@/lib/campgrounds";
import type { Campground } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const serviceKey = process.env.GOCAMPING_SERVICE_KEY;
  if (!serviceKey) return NextResponse.json({ camps: campgrounds, source: "curated-demo", live: false });

  try {
    const latitude = request.nextUrl.searchParams.get("latitude") || "37.5665";
    const longitude = request.nextUrl.searchParams.get("longitude") || "126.978";
    const radius = String(Math.max(1000, Math.min(200000, Number(request.nextUrl.searchParams.get("radius")) || 200000)));
    const url = new URL("https://apis.data.go.kr/B551011/GoCamping/locationBasedList");
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("mapX", longitude);
    url.searchParams.set("mapY", latitude);
    url.searchParams.set("radius", radius);
    url.searchParams.set("numOfRows", "40");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("MobileOS", "ETC");
    url.searchParams.set("MobileApp", "CampingScout");
    url.searchParams.set("_type", "json");
    const response = await fetch(url, { next: { revalidate: 3600 } });
    if (!response.ok) throw new Error(`GoCamping returned ${response.status}`);
    const payload = await response.json() as { response?: { body?: { items?: { item?: Record<string, string> | Record<string, string>[] } } } };
    const rawItems = payload?.response?.body?.items?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    const camps = items.map(normalizeCamp).filter((camp: Campground | null): camp is Campground => Boolean(camp));
    if (!camps.length) throw new Error("No usable campground records");
    return NextResponse.json({ camps, source: "Korea Tourism Organization GoCamping", live: true });
  } catch (error) {
    console.error("GoCamping lookup failed", error);
    return NextResponse.json({ camps: campgrounds, source: "curated-demo-fallback", live: false });
  }
}

function normalizeCamp(item: Record<string, string>, index: number): Campground | null {
  const longitude = Number(item.mapX);
  const latitude = Number(item.mapY);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const distanceKm = Number(item.dist || 0) / 1000;
  const facilities = String(item.sbrsCl || "Toilet, Water").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 4);
  return {
    id: `gocamping-${item.contentId || index}`,
    name: item.facltNm || "Korea campground",
    area: item.addr1 || item.doNm || "Korea",
    landscape: [item.lctCl, item.induty].filter(Boolean).join(" · ") || "Outdoor campground",
    coordinates: [longitude, latitude],
    score: Math.max(70, Math.round(94 - Math.min(distanceKm, 200) / 10)),
    driveMinutes: Math.max(45, Math.round(distanceKm * 1.3)),
    distanceKm: Math.round(distanceKm),
    price: 70000,
    highC: 15,
    lowC: 8,
    rainChance: 20,
    gustKph: 20,
    facilities,
    dogFriendly: /가능|가능\(소형견\)/.test(item.animalCmgCl || ""),
    status: index === 0 ? "best" : index === 1 ? "safe" : index === 2 ? "wild" : "verify",
    reason: item.intro || "A real campground matching the current map and travel radius.",
    tradeoff: "Price, live availability, and operator policies must be confirmed before departure.",
    image: item.firstImageUrl || "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=1200&q=88",
    source: `GoCamping · ${item.homepage || "official public data"}`,
    checkedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
    quiet: 55 + (index * 7) % 40,
    wild: 45 + (index * 11) % 50,
    bookingUrl: normalizeExternalUrl(item.resveUrl || item.homepage),
  };
}

function normalizeExternalUrl(value?: string) {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined; } catch { return undefined; }
}
