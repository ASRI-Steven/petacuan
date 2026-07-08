// Seed harga_sewa dari hasil scrape rumah123 (data/scrape-raw-rumah123/all.json)
// untuk kecamatan Jabodetabek di luar Tangsel (yang sudah dicover 99.co).
//
// Strategi:
//   1. Parse tiap listing → harga tahunan (IDR) + format (pkl/kios/ruko_std/ruko_premium).
//   2. Cocokkan "Area" pada location ke nama kecamatan DB → statistik per-kecamatan.
//   3. Area yang tak cocok (sub-area seperti Kemang, Pondok Indah) tetap dipakai
//      untuk BASELINE per-kota, guna mengisi kecamatan yang tak punya data langsung.
//   4. Tulis p25-p75 per (kecamatan, format). Kecamatan yang SUDAH punya harga dari
//      sumber lain (mis. 99.co Tangsel) TIDAK ditimpa.
//
// Aman untuk DB produksi: default DRY-RUN (hanya cetak). Tulis DB dengan --commit.
// Idempotent: --commit menghapus dulu baris ber-source 'rumah123%' lalu insert ulang.

import fs from 'fs';
import postgres from 'postgres';
import { config } from 'dotenv';
import { loadKecamatanList } from './lib/kecamatan-jabodetabek.mjs';

config({ path: '.env.local' });

const INPUT = './data/scrape-raw-rumah123/all.json';
const COMMIT = process.argv.includes('--commit');
const SRC_TAG = 'rumah123 2026-07';

// location "Kota display" → daftar kota_kab DB kandidat (Bogor/Bekasi/Tangerang
// ambigu kota vs kabupaten → baseline dipakai untuk keduanya).
const KOTA_DISPLAY_TO_KAB = {
  'Jakarta Barat': ['Jakarta Barat'],
  'Jakarta Pusat': ['Jakarta Pusat'],
  'Jakarta Selatan': ['Jakarta Selatan'],
  'Jakarta Timur': ['Jakarta Timur'],
  'Jakarta Utara': ['Jakarta Utara'],
  'Depok': ['Depok'],
  'Bogor': ['Kota Bogor', 'Kabupaten Bogor'],
  'Bekasi': ['Kota Bekasi', 'Kabupaten Bekasi'],
  'Tangerang': ['Kota Tangerang', 'Kabupaten Tangerang'],
  'Tangerang Selatan': ['Tangerang Selatan'],
};

function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function parsePrice(text) {
  // "Rp 500 Juta Total /tahun", "Rp 1,8 Miliar Total /tahun", "... /bulan"
  const m = text.match(/Rp\s*([\d.,]+)\s*(Juta|Miliar)/i);
  if (!m) return null;
  let s = m[1];
  s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\./g, '');
  const num = parseFloat(s);
  if (!Number.isFinite(num)) return null;
  let idr = num * (m[2].toLowerCase() === 'miliar' ? 1_000_000_000 : 1_000_000);
  if (/\/?\s*bulan|per bulan/i.test(text)) idr *= 12; // normalisasi ke tahunan
  return Math.round(idr);
}

