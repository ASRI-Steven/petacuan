'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

// Leaflet harus di-load client-side only
const RecommendMap = dynamic(
  () => import('@/components/RecommendMap'),
  { 
    ssr: false, 
    loading: () => <div className="h-full bg-gray-100 flex items-center justify-center">Loading map...</div> 
  }
) as React.ComponentType<{
  heatmap: Array<{
    lat: number;
    lng: number;
    kelurahanId: number;
    kelurahan: string;
    kecamatan: string;
    score: number;
  }>;
  top: Array<{
    kelurahanId: number;
    kelurahan: string;
    kecamatan: string;
    coordinates: { lat: number; lng: number };
    scores: { final: number };
  }>;
  selectedId: number | null;
  onSelect: (id: number) => void;
}>;

const BUSINESS_TYPES = [
  { value: 'warkop', label: 'Warung Kopi / Cafe' },
  { value: 'restoran', label: 'Restoran / Rumah Makan' },
  { value: 'laundry', label: 'Laundry Kiloan' },
  { value: 'klinik', label: 'Klinik / Dokter' },
  { value: 'salon', label: 'Salon Kecantikan' },
  { value: 'minimarket', label: 'Minimarket' },
  { value: 'apotek', label: 'Apotek' },
  { value: 'fotokopi', label: 'Fotokopi & Print' },
  { value: 'bengkel', label: 'Bengkel Kendaraan' },
  { value: 'barbershop', label: 'Barbershop' },
];

interface ApiResponse {
  top: Array<{
    kelurahanId: number;
    kelurahan: string;
    kecamatan: string;
    coordinates: { lat: number; lng: number };
    demografis: { jumlahPenduduk: number; demandTarget: number };
    market: { competitorCount: number; anchorCount: number };
    scores: {
      demand: number;
      competition: number;
      anchor: number;
      access: number;
      affordability: number;
      final: number;
    };
    sewa: { minIdr: number | null; maxIdr: number | null; format: string };
  }>;
  heatmap: Array<{
    lat: number;
    lng: number;
    kelurahanId: number;
    kelurahan: string;
    kecamatan: string;
    score: number;
  }>;
}

