import Link from "next/link";
import { MapPin, Route, ShieldCheck, TentTree } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SharedTripPage({ params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = await params;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const response = await fetch(`${origin}/api/trips/${shareToken}`, { cache: "no-store" });
  if (!response.ok) return <main className="share-page"><section><TentTree size={42} /><h1>This trail went cold.</h1><p>The shared trip may have expired or moved.</p><Link href="/">Plan a new trip</Link></section></main>;
  const { trip } = await response.json() as { trip: { title: string; data?: { selected?: { name?: string; area?: string; landscape?: string; driveMinutes?: number } } } };
  const camp = trip.data?.selected;
  return <main className="share-page"><section><div className="share-brand"><TentTree size={25} /> CamperLife</div><span className="eyebrow">Shared adventure</span><h1>{trip.title}</h1><p>{camp?.name || "Camping trip"} · {camp?.area || "Korea"}</p><div className="shared-facts"><div><MapPin /><strong>{camp?.landscape || "Outdoor campground"}</strong></div><div><Route /><strong>{camp?.driveMinutes || 120} min drive</strong></div><div><ShieldCheck /><strong>Verify live conditions</strong></div></div><p className="share-note">CamperLife separates public-data facts from AI recommendations. Always confirm operator policies and official alerts before departure.</p><Link href="/">Build my own trip</Link></section></main>;
}
