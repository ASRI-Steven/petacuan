'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { RecommendMapProps, Spot } from './RecommendMap.types';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN as string;

const TANGSEL_CENTER: [number, number] = [106.71, -6.30];
const RANK_COLORS = ['#fbbf24', '#94a3b8', '#fb923c'];

const ISO_COLORS = ['#34d399', '#fbbf24', '#f87171'] as const; // 5, 10, 15 min

function presetFromHour(h: number): 'dawn' | 'day' | 'dusk' | 'night' {
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 19) return 'dusk';
  return 'night';
}

// CRITICAL: Mapbox owns el.style.transform for anchor positioning.
// Hover scale must target an INNER element only — never the outer el.
function createSpotMarker(spot: Spot, rankIdx: number, localIdx: number): HTMLElement {
  const rColor = RANK_COLORS[rankIdx] ?? RANK_COLORS[2];
  const imgUrl = `/api/streetview?lat=${spot.lat}&lng=${spot.lng}`;

  const el = document.createElement('div');
  el.style.cssText = 'cursor:pointer;';

  el.innerHTML = `
    <div class="mk-inner" style="
      width:46px;height:46px;border-radius:50%;overflow:hidden;
      border:2.5px solid ${rColor};
      box-shadow:0 2px 10px rgba(0,0,0,0.45),0 0 0 1px ${rColor}50;
      display:flex;align-items:center;justify-content:center;
      background:${rColor}30;position:relative;
      transition:transform 0.15s ease,box-shadow 0.15s ease;
      transform-origin:center center;
    ">
      <img src="${imgUrl}"
        style="position:absolute;top:0;left:0;width:100%;height:145%;object-fit:cover;object-position:center top;"
        onerror="this.style.display='none'"
      />
      <span style="
        position:relative;z-index:1;
        font-family:system-ui,sans-serif;font-weight:800;font-size:13px;
        color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.9);
      ">${localIdx + 1}</span>
    </div>
  `;

  const inner = el.querySelector('.mk-inner') as HTMLElement;
  el.addEventListener('mouseenter', () => {
    inner.style.transform = 'scale(1.3)';
    inner.style.boxShadow = `0 4px 16px rgba(0,0,0,0.5),0 0 0 2px ${rColor}80`;
  });
  el.addEventListener('mouseleave', () => {
    inner.style.transform = '';
    inner.style.boxShadow = `0 2px 10px rgba(0,0,0,0.45),0 0 0 1px ${rColor}50`;
  });

  return el;
}

interface Props extends RecommendMapProps {
  theme?: 'dark' | 'light';
  isochroneTarget?: [number, number] | null;
  /** GeoJSON LineString untuk rute terhitung. Null = tidak ada rute. */
  routeGeometry?: GeoJSON.LineString | null;
  routeFrom?: [number, number] | null;
  routeTo?: [number, number] | null;
  /** True = peta sedang menunggu klik user untuk memilih titik. */
  pickingActive?: boolean;
  /** Dipanggil saat user klik peta saat pickingActive=true. */
  onMapPick?: (lngLat: [number, number]) => void;
  /** True = panel rute terbuka. Klik marker akan jadi set tujuan, bukan buka Street View. */
  routePanelOpen?: boolean;
  /** Dipanggil saat marker spot diklik & panel rute sedang terbuka. */
  onSpotForRoute?: (spot: Spot) => void;
}

