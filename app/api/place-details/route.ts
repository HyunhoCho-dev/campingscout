import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get("latitude"));
  const longitude = Number(request.nextUrl.searchParams.get("longitude"));
  const name = String(request.nextUrl.searchParams.get("name") || "").slice(
    0,
    160,
  );
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    return NextResponse.json(
      { error: "Valid coordinates are required" },
      { status: 400 },
    );

  const [reverse, wiki] = await Promise.allSettled([
    reversePlace(latitude, longitude),
    nearbyWikipedia(latitude, longitude, name),
  ]);
  const osm = reverse.status === "fulfilled" ? reverse.value : null;
  const page = wiki.status === "fulfilled" ? wiki.value : null;
  return NextResponse.json(
    {
      name: name || osm?.name || page?.title || "Selected place",
      address: osm?.address || "Address unavailable",
      category: osm?.category || "Place",
      description:
        page?.description ||
        osm?.description ||
        "Live public records do not include a longer description for this place.",
      image: osm?.image || page?.image || null,
      website: osm?.website || page?.url || null,
      phone: osm?.phone || null,
      openingHours: osm?.openingHours || null,
      source:
        [osm?.source, page?.source].filter(Boolean).join(" + ") ||
        "Live map coordinates",
    },
    { headers: { "Cache-Control": "public, max-age=900" } },
  );
}

async function reversePlace(latitude: number, longitude: number) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  Object.entries({
    lat: String(latitude),
    lon: String(longitude),
    format: "jsonv2",
    zoom: "18",
    addressdetails: "1",
    extratags: "1",
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { "User-Agent": "CamperLife/1.0", Accept: "application/json" },
    signal: AbortSignal.timeout(5500),
  });
  if (!response.ok) throw new Error("Place lookup failed");
  const data = (await response.json()) as {
    display_name?: string;
    name?: string;
    type?: string;
    category?: string;
    osm_type?: string;
    osm_id?: number;
    extratags?: Record<string, string>;
  };
  const tags = data.extratags || {};
  return {
    name: data.name,
    address: data.display_name,
    category: data.type || data.category,
    description: tags.description,
    image: safeUrl(tags.image) || commonsImage(tags.wikimedia_commons),
    website: safeUrl(tags.website || tags["contact:website"]),
    phone: tags.phone || tags["contact:phone"],
    openingHours: tags.opening_hours,
    source: data.osm_id
      ? `OpenStreetMap ${data.osm_type || "object"} ${data.osm_id}`
      : "OpenStreetMap Nominatim",
  };
}

async function nearbyWikipedia(
  latitude: number,
  longitude: number,
  name: string,
) {
  const url = new URL("https://ko.wikipedia.org/w/api.php");
  Object.entries({
    action: "query",
    generator: "geosearch",
    ggsprimary: "all",
    ggsnamespace: "0",
    ggsradius: "6000",
    ggslimit: "10",
    prop: "pageimages|extracts",
    piprop: "thumbnail|original",
    pithumbsize: "900",
    exintro: "1",
    explaintext: "1",
    format: "json",
    origin: "*",
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { "User-Agent": "CamperLife/1.0" },
    signal: AbortSignal.timeout(5500),
  });
  if (!response.ok) throw new Error("Wikipedia lookup failed");
  const data = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          pageid: number;
          title: string;
          extract?: string;
          thumbnail?: { source?: string };
          original?: { source?: string };
        }
      >;
    };
  };
  const pages = Object.values(data.query?.pages || {});
  const normalized = normalize(name);
  const selected = pages.find(
    (page) =>
      normalize(page.title).includes(normalized) ||
      normalized.includes(normalize(page.title)),
  );
  if (!selected) return null;
  return {
    title: selected.title,
    description: selected.extract?.slice(0, 700),
    image: selected.original?.source || selected.thumbnail?.source,
    url: `https://ko.wikipedia.org/?curid=${selected.pageid}`,
    source: `Korean Wikipedia · ${selected.title}`,
  };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}
function safeUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
function commonsImage(value?: string) {
  if (!value || !/^File:/i.test(value)) return undefined;
  return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(value.replace(/^File:/i, ""))}`;
}
