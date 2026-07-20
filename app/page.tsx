import { ScoutDashboard } from "@/components/scout-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Home() {
  return <ScoutDashboard />;
}
