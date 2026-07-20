import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "CampingScout — Find your kind of wild",
  description: "An AI camping planner that turns your gear, preferences, weather, and real places into a trip you can take.",
  openGraph: {
    title: "CampingScout — Find your kind of wild",
    description: "Weather-aware camping plans built around your gear, preferences, and real places.",
    type: "website",
    images: [{ url: "/og.png", width: 1736, height: 909, alt: "CampingScout route through Seoul's mountain camps" }],
  },
  twitter: { card: "summary_large_image", title: "CampingScout", description: "Find your kind of wild.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
