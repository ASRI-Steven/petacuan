import fs from 'fs';
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const OUTPUT_PATH = './data/demografi-jabodetabek.json';
const DELAY_MS = 700;
const MAX_RETRY = 2;

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const WIKI_API = 'https://id.wikipedia.org/w/api.php';
const UA = 'PetaCuan/1.0 (research; demographics scraper)';

// Possible title formats Wikipedia ID untuk kelurahan
function candidateTitles(kel, kec, kota) {
  const kelEnc = kel;
  const kecEnc = kec;
  // contoh: "Cilandak Barat, Cilandak, Jakarta Selatan"
  // beberapa entri pakai "Kota Bogor" / "Kabupaten Bogor"
  return [
    `${kelEnc}, ${kecEnc}, ${kota}`,
    `${kelEnc}, ${kecEnc}`,
    `${kelEnc} (${kec})`,
  ];
}

async function fetchWikitext(title) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.error) return null;
  return json.parse?.wikitext?.['*'] || null;
}

function parseNumber(raw) {
  if (!raw) return null;
  // contoh: "29.500", "29.500 jiwa", "29,500", "29500", "29.500&nbsp;jiwa"
  const m = String(raw).match(/[\d.,]+/);
  if (!m) return null;
  let s = m[0];
  // Indo: dot as thousand. Kalau ada koma, koma decimal.
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function extractField(wikitext, field) {
  // Match |field = value (until next | or }})
  const re = new RegExp(`\\|\\s*${field}\\s*=\\s*([^|}\\n]+)`, 'i');
  const m = wikitext.match(re);
  return m ? m[1].trim() : null;
}

function parseInfobox(wikitext) {
  if (!wikitext) return null;
  const penduduk =
    parseNumber(extractField(wikitext, 'penduduk')) ||
    parseNumber(extractField(wikitext, 'population')) ||
    parseNumber(extractField(wikitext, 'population_total'));
  const luas =
    parseNumber(extractField(wikitext, 'luas')) ||
    parseNumber(extractField(wikitext, 'area'));
  const kepadatan =
    parseNumber(extractField(wikitext, 'kepadatan')) ||
    parseNumber(extractField(wikitext, 'population_density'));
  if (!penduduk && !luas) return null;
  return { penduduk, luas, kepadatan };
}

async function scrapeOne(kel, kec, kota) {
  for (const title of candidateTitles(kel, kec, kota)) {
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const wt = await fetchWikitext(title);
        const parsed = parseInfobox(wt);
        if (parsed) return { ...parsed, title, source: 'wikipedia' };
        break; // wikitext ada tapi parse gagal — coba title lain
      } catch (err) {
        if (attempt < MAX_RETRY) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
      }
    }
  }
  return null;
}

async function main() {
  const rows = await sql`
    SELECT id, nama, kecamatan, kota_kab, provinsi,
           ST_Area(geom::geography) / 1000000 AS luas_km2_geom
    FROM kelurahan
    ORDER BY kota_kab, kecamatan, nama
  `;
  console.log(`Scraping ${rows.length} kelurahan...`);

  const results = [];
  const existing = fs.existsSync(OUTPUT_PATH)
    ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
    : [];
  const existingById = new Map(existing.map(r => [r.id, r]));

  let okWiki = 0, fallback = 0;
  let start = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const luasGeom = parseFloat(r.luas_km2_geom);

    // Resume: skip kalau sudah ada hasil wikipedia
    if (existingById.has(r.id) && existingById.get(r.id).source === 'wikipedia') {
      results.push(existingById.get(r.id));
      okWiki++;
      continue;
    }

    const wiki = await scrapeOne(r.nama, r.kecamatan, r.kota_kab);

    let record;
    if (wiki && wiki.penduduk) {
      record = {
        id: r.id,
        nama: r.nama,
        kecamatan: r.kecamatan,
        kota_kab: r.kota_kab,
        provinsi: r.provinsi,
        jumlah_penduduk: Math.round(wiki.penduduk),
        luas_km2: wiki.luas || luasGeom,
        luas_km2_geom: luasGeom,
        kepadatan: wiki.kepadatan ? Math.round(wiki.kepadatan) : Math.round(wiki.penduduk / (wiki.luas || luasGeom)),
        title: wiki.title,
        source: 'wikipedia',
      };
      okWiki++;
    } else {
      record = {
        id: r.id,
        nama: r.nama,
        kecamatan: r.kecamatan,
        kota_kab: r.kota_kab,
        provinsi: r.provinsi,
        jumlah_penduduk: null, // di-fill saat derive (median kecamatan / fallback)
        luas_km2: luasGeom,
        luas_km2_geom: luasGeom,
        kepadatan: null,
        source: 'fallback',
      };
      fallback++;
    }

    results.push(record);

    // Progress + checkpoint tiap 50 baris
    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
      const elapsed = (Date.now() - start) / 1000;
      const rate = (i + 1) / elapsed;
      const eta = (rows.length - i - 1) / rate;
      console.log(
        `  [${i + 1}/${rows.length}] wiki=${okWiki} fallback=${fallback}  ` +
        `rate=${rate.toFixed(2)}/s  eta=${Math.round(eta)}s`
      );
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nDone. wiki=${okWiki} fallback=${fallback}`);
  await sql.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