export default function RecommendMap({
  heatmap,
  top,
  spots,
  selectedId,
  onSelect,
  flyTarget,
  theme,
  isochroneTarget,
  routeGeometry,
  routeFrom,
  routeTo,
  pickingActive,
  onMapPick,
  routePanelOpen,
  onSpotForRoute,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const spotMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [isoProfile, setIsoProfile] = useState<'walking' | 'driving'>('walking');

  // Refs untuk membaca state terbaru dari handler marker yang dibikin sekali
  const routePanelOpenRef = useRef<boolean>(false);
  const onSpotForRouteRef = useRef<((spot: Spot) => void) | undefined>(undefined);
  useEffect(() => { routePanelOpenRef.current = !!routePanelOpen; }, [routePanelOpen]);
  useEffect(() => { onSpotForRouteRef.current = onSpotForRoute; }, [onSpotForRoute]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      center: TANGSEL_CENTER,
      zoom: 12,
      pitch: 0,
      bearing: 0,
      antialias: true,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.on('error', e => console.error('Mapbox error:', e.error?.message));

    map.on('style.load', () => {
      const preset = theme === 'light' ? 'day' : presetFromHour(new Date().getHours());
      try {
        map.setConfigProperty('basemap', 'lightPreset', preset);
        map.setConfigProperty('basemap', 'showPointOfInterestLabels', true);
        map.setConfigProperty('basemap', 'show3dObjects', true);
      } catch {
        // style import not yet resolved
      }
      setStyleReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Choropleth
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || heatmap.length === 0) return;

    fetch('/api/kelurahan-geom')
      .then(r => r.json())
      .then(geo => {
        const enriched = {
          ...geo,
          features: geo.features.map((f: any) => {
            const s = heatmap.find(h => h.kelurahanId === f.properties.kelurahanId);
            return {
              ...f,
              properties: {
                ...f.properties,
                score: s?.score ?? 0,
                hasData: s ? 1 : 0,
                kelurahan: s?.kelurahan ?? f.properties.kelurahan ?? '',
                kecamatan: s?.kecamatan ?? f.properties.kecamatan ?? '',
              },
            };
          }),
        };

        if (map.getSource('kelurahan')) {
          (map.getSource('kelurahan') as mapboxgl.GeoJSONSource).setData(enriched);
          return;
        }

        map.addSource('kelurahan', { type: 'geojson', data: enriched });

        map.addLayer({
          id: 'kelurahan-fill',
          type: 'fill',
          source: 'kelurahan',
          slot: 'middle',
          paint: {
            'fill-color': [
              'case',
              ['==', ['get', 'hasData'], 0], 'rgba(255,255,255,0.01)',
              ['>=', ['get', 'score'], 70], '#34d399',
              ['>=', ['get', 'score'], 55], '#86efac',
              ['>=', ['get', 'score'], 40], '#fbbf24',
              ['>=', ['get', 'score'], 25], '#fb923c',
              '#f87171',
            ],
            'fill-opacity': 0.38,
            'fill-emissive-strength': 0.85,
          },
        });

        map.addLayer({
          id: 'kelurahan-line',
          type: 'line',
          source: 'kelurahan',
          slot: 'middle',
          paint: {
            'line-color': 'rgba(255,255,255,0.15)',
            'line-width': 0.8,
            'line-emissive-strength': 0.8,
          },
        });

        map.on('mousemove', 'kelurahan-fill', (e) => {
          const f = e.features?.[0];
          if (!f?.properties?.hasData) return;
          map.getCanvas().style.cursor = 'pointer';

          const score = f.properties.score as number;
          const scoreCol = score >= 70 ? '#34d399' : score >= 55 ? '#86efac' : score >= 40 ? '#fbbf24' : score >= 25 ? '#fb923c' : '#f87171';

          if (!popupRef.current) {
            popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
          }

          popupRef.current
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-weight:700;font-size:13px;color:#e8f0ff;margin-bottom:2px">${f.properties.kelurahan}</div>
              <div style="font-size:11px;color:#7a90b8;margin-bottom:5px">${f.properties.kecamatan}</div>
              ${score > 0 ? `<div style="font-size:12px;font-weight:700;color:${scoreCol}">● Skor ${score}</div>` : ''}
            `)
            .addTo(map);
        });

        map.on('mouseleave', 'kelurahan-fill', () => {
          map.getCanvas().style.cursor = '';
          popupRef.current?.remove();
          popupRef.current = null;
        });

        map.on('click', 'kelurahan-fill', (e) => {
          const id = e.features?.[0]?.properties?.kelurahanId;
          if (id) onSelect?.(id);
        });
      })
      .catch(err => console.error('geom load failed:', err));
  }, [heatmap, styleReady, onSelect]);

  // Highlight selected kelurahan
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('kelurahan-fill')) return;

    if (selectedId) {
      map.setPaintProperty('kelurahan-fill', 'fill-opacity', [
        'case',
        ['==', ['get', 'hasData'], 0], 0.01,
        ['==', ['get', 'kelurahanId'], selectedId], 0.72,
        0.35,
      ]);
      map.setPaintProperty('kelurahan-line', 'line-color', [
        'case',
        ['==', ['get', 'kelurahanId'], selectedId], '#38bdf8',
        'rgba(255,255,255,0.12)',
      ]);
      map.setPaintProperty('kelurahan-line', 'line-width', [
        'case',
        ['==', ['get', 'kelurahanId'], selectedId], 2.5,
        0.8,
      ]);
    } else {
      map.setPaintProperty('kelurahan-fill', 'fill-opacity', 0.38);
      map.setPaintProperty('kelurahan-line', 'line-color', 'rgba(255,255,255,0.15)');
      map.setPaintProperty('kelurahan-line', 'line-width', 0.8);
    }
  }, [selectedId]);

  // Spot markers from real OSM POI coordinates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    spotMarkersRef.current.forEach(m => m.remove());
    spotMarkersRef.current = [];

    if (spots.length === 0 || top.length === 0) return;

    const rankMap = new Map(top.map((t, i) => [t.kelurahanId, i]));
    const localCounts = new Map<number, number>();

    spots.forEach(spot => {
      const rankIdx = rankMap.get(spot.kelurahanId) ?? 0;
      const localIdx = localCounts.get(spot.kelurahanId) ?? 0;
      localCounts.set(spot.kelurahanId, localIdx + 1);

      const rColor = RANK_COLORS[rankIdx] ?? RANK_COLORS[2];
      const el = createSpotMarker(spot, rankIdx, localIdx);

      el.addEventListener('click', () => {
        // Mode rute aktif: set spot sebagai tujuan, jangan buka Street View
        if (routePanelOpenRef.current && onSpotForRouteRef.current) {
          onSpotForRouteRef.current(spot);
          return;
        }
        // Mode normal: select kelurahan + buka Google Street View di tab baru
        onSelect?.(spot.kelurahanId);
        window.open(
          `https://www.google.com/maps?q=&layer=c&cbll=${spot.lat},${spot.lng}`,
          '_blank',
          'noopener,noreferrer'
        );
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([spot.lng, spot.lat])
        .addTo(map);

      spotMarkersRef.current.push(marker);
    });

    const first = spots[0];
    if (first) {
      map.flyTo({ center: [first.lng, first.lat], zoom: 14, pitch: 0, bearing: 0, duration: 1400 });
    }
  }, [spots, top, styleReady, onSelect]);

  // Fly to spot when sidebar item clicked
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTarget) return;
    map.flyTo({ center: flyTarget, zoom: 17, pitch: 0, bearing: 0, duration: 900 });
  }, [flyTarget]);

  // Isochrone overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    const removeIsochrone = () => {
      ['isochrone-fill', 'isochrone-line'].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource('isochrone')) map.removeSource('isochrone');
    };

    if (!isochroneTarget) {
      removeIsochrone();
      return;
    }

    const [lng, lat] = isochroneTarget;
    const profile = isoProfile === 'driving' ? 'mapbox/driving' : 'mapbox/walking';

    fetch(
      `https://api.mapbox.com/isochrone/v1/${profile}/${lng},${lat}` +
      `?contours_minutes=5,10,15&contours_colors=34d399,fbbf24,f87171&polygons=true` +
      `&access_token=${mapboxgl.accessToken}`
    )
      .then(r => r.json())
      .then(geojson => {
        if (!mapRef.current) return;
        removeIsochrone();

        map.addSource('isochrone', { type: 'geojson', data: geojson });

        // Layer di atas heatmap kelurahan tanpa beforeId — slot: 'middle' sudah ngatur posisi
        // Fill sangat tipis biar heatmap di bawahnya tetap kelihatan
        map.addLayer({
          id: 'isochrone-fill',
          type: 'fill',
          source: 'isochrone',
          slot: 'middle',
          paint: {
            'fill-color': ['coalesce', ['get', 'color'], ['get', 'fill'], '#38bdf8'],
            'fill-opacity': 0.08,
          },
        });

        map.addLayer({
          id: 'isochrone-line',
          type: 'line',
          source: 'isochrone',
          slot: 'middle',
          paint: {
            'line-color': ['coalesce', ['get', 'color'], ['get', 'fill'], '#38bdf8'],
            'line-width': 2.2,
            'line-opacity': 0.92,
            'line-blur': 0.4,
          },
        });
      })
      .catch(err => console.warn('Isochrone fetch failed:', err));

    return removeIsochrone;
  }, [isochroneTarget, isoProfile, styleReady]);

  // ─── Route overlay (line + start/end markers) ───
  const routeFromMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const routeToMarkerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    const removeRoute = () => {
      ['route-line', 'route-line-bg'].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource('route')) map.removeSource('route');
    };

    if (!routeGeometry) {
      removeRoute();
      return;
    }

    const data: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: routeGeometry,
    };

    if (map.getSource('route')) {
      (map.getSource('route') as mapboxgl.GeoJSONSource).setData(data);
    } else {
      map.addSource('route', { type: 'geojson', data });
      map.addLayer({
        id: 'route-line-bg',
        type: 'line',
        source: 'route',
        slot: 'top',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#0b1324',
          'line-width': 9,
          'line-opacity': 0.6,
        },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        slot: 'top',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': 5,
          'line-opacity': 0.95,
          'line-emissive-strength': 1,
        },
      });
    }

    // Fit map ke bounding box rute
    const coords = routeGeometry.coordinates;
    if (coords.length > 1) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c as [number, number]),
        new mapboxgl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number])
      );
      map.fitBounds(bounds, { padding: { top: 80, bottom: 80, left: 360, right: 80 }, duration: 900, maxZoom: 16 });
    }

    return removeRoute;
  }, [routeGeometry, styleReady]);

  // Route endpoint markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    routeFromMarkerRef.current?.remove();
    routeFromMarkerRef.current = null;
    if (routeFrom) {
      const el = document.createElement('div');
      el.style.cssText = `
        width:22px;height:22px;border-radius:50%;
        background:#38bdf8;border:3px solid #fff;
        box-shadow:0 2px 8px rgba(0,0,0,0.4),0 0 0 2px rgba(56,189,248,0.4);
      `;
      routeFromMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(routeFrom)
        .addTo(map);
    }

    routeToMarkerRef.current?.remove();
    routeToMarkerRef.current = null;
    if (routeTo) {
      const el = document.createElement('div');
      el.style.cssText = `
        width:22px;height:22px;border-radius:50%;
        background:#f87171;border:3px solid #fff;
        box-shadow:0 2px 8px rgba(0,0,0,0.4),0 0 0 2px rgba(248,113,113,0.4);
      `;
      routeToMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(routeTo)
        .addTo(map);
    }
  }, [routeFrom, routeTo, styleReady]);

  // ─── Map picking mode ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    const canvas = map.getCanvas();

    if (!pickingActive) {
      canvas.style.cursor = '';
      return;
    }

    canvas.style.cursor = 'crosshair';

    const handler = (e: mapboxgl.MapMouseEvent) => {
      onMapPick?.([e.lngLat.lng, e.lngLat.lat]);
    };
    map.once('click', handler);

    return () => {
      canvas.style.cursor = '';
      map.off('click', handler);
    };
  }, [pickingActive, onMapPick, styleReady]);

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Isochrone controls — show when target is active */}
      {isochroneTarget && (
        <div style={{
          position: 'absolute', top: 110, right: 12, zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: 6,
          alignItems: 'flex-end',
        }}>
          {/* Profile toggle */}
          <div style={{
            display: 'flex', borderRadius: 10, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(12px)',
          }}>
            {(['walking', 'driving'] as const).map((p, i) => (
              <button
                key={p}
                onClick={() => setIsoProfile(p)}
                style={{
                  padding: '7px 13px',
                  background: isoProfile === p ? 'rgba(56,189,248,0.18)' : 'rgba(6,12,24,0.8)',
                  color: isoProfile === p ? '#38bdf8' : '#7a90b8',
                  border: 'none',
                  borderRight: i === 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: isoProfile === p ? 700 : 400,
                  fontFamily: 'system-ui,sans-serif',
                  letterSpacing: '0.02em',
                  transition: 'all 0.15s ease',
                }}
              >
                {p === 'walking' ? '🚶 Jalan Kaki' : '🚗 Berkendara'}
              </button>
            ))}
          </div>

          {/* Legend */}
          <div style={{
            background: 'rgba(6,12,24,0.88)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
            padding: '9px 13px',
          }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: '#7a90b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
              Jangkauan dari Spot
            </div>
            {[
              { col: ISO_COLORS[0], label: '5 menit' },
              { col: ISO_COLORS[1], label: '10 menit' },
              { col: ISO_COLORS[2], label: '15 menit' },
            ].map(item => (
              <div key={item.col} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: item.col, flexShrink: 0, opacity: 0.85 }} />
                <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
