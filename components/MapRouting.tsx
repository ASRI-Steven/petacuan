'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface Place {
  lng: number;
  lat: number;
  label: string;
}

export type TravelMode = 'driving' | 'walking' | 'cycling';

export interface RouteResult {
  geometry: GeoJSON.LineString;
  distance: number; // meters
  duration: number; // seconds
  from: Place;
  to: Place;
  mode: TravelMode;
}

interface MapRoutingProps {
  mapboxToken: string;
  /** Hint berisi tujuan terpilih (mis. dari klik kelurahan). Mengisi otomatis "To" saat panel dibuka. */
  destinationHint?: Place | null;
  /** Dipanggil setiap kali rute berubah (atau dihapus). */
  onRouteChange: (route: RouteResult | null) => void;
  /** Minta peta masuk mode pick — callback dipanggil saat user klik peta. */
  requestMapPick: (cb: (lngLat: [number, number]) => void) => void;
  /** Batalkan mode pick. */
  cancelMapPick: () => void;
  /** Apakah peta sedang menunggu klik (untuk feedback visual). */
  picking: boolean;
  /** Dipanggil saat panel dibuka/ditutup. */
  onOpenChange?: (open: boolean) => void;
}

// Bbox approximate untuk Tangerang Selatan
const TANGSEL_BBOX = '106.62,-6.42,106.82,-6.22';

const MODES: { value: TravelMode; label: string; icon: string }[] = [
  { value: 'driving', label: 'Mobil', icon: '🚗' },
  { value: 'walking', label: 'Jalan', icon: '🚶' },
  { value: 'cycling', label: 'Sepeda', icon: '🚴' },
];

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatDuration(s: number): string {
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} menit`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} jam ${m} menit` : `${h} jam`;
}

async function geocodeForward(query: string, token: string): Promise<Place[]> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${token}&country=id&bbox=${TANGSEL_BBOX}&limit=5&language=id&autocomplete=true`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features ?? []).map((f: any) => ({
      lng: f.center[0],
      lat: f.center[1],
      label: f.place_name ?? f.text ?? '',
    }));
  } catch {
    return [];
  }
}

async function geocodeReverse(lng: number, lat: number, token: string): Promise<Place> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
    `?access_token=${token}&language=id&limit=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const f = data.features?.[0];
    if (f) return { lng, lat, label: f.place_name ?? f.text };
  } catch {
    // fall through
  }
  return { lng, lat, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
}

