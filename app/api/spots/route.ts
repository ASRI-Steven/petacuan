import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3 });

const ANCHOR_LABELS: Record<string, string> = {
  place_of_worship: 'Masjid',
  place_of_worship_christian: 'Gereja',
  place_of_worship_buddhist: 'Vihara',
  place_of_worship_hindu: 'Pura',
  school: 'Sekolah',
  university: 'Universitas',
  college: 'Kampus',
  hospital: 'Rumah Sakit',
  clinic: 'Klinik',
  marketplace: 'Pasar',
  mall: 'Mall',
  fuel: 'SPBU',
  bus_stop: 'Halte',
  transit: 'Stasiun/Terminal',
  office: 'Perkantoran',
};

// Detect worship type from POI name (reliable for Indonesian OSM — religion tag often missing)
function detectWorshipType(name: string): 'muslim' | 'christian' | 'buddhist' | 'hindu' | 'unknown' {
  const n = name.toLowerCase();
  if (n.includes('masjid') || n.includes('mushola') || n.includes('musala') ||
      n.includes('surau') || n.includes('jami') || n.includes('nurul') ||
      n.includes('baitul') || n.includes('baitullah') || n.includes('darul') ||
      n.includes('miftahul') || n.includes('raudlatul') || n.includes('al-'))
    return 'muslim';
  if (n.includes('gereja') || n.includes('gkp') || n.includes('gki') || n.includes('gpib') ||
      n.includes('gpil') || n.includes('gbi') || n.includes('bethel') || n.includes('kristen') ||
      n.includes('protestan') || n.includes('katolik') || n.includes('katedral') ||
      n.includes('chapel') || n.includes('jemaat') || n.includes('paroki') ||
      n.includes('advent') || n.includes('pantekosta') || n.includes('baptist'))
    return 'christian';
  if (n.includes('vihara') || n.includes('wihara') || n.includes('klenteng') ||
      n.includes('buddha') || n.includes('budha'))
    return 'buddhist';
  if (n.includes('pura') || n.includes('hindu'))
    return 'hindu';
  return 'unknown';
}

function resolveWorshipLabel(name: string): string {
  const t = detectWorshipType(name);
  if (t === 'christian') return 'place_of_worship_christian';
  if (t === 'buddhist')  return 'place_of_worship_buddhist';
  if (t === 'hindu')     return 'place_of_worship_hindu';
  return 'place_of_worship'; // muslim or unknown → treat as masjid
}

function worshipAnchorScore(name: string, businessType: string): number {
  const base = ANCHOR_SCORES[businessType]?.['place_of_worship'] ?? 10;
  const t = detectWorshipType(name);
  const mult =
    t === 'muslim'    ? 1.0  :
    t === 'christian' ? 0.28 : // Gereja: traffic Minggu saja
    t === 'buddhist'  ? 0.50 :
    t === 'hindu'     ? 0.44 : 0.65; // unknown → konservatif
  return Math.round(base * mult);
}

// Offset spot 60-90m from anchor so pin doesn't land exactly on the building
function offsetCoords(lat: number, lng: number, id: number): { lat: number; lng: number } {
  const angle = (Math.abs(id) * 137.508) % 360; // golden-angle spread, deterministic
  const dist  = 0.0006 + (Math.abs(id) % 4) * 0.0001; // 67-111m
  const rad   = (angle * Math.PI) / 180;
  return { lat: lat + dist * Math.cos(rad), lng: lng + dist * Math.sin(rad) };
}

