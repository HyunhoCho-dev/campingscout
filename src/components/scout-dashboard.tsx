"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LineString, Polygon } from "geojson";
import {
  AlertTriangle, Backpack, CalendarDays, Car, Check, ChevronDown, CloudSun,
  Compass, Heart, Info, LocateFixed, MapPin, Navigation, Pencil, Search,
  ExternalLink, KeyRound, LogIn, LogOut, PawPrint, Route, Save, Share2, ShieldCheck, ShowerHead,
  SlidersHorizontal, Sparkles, TentTree, Thermometer, Users, WalletCards, X,
} from "lucide-react";
import { campgrounds } from "@/lib/campgrounds";
import type { Campground, PlanResponse, Preference, WeatherSnapshot } from "@/lib/types";

const CampMap = dynamic(() => import("./camp-map").then((module) => module.CampMap), { ssr: false, loading: () => <div className="map-loading">Loading the wild…</div> });

const money = new Intl.NumberFormat("ko-KR");
const formatDrive = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

type CamperProfile = { experience: string; party: string; vehicle: string; sleepingBagComfortC: number; facilities: string[] };
type TripSettings = { originName: string; origin: [number, number]; startDate: string; endDate: string; travelers: number; budget: number; maxDriveMinutes: number; scope: "nationwide" | "drive" | "drawn" };
type SessionInfo = { user: { displayName: string; email: string } | null; signInUrl: string; signOutUrl: string };
type NavigationData = { route: LineString; reach: Polygon | null; driveMinutes: number | null; distanceKm: number | null; source: string; live: boolean };
type AiFilters = { dogFriendly: boolean; requiredFacilities: string[] };

const defaultProfile: CamperProfile = { experience: "Beginner", party: "2 adults · 1 child · 1 dog", vehicle: "Sedan", sleepingBagComfortC: 8, facilities: ["Toilet", "Drinking water"] };
const upcomingWeekend = getUpcomingWeekend();
const defaultTrip: TripSettings = { originName: "Seoul", origin: [126.978, 37.5665], startDate: upcomingWeekend.start, endDate: upcomingWeekend.end, travelers: 3, budget: 200000, maxDriveMinutes: 120, scope: "nationwide" };

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(window.localStorage.getItem(key) || "") as T; } catch { return fallback; }
}

function getUpcomingWeekend() {
  const start = new Date();
  const days = (5 - start.getDay() + 7) % 7;
  start.setDate(start.getDate() + days);
  const end = new Date(start); end.setDate(start.getDate() + 2);
  const format = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { start: format(start), end: format(end) };
}

