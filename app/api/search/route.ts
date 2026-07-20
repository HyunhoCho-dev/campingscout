import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { searchCampgrounds } from "../campgrounds/route";
import { openRouter, temporaryKey } from "../plan/route";
import type {
  Campground,
  MapPlace,
  PlanResponse,
  RouteStop,
} from "@/lib/types";

export const dynamic = "force-dynamic";
const MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";

type SearchIntent = {
  querySummary: string;
  quiet: number;
  wild: number;
  maxDriveMinutes: number;
  budget: number;
  dogFriendly: boolean;
  requiredFacilities: string[];
  travelers: number;
  experience: string;
  vehicle: string;
  sleepingBagComfortC: number;
  days: number;
  nights: number;
};

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as Record<string, unknown> & {
    command?: unknown;
    candidateSnapshot?: unknown;
    requiredStops?: unknown;
    searchArea?: unknown;
    trip?: {
      origin?: unknown;
      maxDriveMinutes?: unknown;
      budget?: unknown;
      startDate?: unknown;
      endDate?: unknown;
      scope?: unknown;
    };
    preference?: { quiet?: unknown; wild?: unknown };
  };
  const origin = payload.trip?.origin;
  if (!validCoordinate(origin))
    return NextResponse.json(
      { error: "A valid trip origin is required" },
      { status: 400 },
    );
  const apiKey = temporaryKey(request) || process.env.OPENROUTER_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "OpenRouter is not configured" },
      { status: 503 },
    );

  try {
    const client = openRouter(apiKey);
    const preliminaryDrive = clamp(payload.trip?.maxDriveMinutes, 15, 480, 120);
    const preliminaryRadius = Math.min(
      200000,
      Math.max(50000, preliminaryDrive * 1300),
    );
    const polygon = validPolygon(payload.searchArea)
      ? payload.searchArea
      : undefined;
    const nationwide = payload.trip?.scope === "nationwide" && !polygon;
    const selectedCampId =
      typeof payload.selectedCampId === "string"
        ? payload.selectedCampId
        : undefined;
    const snapshot = validCampSnapshot(payload.candidateSnapshot);
    const scopedSnapshot = polygon
      ? snapshot.filter((camp) => pointInPolygon(camp.coordinates, polygon))
      : snapshot;
    const commandStop = inferCommandPlace(String(payload.command || ""));
    const requiredStops = dedupeMapPlaces([
      ...validRequiredStops(payload.requiredStops),
      ...(commandStop ? [commandStop] : []),
    ]);
    let factual = scopedSnapshot.length
      ? {
          camps: scopedSnapshot,
          source: polygon
            ? "Live campground snapshot filtered to the drawn area"
            : "Recent live campground snapshot",
          live: true,
        }
      : await searchCampgrounds(origin[1], origin[0], preliminaryRadius, {
          nationwide,
          polygon,
        });
    const missingRequiredRegion =
      !polygon &&
      requiredStops.find(
        (stop) =>
          !factual.camps.some(
            (camp) =>
              haversine(
                camp.coordinates[1],
                camp.coordinates[0],
                stop.coordinates[1],
                stop.coordinates[0],
              ) <= 120,
          ),
      );
    if (missingRequiredRegion) {
      const local = await searchCampgrounds(
        missingRequiredRegion.coordinates[1],
        missingRequiredRegion.coordinates[0],
        120000,
      );
      factual = {
        camps: mergeCamps(factual.camps, local.camps),
        source: `${factual.source} + required-region live search`,
        live: true,
      };
    }
    const intent = intentFromInput(payload);
    if (!factual.camps.length)
      return NextResponse.json(
        {
          error: "No live campground records were found for this search area",
          source: factual.source,
        },
        { status: 404 },
      );

    const constraintRanked = requiredStops.length
      ? prioritizeByRequiredStops(factual.camps, requiredStops)
      : factual.camps;
    const baseTargets = requiredStops.length
      ? constraintRanked.slice(0, 10)
      : nationwide
        ? geographicallyDiverse(factual.camps, 10)
        : [...factual.camps]
            .sort(
              (a, b) =>
                haversine(
                  origin[1],
                  origin[0],
                  a.coordinates[1],
                  a.coordinates[0],
                ) -
                haversine(
                  origin[1],
                  origin[0],
                  b.coordinates[1],
                  b.coordinates[0],
                ),
            )
            .slice(0, 10);
    const selectedTarget = selectedCampId
      ? factual.camps.find((camp) => camp.id === selectedCampId)
      : undefined;
    const routeTargets = selectedTarget
      ? [
          selectedTarget,
          ...baseTargets.filter((camp) => camp.id !== selectedTarget.id),
        ].slice(0, 10)
      : baseTargets;
    const nearbyTargets = (
      selectedTarget
        ? [
            selectedTarget,
            ...baseTargets.filter((camp) => camp.id !== selectedTarget.id),
          ]
        : baseTargets
    ).slice(0, 2);
    const [routed, nearbyGroups] = await Promise.all([
      enrichRoutes(origin, routeTargets),
      Promise.all(
        nearbyTargets.map((camp) =>
          fetchNearbyPlaces(camp.id, camp.coordinates),
        ),
      ),
    ]);
    const withinDrive = routed.filter(
      (camp) =>
        !camp.driveMinutes || camp.driveMinutes <= intent.maxDriveMinutes + 15,
    );
    const candidates = (withinDrive.length >= 6 ? withinDrive : routed).slice(
      0,
      10,
    );
    const weatherEnriched = forecastIsAvailable(
      String(payload.trip?.startDate || ""),
    )
      ? await enrichWeather(
          candidates,
          String(payload.trip?.startDate || ""),
          String(payload.trip?.endDate || ""),
        )
      : candidates;
    const candidateFacts = weatherEnriched.map((camp) => ({
      id: camp.id,
      name: camp.name,
      area: camp.area,
      landscape: camp.landscape,
      driveMinutes: camp.driveMinutes || null,
      distanceKm: camp.distanceKm || null,
      price: camp.price || null,
      facilities: camp.facilities,
      dogFriendly: camp.dogFriendly,
      highC: camp.highC || null,
      lowC: camp.lowC || null,
      rainChance: camp.rainChance || null,
      gustKph: camp.gustKph || null,
      bookingUrl: camp.bookingUrl || null,
      source: camp.source,
      dataCompleteness:
        (camp.name && !/^Campground \d+$/i.test(camp.name) ? 1 : 0) +
        (camp.area !== "Korea" ? 1 : 0) +
        (camp.facilities[0] !== "Verify facilities" ? 1 : 0) +
        (camp.bookingUrl ? 1 : 0) +
        (camp.dogFriendly !== null ? 1 : 0),
    }));
    const requiredPlaces: NearbyPlace[] = requiredStops.map((place) => ({
      ...place,
      campId: "",
      type: "must-visit",
      reason: "Required by the traveler",
    }));
    const nearby = [...requiredPlaces, ...nearbyGroups.flat()];
    const travelerContext = {
      command: payload.command,
      preference: payload.preference,
      profile: payload.profile,
      trip: payload.trip,
      user: payload.user,
    };
    let aiUsed = true;
    let rawPlan: unknown;
    try {
      rawPlan = await withTimeout(
        completeJson(client, [
          {
            role: "system",
            content:
              "You are CamperLife, an evidence-aware camping search ranker. Use every supplied traveler constraint and only supplied live facts. Never invent facts. Respond only in concise English JSON.",
          },
          {
            role: "user",
            content: `Return strict JSON with summary, changes, packing, search, rankedCampIds, recommendations (top 6: id, score, reason, tradeoff, quiet, wild), itinerary (4-20 items), and routeStopIds (0-5 supplied place IDs). The itinerary must cover the complete selected range of ${intent.days} days and ${intent.nights} nights. Every calendar day needs at least one itinerary item. Every must-visit place is mandatory in routeStopIds and must influence campground ranking. If selectedCampId exists, rank it first unless a hard supplied fact makes it unsafe. Include at most one restaurant.\nIntent:${JSON.stringify(intent)}\nTraveler:${JSON.stringify(travelerContext)}\nRequiredStops:${JSON.stringify(requiredStops)}\nCamps:${JSON.stringify(candidateFacts)}\nPlaces:${JSON.stringify(nearby)}`,
          },
        ]),
        10_000,
      );
    } catch {
      aiUsed = false;
      rawPlan = factualFallback(
        intent,
        weatherEnriched,
        nearby,
        selectedCampId,
        requiredStops,
      );
    }
    const plan = validateSearchPlan(
      rawPlan,
      intent,
      new Set(weatherEnriched.map((camp) => camp.id)),
    );
    const topCamp = plan.rankedCampIds?.length
      ? weatherEnriched.find((camp) => camp.id === plan.rankedCampIds![0])
      : undefined;
    const finalPlan = topCamp
      ? applyRoutePlan(plan, rawPlan, nearby, topCamp.id)
      : plan;
    const recommendationMap = new Map(
      finalPlan.recommendations?.map((item) => [item.id, item]) || [],
    );
    const rankMap = new Map(
      finalPlan.rankedCampIds?.map((id, index) => [id, index]) || [],
    );
    const rankedCamps = weatherEnriched
      .map((camp) => {
        const recommendation = recommendationMap.get(camp.id);
        const rank = rankMap.get(camp.id);
        return {
          ...camp,
          score: recommendation?.score ?? camp.score,
          quiet: recommendation?.quiet ?? camp.quiet,
          wild: recommendation?.wild ?? camp.wild,
          reason: recommendation?.reason ?? camp.reason,
          tradeoff: recommendation?.tradeoff ?? camp.tradeoff,
          status:
            rank === 0
              ? ("best" as const)
              : rank === 1
                ? ("safe" as const)
                : rank === 2
                  ? ("wild" as const)
                  : ("verify" as const),
        };
      })
      .sort((a, b) => (rankMap.get(a.id) ?? 999) - (rankMap.get(b.id) ?? 999));

    return NextResponse.json(
      {
        camps: rankedCamps,
        plan: {
          ...finalPlan,
          source: aiUsed ? "deepseek-v4-flash" : "demo",
          model: aiUsed ? MODEL : "factual-timeout-fallback",
        } satisfies PlanResponse,
        source: `${factual.source} + OSRM road matrix + live weather + nearby OSM places + ${aiUsed ? "DeepSeek ranking" : "fast factual fallback (AI timeout)"}`,
        counts: {
          discovered: factual.camps.length,
          routed: routed.filter((camp) => camp.driveMinutes > 0).length,
          weather: weatherEnriched.filter((camp) => camp.lowC || camp.highC)
            .length,
          ranked: finalPlan.rankedCampIds?.length || 0,
          places: nearby.length,
        },
        live: true,
        requiredStops,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof OpenAI.APIError &&
      [401, 402, 403, 429].includes(error.status)
        ? error.status
        : 502;
    const message =
      error instanceof Error ? error.message : "AI campground search failed";
    return NextResponse.json(
      { error: message.slice(0, 240), model: MODEL },
      { status },
    );
  }
}

type NearbyPlace = {
  id: string;
  campId: string;
  type: "attraction" | "restaurant" | "must-visit";
  name: string;
  area: string;
  coordinates: [number, number];
  cuisine?: string;
  source: string;
  reason?: string;
  image?: string;
  website?: string;
  phone?: string;
  openingHours?: string;
};

async function fetchNearbyPlaces(
  campId: string,
  [longitude, latitude]: [number, number],
): Promise<NearbyPlace[]> {
  const query = `[out:json][timeout:16];(nwr(around:18000,${latitude},${longitude})["tourism"~"attraction|museum|viewpoint|theme_park|zoo|gallery"]["name"];nwr(around:12000,${latitude},${longitude})["amenity"="restaurant"]["name"];);out tags center qt 70;`;
  try {
    const response = await fetch(
      "https://overpass.kumi.systems/api/interpreter",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "CamperLife/1.0",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(3500),
      },
    );
    if (!response.ok) throw new Error("Nearby place lookup failed");
    const data = (await response.json()) as {
      elements?: Array<{
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat?: number; lon?: number };
        tags?: Record<string, string>;
      }>;
    };
    return (data.elements || [])
      .flatMap((item) => {
        const lat = item.lat ?? item.center?.lat;
        const lon = item.lon ?? item.center?.lon;
        const tags = item.tags || {};
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !tags.name)
          return [];
        const type =
          tags.amenity === "restaurant"
            ? ("restaurant" as const)
            : ("attraction" as const);
        return [
          {
            id: `poi-${item.type[0]}-${item.id}`,
            campId,
            type,
            name: tags.name,
            area:
              [tags["addr:city"], tags["addr:district"], tags["addr:full"]]
                .filter(Boolean)
                .join(", ") || "Near campground",
            coordinates: [lon!, lat!] as [number, number],
            cuisine: tags.cuisine,
            image:
              safeImage(tags.image) || commonsImage(tags.wikimedia_commons),
            website: safeImage(tags.website || tags["contact:website"]),
            phone: tags.phone || tags["contact:phone"],
            openingHours: tags.opening_hours,
            source: `OpenStreetMap ${item.type} ${item.id}`,
          },
        ];
      })
      .slice(0, 50);
  } catch {
    return fetchNearbyPhoton(campId, longitude, latitude);
  }
}

