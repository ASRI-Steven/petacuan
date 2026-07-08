// Isi planet_osm_line (jalan) dari Overpass API untuk skor access.
// Pakai:
//   node scripts/import-roads-overpass.mjs              -> semua kota (DELETE dulu, full refresh)
//   node scripts/import-roads-overpass.mjs "Depok"      -> kota tertentu (additive)
//
// View v_kelurahan_access hanya butuh highway IN (motorway,trunk,primary,secondary,tertiary).
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function overpassQuery(s, w, n, e) {
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:150];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bbox});
out geom;`;
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
          'User-Agent': 'petacuan-roads-import/1.0 (contact: dev)',
        },
      });
      if ([429, 502, 503, 504].includes(res.status)) { await sleep(8000); continue; }
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
      const del = await sql`DELETE FROM planet_osm_line`;
      console.log(`🗑️  Reset planet_osm_line (${del.count} baris lama dihapus)`);
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
        if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
        if (seen.has(el.id)) continue;
        seen.add(el.id);
        const wkt = 'LINESTRING(' + el.geometry.map((p) => `${p.lon} ${p.lat}`).join(',') + ')';
        const t = el.tags || {};
        rows.push({ osm_id: -el.id, highway: t.highway ?? null, name: t.name ?? null, wkt });
      }

      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const c = rows.slice(i, i + CHUNK);
        await sql.unsafe(
          `INSERT INTO planet_osm_line (osm_id, highway, name, way)
           SELECT u.osm_id, u.highway, u.name, ST_Transform(ST_GeomFromText(u.wkt, 4326), 3857)
           FROM UNNEST($1::bigint[], $2::text[], $3::text[], $4::text[])
                AS u(osm_id, highway, name, wkt)`,
          [c.map((r) => r.osm_id), c.map((r) => r.highway), c.map((r) => r.name), c.map((r) => r.wkt)],
        );
      }
      grandTotal += rows.length;
      console.log(`✅ ${kota}: +${rows.length} ruas jalan`);
      await sleep(3000);
    }

    console.log(`\n🎯 Total ruas jalan di-insert: ${grandTotal}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