export function ScoutDashboard() {
  const [camps, setCamps] = useState<Campground[]>(campgrounds);
  const [selected, setSelected] = useState(campgrounds[0]);
  const [preference, setPreference] = useState<Preference>({ wild: 72, quiet: 82 });
  const [pinned, setPinned] = useState<string[]>([campgrounds[0].id]);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [aiConnected, setAiConnected] = useState(false);
  const [aiManaged, setAiManaged] = useState(false);
  const [profile, setProfile] = useState<CamperProfile>(defaultProfile);
  const [trip, setTrip] = useState<TripSettings>(defaultTrip);
  const [searchArea, setSearchArea] = useState<[number, number][] | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const initialLoadDone = useRef(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [navigation, setNavigation] = useState<NavigationData | null>(null);
  const [dataSource, setDataSource] = useState("Loading real campground data…");
  const [aiFilters, setAiFilters] = useState<AiFilters>({ dogFriendly: false, requiredFacilities: [] });
  const [aiRankedIds, setAiRankedIds] = useState<string[]>([]);
  const [mapCardOpen, setMapCardOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [command, setCommand] = useState("");
  const [thinking, setThinking] = useState(false);
  const [aiPlan, setAiPlan] = useState<PlanResponse | null>(null);
  const [toast, setToast] = useState("");

  const visibleCamps = useMemo(() => {
    const candidates = camps
      .filter((camp) => !aiFilters.dogFriendly || camp.dogFriendly !== false)
      .filter((camp) => !aiFilters.requiredFacilities.length || aiFilters.requiredFacilities.every((facility) => camp.facilities.some((available) => available.toLowerCase().includes(facility.toLowerCase()))))
      .map((camp) => ({ camp, affinity: 100 - Math.abs(camp.wild - preference.wild) * 0.35 - Math.abs(camp.quiet - preference.quiet) * 0.35 }))
      .sort((a, b) => {
        const aiA = aiRankedIds.indexOf(a.camp.id); const aiB = aiRankedIds.indexOf(b.camp.id);
        if (aiA >= 0 || aiB >= 0) return (aiA < 0 ? 999 : aiA) - (aiB < 0 ? 999 : aiB);
        return b.affinity - a.affinity;
      })
      .map(({ camp }) => camp);
    return candidates.length ? candidates : camps;
  }, [aiFilters, aiRankedIds, camps, preference]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setPreference(readStored("campingscout-preference", { wild: 72, quiet: 82 }));
      setProfile(readStored("campingscout-profile", defaultProfile));
      setTrip({ ...defaultTrip, ...readStored("campingscout-trip", defaultTrip) });
      setSearchArea(readStored("camperlife-search-area", null));
      setOpenRouterKey(window.sessionStorage.getItem("campingscout-openrouter-key") || "");
      setStorageReady(true);
    });
    fetch("/api/session").then(async (r) => await r.json() as SessionInfo).then((value) => {
      setSession(value);
      if (value.user) fetch("/api/profile").then(async (r) => r.ok ? await r.json() as { profile: CamperProfile | null } : null).then((body) => { if (body?.profile) setProfile(body.profile); });
    }).catch(() => undefined);
    fetch("/api/health").then(async (r) => await r.json() as { integrations?: { openrouter?: boolean } }).then((value) => { if (value.integrations?.openrouter) { setAiManaged(true); setAiConnected(true); } }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!storageReady || initialLoadDone.current) return;
    initialLoadDone.current = true;
    const seedTrip = trip; const [longitude, latitude] = seedTrip.origin;
    fetch(`/api/campgrounds?latitude=${latitude}&longitude=${longitude}&radius=${Math.max(50000, seedTrip.maxDriveMinutes * 1300)}&nationwide=${seedTrip.scope === "nationwide"}`, { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { camps: Campground[]; source: string; live: boolean } : Promise.reject())
      .then((result) => {
        if (!result.camps.length) { setDataSource(result.source || "Live campground data unavailable"); return; }
        setCamps(result.camps); setSelected(result.camps[0]); setPinned([result.camps[0].id]);
        setMapCardOpen(true); setDataSource(result.source);
      }).catch(() => setDataSource("Live data unavailable · current cards are placeholders"));
  }, [storageReady, trip]);

  useEffect(() => {
    fetch("/api/navigation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: trip.origin, destination: selected.coordinates, waypoints: aiPlan?.routeStops?.slice(0, 5).map((stop) => stop.coordinates) || [], minutes: trip.maxDriveMinutes }) })
      .then(async (response) => response.ok ? await response.json() as NavigationData : Promise.reject())
      .then((result) => setNavigation(result)).catch(() => setNavigation(null));
  }, [selected, trip.origin, trip.maxDriveMinutes, aiPlan?.routeStops]);

  useEffect(() => {
    let active = true;
    const [longitude, latitude] = selected.coordinates;
    fetch(`/api/weather?latitude=${latitude}&longitude=${longitude}&startDate=${trip.startDate}&endDate=${trip.endDate}`)
      .then((response) => {
        if (!response.ok) throw new Error("Weather unavailable");
        return response.json() as Promise<WeatherSnapshot>;
      })
      .then((snapshot: WeatherSnapshot) => { if (active) setWeather(snapshot); })
      .catch(() => {
        if (active) setWeather({ highC: selected.highC, lowC: selected.lowC, rainChance: selected.rainChance, gustKph: selected.gustKph, fetchedAt: new Date().toISOString(), live: false });
      });
    return () => { active = false; };
  }, [selected, trip.startDate, trip.endDate]);

  useEffect(() => { if (storageReady) window.localStorage.setItem("campingscout-preference", JSON.stringify(preference)); }, [preference, storageReady]);
  useEffect(() => { if (storageReady) window.localStorage.setItem("campingscout-profile", JSON.stringify(profile)); }, [profile, storageReady]);
  useEffect(() => { if (storageReady) window.localStorage.setItem("campingscout-trip", JSON.stringify(trip)); }, [trip, storageReady]);
  useEffect(() => { if (storageReady) window.localStorage.setItem("camperlife-search-area", JSON.stringify(searchArea)); }, [searchArea, storageReady]);

  const lowC = weather?.lowC ?? selected.lowC;
  const gearMismatch = lowC !== 0 && lowC < profile.sleepingBagComfortC;

  function chooseCamp(camp: Campground) {
    setWeather(null);
    setSelected(camp);
    setMapCardOpen(true);
    setToast(`${camp.name} selected`);
    window.setTimeout(() => setToast(""), 1800);
  }

  async function askScout(event: React.FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    await runScout(command.trim());
  }

  async function runScout(prompt: string, searchTrip = trip) {
    setThinking(true);
    setDataSource("Scout is interpreting your profile and collecting live candidates…");
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(openRouterKey ? { "X-OpenRouter-Key": openRouterKey } : {}) },
        body: JSON.stringify({ command: prompt, preference, profile, trip: searchTrip, searchArea: searchTrip.scope === "drawn" ? searchArea : null, user: session?.user ? { displayName: session.user.displayName } : null }),
      });
      const result = await response.json() as { camps?: Campground[]; plan?: PlanResponse; source?: string; counts?: { discovered: number; routed: number; weather: number; ranked: number; places?: number }; error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "AI planning failed");
      if (!result.plan || !result.camps?.length) throw new Error("Scout returned no ranked live campgrounds");
      setCamps(result.camps); setAiPlan(result.plan); setAiFilters({ dogFriendly: false, requiredFacilities: [] });
      if (result.plan.search) {
        setPreference({ quiet: result.plan.search.quiet, wild: result.plan.search.wild });
        setTrip({ ...searchTrip, maxDriveMinutes: result.plan.search.maxDriveMinutes, budget: result.plan.search.budget });
      }
      if (result.plan.rankedCampIds?.length) {
        setAiRankedIds(result.plan.rankedCampIds);
        const best = result.plan.rankedCampIds.map((id) => result.camps!.find((camp) => camp.id === id)).find(Boolean);
        if (best) chooseCamp(best);
      }
      setDataSource(`${result.source || "Live AI search"} · ${result.counts?.discovered || result.camps.length} found / ${result.counts?.ranked || result.camps.length} AI-ranked`);
      setAiConnected(result.plan.source === "deepseek-v4-flash");
      setPlanOpen(true);
      setCommand("");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "AI planning failed");
      if (openRouterKey) setAiSettingsOpen(true);
    } finally {
      setThinking(false);
    }
  }

  async function searchFromSettings(nextTrip: TripSettings) {
    setSettingsOpen(false);
    setTrip(nextTrip);
    await runScout(`Search now using my saved profile and these trip settings. Rank real campgrounds for ${nextTrip.originName}, ${nextTrip.startDate} to ${nextTrip.endDate}, ${nextTrip.travelers} travelers, budget ${nextTrip.budget} KRW, and a maximum drive of ${nextTrip.maxDriveMinutes} minutes.`, nextTrip);
  }

  function acceptSearchArea(area: [number, number][]) {
    setSearchArea(area); setTrip((value) => ({ ...value, scope: "drawn" })); setDrawMode(false);
    setToast("Area saved. Press Search to refresh AI recommendations.");
  }

  async function connectOpenRouter(key: string) {
    const response = await fetch("/api/openrouter/test", { method: "POST", headers: { ...(key ? { "X-OpenRouter-Key": key } : {}) } });
    const result = await response.json() as { connected?: boolean; model?: string; error?: string };
    if (!response.ok || !result.connected) throw new Error(result.error || "Connection test failed");
    window.sessionStorage.setItem("campingscout-openrouter-key", key);
    setOpenRouterKey(key); setAiConnected(true); setAiSettingsOpen(false);
    setToast(`Connected · ${result.model || "DeepSeek V4 Flash"}`);
  }

  function disconnectOpenRouter() {
    window.sessionStorage.removeItem("campingscout-openrouter-key");
    setOpenRouterKey(""); setAiConnected(false); setToast("Temporary OpenRouter key removed");
  }

  async function saveProfile(nextProfile: CamperProfile) {
    setProfile(nextProfile); setProfileOpen(false);
    if (!session?.user) { setToast("Profile saved on this device · sign in to sync"); return; }
    const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: nextProfile }) });
    setToast(response.ok ? "Profile synced securely" : "Profile kept on this device");
  }

  async function saveAndShareTrip() {
    if (!session?.user) { setToast("Sign in with ChatGPT to save and share"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `${selected.name} · ${trip.startDate}`, data: { selected, trip, profile, preference, aiPlan, weather } }) });
      if (!response.ok) throw new Error("save failed");
      const result = await response.json() as { shareUrl: string };
      const url = new URL(result.shareUrl, window.location.origin).toString();
      await navigator.clipboard?.writeText(url);
      setToast("Trip saved · share link copied");
    } catch { setToast("Could not save the trip. Please try again."); }
    finally { setSaving(false); }
  }

  const dateLabel = `${new Date(`${trip.startDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${new Date(`${trip.endDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" aria-label="CampingScout home">
          <span className="brand-mark"><TentTree size={24} /></span>
          <span><strong>CamperLife</strong><small>Find your kind of wild.</small></span>
        </button>
        <div className="trip-bar" aria-label="Trip filters">
          <button onClick={() => setSettingsOpen(true)}><MapPin size={18} /><span>{trip.originName}</span><ChevronDown size={15} /></button>
          <button onClick={() => setSettingsOpen(true)}><CalendarDays size={18} /><span>{dateLabel}</span><ChevronDown size={15} /></button>
          <button onClick={() => setSettingsOpen(true)}><Users size={18} /><span>{trip.travelers} travelers</span><ChevronDown size={15} /></button>
          <button onClick={() => setSettingsOpen(true)}><WalletCards size={18} /><span>₩{money.format(trip.budget)}</span><ChevronDown size={15} /></button>
        </div>
        <div className="top-actions"><button className="top-search" disabled={thinking} onClick={() => runScout("Search again using every current origin, date, party, budget, profile, preference and drawn-area selection, then rebuild the route.")} aria-label="Search again with current conditions">{thinking ? <span className="spinner" /> : <Search size={19} />}</button><button className={aiConnected ? "ai-key ai-key--connected" : "ai-key"} onClick={() => setAiSettingsOpen(true)} aria-label="Configure OpenRouter AI"><KeyRound size={19} /><i /></button>{session?.user ? <><button className="avatar" onClick={() => setProfileOpen(true)} aria-label="Open profile">{session.user.displayName.slice(0, 2).toUpperCase()}</button><a href={session.signOutUrl} aria-label="Sign out"><LogOut size={18} /></a></> : <a href={session?.signInUrl || "/signin-with-chatgpt"} className="sign-in" aria-label="Sign in with ChatGPT"><LogIn size={18} /></a>}</div>
      </header>

      <section className="workspace">
        <aside className="left-panel">
          <div className="panel-heading"><div><span className="eyebrow">Base camp</span><h1>Your trip</h1></div><button className="icon-button" onClick={() => setProfileOpen(true)} aria-label="Edit camper profile"><SlidersHorizontal size={18} /></button></div>
          <button className="profile-card" onClick={() => setProfileOpen(true)}>
            <span className="profile-illustration"><Compass size={26} /></span>
            <span><strong>{profile.experience} camper</strong><small>{profile.party}</small></span>
            <ChevronDown size={16} />
          </button>

          <div className="section-title"><span>Your gear</span><button onClick={() => setProfileOpen(true)}>Edit</button></div>
          <div className="gear-list">
            <div><TentTree size={20} /><span>3-season tent</span></div>
            <div><Backpack size={20} /><span>Sleeping bag {profile.sleepingBagComfortC}°C</span></div>
            <div><Car size={20} /><span>{profile.vehicle}</span></div>
          </div>

          <div className="section-title"><span>Weekend itinerary</span><span className="live-dot">Draft</span></div>
          <ol className="timeline">{aiPlan?.itinerary?.length ? aiPlan.itinerary.slice(0, 4).map((item, index) => <li key={`${item.time}-${index}`}><time>{item.time.slice(0, 8)}<small>AI PLAN</small></time><span><strong>{item.title}</strong><small>{item.detail}</small></span></li>) : <><li><time>START<small>{trip.startDate.slice(5)}</small></time><span><strong>Depart {trip.originName}</strong><small>Search to generate with Scout</small></span></li><li><time>ARRIVE<small>LIVE ROUTE</small></time><span><strong>Waiting for a ranked campground</strong><small>Road time appears after search</small></span></li></>}</ol>
          <button className="compare-button" onClick={() => setCompareOpen(true)}><SlidersHorizontal size={17} /> Compare top matches</button>
        </aside>

        <section className="map-stage">
          <CampMap camps={visibleCamps} selected={selected} onSelect={chooseCamp} route={navigation?.route} reach={navigation?.reach} origin={trip.origin} stops={aiPlan?.routeStops} drawMode={drawMode} searchArea={searchArea} onAreaChange={acceptSearchArea} />
          <div className="reach-legend"><span className="reach-swatch" /><span><strong>Selected road route</strong><small>{navigation?.live ? `live ${navigation.source}` : "Calculating actual route…"}</small></span></div>
          <button className="locate-button" aria-label="Center on my location"><LocateFixed size={19} /></button>
          <button className={drawMode ? "draw-area-button draw-area-button--active" : "draw-area-button"} onClick={() => setDrawMode((value) => !value)} aria-pressed={drawMode}><Pencil size={17} />{drawMode ? "Click 3+ points · double-click to finish" : "Draw search area"}</button>
          {mapCardOpen && <div className="selected-map-card">
            <div className={selected.image ? "selected-map-photo" : "selected-map-photo photo-missing"} style={selected.image ? { backgroundImage: `url(${selected.image})` } : undefined}>{!selected.image && <TentTree size={28} />}</div>
            <div><span className="tag">{labelForStatus(selected.status)}</span><strong>{selected.name}</strong><small>{selected.landscape}</small><div className="score-line"><b>{selected.score}</b><span>Suitability score</span></div></div>
            <button onClick={() => setMapCardOpen(false)} aria-label={`Close ${selected.name} preview`}><X size={16} /></button>
          </div>}
          <PreferencePad preference={preference} onChange={setPreference} />
          <form className="scout-command" onSubmit={askScout}>
            <Sparkles size={18} />
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Ask Scout to change this trip…" aria-label="Ask Scout" />
            <button disabled={thinking} aria-label="Send to Scout">{thinking ? <span className="spinner" /> : <Navigation size={17} />}</button>
          </form>
        </section>

        <aside className="right-panel">
          <div className={selected.image ? "camp-photo" : "camp-photo photo-missing"} style={selected.image ? { backgroundImage: `linear-gradient(180deg, transparent 58%, rgba(0,0,0,.36)), url(${selected.image})` } : undefined}>
            {!selected.image && <div className="photo-placeholder"><TentTree size={34} /><span>Verified campground photo unavailable</span></div>}
            <div className="photo-actions"><button aria-label="Save campground" onClick={() => setPinned((ids) => ids.includes(selected.id) ? ids.filter((id) => id !== selected.id) : [...ids, selected.id])}><Heart size={18} fill={pinned.includes(selected.id) ? "currentColor" : "none"} /></button></div>
            <span className="photo-caption">{dataSource}</span>
          </div>
          <div className="camp-title"><div><span className="tag">{labelForStatus(selected.status)}</span><h2>{selected.name}</h2><p>{selected.area} · {selected.landscape}</p></div><div className="score-badge">{selected.score}<small>/100</small></div></div>

          <div className="fact-grid">
            <Fact icon={<Car />} value={`${formatDrive(navigation?.driveMinutes ?? selected.driveMinutes)} drive`} detail={`${navigation?.distanceKm ?? selected.distanceKm} km from ${trip.originName}`} />
            <Fact icon={<WalletCards />} value={selected.price ? `₩${money.format(selected.price)}` : "Check operator"} detail={selected.price ? "Estimated site total" : "Public data has no verified price"} />
            <Fact icon={<CloudSun />} value={(weather?.highC ?? selected.highC) || lowC ? `${weather?.highC ?? selected.highC}° / ${lowC}°C` : "Forecast unavailable"} detail={weather?.live ? `Live ${weather.provider || "weather"} forecast` : "No invented weather values"} />
            <Fact icon={<ShowerHead />} value="Essential facilities" detail={selected.facilities.join(", ")} />
            <Fact icon={<PawPrint />} value={selected.dogFriendly === true ? "Dog friendly" : selected.dogFriendly === false ? "No dogs" : "Verify pet policy"} detail={selected.dogFriendly === null ? "Not present in public record" : "Policy reported"} />
            <Fact icon={<ShieldCheck />} value="Source-aware" detail={selected.checkedAt} />
          </div>

          <div className={`gear-alert ${gearMismatch ? "gear-alert--warning" : "gear-alert--safe"}`}>
            {gearMismatch ? <AlertTriangle size={22} /> : <Check size={22} />}
            <div><strong>{gearMismatch ? "Equipment check" : "Gear looks compatible"}</strong><p>{gearMismatch ? `The ${lowC}°C forecast low is below your sleeping bag’s ${profile.sleepingBagComfortC}°C comfort rating.` : `The forecast low is within your sleeping bag’s registered comfort range.`}</p></div>
            <Thermometer size={30} />
          </div>

          <div className="why-card"><div><Sparkles size={17} /><strong>Why Scout picked it</strong></div><p>{selected.reason}</p><small><Info size={13} /> {selected.source}</small></div>
          <div className="panel-actions"><button className="primary" onClick={() => setPlanOpen(true)}>View trip plan <Route size={17} /></button>{selected.bookingUrl ? <a className="secondary" href={selected.bookingUrl} target="_blank" rel="noreferrer">Check availability <ExternalLink size={17} /></a> : <button className="secondary" onClick={() => setToast("No verified booking link · confirm with the operator")}>Verify booking <ExternalLink size={17} /></button>}<button className="secondary" disabled={thinking} onClick={() => runScout("Find a genuinely warmer campground from the supplied candidates. Do not claim a temperature unless live weather data supports it; otherwise explain what must be verified.")}>Ask Scout for a warmer option <Thermometer size={17} /></button></div>
        </aside>
      </section>

      {planOpen && <PlanDrawer selected={selected} aiPlan={aiPlan} weather={weather} saving={saving} onSave={saveAndShareTrip} onClose={() => setPlanOpen(false)} />}
      {compareOpen && <CompareModal camps={visibleCamps.slice(0, 3)} selected={selected} onSelect={(camp) => { chooseCamp(camp); setCompareOpen(false); }} onClose={() => setCompareOpen(false)} />}
      {profileOpen && <ProfileModal profile={profile} onSave={saveProfile} onClose={() => setProfileOpen(false)} />}
      {settingsOpen && <TripSettingsModal settings={trip} searching={thinking} onSave={searchFromSettings} onClose={() => setSettingsOpen(false)} />}
      {aiSettingsOpen && <OpenRouterModal initialKey={openRouterKey} connected={aiConnected} managed={aiManaged} onConnect={connectOpenRouter} onDisconnect={disconnectOpenRouter} onClose={() => setAiSettingsOpen(false)} />}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </main>
  );
}

function PreferencePad({ preference, onChange }: { preference: Preference; onChange: (value: Preference) => void }) {
  function update(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    onChange({ wild: Math.round(Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100))), quiet: Math.round(Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100))) });
  }
  return <div className="preference-card"><div><strong>Tune your wild</strong><span>{preference.quiet}% quiet · {preference.wild}% wild</span></div><div className="xy-pad" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); update(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event); }}><span className="axis axis-top">Popular</span><span className="axis axis-bottom">Quiet</span><span className="axis axis-left">Convenient</span><span className="axis axis-right">Wild</span><i style={{ left: `${preference.wild}%`, top: `${preference.quiet}%` }} /></div></div>;
}

function Fact({ icon, value, detail }: { icon: React.ReactNode; value: string; detail: string }) { return <div className="fact"><span>{icon}</span><div><strong>{value}</strong><small>{detail}</small></div></div>; }

function labelForStatus(status: Campground["status"]) { return ({ best: "Best Match", safe: "Safe Choice", wild: "Wild Card", verify: "Verify", risk: "Not a fit" })[status]; }

function PlanDrawer({ selected, aiPlan, weather, saving, onSave, onClose }: { selected: Campground; aiPlan: PlanResponse | null; weather: WeatherSnapshot | null; saving: boolean; onSave: () => void; onClose: () => void }) {
  const packing = aiPlan?.packing ?? ["Warmer sleeping bag or liner", "Waterproof shell", "Dog lead and bowl", "Headlamp", "Offline map", "2L water per traveler"];
  const itinerary = aiPlan?.itinerary?.length ? aiPlan.itinerary : [{ time: "FRI · 18:00", title: "Leave origin", detail: "Snacks and fuel before departure" }, { time: "ARRIVAL", title: "Arrive and set up", detail: "Pitch before sunset" }, { time: "DAY 2 · 09:00", title: "Explore nearby", detail: `Weather window: ${weather?.rainChance ?? selected.rainChance}% rain` }, { time: "FINAL · 10:00", title: "Pack and head home", detail: "Leave no trace check" }];
  return <div className="overlay"><section className="drawer" role="dialog" aria-modal="true" aria-label="Trip plan"><div className="drawer-head"><div><span className="eyebrow">Ready to roam</span><h2>Your {selected.name} plan</h2></div><button className="icon-button" onClick={onClose} aria-label="Close plan"><X /></button></div>{aiPlan && <div className="ai-summary"><Sparkles size={18} /><div><strong>CamperLife AI · {aiPlan.source === "deepseek-v4-flash" ? "DeepSeek V4 Flash · live" : "Offline preview"}</strong><p>{aiPlan.summary}</p></div></div>}<div className="plan-route">{itinerary.map((item, index) => <div key={`${item.time}-${index}`}><span>{item.time}</span><strong>{item.title}</strong><small>{item.detail}</small></div>)}</div>{Boolean(aiPlan?.routeStops?.length) && <><h3>AI-selected places on your route</h3><div className="route-stops">{aiPlan!.routeStops!.map((stop) => <article key={stop.id}><span>{stop.type === "restaurant" ? "🍽" : "★"}</span><div><strong>{stop.visitOrder}. {stop.name}</strong><small>{stop.area} · {stop.reason}</small></div></article>)}</div></>}<h3>Scout’s packing list</h3><div className="packing-grid">{packing.map((item) => <label key={item}><input type="checkbox" /><span>{item}</span></label>)}</div><div className="source-note"><ShieldCheck size={16} /><span>Weather, campsites, restaurants and attractions come from live/public sources when available. Confirm hours, alerts and booking policies before departure.</span></div><button className="primary full" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save & copy share link"} <Share2 size={17} /></button></section></div>;
}

function CompareModal({ camps, selected, onSelect, onClose }: { camps: Campground[]; selected: Campground; onSelect: (camp: Campground) => void; onClose: () => void }) {
  return <div className="overlay overlay--center"><section className="compare-modal"><div className="drawer-head"><div><span className="eyebrow">Decision, simplified</span><h2>Three different kinds of right</h2></div><button className="icon-button" onClick={onClose}><X /></button></div><div className="compare-grid">{camps.map((camp) => <article key={camp.id} className={camp.id === selected.id ? "compare-card compare-card--selected" : "compare-card"}><span className="tag">{labelForStatus(camp.status)}</span><div className={camp.image ? "compare-photo" : "compare-photo photo-missing"} style={camp.image ? { backgroundImage: `url(${camp.image})` } : undefined}>{!camp.image && <TentTree size={26} />}</div><h3>{camp.name}</h3><p>{camp.reason}</p><dl><div><dt>Match</dt><dd>{camp.score}</dd></div><div><dt>Drive</dt><dd>{formatDrive(camp.driveMinutes)}</dd></div><div><dt>Low</dt><dd>{camp.lowC ? `${camp.lowC}°C` : "Live fetch"}</dd></div><div><dt>Cost</dt><dd>{camp.price ? `₩${money.format(camp.price)}` : "Verify"}</dd></div></dl><small className="tradeoff"><AlertTriangle size={14} /> {camp.tradeoff}</small><button onClick={() => onSelect(camp)}>{camp.id === selected.id ? "Selected" : "Choose this camp"}</button></article>)}</div></section></div>;
}

function ProfileModal({ profile, onSave, onClose }: { profile: CamperProfile; onSave: (profile: CamperProfile) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(profile);
  const toggle = (facility: string) => setDraft((value) => ({ ...value, facilities: value.facilities.includes(facility) ? value.facilities.filter((item) => item !== facility) : [...value.facilities, facility] }));
  return <div className="overlay overlay--center"><section className="profile-modal" role="dialog" aria-modal="true" aria-label="Camper profile"><div className="drawer-head"><div><span className="eyebrow">Your camping profile</span><h2>Help Scout plan like you</h2></div><button className="icon-button" onClick={onClose} aria-label="Close profile"><X /></button></div><div className="profile-form"><label>Experience<select value={draft.experience} onChange={(e) => setDraft({ ...draft, experience: e.target.value })}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label><label>Travel party<input value={draft.party} onChange={(e) => setDraft({ ...draft, party: e.target.value })} /></label><label>Vehicle<select value={draft.vehicle} onChange={(e) => setDraft({ ...draft, vehicle: e.target.value })}><option>Sedan</option><option>SUV</option><option>RV</option><option>EV</option></select></label><label>Sleeping bag comfort<input type="number" value={draft.sleepingBagComfortC} onChange={(e) => setDraft({ ...draft, sleepingBagComfortC: Number(e.target.value) })} /><span>°C</span></label><fieldset><legend>Must-have facilities</legend>{["Toilet", "Drinking water", "Shower", "Power"].map((item) => <label key={item}><input type="checkbox" checked={draft.facilities.includes(item)} onChange={() => toggle(item)} /> {item}</label>)}</fieldset></div><button className="primary full" onClick={() => onSave(draft)}>Save profile <Check size={17} /></button></section></div>;
}

function TripSettingsModal({ settings, searching, onSave, onClose }: { settings: TripSettings; searching: boolean; onSave: (settings: TripSettings) => void | Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(settings);
  const [originQuery, setOriginQuery] = useState(settings.originName);
  const [places, setPlaces] = useState<{ label: string; coordinates: [number, number] }[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  async function findOrigin() {
    if (originQuery.trim().length < 2) return;
    setGeocoding(true);
    try { const response = await fetch(`/api/geocode?q=${encodeURIComponent(originQuery.trim())}`); const body = await response.json() as { places?: typeof places }; setPlaces(body.places || []); }
    finally { setGeocoding(false); }
  }
  return <div className="overlay overlay--center"><section className="profile-modal" role="dialog" aria-modal="true" aria-label="Trip search settings"><div className="drawer-head"><div><span className="eyebrow">AI-powered nationwide search</span><h2>Trip details</h2></div><button className="icon-button" onClick={onClose} aria-label="Close trip settings"><X /></button></div><div className="profile-form"><label className="origin-field">Departure place<div><input value={originQuery} onChange={(event) => setOriginQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findOrigin(); } }} placeholder="Address, station or city" /><button type="button" onClick={findOrigin} disabled={geocoding}>{geocoding ? <span className="spinner spinner--blue" /> : <Search size={17} />}</button></div>{Boolean(places.length) && <span className="geocode-results">{places.map((place) => <button type="button" key={`${place.coordinates.join("-")}-${place.label}`} onClick={() => { setDraft({ ...draft, originName: place.label, origin: place.coordinates }); setOriginQuery(place.label); setPlaces([]); }}>{place.label}</button>)}</span>}<small>Selected: {draft.originName}</small></label><label>Search range<select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as TripSettings["scope"] })}><option value="nationwide">All of South Korea</option><option value="drive">Within maximum drive</option><option value="drawn">Area drawn on map</option></select></label><label>Travelers<input min="1" max="12" type="number" value={draft.travelers} onChange={(e) => setDraft({ ...draft, travelers: Number(e.target.value) })} /></label><label>Start date<input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></label><label>End date<input type="date" min={draft.startDate} value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} /></label><label>Budget (KRW)<input min="0" step="10000" type="number" value={draft.budget} onChange={(e) => setDraft({ ...draft, budget: Number(e.target.value) })} /></label><label>Maximum drive<select value={draft.maxDriveMinutes} onChange={(e) => setDraft({ ...draft, maxDriveMinutes: Number(e.target.value) })}><option value="60">1 hour</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option><option value="360">6 hours</option></select></label></div><button className="primary full" disabled={searching || !draft.startDate || !draft.endDate || draft.endDate < draft.startDate} onClick={() => onSave(draft)}>{searching ? "CamperLife is searching live data…" : "Search with CamperLife AI"} {searching ? <span className="spinner" /> : <Save size={17} />}</button></section></div>;
}

function OpenRouterModal({ initialKey, connected, managed, onConnect, onDisconnect, onClose }: { initialKey: string; connected: boolean; managed: boolean; onConnect: (key: string) => Promise<void>; onDisconnect: () => void; onClose: () => void }) {
  const [key, setKey] = useState(initialKey);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  async function test() {
    if (!key.trim()) { setError("Enter an OpenRouter API key."); return; }
    setTesting(true); setError("");
    try { await onConnect(key.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect."); }
    finally { setTesting(false); }
  }
  return <div className="overlay overlay--center"><section className="profile-modal ai-modal" role="dialog" aria-modal="true" aria-label="OpenRouter connection"><div className="drawer-head"><div><span className="eyebrow">Live AI connection</span><h2>DeepSeek V4 Flash</h2></div><button className="icon-button" onClick={onClose} aria-label="Close AI settings"><X /></button></div><div className={connected ? "connection-state connection-state--ok" : "connection-state"}><span /><div><strong>{connected ? managed && !initialKey ? "Connected by deployment secret" : "Connected for this browser tab" : "Not connected"}</strong><small>Model: deepseek/deepseek-v4-flash</small></div></div><label className="key-field">Temporary OpenRouter API key (optional override)<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-or-v1-…" /></label><p className="privacy-note"><ShieldCheck size={16} /> The temporary key stays in this browser tab. The deployment key is stored as an encrypted server environment variable.</p>{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary full" disabled={testing || !key.trim()} onClick={test}>{testing ? "Testing real API call…" : "Test temporary key"} <KeyRound size={17} /></button>{Boolean(initialKey) && <button className="secondary full" onClick={() => { onDisconnect(); onClose(); }}>Remove temporary key</button>}</section></div>;
}