async function fetchNearbyPhoton(
  campId: string,
  longitude: number,
  latitude: number,
): Promise<NearbyPlace[]> {
  const queries: Array<{ query: string; type: "attraction" | "restaurant" }> = [
    { query: "tourist attraction", type: "attraction" },
    { query: "restaurant", type: "restaurant" },
  ];
  const settled = await Promise.allSettled(
    queries.map(async ({ query, type }) => {
      const url = new URL("https://photon.komoot.io/api/");
      url.searchParams.set("q", query);
      url.searchParams.set("lat", String(latitude));
      url.searchParams.set("lon", String(longitude));
      url.searchParams.set("limit", "20");
      const response = await fetch(url, {
        headers: { "User-Agent": "CamperLife/1.0" },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: Record<string, string | number>;
        }>;
      };
      return (data.features || []).flatMap((feature) => {
        const coordinates = feature.geometry?.coordinates;
        const props = feature.properties || {};
        if (
          !coordinates ||
          String(props.countrycode || "").toUpperCase() !== "KR" ||
          !props.name ||
          haversine(latitude, longitude, coordinates[1], coordinates[0]) > 22
        )
          return [];
        return [
          {
            id: `poi-photon-${props.osm_type || "p"}-${props.osm_id || `${coordinates[0]}-${coordinates[1]}`}`,
            campId,
            type,
            name: String(props.name),
            area:
              [props.city, props.county, props.state]
                .filter(Boolean)
                .join(", ") || "Near campground",
            coordinates,
            source: `OpenStreetMap ${props.osm_type || "place"} ${props.osm_id || "record"} via Photon`,
          } satisfies NearbyPlace,
        ];
      });
    }),
  );
  const unique = new Map<string, NearbyPlace>();
  settled.forEach((result) => {
    if (result.status === "fulfilled")
      result.value.forEach((place) => unique.set(place.id, place));
  });
  return [...unique.values()].slice(0, 30);
}

