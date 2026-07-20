export type CampStatus = "best" | "safe" | "wild" | "verify" | "risk";

export type Campground = {
  id: string;
  name: string;
  area: string;
  landscape: string;
  coordinates: [number, number];
  score: number;
  driveMinutes: number;
  distanceKm: number;
  price: number;
  highC: number;
  lowC: number;
  rainChance: number;
  gustKph: number;
  facilities: string[];
  dogFriendly: boolean | null;
  status: CampStatus;
  reason: string;
  tradeoff: string;
  image: string;
  source: string;
  checkedAt: string;
  quiet: number;
  wild: number;
  bookingUrl?: string;
};

export type WeatherSnapshot = {
  highC: number;
  lowC: number;
  rainChance: number;
  gustKph: number;
  fetchedAt: string;
  live: boolean;
  provider?: string;
};

export type Preference = { wild: number; quiet: number };

export type PlanResponse = {
  summary: string;
  changes: string[];
  packing: string[];
  source: "deepseek-v4-flash" | "demo";
  model?: string;
  search?: {
    quiet: number;
    wild: number;
    maxDriveMinutes: number;
    budget: number;
    dogFriendly: boolean;
    requiredFacilities: string[];
  };
  rankedCampIds?: string[];
  recommendations?: Array<{ id: string; score: number; reason: string; tradeoff: string; quiet: number; wild: number }>;
  itinerary?: Array<{ time: string; title: string; detail: string }>;
};
