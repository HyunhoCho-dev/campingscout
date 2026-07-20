import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get("latitude"));
  const longitude = Number(request.nextUrl.searchParams.get("longitude"));
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      Object.entries({
        lat: String(latitude),
        lon: String(longitude),
        format: "jsonv2",
        zoom: "16",
        addressdetails: "1",
      }).forEach(([key, value]) => url.searchParams.set(key, value));
      const response = await fetch(url, {
        headers: { "User-Agent": "CamperLife/1.0", Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error("Reverse geocoder failed");
      const data = (await response.json()) as {
        display_name?: string;
        name?: string;
        address?: Record<string, string>;
        osm_id?: number;
        osm_type?: string;
      };
      const label =
        data.name ||
        data.address?.tourism ||
        data.address?.amenity ||
        data.address?.road ||
        data.address?.city ||
        data.display_name ||
        `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      return NextResponse.json(
        {
          places: [
            {
              id: `map-${longitude.toFixed(5)}-${latitude.toFixed(5)}`,
              label,
              area: data.display_name || label,
              coordinates: [longitude, latitude],
              source: data.osm_id
                ? `OpenStreetMap ${data.osm_type || "object"} ${data.osm_id}`
                : "OpenStreetMap reverse geocoder",
            },
          ],
          live: true,
          source: "OpenStreetMap Nominatim",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json({
        places: [
          {
            id: `map-${longitude.toFixed(5)}-${latitude.toFixed(5)}`,
            label: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            area: "Map-selected coordinate",
            coordinates: [longitude, latitude],
            source: "Traveler map selection",
          },
        ],
        live: true,
        source: "Coordinate fallback",
      });
    }
  }
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length > 120)
    return NextResponse.json(
      { error: "Enter a valid departure place" },
      { status: 400 },
    );
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "6");
    const response = await fetch(url, {
      headers: { "User-Agent": "CamperLife/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
    const data = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: Record<string, string>;
      }>;
    };
    const places = (data.features || []).flatMap((feature) => {
      const coordinates = feature.geometry?.coordinates;
      if (
        !coordinates ||
        feature.properties?.countrycode?.toUpperCase() !== "KR"
      )
        return [];
      const props = feature.properties || {};
      const label = [props.name, props.city, props.county, props.state]
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(", ");
      return [{ label: label || query, coordinates }];
    });
    return NextResponse.json(
      { places, live: true, source: "OpenStreetMap via Photon" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Departure search is temporarily unavailable" },
      { status: 503 },
    );
  }
}