function applyRoutePlan(
  plan: Omit<PlanResponse, "source" | "model">,
  value: unknown,
  places: NearbyPlace[],
  campId: string,
): Omit<PlanResponse, "source" | "model"> {
  if (!value || typeof value !== "object") return plan;
  const item = value as Record<string, unknown>;
  const placeMap = new Map(
    places
      .filter((place) => place.type === "must-visit" || place.campId === campId)
      .map((place) => [place.id, place]),
  );
  const requestedIds = places
    .filter((place) => place.type === "must-visit")
    .map((place) => place.id);
  const aiIds = Array.isArray(item.routeStopIds)
    ? item.routeStopIds.filter(
        (id): id is string => typeof id === "string" && placeMap.has(id),
      )
    : [];
  const ids = [...new Set([...requestedIds, ...aiIds])].slice(0, 5);
  const routeStops: RouteStop[] = ids.map((id, index) => {
    const place = placeMap.get(id)!;
    return {
      id: place.id,
      type: place.type,
      name: place.name,
      area: place.area,
      coordinates: place.coordinates,
      reason:
        place.reason || "Selected by CamperLife from live nearby place data",
      visitOrder: index + 1,
      source: place.source,
      image: place.image,
      website: place.website,
      phone: place.phone,
      openingHours: place.openingHours,
      cuisine: place.cuisine,
    };
  });
  const itinerary = Array.isArray(item.itinerary)
    ? item.itinerary
        .flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const row = entry as Record<string, unknown>;
          return typeof row.time === "string" &&
            typeof row.title === "string" &&
            typeof row.detail === "string"
            ? [
                {
                  time: row.time.slice(0, 40),
                  title: row.title.slice(0, 120),
                  detail: row.detail.slice(0, 240),
                },
              ]
            : [];
        })
        .slice(0, 20)
    : plan.itinerary;
  return {
    ...plan,
    summary:
      typeof item.summary === "string"
        ? item.summary.slice(0, 1200)
        : plan.summary,
    packing: Array.isArray(item.packing)
      ? item.packing
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 8)
      : plan.packing,
    itinerary,
    routeStops,
  };
}

