export interface HeatmapPoint {
  lat: number;
  lng: number;
  kelurahanId: number;
  kelurahan: string;
  kecamatan: string;
  score: number;
}

export interface TopRecommendation {
  kelurahanId: number;
  kelurahan: string;
  kecamatan: string;
  coordinates: { lat: number; lng: number };
  scores: { final: number };
}

export interface RecommendMapProps {
  heatmap: HeatmapPoint[];
  top: TopRecommendation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}