function classifyFormat(priceIdr) {
  if (priceIdr < 25_000_000) return 'kios';
  if (priceIdr < 200_000_000) return 'ruko_std';
  return 'ruko_premium';
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

function statsFor(prices) {
  const s = [...prices].sort((a, b) => a - b);
  return { count: s.length, p25: percentile(s, 0.25), p75: percentile(s, 0.75) };
}

// Bangun stat per-format dari daftar harga, plus estimasi format yang kosong.
function buildFormatStats(pricesByFormat) {
  const out = {};
  for (const [fmt, prices] of Object.entries(pricesByFormat)) {
    if (prices.length) out[fmt] = { ...statsFor(prices), estimated: false };
  }
  const base = out.ruko_std;
  if (!base) return out; // tanpa baseline ruko_std tak bisa estimasi
  if (!out.kios || out.kios.count < 2)
    out.kios = { count: 0, p25: Math.round(base.p25 * 0.3), p75: Math.round(base.p75 * 0.3), estimated: true };
  if (!out.pkl)
    out.pkl = { count: 0, p25: Math.round(base.p25 * 0.12), p75: Math.round(base.p75 * 0.12), estimated: true };
  if (!out.ruko_premium || out.ruko_premium.count < 2)
    out.ruko_premium = { count: out.ruko_premium?.count || 0, p25: Math.round(base.p75 * 2.0), p75: Math.round(base.p75 * 3.5), estimated: true };
  return out;
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`Missing ${INPUT} — jalankan scrape-rumah123.mjs dulu`);
    process.exit(1);
  }
  const listings = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const kecList = loadKecamatanList();

  // Index nama kecamatan DB (dinormalisasi) → daftar entri (bisa >1: mis. "Setu").
  const kecIndex = new Map();
  for (const e of kecList) {
    const k = norm(e.kecamatan);
    if (!kecIndex.has(k)) kecIndex.set(k, []);
    kecIndex.get(k).push(e);
  }

  // Akumulasi harga: per-kecamatan (match langsung) & per-kota (baseline).
  const perKec = new Map();  // "kotaKab|kecamatan" → {format: [harga]}
  const perKota = new Map(); // kotaKab → {format: [harga]}
  let parsed = 0, matched = 0, unmatched = 0;

  const pushKec = (map, key, fmt, price) => {
    if (!map.has(key)) map.set(key, {});
    const b = map.get(key);
    (b[fmt] = b[fmt] || []).push(price);
  };

  for (const l of listings) {
    const price = parsePrice(l.price);
    if (!price || price < 5_000_000 || price > 10_000_000_000) continue;
    parsed++;
    const fmt = classifyFormat(price);

    const parts = l.location.split(',').map((x) => x.trim());
    const area = parts[0];
    const kotaDisplay = parts[parts.length - 1];
    const kabCandidates = KOTA_DISPLAY_TO_KAB[kotaDisplay] || [];

    // Baseline per-kota untuk semua kota kandidat.
    for (const kab of kabCandidates) pushKec(perKota, kab, fmt, price);

    // Match area → kecamatan DB, disambiguasi dengan kota kandidat.
    const hits = kecIndex.get(norm(area)) || [];
    const scoped = hits.filter((h) => kabCandidates.includes(h.kotaKab));
    const chosen = scoped.length ? scoped : hits.length === 1 ? hits : [];
    if (chosen.length) {
      for (const h of chosen) pushKec(perKec, `${h.kotaKab}|${h.kecamatan}`, fmt, price);
      matched++;
    } else {
      unmatched++;
    }
  }

  console.log(`Parsed ${parsed} listing valid — match kecamatan=${matched}, hanya baseline kota=${unmatched}`);

  // Susun baris final per kecamatan: pakai data langsung kalau ada, else baseline kota.
  const FORMATS = ['pkl', 'kios', 'ruko_std', 'ruko_premium'];
  const rows = []; // {kecamatan, kotaKab, format, p25, p75, mode, n}
  let direct = 0, viaBaseline = 0, noData = 0;

  const kotaStats = new Map();
  for (const [kab, pbf] of perKota) kotaStats.set(kab, buildFormatStats(pbf));

  for (const e of kecList) {
    if (e.kotaKab === 'Tangerang Selatan') continue; // dipertahankan dari 99.co
    const key = `${e.kotaKab}|${e.kecamatan}`;
    let stats, mode;
    if (perKec.has(key)) {
      stats = buildFormatStats(perKec.get(key));
      mode = 'kecamatan';
    } else {
      stats = kotaStats.get(e.kotaKab);
      mode = 'baseline';
    }
    if (!stats || !stats.ruko_std) { noData++; continue; }
    mode === 'kecamatan' ? direct++ : viaBaseline++;
    for (const fmt of FORMATS) {
      const s = stats[fmt];
      if (!s) continue;
      rows.push({ kecamatan: e.kecamatan, kotaKab: e.kotaKab, format: fmt, p25: s.p25, p75: s.p75, mode, n: s.count });
    }
  }

  console.log(`\nCakupan kecamatan (non-Tangsel): langsung=${direct}, baseline-kota=${viaBaseline}, tanpa-data=${noData}`);
  console.log(`Total baris harga_sewa akan ditulis: ${rows.length}`);
  console.log('\nContoh (10 baris):');
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.kotaKab.padEnd(20)} ${r.kecamatan.padEnd(18)} ${r.format.padEnd(13)} Rp ${(r.p25/1e6).toFixed(0)}-${(r.p75/1e6).toFixed(0)}jt  [${r.mode}${r.n ? ` n=${r.n}` : ' est'}]`);
  }

  if (!COMMIT) {
    console.log('\nℹ️  DRY-RUN. Tambahkan --commit untuk menulis ke DB.');
    return;
  }

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    await sql`ALTER TABLE harga_sewa ALTER COLUMN kelurahan_id DROP NOT NULL`.catch(() => {});
    await sql`ALTER TABLE harga_sewa ADD COLUMN IF NOT EXISTS kecamatan TEXT`.catch(() => {});
    // Harga sewa ruko/tahun bisa > 2,1 M (batas integer) → pakai bigint.
    await sql`ALTER TABLE harga_sewa ALTER COLUMN min_yearly_idr TYPE BIGINT`.catch(() => {});
    await sql`ALTER TABLE harga_sewa ALTER COLUMN max_yearly_idr TYPE BIGINT`.catch(() => {});

    // Idempotent: hapus baris rumah123 lama.
    const del = await sql`DELETE FROM harga_sewa WHERE source LIKE 'rumah123%'`;
    console.log(`\n🗑️  Hapus ${del.count} baris rumah123 lama`);

    // Jangan timpa kecamatan yang sudah ada dari sumber lain (mis. 99.co).
    const existing = await sql`SELECT DISTINCT kecamatan FROM harga_sewa WHERE source NOT LIKE 'rumah123%'`;
    const skipKec = new Set(existing.map((r) => r.kecamatan));

    let ins = 0, skipped = 0;
    for (const r of rows) {
      if (skipKec.has(r.kecamatan)) { skipped++; continue; }
      const label = r.mode === 'kecamatan'
        ? `${SRC_TAG}: ${r.n || 'est'} listing kecamatan, p25-p75`
        : `${SRC_TAG}: baseline kota ${r.kotaKab}`;
      await sql`
        INSERT INTO harga_sewa (kecamatan, format, min_yearly_idr, max_yearly_idr, source)
        VALUES (${r.kecamatan}, ${r.format}, ${r.p25}, ${r.p75}, ${label})
      `;
      ins++;
    }
    console.log(`✅ Insert ${ins} baris (skip ${skipped} karena sudah ada sumber lain)`);

    const summary = await sql`
      SELECT split_part(source, ':', 1) AS src, COUNT(DISTINCT kecamatan) AS kec, COUNT(*) AS baris
      FROM harga_sewa GROUP BY 1 ORDER BY 1`;
    console.log('\n📊 harga_sewa per sumber:');
    console.table(summary);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
