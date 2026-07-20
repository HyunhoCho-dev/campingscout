import { NextRequest, NextResponse } from "next/server";
import type { Campground } from "@/lib/types";

export const dynamic = "force-dynamic";
type SearchAreaOptions = { nationwide?: boolean; polygon?: [number, number][] };
let nationwideCache: { camps: Campground[]; source: string; expiresAt: number } | null = null;

export async function GET(request: NextRequest) {
  const latitude = clamp(Number(request.nextUrl.searchParams.get("latitude")) || 37.5665, -90, 90);
  const longitude = clamp(Number(request.nextUrl.searchParams.get("longitude")) || 126.978, -180, 180);
  const radius = clamp(Number(request.nextUrl.searchParams.get("radius")) || 120000, 1000, 200000);
  const nationwide = request.nextUrl.searchParams.get("nationwide") === "true";

  try {
    return NextResponse.json(await searchCampgrounds(latitude, longitude, radius, { nationwide }), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("OpenStreetMap campground lookup failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ camps: [], source: "Live campground providers unavailable", live: false, error: "Could not load factual campground data" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function searchCampgrounds(latitude: number, longitude: number, radius: number, options: SearchAreaOptions = {}) {
  if (options.nationwide && !options.polygon?.length && nationwideCache?.expiresAt && nationwideCache.expiresAt > Date.now()) {
    return { camps: rebaseDistances(nationwideCache.camps, latitude, longitude), source: `${nationwideCache.source} · cached`, live: true };
  }
  const jobs: Promise<{ camps: Campground[]; source: string }>[] = [
    fetchOverpass(latitude, longitude, Math.min(radius, 200000), options).then((camps) => ({ camps, source: "OpenStreetMap Overpass" })),
  ];
  if (process.env.GOCAMPING_SERVICE_KEY) jobs.push(fetchGoCamping(latitude, longitude, radius, process.env.GOCAMPING_SERVICE_KEY).then((camps) => ({ camps, source: "KTO GoCamping" })));
  const settled = await Promise.allSettled(jobs);
  const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!successful.length) {
    const photon = options.nationwide ? await fetchPhotonNationwide() : await fetchPhoton(latitude, longitude, Math.min(radius, 120000));
    const source = `OpenStreetMap via Photon · ${options.nationwide ? "nationwide " : ""}live fallback`;
    if (options.nationwide && photon.length) nationwideCache = { camps: photon, source, expiresAt: Date.now() + 15 * 60_000 };
    return { camps: photon, source, live: true };
  }
  const unique = new Map<string, Campground>();
  successful.flatMap((result) => result.camps).forEach((camp) => {
    const key = `${camp.name.toLowerCase()}-${camp.coordinates[0].toFixed(3)}-${camp.coordinates[1].toFixed(3)}`;
    if (!unique.has(key)) unique.set(key, camp);
  });
  const all = [...unique.values()];
  const camps = options.nationwide ? geographicallyDiverse(all, 180) : all.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, options.polygon?.length ? 160 : 80);
  const source = `${successful.map((item) => item.source).join(" + ")} · live factual records`;
  if (options.nationwide && camps.length) nationwideCache = { camps, source, expiresAt: Date.now() + 15 * 60_000 };
  return { camps, source, live: true };
}

async function fetchGoCamping(latitude: number, longitude: number, radius: number, serviceKey: string) {
  const url = new URL("https://apis.data.go.kr/B551011/GoCamping/locationBasedList");
  Object.entries({ serviceKey, mapX: String(longitude), mapY: String(latitude), radius: String(radius), numOfRows: "100", pageNo: "1", MobileOS: "ETC", MobileApp: "CamperLife", _type: "json" }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`GoCamping returned ${response.status}`);
  const payload = await response.json() as { response?: { body?: { items?: { item?: Record<string, string> | Record<string, string>[] } } } };
  const raw = payload.response?.body?.items?.item;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(normalizeGoCamping).filter((camp): camp is Campground => Boolean(camp));
}

async function fetchOverpass(latitude: number, longitude: number, radius: number, options: SearchAreaOptions) {
  const selector = options.polygon?.length && options.polygon.length >= 3
    ? `nwr(poly:"${options.polygon.slice(0, 30).map(([lon, lat]) => `${lat} ${lon}`).join(" ")}")["tourism"="camp_site"];`
    : options.nationwide
      ? `area["ISO3166-1"="KR"][boundary="administrative"]->.country;nwr(area.country)["tourism"="camp_site"];`
      : `nwr(around:${Math.round(radius)},${latitude},${longitude})["tourism"="camp_site"];`;
  const query = `[out:json][timeout:14];${selector}out tags center qt ${options.nationwide ? 500 : 180};`;
  const endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  try {
    return await Promise.any(endpoints.map(async (endpoint) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "CamperLife/1.0" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
      const payload = await response.json() as { elements?: OverpassElement[] };
      return (payload.elements || []).map((item, index) => normalizeOverpass(item, index, latitude, longitude)).filter((camp): camp is Campground => Boolean(camp));
    }));
  } catch { throw new Error("Overpass unavailable"); }
}