async function completeJson(
  client: OpenAI,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
) {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 1600,
  });
  return parseJson(completion.choices[0]?.message?.content || "");
}

async function enrichRoutes(origin: [number, number], camps: Campground[]) {
  try {
    const coordinates = [origin, ...camps.map((camp) => camp.coordinates)]
      .map((item) => `${item[0]},${item[1]}`)
      .join(";");
    const response = await fetch(
      `https://router.project-osrm.org/table/v1/driving/${coordinates}?sources=0&annotations=duration,distance`,
      {
        headers: { "User-Agent": "CamperLife/1.0" },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) throw new Error(`OSRM table returned ${response.status}`);
    const data = (await response.json()) as {
      code?: string;
      durations?: Array<Array<number | null>>;
      distances?: Array<Array<number | null>>;
    };
    if (data.code !== "Ok") throw new Error("OSRM table did not return routes");
    return camps.map((camp, index) => ({
      ...camp,
      driveMinutes: data.durations?.[0]?.[index + 1]
        ? Math.round(data.durations[0][index + 1]! / 60)
        : 0,
      distanceKm: data.distances?.[0]?.[index + 1]
        ? Math.round(data.distances[0][index + 1]! / 1000)
        : camp.distanceKm,
    }));
  } catch (error) {
    console.error("Road matrix enrichment failed", error);
    return camps;
  }
}

async function enrichWeather(
  camps: Campground[],
  startDate: string,
  endDate: string,
) {
  const targets = camps.slice(0, 9);
  const enriched: Campground[] = [];
  enriched.push(
    ...(await Promise.all(
      targets
        .slice(0, 20)
        .map((camp) => fetchMetCampWeather(camp, startDate, endDate)),
    )),
  );
  return [...enriched, ...camps.slice(6)];
}

async function fetchMetCampWeather(
  camp: Campground,
  startDate: string,
  endDate: string,
) {
  try {
    const url = new URL(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact",
    );
    url.searchParams.set("lat", camp.coordinates[1].toFixed(4));
    url.searchParams.set("lon", camp.coordinates[0].toFixed(4));
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "CamperLife/1.0 https://campingscout-wild.hyunhocho123.chatgpt.site",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return camp;
    const data = (await response.json()) as {
      properties?: {
        timeseries?: Array<{
          time: string;
          data: {
            instant: {
              details: {
                air_temperature?: number;
                wind_speed?: number;
                wind_speed_of_gust?: number;
              };
            };
            next_1_hours?: {
              details?: {
                probability_of_precipitation?: number;
                precipitation_amount?: number;
              };
            };
          };
        }>;
      };
    };
    const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? Date.parse(`${startDate}T00:00:00+09:00`)
      : Date.now();
    const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ? Date.parse(`${endDate}T23:59:59+09:00`)
      : Date.now() + 72 * 3_600_000;
    const periods = (data.properties?.timeseries || []).filter((item) => {
      const time = Date.parse(item.time);
      return time >= start && time <= end;
    });
    const temperatures = periods
      .map((item) => item.data.instant.details.air_temperature)
      .filter((value): value is number => Number.isFinite(value));
    if (!temperatures.length) return camp;
    const gusts = periods
      .map(
        (item) =>
          item.data.instant.details.wind_speed_of_gust ??
          item.data.instant.details.wind_speed,
      )
      .filter((value): value is number => Number.isFinite(value));
    const rain = periods
      .map(
        (item) => item.data.next_1_hours?.details?.probability_of_precipitation,
      )
      .filter((value): value is number => Number.isFinite(value));
    return {
      ...camp,
      highC: Math.round(Math.max(...temperatures)),
      lowC: Math.round(Math.min(...temperatures)),
      rainChance: rain.length ? Math.round(Math.max(...rain)) : 0,
      gustKph: gusts.length ? Math.round(Math.max(...gusts) * 3.6) : 0,
    };
  } catch {
    return camp;
  }
}

function intentFromInput(
  payload: Record<string, unknown> & {
    trip?: { maxDriveMinutes?: unknown; budget?: unknown };
    preference?: { quiet?: unknown; wild?: unknown };
  },
): SearchIntent {
  const profile =
    payload.profile && typeof payload.profile === "object"
      ? (payload.profile as Record<string, unknown>)
      : {};
  const party = String(profile.party || "");
  const facilities = Array.isArray(profile.facilities)
    ? profile.facilities
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 8)
    : [];
  const trip =
    payload.trip && typeof payload.trip === "object"
      ? (payload.trip as Record<string, unknown>)
      : {};
  const duration = tripDuration(trip.startDate, trip.endDate);
  return {
    querySummary: String(
      payload.command || "Personalized campground search",
    ).slice(0, 300),
    quiet: clamp(payload.preference?.quiet, 0, 100, 50),
    wild: clamp(payload.preference?.wild, 0, 100, 50),
    maxDriveMinutes: clamp(payload.trip?.maxDriveMinutes, 15, 480, 120),
    budget: clamp(payload.trip?.budget, 0, 10_000_000, 200000),
    dogFriendly: /\bdog\b|\bpet\b|강아지|반려견|반려동물/i.test(party),
    requiredFacilities: facilities,
    travelers: clamp(trip.travelers, 1, 12, 1),
    experience: String(profile.experience || "Unspecified").slice(0, 40),
    vehicle: String(profile.vehicle || "Unspecified").slice(0, 40),
    sleepingBagComfortC: clamp(profile.sleepingBagComfortC, -30, 40, 8),
    days: duration.days,
    nights: duration.nights,
  };
}

