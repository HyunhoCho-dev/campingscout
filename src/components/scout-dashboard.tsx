"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { LineString, Polygon } from "geojson";
import {
  AlertTriangle, Backpack, Bell, CalendarDays, Car, Check, ChevronDown, CloudSun,
  Compass, Heart, Info, LocateFixed, MapPin, Navigation,
  ExternalLink, LogIn, LogOut, PawPrint, Route, Save, Share2, ShieldCheck, ShowerHead,
  SlidersHorizontal, Sparkles, TentTree, Thermometer, Users, WalletCards, X,
} from "lucide-react";
import { campgrounds } from "@/lib/campgrounds";
import type { Campground, PlanResponse, Preference, WeatherSnapshot } from "@/lib/types";

const CampMap = dynamic(() => import("./camp-map").then((module) => module.CampMap), { ssr: false, loading: () => <div className="map-loading">Loading the wild…</div> });

const money = new Intl.NumberFormat("ko-KR");
const formatDrive = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

type CamperProfile = { experience: string; party: string; vehicle: string; sleepingBagComfortC: number; facilities: string[] };
type TripSettings = { originName: string; origin: [number, number]; startDate: string; endDate: string; travelers: number; budget: number; maxDriveMinutes: number };
type SessionInfo = { user: { displayName: string; email: string } | null; signInUrl: string; signOutUrl: string };
type NavigationData = { route: LineString; reach: Polygon | null; driveMinutes: number | null; distanceKm: number | null; source: string; live: boolean };

const defaultProfile: CamperProfile = { experience: "Beginner", party: "2 adults · 1 child · 1 dog", vehicle: "Sedan", sleepingBagComfortC: 8, facilities: ["Toilet", "Drinking water"] };
const defaultTrip: TripSettings = { originName: "Seoul", origin: [126.978, 37.5665], startDate: "2026-08-21", endDate: "2026-08-23", travelers: 3, budget: 200000, maxDriveMinutes: 120 };

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(window.localStorage.getItem(key) || "") as T; } catch { return fallback; }
}

