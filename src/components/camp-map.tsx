"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import type { LineString, Polygon } from "geojson";
import type { Campground } from "@/lib/types";

const pinColors: Record<Campground["status"], string> = {
  best: "#2474a8",
  safe: "#6b9850",
  wild: "#8b62af",
  verify: "#d99b45",
  risk: "#ce4f4f",
};

type Props = {
  camps: Campground[];
  selected: Campground;
  onSelect: (camp: Campground) => void;
  origin: [number, number];
  route?: LineString;
  reach?: Polygon | null;
};

export function CampMap({ camps, selected, onSelect, origin, route, reach }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [127.34, 37.67],
      zoom: 8.75,
      attributionControl: false,
      style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.38, "raster-contrast": 0.06 } }],
      },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("reach", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({ id: "reach-fill", type: "fill", source: "reach", paint: { "fill-color": "#7b9d6b", "fill-opacity": 0.14 } });
      map.addLayer({ id: "reach-line", type: "line", source: "reach", paint: { "line-color": "#f8fbf7", "line-width": 2.5, "line-opacity": 0.92 } });

      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [] },
        },
      });
      map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2474a8", "line-width": 4, "line-opacity": 0.9 } });
    });

    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = camps.map((camp) => {
      const button = document.createElement("button");
      button.className = `map-pin${camp.id === selected.id ? " map-pin--selected" : ""}`;
      button.style.setProperty("--pin-color", pinColors[camp.status]);
      button.setAttribute("aria-label", `View ${camp.name}`);
      button.innerHTML = `<span aria-hidden="true">⌁</span>`;
      button.addEventListener("click", () => onSelect(camp));
      return new maplibregl.Marker({ element: button, anchor: "bottom" }).setLngLat(camp.coordinates).addTo(map);
    });

    const update = () => updateNavigation(map, route, reach);
    if (map.loaded()) update();
    else map.once("load", update);
  }, [camps, selected, onSelect, origin, route, reach]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !camps.length) return;
    const bounds = new maplibregl.LngLatBounds(origin, origin); camps.forEach((camp) => bounds.extend(camp.coordinates));
    map.fitBounds(bounds, { padding: 70, maxZoom: 10, duration: 700 });
  }, [camps, origin]);

  return <div ref={containerRef} className="map-canvas" aria-label="Interactive map of recommended campgrounds" />;
}

function updateNavigation(map: MapLibreMap, route?: LineString, reach?: Polygon | null) {
  const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
  source?.setData({
    type: "Feature",
    properties: {},
    geometry: route || { type: "LineString", coordinates: [] },
  });
  const reachSource = map.getSource("reach") as maplibregl.GeoJSONSource | undefined;
  reachSource?.setData(reach ? { type: "Feature", properties: {}, geometry: reach } : { type: "FeatureCollection", features: [] });
}