function validateSearchPlan(
  value: unknown,
  intent: SearchIntent,
  validIds: Set<string>,
): Omit<PlanResponse, "source" | "model"> {
  if (!value || typeof value !== "object")
    throw new Error("AI ranking was not valid");
  const item = value as Record<string, unknown>;
  const rankedCampIds = Array.isArray(item.rankedCampIds)
    ? item.rankedCampIds.filter(
        (id): id is string => typeof id === "string" && validIds.has(id),
      )
    : [];
  if (!rankedCampIds.length)
    throw new Error("AI did not rank any factual campground candidates");
  const recommendations = Array.isArray(item.recommendations)
    ? item.recommendations
        .flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const row = entry as Record<string, unknown>;
          if (typeof row.id !== "string" || !validIds.has(row.id)) return [];
          return [
            {
              id: row.id,
              score: clamp(row.score, 0, 100, 70),
              reason: String(
                row.reason || "Matched against the supplied profile",
              ).slice(0, 500),
              tradeoff: String(
                row.tradeoff || "Confirm unlisted operator policies",
              ).slice(0, 400),
              quiet: clamp(row.quiet, 0, 100, 50),
              wild: clamp(row.wild, 0, 100, 50),
            },
          ];
        })
        .slice(0, 12)
    : [];
  const itinerary = Array.isArray(item.itinerary)
    ? item.itinerary
        .flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const row = entry as Record<string, unknown>;
          return typeof row.time === "string" &&
            typeof row.title === "string" &&
            typeof row.detail === "string"
            ? [
                {
                  time: row.time.slice(0, 40),
                  title: row.title.slice(0, 120),
                  detail: row.detail.slice(0, 240),
                },
              ]
            : [];
        })
        .slice(0, 6)
    : [];
  return {
    summary: String(item.summary || intent.querySummary).slice(0, 1200),
    changes: Array.isArray(item.changes)
      ? item.changes
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 5)
      : [],
    packing: Array.isArray(item.packing)
      ? item.packing
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 8)
      : [],
    search: intent,
    rankedCampIds,
    recommendations,
    itinerary,
  };
}

