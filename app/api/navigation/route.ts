import { NextRequest, NextResponse } from "next/server";
import type { LineString, Polygon } from "geojson";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { origin, destination, minutes = 120 } = await request.json() as { origin?: unknown; destination?: unknown; minutes?: number };
  if (!validCoordinate(origin) || !validCoordinate(destination)) return NextResponse.json({ error: "Valid origin and destination are required" }, { status: 400 });
  const safeMinutes = Math.max(15, Math.min(240, Number(minutes) || 120));
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return NextResponse.json(await fetchOsrmOrFallback(origin, destination, safeMinutes));
  try {
    const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;
    const isochroneUrl = `https://api.mapbox.com/isochrone/v1/mapbox/driving/${origin[0]},${origin[1]}?contours_minutes=${safeMinutes}&polygons=true&access_token=${encodeURIComponent(token)}`;
    const [directionsResponse, isochroneResponse] = await Promise.all([fetch(directionsUrl), fetch(isochroneUrl)]);
    if (!directionsResponse.ok || !isochroneResponse.ok) throw new Error("Mapbox navigation failed");
    const [directions, isochrone] = await Promise.all([directionsResponse.json(), isochroneResponse.json()]) as [{ routes?: Array<{ geometry: LineString; distance: number; duration: number }> }, { features?: Array<{ geometry: Polygon }> }];
    const route = directions.routes?.[0];
    return NextResponse.json({ route: route?.geometry, distanceKm: route ? Math.round(route.distance / 1000) : null, driveMinutes: route ? Math.round(route.duration / 60) : null, reach: isochrone.features?.[0]?.geometry, source: "mapbox", live: true });
  } catch (error) {
    console.error("Mapbox navigation failed", error);
    return NextResponse.json(await fetchOsrmOrFallback(origin, destination, safeMinutes));
  }
}

async function fetchOsrmOrFallback(origin: [number, number], destination: [number, number], minutes: number) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?overview=full&geometries=geojson`;
    const response = await fetch(url, { headers: { "User-Agent": "CampingScout/1.0" }, next: { revalidate: 3600 } });
    if (!response.ok) throw new Error(`OSRM returned ${response.status}`);
    const data = await response.json() as { code?: string; routes?: Array<{ geometry: LineString; distance: number; duration: number }> };
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) throw new Error("OSRM returned no route");
    return { route: route.geometry, distanceKm: Math.round(route.distance / 1000), driveMinutes: Math.round(route.duration / 60), reach: null, source: "OSRM / OpenStreetMap", live: true };
  } catch (error) {
    console.error("OSRM navigation failed", error);
    return fallbackNavigation(origin, destination, minutes);
  }
}

function validCoordinate(value: unknown): value is [number, number] { return Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90; }
function fallbackNavigation(origin: [number, number], destination: [number, number], minutes: number) { return { route: { type: "LineString", coordinates: [origin, [(origin[0] + destination[0]) / 2, (origin[1] + destination[1]) / 2], destination] }, reach: null, driveMinutes: Math.round(minutes), distanceKm: null, source: "temporary estimate", live: false }; }