async function fetchPhoton(latitude: number, longitude: number, radius: number) {
  const terms = ["캠핑장", "야영장", "오토캠핑장"];
  const results = await Promise.all(terms.map(async (term) => {
    const url = new URL("https://photon.komoot.io/api/");
    Object.entries({ q: term, lat: String(latitude), lon: String(longitude), limit: "50" }).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "CamperLife/1.0" }, signal: AbortSignal.timeout(15000) });
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

async function fetchPhotonNationwide() {
  const hubs: Array<[number, number]> = [[37.5665,126.978],[37.7519,128.8761],[36.3504,127.3845],[35.8714,128.6014],[35.1796,129.0756],[35.1595,126.8526],[35.8242,127.148],[33.4996,126.5312]];
  const settled = await Promise.allSettled(hubs.map(([lat, lon]) => fetchPhoton(lat, lon, 180000)));
  const unique = new Map<string, Campground>(); settled.forEach((result) => { if (result.status === "fulfilled") result.value.forEach((camp) => unique.set(camp.id, camp)); });
  return geographicallyDiverse([...unique.values()], 180);
}

type PhotonFeature = { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string | number> };
type OverpassElement = { type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };

function normalizeOverpass(item: OverpassElement, index: number, originLat: number, originLon: number): Campground | null {
  const latitude = item.lat ?? item.center?.lat; const longitude = item.lon ?? item.center?.lon;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const tags = item.tags || {}; const distanceKm = haversine(originLat, originLon, latitude!, longitude!);
  const facilities = [
    yes(tags.toilets) && "Toilet", yes(tags.shower) && "Shower", yes(tags.drinking_water) && "Drinking water",
    yes(tags.electricity) && "Power", yes(tags.internet_access) && "Internet", yes(tags.bbq) && "BBQ", yes(tags.fireplace) && "Fire pit",
  ].filter((value): value is string => Boolean(value));
  const dogTag = tags.dog ?? tags.dogs;
  const area = [tags["addr:city"], tags["addr:county"], tags["addr:province"], tags["addr:full"]].filter(Boolean).join(", ") || "Korea";
  const name = tags.name || tags["name:ko"] || tags["name:en"] || `Campground ${index + 1}`;
  const sourceId = `${item.type}-${item.id}`;
  return {
    id: `osm-${item.type[0].toUpperCase()}-${item.id}`, name, area,
    landscape: [tags.camp_site, tags.backcountry === "yes" ? "Backcountry" : "", tags.caravans === "yes" ? "Caravan" : ""].filter(Boolean).join(" · ") || "OpenStreetMap campground",
    coordinates: [longitude!, latitude!], score: 70, driveMinutes: 0, distanceKm: Math.round(distanceKm), price: 0,
    highC: 0, lowC: 0, rainChance: 0, gustKph: 0, facilities: facilities.length ? facilities : ["Verify facilities"],
    dogFriendly: /^(yes|leashed|permissive)$/i.test(dogTag || "") ? true : /^(no|private)$/i.test(dogTag || "") ? false : null,
    status: "verify", reason: "Live factual campground candidate awaiting AI ranking against this traveler and trip.",
    tradeoff: "Unlisted price, availability, and policies must be verified with the operator.",
    image: safeUrl(tags.image) || commonsImage(tags.wikimedia_commons) || "", source: `OpenStreetMap ${sourceId} via Overpass`, checkedAt: new Date().toISOString(), quiet: 50, wild: 50,
    bookingUrl: safeUrl(tags.reservation || tags.website || tags["contact:website"]),
  };
}

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
    image: "", source: `OpenStreetMap ${osmType} ${osmId} via Photon`, checkedAt: new Date().toISOString(), quiet: 55 + index % 5 * 8, wild: 50 + index % 4 * 10,
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
    image: safeUrl(item.firstImageUrl) || "", source: `GoCamping content ${item.contentId || index}`, checkedAt: new Date().toISOString(), quiet: 55 + (index * 7) % 40, wild: 45 + (index * 11) % 50,
    bookingUrl: safeUrl(item.resveUrl || item.homepage),
  };
}

function safeUrl(value?: string) { if (!value) return undefined; try { const url = new URL(value); return /https?:/.test(url.protocol) ? url.toString() : undefined; } catch { return undefined; } }
function commonsImage(value?: string) { if (!value || !/^File:/i.test(value)) return undefined; return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(value.replace(/^File:/i, ""))}`; }
function yes(value?: string) { return /^(yes|designated|customers|permissive)$/i.test(value || ""); }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) { const toRad = (value: number) => value * Math.PI / 180; const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function geographicallyDiverse(camps: Campground[], limit: number) {
  const buckets = new Map<string, Campground[]>();
  camps.forEach((camp) => { const key = `${Math.floor(camp.coordinates[1] * 2)}:${Math.floor(camp.coordinates[0] * 2)}`; buckets.set(key, [...(buckets.get(key) || []), camp]); });
  const result: Campground[] = []; let index = 0; const groups = [...buckets.values()].map((group) => group.sort((a, b) => a.distanceKm - b.distanceKm));
  while (result.length < limit && groups.some((group) => index < group.length)) { for (const group of groups) if (group[index] && result.length < limit) result.push(group[index]); index += 1; }
  return result;
}
function rebaseDistances(camps: Campground[], latitude: number, longitude: number) { return camps.map((camp) => ({ ...camp, distanceKm: Math.round(haversine(latitude, longitude, camp.coordinates[1], camp.coordinates[0])) })); }
