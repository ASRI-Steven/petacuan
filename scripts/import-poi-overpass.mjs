// Isi planet_osm_point dari Overpass API (pengganti osm2pgsql yang timeout).
// Pakai:
//   node scripts/import-poi-overpass.mjs                 -> semua kota (DELETE dulu, full refresh)
//   node scripts/import-poi-overpass.mjs "Depok" "Kota Bogor"  -> kota tertentu (additive)
//
// Bbox per-kota diambil dari extent tabel `kelurahan`. POI yang jatuh di luar
// poligon kelurahan otomatis tak terhitung oleh view v_kelurahan_poi_summary
// (join ST_Contains), jadi over-fetch bbox aman.
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tag yang dibutuhkan view (competition + anchor + transit).
function overpassQuery(s, w, n, e) {
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:150];
(
  nwr["amenity"~"^(cafe|restaurant|fast_food|food_court|clinic|doctors|hospital|pharmacy|university|college|school|marketplace|mall)$"](${bbox});
  nwr["shop"~"^(coffee|convenience|supermarket|grocery|laundry|dry_cleaning|hairdresser|beauty|copyshop|car_repair|motorcycle_repair|mall)$"](${bbox});
  nwr["office"](${bbox});
  nwr["public_transport"](${bbox});
  nwr["railway"="station"](${bbox});
);
out center tags;`;
}

async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'petacuan-poi-import/1.0 (contact: dev)',
        },
      });
      if ([429, 502, 503, 504].includes(res.status)) {
        await sleep(8000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(5000);
    }
  }
  throw lastErr;
}

async function main() {
  const targets = process.argv.slice(2);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const kotas = targets.length
      ? targets
      : (await sql`SELECT DISTINCT kota_kab FROM kelurahan WHERE kota_kab IS NOT NULL ORDER BY 1`).map((r) => r.kota_kab);

    if (!targets.length) {
      const del = await sql`DELETE FROM planet_osm_point`;
      console.log(`🗑️  Reset planet_osm_point (${del.count} baris lama dihapus)`);
    }

    const seen = new Set();
    let grandTotal = 0;

    for (const kota of kotas) {
      const [b] = await sql`
        SELECT MIN(ST_YMin(geom)) AS south, MIN(ST_XMin(geom)) AS west,
               MAX(ST_YMax(geom)) AS north, MAX(ST_XMax(geom)) AS east
        FROM kelurahan WHERE kota_kab = ${kota}`;
      if (b.south == null) { console.log(`⚠️  ${kota}: tak ada geom, skip`); continue; }

      let data;
      try {
        data = await overpass(overpassQuery(b.south, b.west, b.north, b.east));
      } catch (err) {
        console.log(`❌ ${kota}: Overpass gagal — ${err.message}`);
        continue;
      }

      const rows = [];
      for (const el of data.elements || []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const key = `${el.type}/${el.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const t = el.tags || {};
        rows.push({
          osm_id: el.type === 'node' ? el.id : -el.id,
          amenity: t.amenity ?? null,
          shop: t.shop ?? null,
          office: t.office ?? null,
          public_transport: t.public_transport ?? null,
          railway: t.railway ?? null,
          name: t.name ?? null,
          lon, lat,
        });
      }

      // Bulk insert via UNNEST, chunk 1500.
      const CHUNK = 1500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const c = rows.slice(i, i + CHUNK);
        await sql.unsafe(
          `INSERT INTO planet_osm_point (osm_id, amenity, shop, office, public_transport, railway, name, way)
           SELECT u.osm_id, u.amenity, u.shop, u.office, u.public_transport, u.railway, u.name,
                  ST_Transform(ST_SetSRID(ST_MakePoint(u.lon, u.lat), 4326), 3857)
           FROM UNNEST($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::float8[], $9::float8[])
                AS u(osm_id, amenity, shop, office, public_transport, railway, name, lon, lat)`,
          [
            c.map((r) => r.osm_id), c.map((r) => r.amenity), c.map((r) => r.shop),
            c.map((r) => r.office), c.map((r) => r.public_transport), c.map((r) => r.railway),
            c.map((r) => r.name), c.map((r) => r.lon), c.map((r) => r.lat),
          ],
        );
      }
      grandTotal += rows.length;
      console.log(`✅ ${kota}: +${rows.length} POI`);
      await sleep(3000); // sopan ke Overpass
    }

    console.log(`\n🎯 Total POI di-insert: ${grandTotal}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
