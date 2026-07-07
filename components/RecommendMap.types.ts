export interface HeatmapPoint {
  lat: number;
  lng: number;
  kelurahanId: number;
  kelurahan: string;
  kecamatan: string;
  score: number;
  competitorCount?: number;
}

export interface TopRecommendation {
  kelurahanId: number;
  kelurahan: string;
  kecamatan: string;
  coordinates: { lat: number; lng: number };
  scores: { final: number };
}

export interface Spot {
  id: number;
  name: string;
  anchorName: string;
  lat: number;
  lng: number;
  kelurahanId: number;
  kelurahan: string;
  kecamatan: string;
  placeType: string;
  score: number;
  reason: string;
}

export interface RecommendMapProps {
  heatmap: HeatmapPoint[];
  top: TopRecommendation[];
  spots: Spot[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  flyTarget: [number, number] | null;
  isochroneTarget?: [number, number] | null;
}