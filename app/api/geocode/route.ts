import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length > 120) return NextResponse.json({ error: "Enter a valid departure place" }, { status: 400 });
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query); url.searchParams.set("limit", "6");
    const response = await fetch(url, { headers: { "User-Agent": "CamperLife/1.0" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
    const data = await response.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, string> }> };
    const places = (data.features || []).flatMap((feature) => {
      const coordinates = feature.geometry?.coordinates; if (!coordinates || feature.properties?.countrycode?.toUpperCase() !== "KR") return [];
      const props = feature.properties || {}; const label = [props.name, props.city, props.county, props.state].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(", ");
      return [{ label: label || query, coordinates }];
    });
    return NextResponse.json({ places, live: true, source: "OpenStreetMap via Photon" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Departure search is temporarily unavailable" }, { status: 503 });
  }
}