export default function Home() {
  const [businessType, setBusinessType] = useState('warkop');
  const [modalIdr, setModalIdr] = useState(80000000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [narratives, setNarratives] = useState<Record<number, string>>({});
  const [loadingNarratives, setLoadingNarratives] = useState<Set<number>>(new Set());
  
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setNarratives({});
    
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessType, modalIdr, topN: 3 }),
      });
      
      if (!res.ok) throw new Error('API error');
      
      const data = await res.json();
      setResult(data);
      
      // Auto-select top 1
      if (data.top.length > 0) setSelectedId(data.top[0].kelurahanId);

      data.top.forEach((t: any, idx: number) => {
        fetchNarrative(t.kelurahanId, idx + 1);
      });
    } catch (err) {
      console.error(err);
      alert('Gagal mengambil rekomendasi');
    } finally {
      setLoading(false);
    }
  }

  async function fetchNarrative(kelurahanId: number, rank: number) {
    // Skip jika udah ada atau sedang loading
    if (narratives[kelurahanId] || loadingNarratives.has(kelurahanId)) return;
    
    // Mark as loading
    setLoadingNarratives(prev => new Set(prev).add(kelurahanId));
    
    try {
      const res = await fetch('/api/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kelurahanId,
          businessType,
          modalIdr,
          rank,
        }),
      });
      
      if (!res.ok) throw new Error('Narrative API error');
      
      const data = await res.json();
      setNarratives(prev => ({ ...prev, [kelurahanId]: data.narrative }));
    } catch (err) {
      console.error(err);
      setNarratives(prev => ({ 
        ...prev, 
        [kelurahanId]: 'Gagal mengambil analisis. Coba lagi.' 
      }));
    } finally {
      // Remove from loading set
      setLoadingNarratives(prev => {
        const next = new Set(prev);
        next.delete(kelurahanId);
        return next;
      });
    }
  }

  function formatIdr(n: number) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(n);
  }

  const selected = result?.top.find(t => t.kelurahanId === selectedId);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">🗺️ PetaCuan</h1>
            <p className="text-xs text-gray-500">AI Lokasi & Format Usaha untuk UMKM Indonesia</p>
          </div>
          <span className="text-xs text-gray-400">Tangerang Selatan • Demo</span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-4">
        {/* Sidebar */}
        <aside className="col-span-12 md:col-span-4 space-y-4">
          {/* Form */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Pasang Modal Lo</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Jenis Usaha
                </label>
                <select
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {BUSINESS_TYPES.map(b => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Modal (IDR/tahun)
                </label>
                <input
                  type="number"
                  value={modalIdr}
                  onChange={(e) => setModalIdr(Number(e.target.value))}
                  min={1000000}           
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">{formatIdr(modalIdr)}</p>
              </div>
              
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white font-medium py-2.5 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '🔍 Menganalisis...' : '🚀 Cari Lokasi Terbaik'}
              </button>
            </form>
          </div>

          {/* Top 3 results */}
          {result && (
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 mb-3">🏆 Top 3 Rekomendasi</h3>
              <div className="space-y-2">
                {result.top.map((t, idx) => (
                  <button
                    key={t.kelurahanId}
                    onClick={() => setSelectedId(t.kelurahanId)}
                    className={`w-full text-left p-3 rounded-md border-2 transition ${
                      selectedId === t.kelurahanId
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-xs font-medium text-gray-500">#{idx + 1}</div>
                        <div className="font-medium text-gray-900">{t.kelurahan}</div>
                        <div className="text-xs text-gray-500">{t.kecamatan}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-blue-600">{t.scores.final}</div>
                        <div className="text-xs text-gray-500">skor</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Detail panel */}
          {selected && (
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 mb-3">📊 Detail: {selected.kelurahan}</h3>
              
              <div className="space-y-3">
                {/* Demografi */}
                <div className="text-sm">
                  <div className="font-medium text-gray-700">Penduduk</div>
                  <div className="text-gray-900">
                    {selected.demografis.jumlahPenduduk.toLocaleString()} jiwa
                  </div>
                  <div className="text-xs text-gray-500">
                    Target customer: ~{selected.demografis.demandTarget.toLocaleString()}
                  </div>
                </div>
                
                {/* Sewa */}
                <div className="text-sm">
                  <div className="font-medium text-gray-700">Estimasi Sewa</div>
                  <div className="text-gray-900">
                    {selected.sewa.minIdr && selected.sewa.maxIdr
                      ? `${formatIdr(selected.sewa.minIdr)} - ${formatIdr(selected.sewa.maxIdr)} / thn`
                      : 'Data tidak tersedia'}
                  </div>
                  <div className="text-xs text-gray-500">Format: {selected.sewa.format}</div>
                </div>
                
                {/* Score breakdown */}
                <div className="text-sm">
                  <div className="font-medium text-gray-700 mb-2">Score Breakdown</div>
                  <div className="space-y-1">
                    {[
                      { label: 'Demand', value: selected.scores.demand },
                      { label: 'Kompetisi', value: selected.scores.competition },
                      { label: 'Anchor', value: selected.scores.anchor },
                      { label: 'Akses', value: selected.scores.access },
                      { label: 'Modal Match', value: selected.scores.affordability },
                    ].map(s => (
                      <div key={s.label} className="flex items-center gap-2">
                        <div className="w-20 text-xs text-gray-600">{s.label}</div>
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500"
                            style={{ width: `${s.value}%` }}
                          />
                        </div>
                        <div className="w-10 text-xs font-medium text-right">{s.value.toFixed(0)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* AI Narrative */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-700">🤖 Analisis AI</span>
                  {loadingNarratives.has(selected.kelurahanId) && (
                    <span className="text-xs text-blue-600 animate-pulse">menulis...</span>
                  )}
                </div>
                
                {narratives[selected.kelurahanId] ? (
                  <div className="text-sm text-gray-700 space-y-2 leading-relaxed">
                    {narratives[selected.kelurahanId].split('\n\n').map((para, idx) => (
                      <p key={idx}>{para}</p>
                    ))}
                  </div>
                ) : loadingNarratives.has(selected.kelurahanId) ? (
                  <div className="space-y-2">
                    <div className="h-3 bg-gray-200 rounded animate-pulse w-full" />
                    <div className="h-3 bg-gray-200 rounded animate-pulse w-5/6" />
                    <div className="h-3 bg-gray-200 rounded animate-pulse w-4/6" />
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const rank = result?.top.findIndex(t => t.kelurahanId === selected.kelurahanId);
                      fetchNarrative(selected.kelurahanId, (rank ?? 0) + 1);
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Klik untuk generate analisis AI
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Map */}
        <main className="col-span-12 md:col-span-8">
          <div className="bg-white rounded-lg shadow-sm h-[calc(100vh-160px)] overflow-hidden">
            <RecommendMap
              heatmap={result?.heatmap || []}
              top={result?.top || []}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </main>
      </div>
    </div>
  );
}