const ANCHOR_SCORES: Record<string, Partial<Record<string, number>>> = {
  warkop:     { place_of_worship: 18, university: 18, college: 17, school: 15, bus_stop: 13, transit: 14, marketplace: 14, hospital: 11, mall: 12, fuel: 9, office: 11 },
  restoran:   { hospital: 17, university: 15, office: 16, school: 13, marketplace: 15, bus_stop: 12, transit: 13, place_of_worship: 12, mall: 13 },
  laundry:    { school: 18, university: 19, college: 17, hospital: 13, place_of_worship: 9, marketplace: 11, office: 12 },
  klinik:     { hospital: 15, place_of_worship: 13, school: 14, marketplace: 12, bus_stop: 11, transit: 12, university: 13 },
  salon:      { school: 15, university: 14, marketplace: 14, place_of_worship: 12, bus_stop: 11, mall: 14, office: 11 },
  minimarket: { school: 16, place_of_worship: 16, bus_stop: 16, transit: 16, hospital: 14, marketplace: 13, university: 12, fuel: 10, office: 12 },
  apotek:     { hospital: 19, clinic: 18, place_of_worship: 13, school: 11, marketplace: 13, bus_stop: 12 },
  fotokopi:   { school: 20, university: 20, college: 19, office: 15, place_of_worship: 8 },
  bengkel:    { fuel: 17, bus_stop: 14, transit: 15, marketplace: 11, school: 8, place_of_worship: 7 },
  barbershop: { school: 16, university: 15, place_of_worship: 15, marketplace: 13, bus_stop: 12, office: 11, mall: 12 },
  generic:    { place_of_worship: 12, university: 14, college: 13, school: 13, bus_stop: 12, transit: 13, marketplace: 13, hospital: 11, mall: 12, fuel: 8, office: 11 },
};

const REASON_MATRIX: Record<string, Partial<Record<string, string>>> = {
  warkop: {
    place_of_worship: 'Traffic jamaah konsisten pagi & sore, cocok untuk warung kopi harian',
    university: 'Mahasiswa adalah konsumen kopi terbesar — demand sepanjang hari',
    college: 'Kawasan kampus menghasilkan demand minuman dan nongkrong tinggi',
    school: 'Orang tua menunggu anak jadi peluang pelanggan tetap',
    bus_stop: 'Komuter yang menunggu bus jadi target minum kopi cepat',
    transit: 'Area stasiun/terminal = lalu lintas orang tinggi sepanjang hari',
    marketplace: 'Pedagang dan pembeli pasar butuh minuman sejak pagi buta',
    hospital: 'Pengunjung dan keluarga pasien membutuhkan tempat menunggu sambil minum',
    fuel: 'Pengemudi yang mengisi bensin sering berhenti untuk minum',
    office: 'Karyawan kantoran jadi pelanggan kopi rutin pagi dan siang',
  },
  restoran: {
    hospital: 'Keluarga pasien dan tenaga medis butuh makan dekat RS',
    university: 'Mahasiswa lapar sepanjang hari — demand makan siang tinggi',
    office: 'Karyawan kantoran jadi pasar makan siang terjamin',
    school: 'Orang tua dan guru membutuhkan tempat makan setelah sekolah',
    marketplace: 'Pembeli pasar dan pedagang butuh makan setelah aktivitas pagi',
    bus_stop: 'Penumpang turun dari bus sering mencari makan terdekat',
    transit: 'Area transit = potensi pelanggan makan yang tinggi',
  },
  laundry: {
    school: 'Area sekolah = banyak keluarga padat aktivitas, butuh laundry kiloan',
    university: 'Mahasiswa kos tidak sempat cuci sendiri — pasar besar',
    college: 'Anak kos sekitar kampus jadi pelanggan laundry paling loyal',
    hospital: 'Staff RS dengan shift panjang butuh laundry cepat',
    office: 'Karyawan sibuk mengandalkan laundry kiloan mingguan',
  },
  klinik: {
    hospital: 'Pasien yang tidak bisa masuk RS besar akan cari klinik terdekat',
    place_of_worship: 'Komunitas jamaah jadi basis kepercayaan layanan kesehatan',
    school: 'Anak sakit sering dirujuk ke klinik terdekat oleh orang tua',
    marketplace: 'Kepadatan area pasar = kebutuhan akses kesehatan mudah',
  },
  salon: {
    school: 'Ibu-ibu pengantar anak ke sekolah potensial mampir salon',
    university: 'Mahasiswi jadi target utama perawatan rambut dan kecantikan',
    marketplace: 'Pengunjung pasar, terutama perempuan, jadi target salon harian',
    office: 'Karyawati kantoran rutin ke salon sebelum atau sesudah kerja',
    mall: 'Area mall = traffic perempuan tinggi, potensial untuk salon',
  },
  minimarket: {
    school: 'Anak sekolah dan orang tua jadi pelanggan minimarket sekitar sekolah',
    place_of_worship: 'Traffic jamaah shalat = pembeli minuman dan snack tinggi',
    bus_stop: 'Penumpang menunggu bus sering beli sesuatu di minimarket',
    transit: 'Area terminal/stasiun = kebutuhan belanja cepat yang tinggi',
    hospital: 'Pengunjung RS butuh kebutuhan harian dekat lokasi',
  },
  apotek: {
    hospital: 'Pasien keluar RS langsung tebus resep di apotek terdekat',
    clinic: 'Pasien klinik tebus resep di apotek terdekat adalah pola umum',
    place_of_worship: 'Komunitas warga jadi pelanggan apotek rutin',
    marketplace: 'Area padat penduduk = kebutuhan obat dan vitamin tinggi',
  },
  fotokopi: {
    school: 'Siswa butuh fotokopi tugas, LKS, dan materi setiap hari',
    university: 'Mahasiswa adalah pengguna terbesar layanan fotokopi dan print',
    college: 'Tugas kuliah dan skripsi = permintaan print sepanjang semester',
    office: 'Kantor butuh fotokopi dokumen dan print rutin setiap hari',
  },
  bengkel: {
    fuel: 'Pengendara ke SPBU sering sekalian servis di bengkel terdekat',
    bus_stop: 'Jalur padat kendaraan = potensi pelanggan bengkel tinggi',
    transit: 'Terminal angkutan = kendaraan banyak butuh perawatan',
    marketplace: 'Area pasar = lalu lintas kendaraan tinggi, ban bocor sering',
  },
  barbershop: {
    school: 'Siswa cukur rambut rutin — pasar stabil harian',
    university: 'Mahasiswa rutin potong rambut terjangkau dekat kampus',
    place_of_worship: 'Warga jamaah jadi pelanggan cukur rambut sekitar masjid',
    marketplace: 'Pria yang ke pasar sering sekalian cukur di barbershop dekat',
    office: 'Karyawan potong rambut rutin sebelum hari kerja',
  },
};