function parseJson(content: string) {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start)
      return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("The AI response was not valid JSON");
  }
}
function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(Math.max(min, Math.min(max, number)))
    : fallback;
}
function validCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}
function validPolygon(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.length <= 30 &&
    value.every(validCoordinate)
  );
}
function tripDuration(startValue: unknown, endValue: unknown) {
  const start =
    typeof startValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startValue)
      ? Date.parse(`${startValue}T12:00:00+09:00`)
      : Date.now();
  const end =
    typeof endValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endValue)
      ? Date.parse(`${endValue}T12:00:00+09:00`)
      : start;
  const nights = Math.max(
    0,
    Math.min(30, Math.round((end - start) / 86_400_000)),
  );
  return { nights, days: nights + 1 };
}
function validCampSnapshot(value: unknown): Campground[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const camp = entry as Campground;
      if (
        typeof camp.id !== "string" ||
        typeof camp.name !== "string" ||
        !validCoordinate(camp.coordinates) ||
        !/^(OpenStreetMap|GoCamping)/.test(String(camp.source || ""))
      )
        return [];
      return [
        {
          ...camp,
          name: camp.name.slice(0, 160),
          area: String(camp.area || "Korea").slice(0, 240),
          facilities: Array.isArray(camp.facilities)
            ? camp.facilities
                .filter((item): item is string => typeof item === "string")
                .slice(0, 8)
            : ["Verify facilities"],
        },
      ];
    })
    .slice(0, 60);
}
function validRequiredStops(value: unknown): MapPlace[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const place = entry as Partial<MapPlace>;
      if (typeof place.name !== "string" || !validCoordinate(place.coordinates))
        return [];
      return [
        {
          id: typeof place.id === "string" ? place.id : `required-${index}`,
          name: place.name.slice(0, 160),
          area: String(place.area || "Map-selected place").slice(0, 240),
          coordinates: place.coordinates,
          source: String(place.source || "Traveler map selection").slice(
            0,
            160,
          ),
        },
      ];
    })
    .slice(0, 4);
}
function inferCommandPlace(command: string): MapPlace | null {
  const locations: Array<{
    names: string[];
    name: string;
    coordinates: [number, number];
  }> = [
    {
      names: ["부산", "busan"],
      name: "Busan",
      coordinates: [129.0756, 35.1796],
    },
    {
      names: ["서울", "seoul"],
      name: "Seoul",
      coordinates: [126.978, 37.5665],
    },
    { names: ["제주", "jeju"], name: "Jeju", coordinates: [126.5312, 33.4996] },
    {
      names: ["강릉", "gangneung"],
      name: "Gangneung",
      coordinates: [128.8761, 37.7519],
    },
    {
      names: ["속초", "sokcho"],
      name: "Sokcho",
      coordinates: [128.5918, 38.207],
    },
    {
      names: ["인천", "incheon"],
      name: "Incheon",
      coordinates: [126.7052, 37.4563],
    },
    {
      names: ["대전", "daejeon"],
      name: "Daejeon",
      coordinates: [127.3845, 36.3504],
    },
    {
      names: ["대구", "daegu"],
      name: "Daegu",
      coordinates: [128.6014, 35.8714],
    },
    {
      names: ["광주", "gwangju"],
      name: "Gwangju",
      coordinates: [126.8526, 35.1595],
    },
    {
      names: ["울산", "ulsan"],
      name: "Ulsan",
      coordinates: [129.3114, 35.5384],
    },
    {
      names: ["전주", "jeonju"],
      name: "Jeonju",
      coordinates: [127.148, 35.8242],
    },
    {
      names: ["경주", "gyeongju"],
      name: "Gyeongju",
      coordinates: [129.2247, 35.8562],
    },
    {
      names: ["여수", "yeosu"],
      name: "Yeosu",
      coordinates: [127.6622, 34.7604],
    },
  ];
  const lower = command.toLowerCase();
  const match = locations.find((location) =>
    location.names.some((name) => lower.includes(name)),
  );
  return match
    ? {
        id: `command-${match.name.toLowerCase()}`,
        name: match.name,
        area: "Required by AI chat instruction",
        coordinates: match.coordinates,
        source: "Traveler natural-language constraint",
      }
    : null;
}
function dedupeMapPlaces(places: MapPlace[]) {
  const unique = new Map<string, MapPlace>();
  places.forEach((place) =>
    unique.set(
      `${place.coordinates[0].toFixed(3)}:${place.coordinates[1].toFixed(3)}`,
      place,
    ),
  );
  return [...unique.values()].slice(0, 4);
}
function prioritizeByRequiredStops(camps: Campground[], stops: MapPlace[]) {
  return [...camps].sort((a, b) => {
    const distance = (camp: Campground) =>
      stops.reduce(
        (sum, stop) =>
          sum +
          haversine(
            camp.coordinates[1],
            camp.coordinates[0],
            stop.coordinates[1],
            stop.coordinates[0],
          ),
        0,
      );
    return distance(a) - distance(b);
  });
}
function mergeCamps(first: Campground[], second: Campground[]) {
  const unique = new Map<string, Campground>();
  [...first, ...second].forEach((camp) => unique.set(camp.id, camp));
  return [...unique.values()];
}
function pointInPolygon([x, y]: [number, number], polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function safeImage(value?: string) {
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
function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error("AI planning timed out")),
        milliseconds,
      ),
    ),
  ]);
}
function factualFallback(
  intent: SearchIntent,
  camps: Campground[],
  places: NearbyPlace[],
  selectedCampId?: string,
  requiredStops: MapPlace[] = [],
) {
  const scored = [...camps].sort(
    (a, b) =>
      factualScore(b, intent, requiredStops) -
      factualScore(a, intent, requiredStops),
  );
  const ranked =
    selectedCampId && scored.some((camp) => camp.id === selectedCampId)
      ? [
          scored.find((camp) => camp.id === selectedCampId)!,
          ...scored.filter((camp) => camp.id !== selectedCampId),
        ]
      : scored;
  const first = ranked[0];
  const matchingPlaces = places.filter((place) => place.campId === first?.id);
  const attraction = matchingPlaces.find(
    (place) => place.type === "attraction",
  );
  const restaurant = matchingPlaces.find(
    (place) => place.type === "restaurant",
  );
  return {
    summary: `Live campground results are ready. The AI provider exceeded the 10-second limit, so CamperLife applied your ${intent.travelers}-traveler, ${intent.vehicle}, budget, drive-time, facility, pet, quiet and wild preferences to a factual ${intent.days}-day, ${intent.nights}-night plan for ${first?.name || "the best available camp"}.`,
    changes: [
      "Applied every current profile and trip limit",
      `Built the itinerary for all ${intent.days} selected days`,
      "Kept unverified operator details clearly marked",
    ],
    packing: [
      "Weather-appropriate sleep system",
      `Water and meals for ${intent.travelers} traveler${intent.travelers === 1 ? "" : "s"}`,
      "Offline map and emergency kit",
      "Booking confirmation",
    ],
    search: intent,
    rankedCampIds: ranked.map((camp) => camp.id),
    recommendations: ranked.slice(0, 6).map((camp) => ({
      id: camp.id,
      score: factualScore(camp, intent, requiredStops),
      reason: camp.reason,
      tradeoff: camp.tradeoff,
      quiet: camp.quiet,
      wild: camp.wild,
    })),
    itinerary: buildFallbackItinerary(intent, first, restaurant, attraction),
    routeStopIds: [restaurant?.id, attraction?.id].filter(Boolean),
  };
}
function buildFallbackItinerary(
  intent: SearchIntent,
  camp?: Campground,
  restaurant?: NearbyPlace,
  attraction?: NearbyPlace,
) {
  const items: Array<{ time: string; title: string; detail: string }> = [
    {
      time: "DAY 1 · DEPARTURE",
      title: "Leave from your selected origin",
      detail: `Follow the calculated road route to ${camp?.name || "the campground"} and verify check-in details.`,
    },
    {
      time: "DAY 1 · CAMP",
      title: "Arrive and set up camp",
      detail: "Set up before dark and review current site rules and weather.",
    },
  ];
  for (let day = 2; day < intent.days; day += 1) {
    const place = day === 2 ? attraction : undefined;
    items.push({
      time: `DAY ${day} · EXPLORE`,
      title: place?.name || "Flexible local exploration",
      detail: place
        ? "A real nearby attraction included on the mapped route."
        : "Choose an activity after confirming live conditions and opening hours.",
    });
  }
  if (restaurant)
    items.push({
      time: `DAY ${Math.min(2, intent.days)} · MEAL`,
      title: restaurant.name,
      detail:
        "A real nearby restaurant record; verify opening hours before visiting.",
    });
  items.push({
    time: `DAY ${intent.days} · RETURN`,
    title: "Pack, leave no trace and return",
    detail: "Check the site, weather and full round-trip route before leaving.",
  });
  return items.slice(0, 20);
}
function factualScore(
  camp: Campground,
  intent: SearchIntent,
  requiredStops: MapPlace[] = [],
) {
  let score =
    100 -
    Math.abs(camp.quiet - intent.quiet) * 0.2 -
    Math.abs(camp.wild - intent.wild) * 0.2;
  if (camp.driveMinutes && camp.driveMinutes > intent.maxDriveMinutes)
    score -= 25;
  if (camp.price && camp.price > intent.budget) score -= 25;
  if (intent.dogFriendly && camp.dogFriendly === false) score -= 35;
  if (intent.dogFriendly && camp.dogFriendly === true) score += 8;
  const facilities = intent.requiredFacilities.filter((required) =>
    camp.facilities.some((available) =>
      available.toLowerCase().includes(required.toLowerCase()),
    ),
  ).length;
  score += facilities * 4 - (intent.requiredFacilities.length - facilities) * 5;
  if (camp.lowC && camp.lowC < intent.sleepingBagComfortC) score -= 12;
  if (requiredStops.length) {
    const nearestRequired = Math.min(
      ...requiredStops.map((stop) =>
        haversine(
          camp.coordinates[1],
          camp.coordinates[0],
          stop.coordinates[1],
          stop.coordinates[0],
        ),
      ),
    );
    score -= Math.min(80, nearestRequired / 3);
  }
  return Math.round(Math.max(35, Math.min(99, score)));
}
function forecastIsAvailable(startDate: string) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? Date.parse(`${startDate}T00:00:00+09:00`)
    : Date.now();
  const days = (start - Date.now()) / 86_400_000;
  return days >= -1 && days <= 9;
}
function geographicallyDiverse(camps: Campground[], limit: number) {
  const buckets = new Map<string, Campground[]>();
  camps.forEach((camp) => {
    const key = `${Math.floor(camp.coordinates[1] * 2)}:${Math.floor(camp.coordinates[0] * 2)}`;
    buckets.set(key, [...(buckets.get(key) || []), camp]);
  });
  const groups = [...buckets.values()];
  const result: Campground[] = [];
  let index = 0;
  while (
    result.length < limit &&
    groups.some((group) => index < group.length)
  ) {
    for (const group of groups)
      if (group[index] && result.length < limit) result.push(group[index]);
    index += 1;
  }
  return result;
}
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
