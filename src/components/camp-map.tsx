"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import type { LineString, Polygon } from "geojson";
import type { Campground, MapPlace, RouteStop } from "@/lib/types";

export type MapInteractionMode = "origin" | "must-visit" | "draw" | null;

type Props = {
  camps: Campground[];
  selected: Campground;
  onSelect: (camp: Campground) => void;
  origin: [number, number];
  originName: string;
  route?: LineString;
  reach?: Polygon | null;
  stops?: RouteStop[];
  requiredStops?: MapPlace[];
  interactionMode?: MapInteractionMode;
  searchArea?: [number, number][] | null;
  onAreaChange?: (area: [number, number][]) => void;
  onMapPoint?: (
    coordinates: [number, number],
    mode: "origin" | "must-visit",
  ) => void;
  onStopSelect?: (stop: RouteStop) => void;
};

export function CampMap({
  camps,
  selected,
  onSelect,
  origin,
  originName,
  route,
  reach,
  stops = [],
  requiredStops = [],
  interactionMode = null,
  searchArea,
  onAreaChange,
  onMapPoint,
  onStopSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  const modeRef = useRef(interactionMode);
  const onAreaChangeRef = useRef(onAreaChange);
  const onMapPointRef = useRef(onMapPoint);
  const onStopSelectRef = useRef(onStopSelect);
  const draftAreaRef = useRef<[number, number][]>([]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    modeRef.current = interactionMode;
    onAreaChangeRef.current = onAreaChange;
    onMapPointRef.current = onMapPoint;
    onStopSelectRef.current = onStopSelect;
  }, [interactionMode, onAreaChange, onMapPoint, onStopSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [127.7, 36.25],
      zoom: 6.2,
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
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
            paint: { "raster-saturation": -0.2, "raster-contrast": 0.04 },
          },
        ],
      },
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-left",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.on("load", () => {
      map.addSource("reach", { type: "geojson", data: emptyCollection() });
      map.addLayer({
        id: "reach-fill",
        type: "fill",
        source: "reach",
        paint: { "fill-color": "#67c7ed", "fill-opacity": 0.13 },
      });
      map.addLayer({
        id: "reach-line",
        type: "line",
        source: "reach",
        paint: {
          "line-color": "#eaf8ff",
          "line-width": 2.5,
          "line-opacity": 0.95,
        },
      });
      map.addSource("search-area", {
        type: "geojson",
        data: emptyCollection(),
      });
      map.addLayer({
        id: "search-area-fill",
        type: "fill",
        source: "search-area",
        paint: { "fill-color": "#159bd7", "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: "search-area-line",
        type: "line",
        source: "search-area",
        paint: {
          "line-color": "#087bb8",
          "line-width": 3,
          "line-dasharray": [2, 1.4],
        },
      });
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [] },
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#087fbd",
          "line-width": 5,
          "line-opacity": 0.92,
        },
      });
    });
    map.on("click", (event) => {
      const mode = modeRef.current;
      if (mode === "draw") {
        draftAreaRef.current = [
          ...draftAreaRef.current,
          [event.lngLat.lng, event.lngLat.lat],
        ];
        updateArea(map, draftAreaRef.current);
      } else if (mode === "origin" || mode === "must-visit") {
        onMapPointRef.current?.([event.lngLat.lng, event.lngLat.lat], mode);
      }
    });
    map.on("dblclick", (event) => {
      if (modeRef.current !== "draw" || draftAreaRef.current.length < 3) return;
      event.preventDefault();
      onAreaChangeRef.current?.(draftAreaRef.current);
      draftAreaRef.current = [];
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
    const selecting =
      interactionMode === "origin" ||
      interactionMode === "must-visit" ||
      interactionMode === "draw";
    map.getCanvas().style.cursor = selecting ? "crosshair" : "grab";
    if (interactionMode === "draw") {
      draftAreaRef.current = [];
      map.doubleClickZoom.disable();
    } else map.doubleClickZoom.enable();
  }, [interactionMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    const originMarker = markerButton(
      "origin-pin",
      "⌂",
      `Departure: ${originName}`,
    );
    const rendered: Marker[] = [
      new maplibregl.Marker({ element: originMarker, anchor: "bottom" })
        .setLngLat(origin)
        .addTo(map),
    ];
    camps.forEach((camp) => {
      const button = markerButton(
        `map-pin${camp.id === selected.id ? " map-pin--selected" : ""}`,
        "⛺",
        `Campground: ${camp.name}`,
      );
      button.style.setProperty(
        "--pin-color",
        camp.id === selected.id ? "#087fbd" : "#42b5e3",
      );
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(camp);
      });
      rendered.push(
        new maplibregl.Marker({ element: button, anchor: "bottom" })
          .setLngLat(camp.coordinates)
          .addTo(map),
      );
    });
    const requiredIds = new Set(requiredStops.map((stop) => stop.id));
    const allStops: RouteStop[] = [
      ...requiredStops.map((stop, index) => ({
        ...stop,
        type: "must-visit" as const,
        reason: "Required by you",
        visitOrder: index + 1,
      })),
      ...stops.filter((stop) => !requiredIds.has(stop.id)),
    ];
    allStops.forEach((stop) => {
      const icon =
        stop.type === "restaurant"
          ? "🍽"
          : stop.type === "must-visit"
            ? "⚑"
            : "★";
      const marker = markerButton(
        `poi-pin poi-pin--${stop.type}`,
        icon,
        `${stop.type}: ${stop.visitOrder}. ${stop.name}`,
      );
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        onStopSelectRef.current?.(stop);
      });
      rendered.push(
        new maplibregl.Marker({ element: marker, anchor: "bottom" })
          .setLngLat(stop.coordinates)
          .addTo(map),
      );
    });
    markersRef.current = rendered;
    const update = () => {
      updateNavigation(map, route, reach);
      updateArea(map, searchArea || []);
    };
    if (map.loaded()) update();
    else map.once("load", update);
  }, [
    camps,
    selected,
    origin,
    originName,
    route,
    reach,
    requiredStops,
    searchArea,
    stops,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camps.length) return;
    const bounds = new maplibregl.LngLatBounds(origin, origin);
    camps.forEach((camp) => bounds.extend(camp.coordinates));
    requiredStops.forEach((stop) => bounds.extend(stop.coordinates));
    stops.forEach((stop) => bounds.extend(stop.coordinates));
    map.fitBounds(bounds, { padding: 70, maxZoom: 10, duration: 700 });
  }, [camps, origin, requiredStops, stops]);

  return (
    <div
      ref={containerRef}
      className="map-canvas"
      aria-label="Interactive map with departure, campgrounds, required places and AI route stops"
    />
  );
}

function markerButton(className: string, icon: string, label: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `<span aria-hidden="true">${icon}</span>`;
  return button;
}
function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}
function areaFeature(points: [number, number][]) {
  if (points.length < 3) return emptyCollection();
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [[...points, points[0]]],
    },
  };
}
function updateArea(map: MapLibreMap, points: [number, number][]) {
  (
    map.getSource("search-area") as maplibregl.GeoJSONSource | undefined
  )?.setData(areaFeature(points));
}
function updateNavigation(
  map: MapLibreMap,
  route?: LineString,
  reach?: Polygon | null,
) {
  (map.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData({
    type: "Feature",
    properties: {},
    geometry: route || { type: "LineString", coordinates: [] },
  });
  (map.getSource("reach") as maplibregl.GeoJSONSource | undefined)?.setData(
    reach
      ? { type: "Feature", properties: {}, geometry: reach }
      : emptyCollection(),
  );
}