export function ScoutDashboard() {
  const [camps, setCamps] = useState<Campground[]>(campgrounds);
  const [selected, setSelected] = useState(campgrounds[0]);
  const [preference, setPreference] = useState<Preference>(() => readStored("campingscout-preference", { wild: 72, quiet: 82 }));
  const [pinned, setPinned] = useState<string[]>([campgrounds[0].id]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<CamperProfile>(() => readStored("campingscout-profile", defaultProfile));
  const [trip, setTrip] = useState<TripSettings>(() => readStored("campingscout-trip", defaultTrip));
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [navigation, setNavigation] = useState<NavigationData | null>(null);
  const [dataSource, setDataSource] = useState("Curated preview");
  const [saving, setSaving] = useState(false);
  const [command, setCommand] = useState("");
  const [thinking, setThinking] = useState(false);
  const [aiPlan, setAiPlan] = useState<PlanResponse | null>(null);
  const [toast, setToast] = useState("");

  const visibleCamps = useMemo(() => {
    return camps
      .filter((camp) => !dismissed.includes(camp.id))
      .map((camp) => ({ camp, affinity: 100 - Math.abs(camp.wild - preference.wild) * 0.35 - Math.abs(camp.quiet - preference.quiet) * 0.35 }))
      .sort((a, b) => b.affinity - a.affinity)
      .map(({ camp }) => camp);
  }, [camps, dismissed, preference]);

  useEffect(() => {
    fetch("/api/session").then(async (r) => await r.json() as SessionInfo).then((value) => {
      setSession(value);
      if (value.user) fetch("/api/profile").then(async (r) => r.ok ? await r.json() as { profile: CamperProfile | null } : null).then((body) => { if (body?.profile) setProfile(body.profile); });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const [longitude, latitude] = trip.origin;
    fetch(`/api/campgrounds?latitude=${latitude}&longitude=${longitude}&radius=${Math.max(50000, trip.maxDriveMinutes * 1300)}`)
      .then(async (response) => response.ok ? await response.json() as { camps: Campground[]; source: string; live: boolean } : Promise.reject())
      .then((result) => {
        if (!result.camps.length) return;
        setCamps(result.camps); setSelected(result.camps[0]); setPinned([result.camps[0].id]);
        setDataSource(result.live ? result.source : "Demo data · add GOCAMPING_SERVICE_KEY");
      }).catch(() => setDataSource("Curated fallback"));
  }, [trip.origin, trip.maxDriveMinutes]);

  useEffect(() => {
    fetch("/api/navigation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: trip.origin, destination: selected.coordinates, minutes: trip.maxDriveMinutes }) })
      .then(async (response) => response.ok ? await response.json() as NavigationData : Promise.reject())
      .then((result) => setNavigation(result)).catch(() => setNavigation(null));
  }, [selected, trip.origin, trip.maxDriveMinutes]);

  useEffect(() => {
    let active = true;
    const [longitude, latitude] = selected.coordinates;
    fetch(`/api/weather?latitude=${latitude}&longitude=${longitude}`)
      .then((response) => {
        if (!response.ok) throw new Error("Weather unavailable");
        return response.json() as Promise<WeatherSnapshot>;
      })
      .then((snapshot: WeatherSnapshot) => { if (active) setWeather(snapshot); })
      .catch(() => {
        if (active) setWeather({ highC: selected.highC, lowC: selected.lowC, rainChance: selected.rainChance, gustKph: selected.gustKph, fetchedAt: new Date().toISOString(), live: false });
      });
    return () => { active = false; };
  }, [selected]);

  useEffect(() => { window.localStorage.setItem("campingscout-preference", JSON.stringify(preference)); }, [preference]);
  useEffect(() => { window.localStorage.setItem("campingscout-profile", JSON.stringify(profile)); }, [profile]);
  useEffect(() => { window.localStorage.setItem("campingscout-trip", JSON.stringify(trip)); }, [trip]);

  const lowC = weather?.lowC ?? selected.lowC;
  const gearMismatch = lowC < profile.sleepingBagComfortC;

  function chooseCamp(camp: Campground) {
    setWeather(null);
    setSelected(camp);
    setToast(`${camp.name} selected`);
    window.setTimeout(() => setToast(""), 1800);
  }

  function findWarmer() {
    const alternative = [...visibleCamps].filter((camp) => camp.id !== selected.id).sort((a, b) => b.lowC - a.lowC)[0];
    if (alternative) {
      chooseCamp(alternative);
      setAiPlan({
        source: "demo",
        summary: `${alternative.name} is the warmer alternative without giving up dog access or essential facilities.`,
        changes: [`Overnight low improves from ${lowC}°C to ${alternative.lowC}°C`, `${formatDrive(alternative.driveMinutes)} drive from Seoul`, `Estimated site cost ₩${money.format(alternative.price)}`],
        packing: ["Lightweight rain shell", "Dog lead and water bowl", "Warm base layer"],
      });
    }
  }

  async function askScout(event: React.FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    setThinking(true);
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, selected, preference, profile, trip, weather }),
      });
      const result = await response.json() as PlanResponse;
      setAiPlan(result);
      setPlanOpen(true);
      setCommand("");
    } finally {
      setThinking(false);
    }
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
          <span><strong>CampingScout</strong><small>Find your kind of wild.</small></span>
        </button>
        <div className="trip-bar" aria-label="Trip filters">
          <button onClick={() => setSettingsOpen(true)}><MapPin size={18} /><span>{trip.originName}</span><ChevronDown size={15} /></button>
          <button onClick={() => setSettingsOpen(true)}><CalendarDays size={18} /><span>{dateLabel}</span><ChevronDown size={15} /></button>
          <button onClick={() => setSettingsOpen(true)}><Users size={18} /><span>{trip.travelers} travelers</span><ChevronDown size={15} /></button>
          <button onClick={() => setSettingsOpen(true)}><WalletCards size={18} /><span>₩{money.format(trip.budget)}</span><ChevronDown size={15} /></button>
        </div>
        <div className="top-actions"><button aria-label="Notifications"><Bell size={19} /></button>{session?.user ? <><button className="avatar" onClick={() => setProfileOpen(true)} aria-label="Open profile">{session.user.displayName.slice(0, 2).toUpperCase()}</button><a href={session.signOutUrl} aria-label="Sign out"><LogOut size={18} /></a></> : <a href={session?.signInUrl || "/signin-with-chatgpt"} className="sign-in" aria-label="Sign in with ChatGPT"><LogIn size={18} /></a>}</div>
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
          <ol className="timeline">
            <li><time>START<small>{trip.startDate.slice(5)}</small></time><span><strong>Depart {trip.originName}</strong><small>18:00 · After work</small></span></li>
            <li><time>ARRIVE<small>{trip.startDate.slice(5)}</small></time><span><strong>Arrive & set up</strong><small>{formatDrive(navigation?.driveMinutes ?? selected.driveMinutes)} drive</small></span></li>
            <li><time>DAY 2<small>EXPLORE</small></time><span><strong>Explore & reset</strong><small>Scout itinerary · All day</small></span></li>
            <li><time>END<small>{trip.endDate.slice(5)}</small></time><span><strong>Pack up & return</strong><small>Leave by 10:00</small></span></li>
          </ol>
          <button className="compare-button" onClick={() => setCompareOpen(true)}><SlidersHorizontal size={17} /> Compare top matches</button>
        </aside>

        <section className="map-stage">
          <CampMap camps={visibleCamps} selected={selected} onSelect={chooseCamp} route={navigation?.route} reach={navigation?.reach} origin={trip.origin} />
          <div className="reach-legend"><span className="reach-swatch" /><span><strong>Driving time</strong><small>Up to {Math.round(trip.maxDriveMinutes / 60)} hours · {navigation?.live ? "live Mapbox" : "estimated"}</small></span></div>
          <button className="locate-button" aria-label="Center on my location"><LocateFixed size={19} /></button>
          <div className="selected-map-card">
            <div className="selected-map-photo" style={{ backgroundImage: `url(${selected.image})` }} />
            <div><span className="tag">{labelForStatus(selected.status)}</span><strong>{selected.name}</strong><small>{selected.landscape}</small><div className="score-line"><b>{selected.score}</b><span>Suitability score</span></div></div>
            <button onClick={() => setDismissed((items) => [...items, selected.id])} aria-label={`Remove ${selected.name}`}><X size={16} /></button>
          </div>
          <PreferencePad preference={preference} onChange={setPreference} />
          <form className="scout-command" onSubmit={askScout}>
            <Sparkles size={18} />
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Ask Scout to change this trip…" aria-label="Ask Scout" />
            <button disabled={thinking} aria-label="Send to Scout">{thinking ? <span className="spinner" /> : <Navigation size={17} />}</button>
          </form>
        </section>

        <aside className="right-panel">
          <div className="camp-photo" style={{ backgroundImage: `linear-gradient(180deg, transparent 58%, rgba(0,0,0,.36)), url(${selected.image})` }}>
            <div className="photo-actions"><button aria-label="Save campground" onClick={() => setPinned((ids) => ids.includes(selected.id) ? ids.filter((id) => id !== selected.id) : [...ids, selected.id])}><Heart size={18} fill={pinned.includes(selected.id) ? "currentColor" : "none"} /></button></div>
            <span className="photo-caption">{dataSource}</span>
          </div>
          <div className="camp-title"><div><span className="tag">{labelForStatus(selected.status)}</span><h2>{selected.name}</h2><p>{selected.area} · {selected.landscape}</p></div><div className="score-badge">{selected.score}<small>/100</small></div></div>

          <div className="fact-grid">
            <Fact icon={<Car />} value={`${formatDrive(navigation?.driveMinutes ?? selected.driveMinutes)} drive`} detail={`${navigation?.distanceKm ?? selected.distanceKm} km from ${trip.originName}`} />
            <Fact icon={<WalletCards />} value={`₩${money.format(selected.price)}`} detail="Estimated site total" />
            <Fact icon={<CloudSun />} value={`${weather?.highC ?? selected.highC}° / ${lowC}°C`} detail={weather?.live ? "Live Open-Meteo forecast" : "Demo forecast"} />
            <Fact icon={<ShowerHead />} value="Essential facilities" detail={selected.facilities.join(", ")} />
            <Fact icon={<PawPrint />} value={selected.dogFriendly ? "Dog friendly" : "No dogs"} detail={selected.dogFriendly ? "Policy reported" : "Does not fit your trip"} />
            <Fact icon={<ShieldCheck />} value="Source-aware" detail={selected.checkedAt} />
          </div>

          <div className={`gear-alert ${gearMismatch ? "gear-alert--warning" : "gear-alert--safe"}`}>
            {gearMismatch ? <AlertTriangle size={22} /> : <Check size={22} />}
            <div><strong>{gearMismatch ? "Equipment check" : "Gear looks compatible"}</strong><p>{gearMismatch ? `The ${lowC}°C forecast low is below your sleeping bag’s ${profile.sleepingBagComfortC}°C comfort rating.` : `The forecast low is within your sleeping bag’s registered comfort range.`}</p></div>
            <Thermometer size={30} />
          </div>

          <div className="why-card"><div><Sparkles size={17} /><strong>Why Scout picked it</strong></div><p>{selected.reason}</p><small><Info size={13} /> {selected.source}</small></div>
          <div className="panel-actions"><button className="primary" onClick={() => setPlanOpen(true)}>View trip plan <Route size={17} /></button>{selected.bookingUrl ? <a className="secondary" href={selected.bookingUrl} target="_blank" rel="noreferrer">Check availability <ExternalLink size={17} /></a> : <button className="secondary" onClick={() => setToast("No verified booking link · confirm with the operator")}>Verify booking <ExternalLink size={17} /></button>}<button className="secondary" onClick={findWarmer}>Find warmer alternative <Thermometer size={17} /></button></div>
        </aside>
      </section>

      {planOpen && <PlanDrawer selected={selected} aiPlan={aiPlan} weather={weather} saving={saving} onSave={saveAndShareTrip} onClose={() => setPlanOpen(false)} />}
      {compareOpen && <CompareModal camps={visibleCamps.slice(0, 3)} selected={selected} onSelect={(camp) => { chooseCamp(camp); setCompareOpen(false); }} onClose={() => setCompareOpen(false)} />}
      {profileOpen && <ProfileModal profile={profile} onSave={saveProfile} onClose={() => setProfileOpen(false)} />}
      {settingsOpen && <TripSettingsModal settings={trip} onSave={(value) => { setTrip(value); setSettingsOpen(false); }} onClose={() => setSettingsOpen(false)} />}
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
  return <div className="overlay"><section className="drawer" role="dialog" aria-modal="true" aria-label="Trip plan"><div className="drawer-head"><div><span className="eyebrow">Ready to roam</span><h2>Your {selected.name} plan</h2></div><button className="icon-button" onClick={onClose} aria-label="Close plan"><X /></button></div>{aiPlan && <div className="ai-summary"><Sparkles size={18} /><div><strong>Scout update · {aiPlan.source === "gpt-5.6" ? "GPT-5.6" : "Reliable demo mode"}</strong><p>{aiPlan.summary}</p></div></div>}<div className="plan-route"><div><span>FRI · 18:00</span><strong>Leave origin</strong><small>Snacks and fuel before departure</small></div><div><span>ARRIVAL</span><strong>Arrive and set up</strong><small>Pitch before sunset</small></div><div><span>DAY 2 · 09:00</span><strong>Forest trail</strong><small>Weather window: {weather?.rainChance ?? selected.rainChance}% rain</small></div><div><span>FINAL · 10:00</span><strong>Pack and head home</strong><small>Leave no trace check</small></div></div><h3>Scout’s packing list</h3><div className="packing-grid">{packing.map((item) => <label key={item}><input type="checkbox" /><span>{item}</span></label>)}</div><div className="source-note"><ShieldCheck size={16} /><span>Weather is live when available. Always confirm alerts, availability, and operator policies before departure.</span></div><button className="primary full" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save & copy share link"} <Share2 size={17} /></button></section></div>;
}

