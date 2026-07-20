"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import type { LineString, Polygon } from "geojson";
import type { Campground } from "@/lib/types";
import { seoul } from "@/lib/campgrounds";

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
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [[
              [126.79, 37.41], [126.72, 37.66], [126.88, 37.92], [127.16, 38.02],
              [127.51, 37.97], [127.78, 37.83], [127.86, 37.57], [127.69, 37.35],
              [127.35, 37.28], [127.02, 37.32], [126.79, 37.41],
            ]],
          },
        },
      });
      map.addLayer({ id: "reach-fill", type: "fill", source: "reach", paint: { "fill-color": "#7b9d6b", "fill-opacity": 0.14 } });
      map.addLayer({ id: "reach-line", type: "line", source: "reach", paint: { "line-color": "#f8fbf7", "line-width": 2.5, "line-opacity": 0.92 } });

      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [seoul, [127.07, 37.62], [127.19, 37.66], [127.31, 37.69], [127.455, 37.707]] },
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

    const update = () => updateNavigation(map, selected, origin, route, reach);
    if (map.loaded()) update();
    else map.once("load", update);
  }, [camps, selected, onSelect, origin, route, reach]);

  return <div ref={containerRef} className="map-canvas" aria-label="Interactive map of recommended campgrounds" />;
}

function updateNavigation(map: MapLibreMap, selected: Campground, origin: [number, number], route?: LineString, reach?: Polygon | null) {
  const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
  source?.setData({
    type: "Feature",
    properties: {},
    geometry: route || { type: "LineString", coordinates: [origin, [(origin[0] + selected.coordinates[0]) / 2, (origin[1] + selected.coordinates[1]) / 2], selected.coordinates] },
  });
  const reachSource = map.getSource("reach") as maplibregl.GeoJSONSource | undefined;
  if (reach) reachSource?.setData({ type: "Feature", properties: {}, geometry: reach });
}
