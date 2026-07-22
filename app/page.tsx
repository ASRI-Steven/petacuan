'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { MapLegend } from '@/components/MapLegend';
import { Chatbot } from '@/components/Chatbot';
import { MapRouting, type RouteResult, type Place } from '@/components/MapRouting';
import type { Spot } from '@/components/RecommendMap.types';
import { JABODETABEK_KOTAS, DEFAULT_KOTA_KAB } from '@/lib/kotas';

const RecommendMap = dynamic(
  () => import('@/components/RecommendMap'),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 28, height: 28, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-body)' }}>Memuat peta...</span>
      </div>
    ),
  }
) as React.ComponentType<{
  heatmap: Array<{ lat: number; lng: number; kelurahanId: number; kelurahan: string; kecamatan: string; score: number; competitorCount?: number }>;
  top: Array<{ kelurahanId: number; kelurahan: string; kecamatan: string; coordinates: { lat: number; lng: number }; scores: { final: number } }>;
  spots: Spot[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  flyTarget: [number, number] | null;
  isochroneTarget?: [number, number] | null;
  theme?: 'dark' | 'light';
  routeGeometry?: GeoJSON.LineString | null;
  routeFrom?: [number, number] | null;
  routeTo?: [number, number] | null;
  pickingActive?: boolean;
  onMapPick?: (lngLat: [number, number]) => void;
  routePanelOpen?: boolean;
  onSpotForRoute?: (spot: Spot) => void;
}>;

const SUGGESTED_BUSINESSES = [
  'Warung Kopi', 'Restoran', 'Laundry', 'Minimarket', 'Apotek',
  'Barbershop', 'Salon', 'Fotokopi', 'Bengkel', 'Klinik',
  'Toko Sembako', 'Warung Makan', 'Rental PS', 'Percetakan', 'Konveksi',
];

const SCORE_METRICS = [
  { key: 'demand' as const,       label: 'Demand',    icon: '👥' },
  { key: 'competition' as const,  label: 'Kompetisi', icon: '⚔️' },
  { key: 'anchor' as const,       label: 'Anchor',    icon: '⚓' },
  { key: 'access' as const,       label: 'Akses',     icon: '🛣️' },
  { key: 'affordability' as const,label: 'Modal',     icon: '💰' },
];

const RANK_COLORS = ['#fbbf24', '#94a3b8', '#fb923c'];
const SCORE_THRESHOLD = 45;

interface ApiResponse {
  top: Array<{
    kelurahanId: number;
    kelurahan: string;
    kecamatan: string;
    coordinates: { lat: number; lng: number };
    demografis: { jumlahPenduduk: number; demandTarget: number };
    market: { competitorCount: number; anchorCount: number };
    scores: { demand: number; competition: number; anchor: number; access: number; affordability: number; final: number };
    sewa: { minIdr: number | null; maxIdr: number | null; format: string };
  }>;
  heatmap: Array<{ lat: number; lng: number; kelurahanId: number; kelurahan: string; kecamatan: string; score: number; competitorCount?: number }>;
}

function scoreHex(score: number) {
  if (score >= 70) return '#34d399';
  if (score >= 55) return '#86efac';
  if (score >= 40) return '#fbbf24';
  if (score >= 25) return '#fb923c';
  return '#f87171';
}

function formatIdr(n: number) {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)}jt`;
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const sw = 4;
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const hex = scoreHex(score);

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', position: 'absolute', top: 0, left: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={hex} strokeWidth={sw}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1)', filter: `drop-shadow(0 0 5px ${hex}70)` }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: size < 56 ? 13 : 20, color: hex, lineHeight: 1 }}>
          {score}
        </span>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
  backdropFilter: 'blur(12px)',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 8,
};

const inputBase: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontSize: 14,
  fontFamily: 'var(--font-body)',
  outline: 'none',
};

const sectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 12,
};

const DATA_SOURCES = [
  {
    label: 'Demografi — penduduk, kepadatan & luas wilayah',
    src: 'Wikipedia bahasa Indonesia + basis data BPS',
    color: '#fbbf24',
    coverage: '440 / 1.496 kelurahan tervalidasi',
    method: 'Jumlah penduduk & kepadatan dihimpun per kelurahan dari sumber resmi. Kelurahan yang belum terdata dilengkapi estimasi berdasarkan kepadatan wilayah sekitarnya.',
    note: 'Kelurahan tervalidasi memakai angka resmi; selebihnya estimasi dan dilabeli sebagai perkiraan.',
  },
  {
    label: 'POI kompetitor & anchor keramaian',
    src: 'OpenStreetMap — © kontributor OpenStreetMap (lisensi ODbL)',
    color: '#fb923c',
    coverage: '13 kota/kabupaten terpetakan',
    method: 'Titik usaha (warung, minimarket, kuliner) dipetakan sebagai kompetitor, dan fasilitas publik (sekolah, masjid, pasar, terminal) sebagai penarik keramaian.',
    note: 'Kelengkapan mengikuti kontribusi komunitas — paling padat di Tangerang Selatan, wilayah lain menyusul.',
  },
  {
    label: 'Harga sewa ruko / kios',
    src: 'rumah123.com & 99.co',
    color: '#fbbf24',
    coverage: 'Rentang harga per kecamatan',
    method: 'Listing publik dikumpulkan lalu diringkas menjadi rentang harga wajar (persentil bawah–atas) per kecamatan.',
    note: 'Estimasi harga penawaran pasar, bukan nilai transaksi resmi.',
  },
  {
    label: 'Batas & geometri wilayah kelurahan',
    src: 'Data batas administrasi Indonesia (basis BPS / Kemendagri)',
    color: '#34d399',
    coverage: '1.496 kelurahan · 6.804 km²',
    method: 'Poligon batas tiap kelurahan dipakai untuk analisis spasial: jarak, cakupan area jangkauan, dan titik-dalam-wilayah.',
    note: 'Mencakup 13 kota/kabupaten se-Jabodetabek.',
  },
];

// Cakupan data aktual per wilayah (dihitung dari dataset kelurahan Jabodetabek).
// kel = jumlah kelurahan · valid = kelurahan dengan demografi tervalidasi · luas = km² (dari geometri).
const DATA_COVERAGE = [
  { kota: 'Kabupaten Bogor', kel: 428, valid: 48, luas: 2992.2 },
  { kota: 'Kabupaten Tangerang', kel: 274, valid: 57, luas: 1029.2 },
  { kota: 'Kabupaten Bekasi', kel: 187, valid: 72, luas: 1269.8 },
  { kota: 'Kota Tangerang', kel: 104, valid: 94, luas: 181.2 },
  { kota: 'Kota Bogor', kel: 68, valid: 11, luas: 111.7 },
  { kota: 'Jakarta Timur', kel: 65, valid: 26, luas: 184.1 },
  { kota: 'Jakarta Selatan', kel: 65, valid: 20, luas: 144.5 },
  { kota: 'Depok', kel: 63, valid: 15, luas: 199.4 },
  { kota: 'Jakarta Barat', kel: 56, valid: 33, luas: 125.7 },
  { kota: 'Kota Bekasi', kel: 56, valid: 16, luas: 214.3 },
  { kota: 'Tangerang Selatan', kel: 54, valid: 11, luas: 164.7 },
  { kota: 'Jakarta Pusat', kel: 44, valid: 12, luas: 47.6 },
  { kota: 'Jakarta Utara', kel: 32, valid: 25, luas: 139.7 },
];
const DATA_COVERAGE_TOTAL = { kel: 1496, valid: 440, luas: 6804.1 };

const thNum: React.CSSProperties = {
  textAlign: 'right', padding: '9px 13px', color: 'var(--text-muted)',
  fontWeight: 600, fontSize: 10.5, letterSpacing: '0.04em',
  textTransform: 'uppercase', whiteSpace: 'nowrap',
};
const tdNum: React.CSSProperties = {
  textAlign: 'right', padding: '8px 13px', color: 'var(--text-secondary)',
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
};

export default function Home() {
  const [darkMode, setDarkMode] = useState(false);
  const [businessType, setBusinessType] = useState('');
  const [sqlCategory, setSqlCategory] = useState('warkop');
  const [modalIdr, setModalIdr] = useState(80_000_000);
  const [kotaKab, setKotaKab] = useState<string>(DEFAULT_KOTA_KAB);
  const [showSources, setShowSources] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [narratives, setNarratives] = useState<Record<number, string>>({});
  const [loadingNarratives, setLoadingNarratives] = useState<Set<number>>(new Set());
  const [userContext, setUserContext] = useState('');
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [outOfScope, setOutOfScope] = useState<{ reason: string } | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loadingSpots, setLoadingSpots] = useState(false);
  const [selectedSpotId, setSelectedSpotId] = useState<number | null>(null);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [devil, setDevil] = useState<{ risks: { severity: string; text: string }[]; verdict: string } | null>(null);
  const [loadingDevil, setLoadingDevil] = useState(false);
  const [showChain, setShowChain] = useState(false);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [svModalSpot, setSvModalSpot] = useState<Spot | null>(null);
  const [routeData, setRouteData] = useState<RouteResult | null>(null);
  const [pickingActive, setPickingActive] = useState(false);
  const [routePanelOpen, setRoutePanelOpen] = useState(false);
  const [destinationHint, setDestinationHint] = useState<Place | null>(null);
  const mapClickHandlerRef = useRef<((lngLat: [number, number]) => void) | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('light', !darkMode);
  }, [darkMode]);

  // Sinkronkan destinationHint dengan kelurahan yang dipilih (silent prefill ke field "Ke")
  useEffect(() => {
    const sel = result?.top.find(t => t.kelurahanId === selectedId);
    if (!sel) return;
    setDestinationHint({
      lng: sel.coordinates.lng,
      lat: sel.coordinates.lat,
      label: `${sel.kelurahan}, ${sel.kecamatan}`,
    });
  }, [selectedId, result]);

  async function runAnalysis(overrides?: { businessType?: string; modalIdr?: number; userContext?: string }) {
    const bt = overrides?.businessType ?? businessType;
    const mod = overrides?.modalIdr ?? modalIdr;
    const ctx = overrides?.userContext ?? userContext;

    if (bt.trim().length < 2 || ctx.trim().length < 5) {
      alert('Isi jenis usaha dan konteks lokasi dulu');
      return;
    }

    setLoading(true);
    setResult(null);
    setNarratives({});
    setAiReasoning(null);
    setOutOfScope(null);
    setSpots([]);
    setSelectedSpotId(null);
    setFlyTarget(null);
    setDevil(null);
    setShowChain(false);

    try {
      let weights = null;
      let locationFilter = null;
      let currentSqlCategory = sqlCategory;

      if (ctx.trim().length >= 5) {
        try {
          const tuneRes = await fetch('/api/tune-weights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ businessType: bt, modalIdr: mod, userContext: ctx, kotaKab }),
          });
          if (tuneRes.ok) {
            const tuneData = await tuneRes.json();
            if (tuneData.outOfScope) {
              setOutOfScope({ reason: tuneData.outOfScopeReason || 'Wilayah di luar Jabodetabek' });
              setLoading(false);
              return;
            }
            weights = tuneData.weights;
            locationFilter = tuneData.locationFilter;
            currentSqlCategory = tuneData.sqlCategory || 'warkop';
            setSqlCategory(currentSqlCategory);
            setAiReasoning(tuneData.reasoning);
          }
        } catch (err) {
          console.warn('Weight tuning failed', err);
        }
      }

      const specificKelurahan = locationFilter?.kelurahan?.length ?? 0;
      const topN = specificKelurahan > 0 ? specificKelurahan : 3;

      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessType: bt,
          sqlCategory: currentSqlCategory,
          modalIdr: mod,
          topN,
          kotaKab,
          ...(weights ? { customWeights: weights } : {}),
          ...(locationFilter ? { locationFilter } : {}),
        }),
      });
      if (!res.ok) throw new Error('Recommend API error');

      const data = await res.json();
      setResult(data);

      const _pass = (data.top as ApiResponse['top']).filter(t => t.scores.final >= SCORE_THRESHOLD);
      const qualified = _pass.length > 0 ? _pass : (data.top as ApiResponse['top']);
      if (qualified.length > 0) {
        setSelectedId(qualified[0].kelurahanId);
        fetchNarrative(qualified[0].kelurahanId, 1, { businessType: bt, modalIdr: mod, sqlCategory: currentSqlCategory });
        fetchDevilForItem(qualified[0], { businessType: bt, modalIdr: mod });

        const kelurahanPayload = qualified.map(t => ({
          id: t.kelurahanId,
          name: t.kelurahan,
          kecamatan: t.kecamatan,
          lat: t.coordinates.lat,
          lng: t.coordinates.lng,
          score: t.scores.final,
        }));
        setLoadingSpots(true);
        fetch('/api/spots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kelurahan: kelurahanPayload, businessType: bt, sqlCategory: currentSqlCategory, limitPerKelurahan: 10 }),
        })
          .then(r => r.json())
          .then(d => setSpots(d.spots ?? []))
          .catch(err => console.warn('Spots fetch failed', err))
          .finally(() => setLoadingSpots(false));
      }
    } catch (err) {
      console.error(err);
      alert('Gagal mengambil rekomendasi');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runAnalysis();
  }

  async function fetchDevilForItem(item: ApiResponse['top'][number], opts?: { businessType?: string; modalIdr?: number }) {
    setDevil(null);
    setLoadingDevil(true);
    const bt = opts?.businessType ?? businessType;
    const mod = opts?.modalIdr ?? modalIdr;
    try {
      const res = await fetch('/api/devil', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kelurahan: item.kelurahan,
          kecamatan: item.kecamatan,
          businessType: bt,
          businessLabel: bt,
          modalIdr: mod,
          scores: item.scores,
          competitorCount: item.market.competitorCount,
          anchorCount: item.market.anchorCount,
          sewa: item.sewa,
          jumlahPenduduk: item.demografis.jumlahPenduduk,
        }),
      });
      if (!res.ok) throw new Error('Devil API error');
      const data = await res.json();
      setDevil(data);
    } catch (err) {
      console.warn('Devil fetch failed', err);
    } finally {
      setLoadingDevil(false);
    }
  }

  async function fetchNarrative(kelurahanId: number, rank: number, opts?: { businessType?: string; modalIdr?: number; sqlCategory?: string }) {
    if (narratives[kelurahanId] || loadingNarratives.has(kelurahanId)) return;
    setLoadingNarratives(prev => new Set(prev).add(kelurahanId));
    const bt = opts?.businessType ?? businessType;
    const mod = opts?.modalIdr ?? modalIdr;
    const cat = opts?.sqlCategory ?? sqlCategory;
    try {
      const res = await fetch('/api/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kelurahanId, businessType: bt, sqlCategory: cat, modalIdr: mod, rank }),
      });
      if (!res.ok) throw new Error('Narrative API error');
      const data = await res.json();
      setNarratives(prev => ({ ...prev, [kelurahanId]: data.narrative }));
    } catch (err) {
      console.error(err);
      setNarratives(prev => ({ ...prev, [kelurahanId]: 'Gagal mengambil analisis. Coba lagi.' }));
    } finally {
      setLoadingNarratives(prev => {
        const next = new Set(prev);
        next.delete(kelurahanId);
        return next;
      });
    }
  }

  const _topAll = result?.top ?? [];
  const _passing = _topAll.filter(t => t.scores.final >= SCORE_THRESHOLD);
  // Jangan pernah tampil kosong saat ada hasil: kalau tak ada yang lolos threshold,
  // tetap tampilkan hasil terbaik yang tersedia (biar demo gak blank).
  const qualifiedTop = _passing.length > 0 ? _passing : _topAll;
  const selected = result?.top.find(t => t.kelurahanId === selectedId);

  function handleExportPDF() {
    if (!selected) return;
    const narrative = narratives[selected.kelurahanId] ?? '';
    const sh = scoreHex;
    const fi = formatIdr;
    const date = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    const scoreRows = SCORE_METRICS.map(m => {
      const val = (selected.scores as Record<string, number>)[m.key] ?? 0;
      const col = sh(val);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
        <span style="font-size:12px;width:80px;color:#334155">${m.icon} ${m.label}</span>
        <div style="flex:1;height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden">
          <div style="width:${val}%;height:100%;background:${col};border-radius:3px"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${col};width:26px;text-align:right">${val.toFixed(0)}</span>
      </div>`;
    }).join('');

    const riskRows = (devil?.risks ?? []).map(r => {
      const bg = r.severity === 'high' ? '#fef2f2' : r.severity === 'medium' ? '#fff7ed' : '#fefce8';
      const bc = r.severity === 'high' ? '#fecaca' : r.severity === 'medium' ? '#fed7aa' : '#fef08a';
      const tc = r.severity === 'high' ? '#991b1b' : r.severity === 'medium' ? '#92400e' : '#713f12';
      return `<div style="display:flex;gap:9px;padding:9px 12px;border-radius:8px;border:1px solid ${bc};background:${bg};margin-bottom:7px">
        <span style="font-size:8px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:${bc};color:${tc};white-space:nowrap;align-self:flex-start;margin-top:1px">${r.severity}</span>
        <span style="font-size:12px;color:#334155;line-height:1.55">${r.text}</span>
      </div>`;
    }).join('');

    const simRows = selected.sewa.minIdr ? [50_000_000,80_000_000,100_000_000,150_000_000,200_000_000].map(sc => {
      const ratio = Math.round((selected.sewa.minIdr! / sc) * 100);
      const isCur = sc === modalIdr;
      const col = ratio<=15?'#10b981':ratio<=25?'#d97706':ratio<=40?'#ea580c':'#dc2626';
      const lbl = ratio<=15?'Aman':ratio<=25?'Moderat':ratio<=40?'Berat':'Riskan';
      return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
        <span style="font-size:11px;font-weight:${isCur?700:400};color:${isCur?'#0284c7':'#334155'};width:70px">${fi(sc)}${isCur?' ←':''}</span>
        <div style="flex:1;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden">
          <div style="width:${Math.min(ratio,100)}%;height:100%;background:${col};border-radius:2px"></div>
        </div>
        <span style="font-size:10px;color:#64748b;width:28px;text-align:right">${ratio}%</span>
        <span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:${col}18;color:${col}">${lbl}</span>
      </div>`;
    }).join('') : '';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>PetaCuan — ${selected.kelurahan}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;background:#fff;padding:36px 44px;max-width:740px;margin:0 auto}
@media print{body{padding:24px 28px}@page{margin:1.5cm}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #e2e8f0;margin-bottom:24px">
  <div>
    <div style="font-size:22px;font-weight:900;letter-spacing:-0.03em;color:#0f172a">📍 PetaCuan</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px">AI Lokasi Usaha UMKM · Jabodetabek</div>
  </div>
  <div style="font-size:10px;color:#94a3b8;text-align:right">
    ${date}<br>
    ${businessType}<br>
    Modal ${fi(modalIdr)}
  </div>
</div>

<div style="font-size:26px;font-weight:900;letter-spacing:-0.02em;margin-bottom:3px">${selected.kelurahan}</div>
<div style="font-size:12px;color:#64748b;margin-bottom:20px">Kec. ${selected.kecamatan} &nbsp;·&nbsp; ${userContext}</div>

<div style="display:flex;gap:20px;padding:18px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:24px;align-items:center">
  <div style="text-align:center;flex-shrink:0">
    <div style="font-size:52px;font-weight:900;line-height:1;color:${sh(selected.scores.final)}">${selected.scores.final}</div>
    <div style="font-size:10px;color:#94a3b8;margin-top:4px">Skor Akhir</div>
  </div>
  <div style="flex:1">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      ${[
        {label:'Penduduk', val:`${(selected.demografis.jumlahPenduduk/1000).toFixed(0)}K`},
        {label:'Kompetitor', val:`${selected.market.competitorCount}`},
        {label:'Sewa min', val:selected.sewa.minIdr?fi(selected.sewa.minIdr):'—'},
      ].map(s=>`<div style="background:#fff;border-radius:8px;padding:10px 12px;border:1px solid #e2e8f0">
        <div style="font-size:16px;font-weight:700;color:#0f172a">${s.val}</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:2px">${s.label}</div>
      </div>`).join('')}
    </div>
  </div>
</div>

<div style="margin-bottom:22px">
  <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:12px">Score Breakdown</div>
  ${scoreRows}
</div>

${narrative?`<div style="margin-bottom:22px">
  <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:10px">Analisis AI</div>
  <div style="font-size:13px;line-height:1.75;color:#334155;padding:14px 16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">${narrative.replace(/\n\n/g,'<br><br>')}</div>
</div>`:''}

${riskRows?`<div style="margin-bottom:22px">
  <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:10px">😈 Devil's Advocate</div>
  ${riskRows}
  ${devil?.verdict?`<div style="font-size:11px;color:#64748b;font-style:italic;padding:8px 12px;background:#f8fafc;border-radius:6px;margin-top:8px">${devil.verdict}</div>`:''}
</div>`:''}

${simRows?`<div style="margin-bottom:22px">
  <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:10px">🔮 Simulasi Modal</div>
  ${simRows}
  <div style="font-size:10px;color:#94a3b8;margin-top:6px">% = sewa min tahunan dari modal. ≤15% aman · 15–25% moderat · &gt;25% berat</div>
</div>`:''}

<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8">
  <span>PetaCuan · AI Lokasi Usaha UMKM · Jabodetabek</span>
  <span>Sumber: OpenStreetMap (ODbL) · rumah123 &amp; 99.co · Wikipedia/BPS · Mapbox · analisis AI Claude</span>
</div>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('Izinkan pop-up untuk export PDF'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-base)', overflow: 'hidden' }}>

      {/* ── HEADER ── */}
      <header style={{
        height: 54,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        background: 'var(--bg-header)',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'blur(20px)',
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34,
            borderRadius: 9,
            background: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, flexShrink: 0,
            boxShadow: '0 0 16px rgba(56,189,248,0.3)',
          }}>
            📍
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1 }}>
              PetaCuan
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.03em', marginTop: 1 }}>
              AI Lokasi Usaha untuk UMKM · Jabodetabek
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Sumber & kualitas data */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowSources(v => !v)}
              title="Sumber & kualitas data"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'rgba(56,189,248,0.07)',
                border: '1px solid rgba(56,189,248,0.25)',
                borderRadius: 20, padding: '4px 10px',
                fontSize: 10, color: 'var(--accent)',
                fontWeight: 600, letterSpacing: '0.03em',
                fontFamily: 'var(--font-body)', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 11 }}>ℹ️</span> Sumber Data
            </button>
            {showSources && createPortal(
              <div
                onClick={() => setShowSources(false)}
                style={{
                  position: 'fixed', inset: 0, zIndex: 200,
                  background: 'rgba(2,6,23,0.62)', backdropFilter: 'blur(4px)',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                  padding: '5vh 16px', overflowY: 'auto',
                }}
              >
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    width: 'min(760px, 100%)',
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 16, overflow: 'hidden', textAlign: 'left',
                    boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {/* Header modal */}
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
                    padding: '18px 22px 14px', borderBottom: '1px solid var(--border)',
                    background: 'linear-gradient(180deg, var(--accent-dim), transparent)',
                  }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 19, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                        Sumber &amp; Cakupan Data
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                        Asal setiap data dan seberapa luas cakupannya. Angka di bawah dihitung langsung dari dataset kelurahan Jabodetabek.
                      </div>
                    </div>
                    <button
                      onClick={() => setShowSources(false)}
                      aria-label="Tutup"
                      style={{
                        flexShrink: 0, width: 30, height: 30, borderRadius: 8,
                        border: '1px solid var(--border)', background: 'var(--bg-base)',
                        color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
                      }}
                    >×</button>
                  </div>

                  {/* Body modal */}
                  <div style={{ padding: '16px 22px 22px', maxHeight: '74vh', overflowY: 'auto' }}>

                    {/* Ringkasan angka */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10, marginBottom: 20 }}>
                      {[
                        { v: '1.496', l: 'Kelurahan' },
                        { v: '13', l: 'Kota / Kabupaten' },
                        { v: '440', l: 'Kelurahan tervalidasi' },
                        { v: '6.804 km²', l: 'Luas terpetakan' },
                      ].map(s => (
                        <div key={s.l} style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 13px' }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', lineHeight: 1.1 }}>{s.v}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>{s.l}</div>
                        </div>
                      ))}
                    </div>

                    {/* Daftar sumber */}
                    <div style={{ ...sectionTitle, marginBottom: 12 }}>Sumber Data</div>
                    {DATA_SOURCES.map(d => (
                      <div key={d.label} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '13px 15px', marginBottom: 10, background: 'var(--bg-base)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ width: 9, height: 9, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{d.label}</span>
                          </div>
                          <span style={{
                            flexShrink: 0, fontSize: 10, fontWeight: 600, color: 'var(--accent)',
                            background: 'var(--accent-dim)', border: '1px solid var(--border-active)',
                            borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap',
                          }}>{d.coverage}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 5 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Sumber: </span>{d.src}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{d.method}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6, paddingTop: 7, borderTop: '1px dashed var(--border)' }}>{d.note}</div>
                      </div>
                    ))}

                    {/* Tabel cakupan per wilayah */}
                    <div style={{ ...sectionTitle, margin: '20px 0 10px' }}>Cakupan per Wilayah</div>
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-base)' }}>
                            <th style={{ textAlign: 'left', padding: '9px 13px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Wilayah</th>
                            <th style={thNum}>Kelurahan</th>
                            <th style={thNum}>Tervalidasi</th>
                            <th style={thNum}>Luas&nbsp;(km²)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {DATA_COVERAGE.map((r, i) => (
                            <tr key={r.kota} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'transparent' : 'var(--accent-dim)' }}>
                              <td style={{ padding: '8px 13px', color: 'var(--text-primary)', fontWeight: 500 }}>{r.kota}</td>
                              <td style={tdNum}>{r.kel}</td>
                              <td style={tdNum}>{r.valid}<span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}> ({Math.round(r.valid / r.kel * 100)}%)</span></td>
                              <td style={tdNum}>{r.luas.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                            </tr>
                          ))}
                          <tr style={{ borderTop: '2px solid var(--border-active)', background: 'var(--bg-base)', fontWeight: 700 }}>
                            <td style={{ padding: '9px 13px', color: 'var(--text-primary)' }}>Total Jabodetabek</td>
                            <td style={{ ...tdNum, color: 'var(--text-primary)' }}>{DATA_COVERAGE_TOTAL.kel.toLocaleString('id-ID')}</td>
                            <td style={{ ...tdNum, color: 'var(--text-primary)' }}>{DATA_COVERAGE_TOTAL.valid}</td>
                            <td style={{ ...tdNum, color: 'var(--text-primary)' }}>{DATA_COVERAGE_TOTAL.luas.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Legend + catatan */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 10.5, color: 'var(--text-muted)', marginTop: 14, lineHeight: 1.6 }}>
                      <span><span style={{ color: '#34d399' }}>●</span> tervalidasi / lengkap</span>
                      <span><span style={{ color: '#fbbf24' }}>●</span> sebagian estimasi</span>
                      <span><span style={{ color: '#fb923c' }}>●</span> tergantung cakupan komunitas</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, opacity: 0.85, lineHeight: 1.5 }}>
                      &ldquo;Tervalidasi&rdquo; = kelurahan yang jumlah penduduk &amp; kepadatannya berasal dari sumber resmi. Sisanya memakai estimasi berbasis kepadatan wilayah sekitar dan ditandai sebagai perkiraan di dalam aplikasi.
                    </div>
                  </div>
                </div>
              </div>,
              document.body
            )}
          </div>

          {/* Dark/Light toggle */}
          <button
            onClick={() => setDarkMode(v => !v)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, transition: 'all 0.15s ease',
            }}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--accent-dim)',
            border: '1px solid rgba(56,189,248,0.18)',
            borderRadius: 20, padding: '4px 11px',
            fontSize: 11, color: 'var(--accent)',
            fontWeight: 600, letterSpacing: '0.02em',
            fontFamily: 'var(--font-body)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', boxShadow: '0 0 6px var(--accent)' }} />
            {kotaKab}
          </div>
        </div>
      </header>

      {/* ── CONTENT ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* ── SIDEBAR ── */}
        <aside style={{
          width: 368,
          flexShrink: 0,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border)',
        }}>

          {/* FORM */}
          <div style={card}>
            <div style={sectionTitle}>Konfigurasi</div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Business type — free text */}
              <div>
                <div style={{ ...label, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span>Jenis Usaha</span>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: businessType.trim().length < 2 ? 'var(--orange)' : 'var(--emerald)',
                    background: businessType.trim().length < 2 ? 'rgba(251,146,60,0.1)' : 'rgba(52,211,153,0.1)',
                    border: `1px solid ${businessType.trim().length < 2 ? 'rgba(251,146,60,0.3)' : 'rgba(52,211,153,0.3)'}`,
                    borderRadius: 4,
                    padding: '2px 6px',
                  }}>
                    {businessType.trim().length < 2 ? 'WAJIB' : 'OK'}
                  </span>
                </div>
                <input
                  type="text"
                  value={businessType}
                  onChange={e => setBusinessType(e.target.value)}
                  placeholder="contoh: Toko Buku, Rental Motor, Warnet..."
                  maxLength={60}
                  style={{
                    ...inputBase,
                    borderColor: businessType.trim().length < 2 ? 'rgba(251,146,60,0.35)' : 'var(--border)',
                  }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
                  {SUGGESTED_BUSINESSES.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setBusinessType(s)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 20,
                        border: businessType === s ? '1px solid rgba(56,189,248,0.5)' : '1px solid var(--border)',
                        background: businessType === s ? 'var(--accent-dim)' : 'var(--bg-surface)',
                        color: businessType === s ? 'var(--accent)' : 'var(--text-muted)',
                        fontSize: 11,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-body)',
                        transition: 'all 0.12s ease',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Kota / Kabupaten */}
              <div>
                <div style={label}>Kota / Kabupaten</div>
                <select
                  value={kotaKab}
                  onChange={e => setKotaKab(e.target.value)}
                  style={{ ...inputBase, cursor: 'pointer' }}
                >
                  {JABODETABEK_KOTAS.map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>

              {/* Modal */}
              <div>
                <div style={label}>Modal (IDR / tahun)</div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={modalIdr ? new Intl.NumberFormat('id-ID').format(modalIdr) : ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/\D/g, '');
                    setModalIdr(raw ? Number(raw) : 0);
                  }}
                  placeholder="0"
                  style={inputBase}
                />
              </div>

              {/* Context — required */}
              <div>
                <div style={{ ...label, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span>Konteks Lokasi</span>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: userContext.trim().length < 5 ? 'var(--orange)' : 'var(--emerald)',
                    background: userContext.trim().length < 5 ? 'rgba(251,146,60,0.1)' : 'rgba(52,211,153,0.1)',
                    border: `1px solid ${userContext.trim().length < 5 ? 'rgba(251,146,60,0.3)' : 'rgba(52,211,153,0.3)'}`,
                    borderRadius: 4,
                    padding: '2px 6px',
                  }}>
                    {userContext.trim().length < 5 ? 'WAJIB' : 'OK'}
                  </span>
                </div>
                <textarea
                  value={userContext}
                  onChange={e => setUserContext(e.target.value)}
                  placeholder="contoh: dekat kampus Binus Alam Sutera, target mahasiswa"
                  rows={2}
                  maxLength={200}
                  style={{
                    ...inputBase,
                    resize: 'none',
                    borderColor: userContext.trim().length < 5
                      ? 'rgba(251,146,60,0.35)'
                      : 'var(--border)',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Sebutkan nama tempat / kawasan spesifik di kota terpilih
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{userContext.length}/200</span>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || businessType.trim().length < 2 || userContext.trim().length < 5}
                style={{
                  width: '100%',
                  padding: '11px 20px',
                  borderRadius: 10,
                  border: 'none',
                  background: (loading || businessType.trim().length < 2 || userContext.trim().length < 5)
                    ? 'var(--bg-surface)'
                    : 'linear-gradient(135deg, #38bdf8 0%, #60a5fa 100%)',
                  color: (loading || businessType.trim().length < 2 || userContext.trim().length < 5) ? 'var(--text-muted)' : '#040d1f',
                  fontFamily: 'var(--font-body)',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: (loading || businessType.trim().length < 2 || userContext.trim().length < 5) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all 0.2s ease',
                  boxShadow: (loading || businessType.trim().length < 2 || userContext.trim().length < 5)
                    ? 'none'
                    : '0 0 20px rgba(56,189,248,0.25), 0 4px 14px rgba(0,0,0,0.4)',
                  letterSpacing: '0.01em',
                }}
              >
                {loading ? (
                  <>
                    <div style={{ width: 15, height: 15, border: '2px solid var(--text-muted)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    Menganalisis...
                  </>
                ) : (
                  <>⚡ Analisis Lokasi Terbaik</>
                )}
              </button>
            </form>
          </div>

          {/* OUT OF SCOPE */}
          {outOfScope && (
            <div className="animate-fade-up" style={{ ...card, borderColor: 'rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.04)' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ fontSize: 18, flexShrink: 0 }}>⚠️</div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--amber)', fontSize: 13, marginBottom: 5, fontFamily: 'var(--font-body)' }}>
                    Di Luar Cakupan
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>{outOfScope.reason}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 7, margin: '7px 0 0' }}>
                    Cakupan: Setu, Serpong, Serpong Utara, Pondok Aren, Ciputat, Ciputat Timur, Pamulang.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TOP RESULTS — kelurahan tabs */}
          {result && qualifiedTop.length === 0 && (
            <div className="animate-fade-up" style={card}>
              <div style={sectionTitle}>Top Rekomendasi</div>
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>📉</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Tidak ada lokasi memadai
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Semua skor di bawah {SCORE_THRESHOLD}. Coba ubah jenis usaha atau perbesar modal.
                </div>
              </div>
            </div>
          )}

          {result && qualifiedTop.length > 0 && (
            <div className="animate-fade-up" style={card}>
              {/* Kelurahan rank tabs */}
              <div style={{ display: 'flex', gap: 5, marginBottom: 8, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'thin' }}>
                {qualifiedTop.map((t, idx) => {
                  const active = selectedId === t.kelurahanId;
                  const inCompare = compareIds.includes(t.kelurahanId);
                  const rColor = RANK_COLORS[idx] ?? RANK_COLORS[2];
                  return (
                    <button
                      key={t.kelurahanId}
                      onClick={() => {
                        setSelectedId(t.kelurahanId);
                        fetchNarrative(t.kelurahanId, idx + 1);
                        fetchDevilForItem(t);
                        setCompareIds([]);
                      }}
                      style={{
                        flex: '1 0 88px', padding: '7px 8px', borderRadius: 8,
                        border: active ? `1px solid ${rColor}60` : '1px solid var(--border)',
                        background: active ? `${rColor}12` : 'var(--bg-surface)',
                        cursor: 'pointer', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: 3, transition: 'all 0.15s ease',
                        fontFamily: 'var(--font-body)', position: 'relative',
                      }}
                    >
                      <span style={{ fontWeight: 800, fontSize: 13, color: active ? rColor : 'var(--text-muted)', lineHeight: 1 }}>
                        #{idx + 1}
                      </span>
                      <span style={{ fontSize: 10, color: active ? 'var(--text-secondary)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>
                        {t.kelurahan}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: active ? rColor : 'var(--text-muted)' }}>
                        {t.scores.final}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Compare toggle row */}
              {qualifiedTop.length >= 2 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginBottom: 12 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', marginRight: 2 }}>Bandingkan:</span>
                  {qualifiedTop.map((t, idx) => {
                    const inCompare = compareIds.includes(t.kelurahanId);
                    const rColor = RANK_COLORS[idx] ?? RANK_COLORS[2];
                    return (
                      <button
                        key={t.kelurahanId}
                        onClick={e => {
                          e.stopPropagation();
                          setCompareIds(prev => {
                            if (prev.includes(t.kelurahanId)) return prev.filter(id => id !== t.kelurahanId);
                            if (prev.length >= 2) return [prev[1], t.kelurahanId];
                            return [...prev, t.kelurahanId];
                          });
                        }}
                        style={{
                          padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                          border: inCompare ? `1px solid ${rColor}60` : '1px solid var(--border)',
                          background: inCompare ? `${rColor}18` : 'var(--bg-surface)',
                          color: inCompare ? rColor : 'var(--text-muted)',
                          cursor: 'pointer', fontFamily: 'var(--font-body)',
                          transition: 'all 0.12s ease',
                        }}
                      >
                        #{idx + 1}
                      </button>
                    );
                  })}
                  {compareIds.length > 0 && (
                    <button
                      onClick={() => setCompareIds([])}
                      style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px' }}
                    >
                      reset
                    </button>
                  )}
                </div>
              )}

              {/* Comparison panel */}
              {compareIds.length === 2 && (() => {
                const a = result?.top.find(t => t.kelurahanId === compareIds[0]);
                const b = result?.top.find(t => t.kelurahanId === compareIds[1]);
                if (!a || !b) return null;
                const idxA = qualifiedTop.findIndex(t => t.kelurahanId === a.kelurahanId);
                const idxB = qualifiedTop.findIndex(t => t.kelurahanId === b.kelurahanId);
                const colA = RANK_COLORS[idxA] ?? RANK_COLORS[2];
                const colB = RANK_COLORS[idxB] ?? RANK_COLORS[2];

                const winsA = SCORE_METRICS.filter(m => a.scores[m.key] >= b.scores[m.key]).length;
                const verdictWinner = winsA >= 3 ? a.kelurahan : b.kelurahan;
                const verdictReason = SCORE_METRICS
                  .filter(m => (winsA >= 3 ? a : b).scores[m.key] > (winsA >= 3 ? b : a).scores[m.key])
                  .slice(0, 2).map(m => m.label).join(' & ');

                return (
                  <div className="animate-fade-up" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                      Perbandingan
                    </div>

                    {/* Headers */}
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: 6, marginBottom: 8 }}>
                      <div />
                      <div style={{ fontSize: 11, fontWeight: 700, color: colA, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.kelurahan}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: colB, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.kelurahan}</div>
                    </div>

                    {SCORE_METRICS.map(m => {
                      const va = a.scores[m.key];
                      const vb = b.scores[m.key];
                      const aWins = va > vb;
                      const bWins = vb > va;
                      return (
                        <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: 6, alignItems: 'center', marginBottom: 7 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 4, alignItems: 'center' }}>
                            <span>{m.icon}</span><span>{m.label}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexDirection: 'row-reverse' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: aWins ? colA : 'var(--text-muted)', minWidth: 22, textAlign: 'right' }}>{va.toFixed(0)}</span>
                            <div style={{ flex: 1, height: 4, background: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${va}%`, height: '100%', background: aWins ? colA : 'var(--text-muted)', borderRadius: 2, opacity: aWins ? 1 : 0.5 }} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ flex: 1, height: 4, background: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${vb}%`, height: '100%', background: bWins ? colB : 'var(--text-muted)', borderRadius: 2, opacity: bWins ? 1 : 0.5 }} />
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: bWins ? colB : 'var(--text-muted)', minWidth: 22 }}>{vb.toFixed(0)}</span>
                          </div>
                        </div>
                      );
                    })}

                    <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 700, color: winsA >= 3 ? colA : colB }}>{verdictWinner}</span> lebih unggul
                      {verdictReason ? ` di dimensi ${verdictReason}` : ''}.
                      {' '}Skor akhir: <span style={{ color: colA }}>{a.scores.final}</span> vs <span style={{ color: colB }}>{b.scores.final}</span>.
                    </div>
                  </div>
                );
              })()}

              {/* Spots list for selected kelurahan */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Spot Potensial {loadingSpots ? '· memuat...' : spots.filter(s => s.kelurahanId === selectedId).length > 0 ? `· ${spots.filter(s => s.kelurahanId === selectedId).length} lokasi` : ''}
                </div>

                {loadingSpots ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[1, 2, 3].map(i => (
                      <div key={i} className="skeleton" style={{ height: 58, borderRadius: 8 }} />
                    ))}
                  </div>
                ) : spots.filter(s => s.kelurahanId === selectedId).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                    Tidak ada POI ditemukan di area ini
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {spots.filter(s => s.kelurahanId === selectedId).map((spot, localIdx) => {
                      const isActive = selectedSpotId === spot.id;
                      const rankIdx = qualifiedTop.findIndex(t => t.kelurahanId === spot.kelurahanId);
                      const rColor = RANK_COLORS[rankIdx] ?? RANK_COLORS[2];
                      return (
                        <button
                          key={spot.id}
                          onClick={() => {
                            setSelectedSpotId(spot.id);
                            setFlyTarget([spot.lng, spot.lat]);
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: isActive ? `1px solid ${rColor}50` : '1px solid var(--border)',
                            background: isActive ? `${rColor}0c` : 'var(--bg-surface)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 9,
                            transition: 'all 0.15s ease',
                            textAlign: 'left',
                            fontFamily: 'var(--font-body)',
                          }}
                        >
                          {/* Street view thumb — click to open modal */}
                          <div
                            onClick={e => { e.stopPropagation(); setSvModalSpot(spot); }}
                            title="Lihat foto lokasi"
                            style={{
                              width: 38, height: 38, flexShrink: 0,
                              borderRadius: '50%', overflow: 'hidden',
                              border: `2px solid ${rColor}60`,
                              background: `${rColor}20`,
                              position: 'relative', cursor: 'zoom-in',
                            }}
                          >
                            <img
                              src={`/api/streetview?lat=${spot.lat}&lng=${spot.lng}`}
                              alt=""
                              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '145%', objectFit: 'cover', objectPosition: 'center top' }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <span style={{
                              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 800, fontSize: 12, color: rColor,
                              textShadow: '0 1px 3px rgba(0,0,0,0.8)', zIndex: 1,
                            }}>
                              {localIdx + 1}
                            </span>
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                              <span style={{
                                fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
                                color: rColor, background: `${rColor}15`,
                                border: `1px solid ${rColor}30`, borderRadius: 4, padding: '1px 5px',
                                flexShrink: 0,
                              }}>
                                {spot.placeType.toUpperCase()}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: scoreHex(spot.score), marginLeft: 'auto', flexShrink: 0 }}>
                                {spot.score}
                              </span>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                              {spot.name}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              dekat {spot.anchorName}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI REASONING */}
          {aiReasoning && (
            <div className="animate-fade-up" style={{ ...card, borderColor: 'rgba(167,139,250,0.18)', background: 'rgba(167,139,250,0.04)' }}>
              <div style={{ display: 'flex', gap: 9 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>🧠</span>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
                    Strategi AI
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{aiReasoning}</p>
                </div>
              </div>
            </div>
          )}

          {/* DETAIL */}
          {selected && (
            <div className="animate-fade-up" style={card}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
                  Detail Lokasi
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 19, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                  {selected.kelurahan}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                  Kec. {selected.kecamatan}
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: 16 }}>
                {[
                  { label: 'Penduduk',    value: `${(selected.demografis.jumlahPenduduk / 1000).toFixed(0)}K`, icon: '👥' },
                  { label: 'Kompetitor', value: `${selected.market.competitorCount}`,                           icon: '🏪' },
                  { label: 'Sewa min',    value: selected.sewa.minIdr ? formatIdr(selected.sewa.minIdr) : '—', icon: '🏢' },
                ].map(stat => (
                  <div key={stat.label} style={{
                    background: 'var(--bg-surface)',
                    borderRadius: 9,
                    padding: '9px 10px',
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: 15, marginBottom: 5 }}>{stat.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1 }}>{stat.value}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Score breakdown */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ ...label, marginBottom: 10 }}>Score Breakdown</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {SCORE_METRICS.map(m => {
                    const val = selected.scores[m.key];
                    const col = scoreHex(val);
                    return (
                      <div key={m.key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                            <span style={{ fontSize: 12 }}>{m.icon}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.label}</span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{val.toFixed(0)}</span>
                        </div>
                        <div style={{ height: 4, background: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${val}%`,
                            background: col,
                            borderRadius: 2,
                            boxShadow: `0 0 8px ${col}70`,
                            transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Feature D: Chain of Reasoning */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 4 }}>
                <button
                  onClick={() => setShowChain(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0 6px',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                    {showChain ? '▾' : '▸'} Kenapa skor ini?
                  </span>
                </button>
                {showChain && selected && (() => {
                  const s = selected.scores;
                  const pop = selected.demografis.jumlahPenduduk;
                  const comp = selected.market.competitorCount;
                  const anch = selected.market.anchorCount;
                  const rentRatio = selected.sewa.minIdr ? Math.round((selected.sewa.minIdr / modalIdr) * 100) : null;
                  const chains: { key: string; icon: string; label: string; val: number; reason: string }[] = [
                    {
                      key: 'demand', icon: '👥', label: 'Demand',
                      val: s.demand,
                      reason: `Populasi ${(pop / 1000).toFixed(0)}K jiwa di kelurahan — ${s.demand >= 70 ? 'kepadatan tinggi, demand solid' : s.demand >= 50 ? 'cukup padat, potensi ada' : 'populasi relatif rendah'}`,
                    },
                    {
                      key: 'competition', icon: '⚔️', label: 'Kompetisi',
                      val: s.competition,
                      reason: `${comp} kompetitor aktif di area — ${s.competition >= 70 ? 'pasar masih terbuka lebar' : s.competition >= 50 ? 'persaingan moderat' : 'persaingan ketat, sulit masuk'}`,
                    },
                    {
                      key: 'anchor', icon: '⚓', label: 'Anchor',
                      val: s.anchor,
                      reason: `${anch} traffic generator (sekolah/masjid/pasar) — ${s.anchor >= 70 ? 'banyak sumber traffic harian' : s.anchor >= 50 ? 'beberapa anchor aktif' : 'minim titik keramaian'}`,
                    },
                    {
                      key: 'access', icon: '🛣️', label: 'Akses',
                      val: s.access,
                      reason: `${s.access >= 70 ? 'Infrastruktur jalan baik, mudah dijangkau' : s.access >= 50 ? 'Akses jalan cukup memadai' : 'Akses terbatas, perlu kendaraan'}`,
                    },
                    {
                      key: 'affordability', icon: '💰', label: 'Modal',
                      val: s.affordability,
                      reason: rentRatio !== null
                        ? `Sewa min ${rentRatio}% dari modal — ${rentRatio <= 15 ? 'sangat aman untuk cashflow' : rentRatio <= 30 ? 'moderat, masih masuk akal' : 'berat, konsumsi modal besar'}`
                        : 'Data sewa tidak tersedia di area ini',
                    },
                  ];
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {chains.map(c => (
                        <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 9px', background: 'var(--bg-surface)', borderRadius: 7, border: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 11 }}>{c.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)' }}>{c.label}</span>
                              <span style={{ fontSize: 10.5, fontWeight: 800, color: scoreHex(c.val) }}>{c.val.toFixed(0)}</span>
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{c.reason}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* AI Narrative */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
                  <div style={{ ...label, margin: 0 }}>Analisis AI</div>
                  {loadingNarratives.has(selected.kelurahanId) && (
                    <span style={{ fontSize: 11, color: 'var(--accent)', animation: 'pulse-soft 1.5s ease-in-out infinite' }}>
                      menulis...
                    </span>
                  )}
                </div>

                {narratives[selected.kelurahanId] ? (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.72 }}>
                    {narratives[selected.kelurahanId].split('\n\n').map((para, i, arr) => (
                      <p key={i} style={{ margin: i < arr.length - 1 ? '0 0 10px' : 0 }}>{para}</p>
                    ))}
                  </div>
                ) : loadingNarratives.has(selected.kelurahanId) ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[100, 88, 72].map((w, i) => (
                      <div key={i} className="skeleton" style={{ height: 11, width: `${w}%` }} />
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const rank = result?.top.findIndex(t => t.kelurahanId === selected.kelurahanId) ?? 0;
                      fetchNarrative(selected.kelurahanId, rank + 1);
                    }}
                    style={{
                      fontSize: 12, color: 'var(--accent)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: 0, fontFamily: 'var(--font-body)',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    ✨ Generate analisis AI
                  </button>
                )}
              </div>
            </div>
          )}

          {/* DEVIL'S ADVOCATE */}
          {(loadingDevil || devil) && selected && (
            <div className="animate-fade-up" style={{ ...card, borderColor: 'rgba(248,113,113,0.22)', background: 'rgba(248,113,113,0.025)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 15, flexShrink: 0 }}>😈</span>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#f87171', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Devil's Advocate
                </div>
                {loadingDevil && (
                  <span style={{ fontSize: 11, color: '#f87171', marginLeft: 'auto', animation: 'pulse-soft 1.5s ease-in-out infinite' }}>
                    mencari kelemahan...
                  </span>
                )}
              </div>

              {loadingDevil && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {[1, 2, 3].map(i => (
                    <div key={i} className="skeleton" style={{ height: 46, borderRadius: 8 }} />
                  ))}
                </div>
              )}

              {devil && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 }}>
                    {devil.risks.map((risk, i) => {
                      const sevColor = risk.severity === 'high' ? '#f87171' : risk.severity === 'medium' ? '#fb923c' : '#fbbf24';
                      return (
                        <div key={i} style={{
                          display: 'flex', gap: 9, alignItems: 'flex-start',
                          padding: '9px 10px',
                          background: `${sevColor}09`,
                          border: `1px solid ${sevColor}22`,
                          borderRadius: 8,
                        }}>
                          <span style={{
                            fontSize: 8.5, fontWeight: 800, letterSpacing: '0.07em',
                            color: sevColor, background: `${sevColor}18`,
                            border: `1px solid ${sevColor}35`, borderRadius: 4,
                            padding: '2px 5px', flexShrink: 0, marginTop: 2,
                            textTransform: 'uppercase',
                          }}>
                            {risk.severity}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                            {risk.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{
                    borderTop: '1px solid rgba(248,113,113,0.12)',
                    paddingTop: 10,
                    fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.65, fontStyle: 'italic',
                  }}>
                    {devil.verdict}
                  </div>
                </>
              )}
            </div>
          )}

          {/* FEATURE C: Counterfactual Modal Sensitivity */}
          {selected && selected.sewa.minIdr && (
            <div className="animate-fade-up" style={{ ...card, borderColor: 'rgba(56,189,248,0.15)', background: 'rgba(56,189,248,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>🔮</span>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Simulasi Modal
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.55 }}>
                Bagaimana sewa berubah jika modal kamu berbeda?
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {(() => {
                  const minSewa = selected.sewa.minIdr!;
                  const scenarios = [
                    { label: 'Rp 50jt', modal: 50_000_000 },
                    { label: 'Rp 80jt', modal: 80_000_000 },
                    { label: 'Rp 100jt', modal: 100_000_000 },
                    { label: 'Rp 150jt', modal: 150_000_000 },
                    { label: 'Rp 200jt', modal: 200_000_000 },
                  ].filter((sc, _, arr) => {
                    // Show 3-4 scenarios bracketing the current modal
                    const current = modalIdr;
                    const sorted = arr.map(a => a.modal).sort((a,b) => a-b);
                    const idx = sorted.indexOf(sc.modal);
                    const ci = sorted.findIndex(m => m >= current);
                    return Math.abs(idx - ci) <= 1 || idx === 0 || idx === sorted.length - 1;
                  }).slice(0, 4);
                  return scenarios.map(sc => {
                    const ratio = Math.round((minSewa / sc.modal) * 100);
                    const isCurrent = sc.modal === modalIdr;
                    const status = ratio <= 15 ? { label: 'Aman', color: '#34d399' } : ratio <= 25 ? { label: 'Moderat', color: '#fbbf24' } : ratio <= 40 ? { label: 'Berat', color: '#fb923c' } : { label: 'Riskan', color: '#f87171' };
                    return (
                      <div key={sc.label} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 10px', borderRadius: 7,
                        border: isCurrent ? '1px solid rgba(56,189,248,0.35)' : '1px solid var(--border)',
                        background: isCurrent ? 'rgba(56,189,248,0.06)' : 'var(--bg-surface)',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: isCurrent ? 700 : 400, color: isCurrent ? 'var(--accent)' : 'var(--text-secondary)', minWidth: 58 }}>
                          {sc.label}{isCurrent ? ' ←' : ''}
                        </span>
                        <div style={{ flex: 1, height: 4, background: 'var(--bg-base)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(ratio, 100)}%`, height: '100%', background: status.color, borderRadius: 2, transition: 'width 0.5s ease' }} />
                        </div>
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', minWidth: 26, textAlign: 'right' }}>{ratio}%</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: status.color, background: `${status.color}15`, border: `1px solid ${status.color}30`, borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                          {status.label}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                % = sewa min tahunan dari modal kamu. ≤15% aman, 15-25% moderat, &gt;25% berat.
              </div>
            </div>
          )}

          {/* EXPORT PDF */}
          {selected && (narratives[selected.kelurahanId] || devil) && (
            <div className="animate-fade-up">
              <button
                onClick={handleExportPDF}
                style={{
                  width: '100%', padding: '10px 16px', borderRadius: 10,
                  border: '1px solid var(--border-active)',
                  background: 'var(--accent-dim)',
                  color: 'var(--accent)', fontFamily: 'var(--font-body)',
                  fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  transition: 'all 0.15s ease',
                }}
              >
                📄 Export PDF Report
              </button>
            </div>
          )}

          {/* EMPTY HINT */}
          {!result && !loading && !outOfScope && (
            <div style={{ textAlign: 'center', padding: '20px 16px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.65 }}>
              Isi parameter di atas dan klik analisis untuk melihat rekomendasi lokasi terbaik di peta.
            </div>
          )}
        </aside>

        {/* ── MAP ── */}
        <main style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <RecommendMap
            heatmap={result?.heatmap || []}
            top={qualifiedTop}
            spots={spots}
            selectedId={selectedId}
            onSelect={setSelectedId}
            flyTarget={flyTarget}
            isochroneTarget={flyTarget}
            theme={darkMode ? 'dark' : 'light'}
            routeGeometry={routeData?.geometry ?? null}
            routeFrom={routeData ? [routeData.from.lng, routeData.from.lat] : null}
            routeTo={routeData ? [routeData.to.lng, routeData.to.lat] : null}
            pickingActive={pickingActive}
            onMapPick={lngLat => {
              const handler = mapClickHandlerRef.current;
              mapClickHandlerRef.current = null;
              setPickingActive(false);
              handler?.(lngLat);
            }}
            routePanelOpen={routePanelOpen}
            onSpotForRoute={spot => {
              setDestinationHint({
                lng: spot.lng,
                lat: spot.lat,
                label: spot.name,
              });
            }}
          />
          {result && <MapLegend />}

          {/* Route panel */}
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 11 }}>
            <MapRouting
              mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN as string}
              destinationHint={destinationHint}
              onRouteChange={setRouteData}
              requestMapPick={cb => {
                mapClickHandlerRef.current = cb;
                setPickingActive(true);
              }}
              cancelMapPick={() => {
                mapClickHandlerRef.current = null;
                setPickingActive(false);
              }}
              picking={pickingActive}
              onOpenChange={setRoutePanelOpen}
            />
          </div>
        </main>
      </div>

      {/* ── STREET VIEW MODAL — klik di mana saja untuk menutup ── */}
      {svModalSpot && (
        <div
          onClick={() => setSvModalSpot(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <div
            className="animate-fade-up"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              overflow: 'hidden',
              maxWidth: 520,
              width: '90vw',
              boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
              cursor: 'default',
            }}
          >
            {/* Image — click opens Google Street View di tab baru, modal otomatis tertutup */}
            <div
              onClick={() => window.open(`https://www.google.com/maps?q=&layer=c&cbll=${svModalSpot.lat},${svModalSpot.lng}`, '_blank', 'noopener,noreferrer')}
              title="Buka di Google Street View"
              style={{ position: 'relative', width: '100%', paddingTop: '56.25%', cursor: 'pointer', background: 'var(--bg-surface)' }}
            >
              <img
                src={`/api/streetview?lat=${svModalSpot.lat}&lng=${svModalSpot.lng}&size=640x360`}
                alt="Street View"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div style={{
                position: 'absolute', bottom: 10, right: 10,
                background: 'rgba(0,0,0,0.6)', borderRadius: 6,
                padding: '4px 9px', fontSize: 10, color: '#fff', fontFamily: 'var(--font-body)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                🔗 Buka Street View
              </div>
            </div>

            {/* Info */}
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 3 }}>{svModalSpot.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>dekat {svModalSpot.anchorName}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{svModalSpot.kelurahan}, Kec. {svModalSpot.kecamatan}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, opacity: 0.7, textAlign: 'center' }}>
                Klik di mana saja di luar untuk menutup
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CHATBOT (floating) ── */}
      <Chatbot
        state={{
          businessType,
          modalIdr,
          userContext,
          sqlCategory,
          kotaKab,
          darkMode,
          hasResults: !!result,
          topRankings: qualifiedTop.map((t, i) => ({
            rank: i + 1,
            kelurahan: t.kelurahan,
            kecamatan: t.kecamatan,
            score: t.scores.final,
          })),
          selectedKelurahan: selected
            ? {
                kelurahan: selected.kelurahan,
                kecamatan: selected.kecamatan,
                rank: qualifiedTop.findIndex(t => t.kelurahanId === selected.kelurahanId) + 1,
                score: selected.scores.final,
              }
            : null,
          spotsForSelected: selectedId
            ? spots
                .filter(s => s.kelurahanId === selectedId)
                .slice(0, 10)
                .map((s, i) => ({
                  rank: i + 1,
                  name: s.name,
                  placeType: s.placeType,
                  anchorName: s.anchorName,
                  score: s.score,
                }))
            : [],
        }}
        actions={{
          setBusinessType,
          setModalIdr,
          setUserContext,
          setKotaKab,
          triggerSearch: overrides => runAnalysis(overrides),
          selectKelurahan: rank => {
            const t = qualifiedTop[rank - 1];
            if (!t) return;
            setSelectedId(t.kelurahanId);
            fetchNarrative(t.kelurahanId, rank);
            fetchDevilForItem(t);
            setCompareIds([]);
          },
          flyToSpot: spotRank => {
            if (!selectedId) return;
            const spotsInSelected = spots.filter(s => s.kelurahanId === selectedId);
            const target = spotsInSelected[spotRank - 1];
            if (!target) return;
            setSelectedSpotId(target.id);
            setFlyTarget([target.lng, target.lat]);
          },
          compareKelurahan: (rankA, rankB) => {
            const a = qualifiedTop[rankA - 1];
            const b = qualifiedTop[rankB - 1];
            if (!a || !b) return;
            setCompareIds([a.kelurahanId, b.kelurahanId]);
          },
          exportPDF: () => handleExportPDF(),
          toggleDarkMode: () => setDarkMode(v => !v),
        }}
      />
    </div>
  );
}