function CompareModal({ camps, selected, onSelect, onClose }: { camps: Campground[]; selected: Campground; onSelect: (camp: Campground) => void; onClose: () => void }) {
  return <div className="overlay overlay--center"><section className="compare-modal"><div className="drawer-head"><div><span className="eyebrow">Decision, simplified</span><h2>Three different kinds of right</h2></div><button className="icon-button" onClick={onClose}><X /></button></div><div className="compare-grid">{camps.map((camp) => <article key={camp.id} className={camp.id === selected.id ? "compare-card compare-card--selected" : "compare-card"}><span className="tag">{labelForStatus(camp.status)}</span><div className="compare-photo" style={{ backgroundImage: `url(${camp.image})` }} /><h3>{camp.name}</h3><p>{camp.reason}</p><dl><div><dt>Match</dt><dd>{camp.score}</dd></div><div><dt>Drive</dt><dd>{formatDrive(camp.driveMinutes)}</dd></div><div><dt>Low</dt><dd>{camp.lowC}°C</dd></div><div><dt>Cost</dt><dd>₩{money.format(camp.price)}</dd></div></dl><small className="tradeoff"><AlertTriangle size={14} /> {camp.tradeoff}</small><button onClick={() => onSelect(camp)}>{camp.id === selected.id ? "Selected" : "Choose this camp"}</button></article>)}</div></section></div>;
}

