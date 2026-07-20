import { NextRequest, NextResponse } from "next/server";
import type { Campground } from "@/lib/types";

export const dynamic = "force-dynamic";
const REPRESENTATIVE_IMAGE = "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=1200&q=88";

export async function GET(request: NextRequest) {
  const latitude = clamp(Number(request.nextUrl.searchParams.get("latitude")) || 37.5665, -90, 90);
  const longitude = clamp(Number(request.nextUrl.searchParams.get("longitude")) || 126.978, -180, 180);
  const radius = clamp(Number(request.nextUrl.searchParams.get("radius")) || 120000, 1000, 200000);

  if (process.env.GOCAMPING_SERVICE_KEY) {
    try {
      const camps = await fetchGoCamping(latitude, longitude, radius, process.env.GOCAMPING_SERVICE_KEY);
      if (camps.length) return NextResponse.json({ camps, source: "Korea Tourism Organization GoCamping · live public data", live: true });
    } catch (error) { console.error("GoCamping lookup failed; trying OpenStreetMap", error instanceof Error ? error.message : "unknown error"); }
  }

  try {
    const camps = await fetchOpenStreetMap(latitude, longitude, Math.min(radius, 120000));
    if (!camps.length) return NextResponse.json({ camps: [], source: "No real campgrounds found in this radius", live: true });
    return NextResponse.json({ camps, source: "OpenStreetMap via Photon · live community data", live: true });
  } catch (error) {
    console.error("OpenStreetMap campground lookup failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ camps: [], source: "Live campground providers unavailable", live: false, error: "Could not load factual campground data" }, { status: 503 });
  }
}

async function fetchGoCamping(latitude: number, longitude: number, radius: number, serviceKey: string) {
  const url = new URL("https://apis.data.go.kr/B551011/GoCamping/locationBasedList");
  Object.entries({ serviceKey, mapX: String(longitude), mapY: String(latitude), radius: String(radius), numOfRows: "40", pageNo: "1", MobileOS: "ETC", MobileApp: "CampingScout", _type: "json" }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`GoCamping returned ${response.status}`);
  const payload = await response.json() as { response?: { body?: { items?: { item?: Record<string, string> | Record<string, string>[] } } } };
  const raw = payload.response?.body?.items?.item;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(normalizeGoCamping).filter((camp): camp is Campground => Boolean(camp));
}

async function fetchOpenStreetMap(latitude: number, longitude: number, radius: number) {
  const terms = ["캠핑장", "야영장", "오토캠핑장"];
  const results = await Promise.all(terms.map(async (term) => {
    const url = new URL("https://photon.komoot.io/api/");
    Object.entries({ q: term, lat: String(latitude), lon: String(longitude), limit: "50" }).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "CampingScout/1.0" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Photon returned ${response.status}`);
    return (await response.json() as { features?: PhotonFeature[] }).features || [];
  }));
  const unique = new Map<string, PhotonFeature>();
  results.flat().forEach((feature) => {
    const props = feature.properties || {}; const coordinates = feature.geometry?.coordinates;
    if (props.countrycode !== "KR" || props.osm_value !== "camp_site" || !coordinates || haversine(latitude, longitude, coordinates[1], coordinates[0]) > radius / 1000) return;
    unique.set(`${props.osm_type}-${props.osm_id}`, feature);
  });
  return [...unique.values()].map((item, index) => normalizePhoton(item, index, latitude, longitude)).filter((camp): camp is Campground => Boolean(camp));
}

type PhotonFeature = { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string | number> };

function normalizePhoton(item: PhotonFeature, index: number, originLat: number, originLon: number): Campground | null {
  const coordinates = item.geometry?.coordinates; const latitude = coordinates?.[1]; const longitude = coordinates?.[0];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const props = item.properties || {}; const distanceKm = haversine(originLat, originLon, latitude!, longitude!);
  const name = String(props.name || props.street || `Campground ${index + 1}`); const osmId = String(props.osm_id || index); const osmType = String(props.osm_type || "place");
  return {
    id: `osm-${osmType}-${osmId}`, name,
    area: [props.city, props.county, props.state].filter(Boolean).map(String).join(", ") || "Korea",
    landscape: "OpenStreetMap · Campground", coordinates: [longitude!, latitude!], score: Math.max(70, 92 - Math.round(distanceKm / 20)), driveMinutes: Math.max(20, Math.round(distanceKm * 1.45)), distanceKm: Math.round(distanceKm), price: 0,
    highC: 0, lowC: 0, rainChance: 0, gustKph: 0, facilities: ["Verify facilities"], dogFriendly: null,
    status: index === 0 ? "best" : index === 1 ? "safe" : index === 2 ? "wild" : "verify",
    reason: "A real OpenStreetMap campground result. DeepSeek ranks it against your constraints without inventing missing facts.", tradeoff: "Facilities, price, availability, and pet rules are absent from this search record and require operator confirmation.",
    image: REPRESENTATIVE_IMAGE, source: `OpenStreetMap ${osmType} ${osmId} via Photon`, checkedAt: new Date().toISOString(), quiet: 55 + index % 5 * 8, wild: 50 + index % 4 * 10,
  };
}

function normalizeGoCamping(item: Record<string, string>, index: number): Campground | null {
  const longitude = Number(item.mapX); const latitude = Number(item.mapY);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const distanceKm = Number(item.dist || 0) / 1000;
  return {
    id: `gocamping-${item.contentId || index}`, name: item.facltNm || "Korea campground", area: item.addr1 || item.doNm || "Korea",
    landscape: [item.lctCl, item.induty].filter(Boolean).join(" · ") || "Outdoor campground", coordinates: [longitude, latitude],
    score: Math.max(70, Math.round(94 - Math.min(distanceKm, 200) / 10)), driveMinutes: Math.max(30, Math.round(distanceKm * 1.3)), distanceKm: Math.round(distanceKm), price: 0,
    highC: 0, lowC: 0, rainChance: 0, gustKph: 0, facilities: String(item.sbrsCl || "Verify facilities").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 6),
    dogFriendly: /가능/.test(item.animalCmgCl || ""), status: index === 0 ? "best" : index === 1 ? "safe" : index === 2 ? "wild" : "verify",
    reason: item.intro || "A live GoCamping public-data record matching the current search radius.", tradeoff: "Live price, availability, and operator policies must be confirmed.",
    image: safeUrl(item.firstImageUrl) || REPRESENTATIVE_IMAGE, source: `GoCamping content ${item.contentId || index}`, checkedAt: new Date().toISOString(), quiet: 55 + (index * 7) % 40, wild: 45 + (index * 11) % 50,
    bookingUrl: safeUrl(item.resveUrl || item.homepage),
  };
}

function safeUrl(value?: string) { if (!value) return undefined; try { const url = new URL(value); return /https?:/.test(url.protocol) ? url.toString() : undefined; } catch { return undefined; } }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) { const toRad = (value: number) => value * Math.PI / 180; const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