function getAnchorScore(anchorType: string, businessType: string): number {
  return ANCHOR_SCORES[businessType]?.[anchorType] ?? 6;
}

function getReason(anchorType: string, anchorName: string, businessType: string): string {
  return REASON_MATRIX[businessType]?.[anchorType]
    ?? `Lokasi potensial dekat ${anchorName} dengan traffic area yang stabil`;
}

function calcSpotScore(kelurahanScore: number, anchorScore: number, idx: number): number {
  const raw = kelurahanScore * 0.60 + anchorScore * 2.1 - idx * 1.5;
  return Math.min(99, Math.max(28, Math.round(raw)));
}

interface KelurahanInput {
  id: number;
  name: string;
  kecamatan: string;
  lat: number;
  lng: number;
  score: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const kelurahan: KelurahanInput[] = body.kelurahan ?? [];
    const businessType: string = body.businessType ?? 'warkop';
    // sqlCategory dipilih AI — digunakan untuk lookup ANCHOR_SCORES & REASON_MATRIX
    const sqlCategory: string = ANCHOR_SCORES[body.sqlCategory] ? body.sqlCategory : (ANCHOR_SCORES[businessType] ? businessType : 'generic');
    const limitPerKelurahan = Math.min(body.limitPerKelurahan ?? 10, 15);

    if (kelurahan.length === 0) return NextResponse.json({ spots: [] });

    const kelurahanIds = kelurahan.map(k => k.id);

    // Query anchor POIs from planet_osm_point using the same spatial join as v_kelurahan_poi_summary
    const rows = await sql<{
      id: string;
      name: string;
      lat: number;
      lng: number;
      kelurahan_id: number;
      kelurahan: string;
      kecamatan: string;
      anchor_type: string;
    }[]>`
      SELECT
        ABS(p.osm_id)::text                      AS id,
        p.name                                   AS name,
        ST_Y(ST_Transform(p.way, 4326))          AS lat,
        ST_X(ST_Transform(p.way, 4326))          AS lng,
        k.id                                     AS kelurahan_id,
        k.nama                                   AS kelurahan,
        k.kecamatan                              AS kecamatan,
        CASE
          WHEN p.amenity IS NOT NULL              THEN p.amenity
          WHEN p.shop = 'mall'                   THEN 'mall'
          WHEN p.office IS NOT NULL              THEN 'office'
          WHEN p.public_transport IS NOT NULL
            OR p.railway = 'station'             THEN 'transit'
          ELSE 'poi'
        END                                      AS anchor_type
      FROM planet_osm_point p
      JOIN kelurahan k
        ON ST_Contains(k.geom, ST_Transform(p.way, 4326))
      WHERE k.id = ANY(${kelurahanIds})
        AND p.name IS NOT NULL
        AND trim(p.name) != ''
        AND (
          p.amenity IN (
            'university','college','school','marketplace',
            'place_of_worship','hospital','clinic',
            'fuel','bus_stop','bus_station','community_centre'
          )
          OR p.shop = 'mall'
          OR p.office IS NOT NULL
          OR p.public_transport IS NOT NULL
          OR p.railway = 'station'
        )
      ORDER BY k.id, p.name
    `;