function ProfileModal({ profile, onSave, onClose }: { profile: CamperProfile; onSave: (profile: CamperProfile) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(profile);
  const toggle = (facility: string) => setDraft((value) => ({ ...value, facilities: value.facilities.includes(facility) ? value.facilities.filter((item) => item !== facility) : [...value.facilities, facility] }));
  return <div className="overlay overlay--center"><section className="profile-modal" role="dialog" aria-modal="true" aria-label="Camper profile"><div className="drawer-head"><div><span className="eyebrow">Your camping profile</span><h2>Help Scout plan like you</h2></div><button className="icon-button" onClick={onClose} aria-label="Close profile"><X /></button></div><div className="profile-form"><label>Experience<select value={draft.experience} onChange={(e) => setDraft({ ...draft, experience: e.target.value })}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label><label>Travel party<input value={draft.party} onChange={(e) => setDraft({ ...draft, party: e.target.value })} /></label><label>Vehicle<select value={draft.vehicle} onChange={(e) => setDraft({ ...draft, vehicle: e.target.value })}><option>Sedan</option><option>SUV</option><option>RV</option><option>EV</option></select></label><label>Sleeping bag comfort<input type="number" value={draft.sleepingBagComfortC} onChange={(e) => setDraft({ ...draft, sleepingBagComfortC: Number(e.target.value) })} /><span>°C</span></label><fieldset><legend>Must-have facilities</legend>{["Toilet", "Drinking water", "Shower", "Power"].map((item) => <label key={item}><input type="checkbox" checked={draft.facilities.includes(item)} onChange={() => toggle(item)} /> {item}</label>)}</fieldset></div><button className="primary full" onClick={() => onSave(draft)}>Save profile <Check size={17} /></button></section></div>;
}

function TripSettingsModal({ settings, onSave, onClose }: { settings: TripSettings; onSave: (settings: TripSettings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(settings);
  const origins: Record<string, [number, number]> = { Seoul: [126.978, 37.5665], Incheon: [126.7052, 37.4563], Daejeon: [127.3845, 36.3504], Busan: [129.0756, 35.1796] };
  return <div className="overlay overlay--center"><section className="profile-modal" role="dialog" aria-modal="true" aria-label="Trip search settings"><div className="drawer-head"><div><span className="eyebrow">Search the right radius</span><h2>Trip details</h2></div><button className="icon-button" onClick={onClose} aria-label="Close trip settings"><X /></button></div><div className="profile-form"><label>Departure city<select value={draft.originName} onChange={(e) => setDraft({ ...draft, originName: e.target.value, origin: origins[e.target.value] })}>{Object.keys(origins).map((name) => <option key={name}>{name}</option>)}</select></label><label>Travelers<input min="1" max="12" type="number" value={draft.travelers} onChange={(e) => setDraft({ ...draft, travelers: Number(e.target.value) })} /></label><label>Start date<input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></label><label>End date<input type="date" min={draft.startDate} value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} /></label><label>Budget (KRW)<input min="0" step="10000" type="number" value={draft.budget} onChange={(e) => setDraft({ ...draft, budget: Number(e.target.value) })} /></label><label>Maximum drive<select value={draft.maxDriveMinutes} onChange={(e) => setDraft({ ...draft, maxDriveMinutes: Number(e.target.value) })}><option value="60">1 hour</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option></select></label></div><button className="primary full" disabled={!draft.startDate || !draft.endDate || draft.endDate < draft.startDate} onClick={() => onSave(draft)}>Search this trip <Save size={17} /></button></section></div>;
}