export function MapRouting({
  mapboxToken,
  destinationHint,
  onRouteChange,
  requestMapPick,
  cancelMapPick,
  picking,
  onOpenChange,
}: MapRoutingProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  const [fromSugs, setFromSugs] = useState<Place[]>([]);
  const [toSugs, setToSugs] = useState<Place[]>([]);
  const [showFromSugs, setShowFromSugs] = useState(false);
  const [showToSugs, setShowToSugs] = useState(false);
  const [mode, setMode] = useState<TravelMode>('driving');
  const [summary, setSummary] = useState<{ distance: number; duration: number } | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePickField, setActivePickField] = useState<'from' | 'to' | null>(null);
  const [locating, setLocating] = useState<'from' | 'to' | null>(null);

  const lastHintRef = useRef<string | null>(null);

  // Auto-isi "To" saat destinationHint berubah (silent — panel tidak auto-open)
  useEffect(() => {
    if (!destinationHint) return;
    const hintKey = `${destinationHint.lng},${destinationHint.lat}`;
    if (lastHintRef.current === hintKey) return;
    lastHintRef.current = hintKey;
    setTo(destinationHint);
    setToQuery(destinationHint.label);
  }, [destinationHint]);

  // Lapor status open ke parent
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // Saat panel dibuka & "Dari" kosong: kalau permission lokasi sudah granted, auto-fill silent
  useEffect(() => {
    if (!open || from) return;
    if (typeof navigator === 'undefined' || !('permissions' in navigator)) return;
    let cancelled = false;
    (navigator.permissions as Permissions)
      .query({ name: 'geolocation' as PermissionName })
      .then(perm => {
        if (cancelled || perm.state !== 'granted') return;
        useMyLocation('from');
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced geocoding for "from"
  useEffect(() => {
    if (!fromQuery.trim() || fromQuery.length < 2 || from?.label === fromQuery) {
      setFromSugs([]);
      return;
    }
    const t = setTimeout(() => {
      geocodeForward(fromQuery, mapboxToken).then(setFromSugs);
    }, 250);
    return () => clearTimeout(t);
  }, [fromQuery, mapboxToken, from]);

  // Debounced geocoding for "to"
  useEffect(() => {
    if (!toQuery.trim() || toQuery.length < 2 || to?.label === toQuery) {
      setToSugs([]);
      return;
    }
    const t = setTimeout(() => {
      geocodeForward(toQuery, mapboxToken).then(setToSugs);
    }, 250);
    return () => clearTimeout(t);
  }, [toQuery, mapboxToken, to]);

  // Fetch directions when from/to/mode changes
  useEffect(() => {
    if (!from || !to) {
      setSummary(null);
      onRouteChange(null);
      return;
    }
    let cancelled = false;
    setLoadingRoute(true);
    setError(null);

    const url =
      `https://api.mapbox.com/directions/v5/mapbox/${mode}/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?geometries=geojson&overview=full&access_token=${mapboxToken}`;

    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (!data.routes || data.routes.length === 0) {
          setError('Rute tidak ditemukan');
          setSummary(null);
          onRouteChange(null);
          return;
        }
        const r = data.routes[0];
        setSummary({ distance: r.distance, duration: r.duration });
        onRouteChange({
          geometry: r.geometry as GeoJSON.LineString,
          distance: r.distance,
          duration: r.duration,
          from,
          to,
          mode,
        });
      })
      .catch(err => {
        if (cancelled) return;
        setError('Gagal mengambil rute');
        console.error(err);
      })
      .finally(() => {
        if (!cancelled) setLoadingRoute(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, mode, mapboxToken]);

  function useMyLocation(field: 'from' | 'to') {
    if (!('geolocation' in navigator)) {
      setError('Browser tidak mendukung Geolocation API.');
      return;
    }
    setLocating(field);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const place: Place = {
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          label: 'Lokasi saya',
        };
        if (field === 'from') {
          setFrom(place);
          setFromQuery(place.label);
        } else {
          setTo(place);
          setToQuery(place.label);
        }
        setLocating(null);
      },
      err => {
        setLocating(null);
        if (err.code === err.PERMISSION_DENIED) {
          setError('Izin lokasi ditolak. Aktifkan di pengaturan browser.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError('Lokasi tidak tersedia.');
        } else if (err.code === err.TIMEOUT) {
          setError('Waktu permintaan lokasi habis.');
        } else {
          setError('Gagal mendapatkan lokasi.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function startPickFromMap(field: 'from' | 'to') {
    if (activePickField === field) {
      setActivePickField(null);
      cancelMapPick();
      return;
    }
    setActivePickField(field);
    setShowFromSugs(false);
    setShowToSugs(false);
    requestMapPick(async lngLat => {
      const place = await geocodeReverse(lngLat[0], lngLat[1], mapboxToken);
      if (field === 'from') {
        setFrom(place);
        setFromQuery(place.label);
      } else {
        setTo(place);
        setToQuery(place.label);
      }
      setActivePickField(null);
    });
  }

  function selectSuggestion(field: 'from' | 'to', p: Place) {
    if (field === 'from') {
      setFrom(p);
      setFromQuery(p.label);
      setShowFromSugs(false);
      setFromSugs([]);
    } else {
      setTo(p);
      setToQuery(p.label);
      setShowToSugs(false);
      setToSugs([]);
    }
  }

  function swap() {
    const f = from;
    const t = to;
    const fq = fromQuery;
    const tq = toQuery;
    setFrom(t);
    setTo(f);
    setFromQuery(tq);
    setToQuery(fq);
  }

  function clearAll() {
    setFrom(null);
    setTo(null);
    setFromQuery('');
    setToQuery('');
    setFromSugs([]);
    setToSugs([]);
    setSummary(null);
    setError(null);
    setActivePickField(null);
    cancelMapPick();
    onRouteChange(null);
  }

  function close() {
    setOpen(false);
    cancelMapPick();
    setActivePickField(null);
  }

  // ─── COLLAPSED BUTTON ───
  if (!open) {
    const hasRoute = from && to && summary;
    return (
      <button
        onClick={() => setOpen(true)}
        title="Buka panel rute"
        style={{
          padding: '8px 14px 8px 10px',
          borderRadius: 999,
          border: '1px solid var(--border-active)',
          background: 'var(--bg-card)',
          backdropFilter: 'blur(20px)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-body)',
          fontSize: 12.5,
          fontWeight: 600,
          boxShadow: 'var(--chatbot-fab-shadow)',
          transition: 'all 0.18s ease',
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-active)')}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--violet) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 8px var(--accent-glow)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12l5-9 5 9-5 9-5-9z" transform="rotate(0)" />
            <path d="M12 2v20M2 12h20" opacity="0" />
            <path d="M3 12l9-9 9 9-9 9-9-9z" />
          </svg>
        </span>
        <span>{hasRoute ? `${formatDistance(summary!.distance)} · ${formatDuration(summary!.duration)}` : 'Rute'}</span>
      </button>
    );
  }

  // ─── EXPANDED PANEL ───
  return (
    <div
      className="animate-fade-up"
      style={{
        width: 320,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: 'var(--chatbot-panel-shadow)',
        backdropFilter: 'blur(20px)',
        fontFamily: 'var(--font-body)',
        overflow: 'visible',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, var(--accent-dim) 0%, transparent 100%)',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          borderRadius: '14px 14px 0 0',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--violet) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 10px var(--accent-glow)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12l9-9 9 9-9 9-9-9z" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1 }}>Rute</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            Cari arah dari titik mana saja
          </div>
        </div>
        <button
          onClick={close}
          title="Tutup"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      {/* Quick-help tip (hanya saat belum lengkap) */}
      {(!from || !to) && (
        <div
          style={{
            margin: '10px 12px 0',
            padding: '8px 10px',
            borderRadius: 7,
            background: 'var(--accent-dim)',
            border: '1px solid var(--border-active)',
            fontSize: 11,
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
          }}
        >
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>Cara cepat:</span>{' '}
          tap ikon <span style={{ color: 'var(--accent)' }}>📍</span> untuk pakai lokasi Anda,
          tap <span style={{ color: 'var(--accent)' }}>🎯</span> lalu klik peta, atau klik langsung marker spot di peta untuk set tujuan.
        </div>
      )}

      {/* Inputs */}
      <div style={{ padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <RouteInput
          label="Dari"
          icon={<DotIcon color="var(--accent)" />}
          value={fromQuery}
          onChange={v => {
            setFromQuery(v);
            setShowFromSugs(true);
            if (from && from.label !== v) setFrom(null);
          }}
          onFocus={() => setShowFromSugs(true)}
          onBlur={() => setTimeout(() => setShowFromSugs(false), 180)}
          suggestions={showFromSugs ? fromSugs : []}
          onSelectSuggestion={p => selectSuggestion('from', p)}
          onUseMyLocation={() => useMyLocation('from')}
          onPickMap={() => startPickFromMap('from')}
          locating={locating === 'from'}
          picking={activePickField === 'from' && picking}
          placeholder="Lokasi saya, alamat, atau klik peta"
        />

        {/* Swap */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -4, marginBottom: -4 }}>
          <button
            onClick={swap}
            disabled={!from && !to}
            title="Tukar Dari & Ke"
            style={{
              width: 28,
              height: 22,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              color: 'var(--text-muted)',
              cursor: !from && !to ? 'not-allowed' : 'pointer',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ⇅
          </button>
        </div>

        <RouteInput
          label="Ke"
          icon={<DotIcon color="var(--red)" filled />}
          value={toQuery}
          onChange={v => {
            setToQuery(v);
            setShowToSugs(true);
            if (to && to.label !== v) setTo(null);
          }}
          onFocus={() => setShowToSugs(true)}
          onBlur={() => setTimeout(() => setShowToSugs(false), 180)}
          suggestions={showToSugs ? toSugs : []}
          onSelectSuggestion={p => selectSuggestion('to', p)}
          onUseMyLocation={() => useMyLocation('to')}
          onPickMap={() => startPickFromMap('to')}
          locating={locating === 'to'}
          picking={activePickField === 'to' && picking}
          placeholder="Tujuan, atau klik peta"
        />
      </div>

      {/* Mode toggle */}
      <div style={{ padding: '4px 12px 10px' }}>
        <div
          style={{
            display: 'flex',
            gap: 6,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
          }}
        >
          {MODES.map(m => {
            const active = mode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                title={m.label}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: 'none',
                  background: active
                    ? 'linear-gradient(135deg, var(--accent) 0%, var(--violet) 100%)'
                    : 'transparent',
                  color: active ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 12.5,
                  fontWeight: active ? 700 : 500,
                  fontFamily: 'var(--font-body)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: 14 }}>{m.icon}</span>
                <span style={{ fontSize: 10.5 }}>{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary / status */}
      <div style={{ padding: '0 12px 12px' }}>
        {loadingRoute && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
            Menghitung rute...
          </div>
        )}
        {!loadingRoute && error && (
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--red)',
              background: 'color-mix(in srgb, var(--red) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--red) 28%, transparent)',
              borderRadius: 7,
              padding: '7px 10px',
            }}
          >
            {error}
          </div>
        )}
        {!loadingRoute && !error && summary && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '9px 11px',
              borderRadius: 8,
              background: 'var(--accent-dim)',
              border: '1px solid var(--border-active)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.01em' }}>
                {formatDistance(summary.distance)} · {formatDuration(summary.duration)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                via {MODES.find(m => m.value === mode)?.label.toLowerCase()}
              </span>
            </div>
            <button
              onClick={clearAll}
              title="Hapus rute"
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
              }}
            >
              Hapus
            </button>
          </div>
        )}
        {!loadingRoute && !error && !summary && (from || to) && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>
            Tentukan kedua titik untuk melihat rute.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───

function DotIcon({ color, filled = false }: { color: string; filled?: boolean }) {
  return (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        border: `2px solid ${color}`,
        background: filled ? color : 'transparent',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

interface RouteInputProps {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  suggestions: Place[];
  onSelectSuggestion: (p: Place) => void;
  onUseMyLocation: () => void;
  onPickMap: () => void;
  locating: boolean;
  picking: boolean;
  placeholder: string;
}

function RouteInput({
  label,
  icon,
  value,
  onChange,
  onFocus,
  onBlur,
  suggestions,
  onSelectSuggestion,
  onUseMyLocation,
  onPickMap,
  locating,
  picking,
  placeholder,
}: RouteInputProps) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 8px 7px 10px',
          background: 'var(--bg-surface)',
          border: `1px solid ${picking ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 8,
          transition: 'border-color 0.15s ease',
        }}
      >
        {icon}
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: 12.5,
            fontFamily: 'var(--font-body)',
            padding: 0,
          }}
        />
        <button
          type="button"
          onClick={onUseMyLocation}
          disabled={locating}
          title="Gunakan lokasi saya"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: locating ? 'var(--accent)' : 'var(--text-muted)',
            cursor: locating ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={e => (e.currentTarget.style.color = locating ? 'var(--accent)' : 'var(--text-muted)')}
        >
          {locating ? (
            <span style={{ width: 12, height: 12, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onPickMap}
          title="Pilih titik di peta"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: picking ? '1px solid var(--accent)' : 'none',
            background: picking ? 'var(--accent-dim)' : 'transparent',
            color: picking ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.15s, background 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => {
            if (!picking) e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={e => {
            if (!picking) e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
          </svg>
        </button>
      </div>

      {suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            zIndex: 20,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.lng},${s.lat},${i}`}
              onMouseDown={e => {
                e.preventDefault(); // prevent blur
                onSelectSuggestion(s);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                background: 'transparent',
                border: 'none',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
                color: 'var(--text-primary)',
                fontSize: 11.5,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                lineHeight: 1.4,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