    // Build score lookup by kelurahanId
    const kelMap = new Map(kelurahan.map(k => [k.id, k]));

    // Group by kelurahan, score and pick top N per kelurahan
    const grouped = new Map<number, (typeof rows)[number][]>();
    for (const row of rows) {
      const kid = Number(row.kelurahan_id);
      if (!grouped.has(kid)) grouped.set(kid, []);
      grouped.get(kid)!.push(row);
    }

    const spots: any[] = [];

    grouped.forEach((items, kid) => {
      const kel = kelMap.get(kid);
      if (!kel) return;

      const scored = items
        .map(row => {
          const isWorship = row.anchor_type === 'place_of_worship';
          const effectiveType = isWorship ? resolveWorshipLabel(row.name) : row.anchor_type;
          const aScore = isWorship
            ? worshipAnchorScore(row.name, sqlCategory)
            : getAnchorScore(row.anchor_type, sqlCategory);
          return { row, effectiveType, aScore };
        })
        .filter(x => x.aScore >= 6)
        .sort((a, b) => b.aScore - a.aScore)
        .slice(0, limitPerKelurahan);

      scored.forEach(({ row, effectiveType, aScore }, idx) => {
        const anchorLat = Number(row.lat);
        const anchorLng = Number(row.lng);
        const { lat, lng } = offsetCoords(anchorLat, anchorLng, Number(row.id));
        spots.push({
          id: Number(row.id),
          name: '',          // filled after road lookup
          anchorName: row.name,
          lat,
          lng,
          kelurahanId: kid,
          kelurahan: kel.name,
          kecamatan: kel.kecamatan,
          placeType: ANCHOR_LABELS[effectiveType] ?? effectiveType,
          score: calcSpotScore(kel.score, aScore, idx),
          reason: getReason(row.anchor_type, row.name, sqlCategory),
        });
      });
    });

    // Resolve nearest named road for each spot offset coordinate
    if (spots.length > 0) {
      const lats = spots.map((s: any) => s.lat);
      const lngs = spots.map((s: any) => s.lng);
      try {
        const roadRows = await sql<{ idx: number; road_name: string | null }[]>`
          SELECT
            (ordinality - 1)::int AS idx,
            (
              SELECT l.name
              FROM planet_osm_line l
              WHERE l.name IS NOT NULL
                AND trim(l.name) != ''
                AND l.highway IN ('primary','secondary','tertiary','residential','service','unclassified','living_street')
                AND ST_DWithin(
                  ST_Transform(l.way, 4326)::geography,
                  ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
                  180
                )
              ORDER BY ST_Distance(
                ST_Transform(l.way, 4326)::geography,
                ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
              )
              LIMIT 1
            ) AS road_name
          FROM UNNEST(${lats}::float8[], ${lngs}::float8[]) WITH ORDINALITY AS t(lat, lng, ordinality)
        `;
        const roadMap = new Map(roadRows.map(r => [r.idx, r.road_name]));
        spots.forEach((s: any, i: number) => {
          const road = roadMap.get(i);
          s.name = road ? `Jl. ${road}` : `Area ${s.kelurahan}`;
        });
      } catch {
        spots.forEach((s: any) => { s.name = `Area ${s.kelurahan}`; });
      }
    }

    return NextResponse.json({ spots });
  } catch (err: any) {
    console.error('Spots API error:', err);
    return NextResponse.json({ spots: [], error: err.message });
  }
}
