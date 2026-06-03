'use client';

import { MapContainer, TileLayer, CircleMarker, Popup, Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useEffect } from 'react';
import type { RecommendMapProps } from './RecommendMap.types';

interface HeatmapPoint {
  lat: number;
  lng: number;
  kelurahanId: number;
  kelurahan: string;
  kecamatan: string;
  score: number;
}

interface TopRecommendation {
  kelurahanId: number;
  kelurahan: string;
  kecamatan: string;
  coordinates: { lat: number; lng: number };
  scores: { final: number };
}

interface Props {
  heatmap: HeatmapPoint[];
  top: TopRecommendation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

// Color scale: red (low) → yellow (mid) → green (high)
function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e'; // green
  if (score >= 50) return '#84cc16'; // lime
  if (score >= 35) return '#eab308'; // yellow
  if (score >= 20) return '#f97316'; // orange
  return '#ef4444'; // red
}

function scoreRadius(score: number): number {
  // Higher score = larger circle
  return 8 + (score / 100) * 12;
}

// Tangsel center
const TANGSEL_CENTER: [number, number] = [-6.30, 106.71];
const TANGSEL_ZOOM = 12;

export default function RecommendMap({ heatmap, top, selectedId, onSelect }: RecommendMapProps) {
  const topIds = new Set(top.map(t => t.kelurahanId));

  return (
    <MapContainer
      center={TANGSEL_CENTER}
      zoom={TANGSEL_ZOOM}
      className="w-full h-full"
      scrollWheelZoom={true}
    >
      {/* CartoDB basemap (free, no API key) */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
      />
      
      {/* Heatmap circles (semua 54 kelurahan) */}
      {heatmap.map(point => {
        const isTop = topIds.has(point.kelurahanId);
        const isSelected = point.kelurahanId === selectedId;
        
        return (
          <CircleMarker
            key={point.kelurahanId}
            center={[point.lat, point.lng]}
            radius={scoreRadius(point.score)}
            pathOptions={{
              fillColor: scoreColor(point.score),
              color: isSelected ? '#1d4ed8' : isTop ? '#0369a1' : 'white',
              weight: isSelected ? 3 : isTop ? 2 : 1,
              fillOpacity: isTop ? 0.85 : 0.55,
            }}
            eventHandlers={{
              click: () => onSelect(point.kelurahanId),
            }}
          >
            <Tooltip>
              <div className="text-xs">
                <div className="font-semibold">{point.kelurahan}</div>
                <div>{point.kecamatan}</div>
                <div className="text-blue-600 font-medium">Score: {point.score}</div>
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
      
      {/* Top 3 rank labels */}
      {top.map((t, idx) => (
        <Marker
          key={`rank-${t.kelurahanId}`}
          position={[t.coordinates.lat, t.coordinates.lng]}
          icon={L.divIcon({
            className: 'rank-marker',
            html: `<div style="
              background: #1d4ed8;
              color: white;
              width: 28px;
              height: 28px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: bold;
              font-size: 14px;
              border: 2px solid white;
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              ">#${idx + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          })}
          eventHandlers={{
            click: () => onSelect(t.kelurahanId),
          }}
        />
      ))}
    </MapContainer>
  );
}