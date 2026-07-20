import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "CamperLife — Find your kind of wild",
  description: "An AI camping planner that turns your gear, preferences, weather, and real places into a trip you can take.",
  openGraph: {
    title: "CamperLife — Find your kind of wild",
    description: "Weather-aware camping plans built around your gear, preferences, and real places.",
    type: "website",
    images: [{ url: "/og.png", width: 1736, height: 909, alt: "CamperLife AI camping route planner" }],
  },
  twitter: { card: "summary_large_image", title: "CamperLife", description: "Find your kind of wild.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
