// Scrape listing "sewa ruko" dari rumah123.com per KOTA (bukan 99.co yang
// diblokir Cloudflare). Setiap listing memuat field "location" = "Area, Kota"
// sehingga kecamatan bisa diturunkan dari situ.
//
// rumah123 hanya SSR ~10 listing/halaman, jadi kita paginasi beberapa halaman
// per kota. Slug kabupaten (kabupaten-bogor dst.) 404 di rumah123; kecamatan
// kabupaten umumnya muncul di bawah slug kota induk ("bogor"/"bekasi"/"tangerang").
//
// Output: data/scrape-raw-rumah123/all.json  (array listing mentah, dedupe per url)
// Pemakaian: node scripts/scrape-rumah123.mjs [--pages=20] [--force]

import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = './data/scrape-raw-rumah123';
const OUTPUT = path.join(OUTPUT_DIR, 'all.json');
const DELAY_MS = 2500;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const PAGES = Number((process.argv.find((a) => a.startsWith('--pages=')) || '').split('=')[1]) || 20;
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--kota=')) || '').split('=')[1]; // opsional, buat tes

// Slug kota rumah123 yang valid (slug kabupaten 404 → di-cover slug kota induk).
const KOTA_SLUGS = [
  'jakarta-barat', 'jakarta-pusat', 'jakarta-selatan', 'jakarta-timur', 'jakarta-utara',
  'depok', 'bogor', 'bekasi', 'tangerang', 'tangerang-selatan',
];

// Ekstrak objek listing dari HTML SSR. Urutan field JSON konsisten:
// "url":..,"image":..,"price":..,"location":..,"propertyType":..
const LISTING_RE =
  /"url":"(\/properti\/[^"]+)","image":"[^"]*","price":"(Rp[^"]+)","location":"([^"]+)","propertyType":"([^"]+)"/g;

function extractListings(html) {
  const out = [];
  let m;
  while ((m = LISTING_RE.exec(html)) !== null) {
    out.push({ url: m[1], price: m[2], location: m[3], propertyType: m[4] });
  }
  return out;
}

async function fetchPage(slug, page) {
  const url =
    page === 1
      ? `https://www.rumah123.com/sewa/${slug}/ruko/`
      : `https://www.rumah123.com/sewa/${slug}/ruko/?page=${page}`;
  // Retry hingga 3x untuk kegagalan jaringan transient (fetch failed).
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) return { ok: false, status: res.status, listings: [] };
      const html = await res.text();
      return { ok: true, status: 200, listings: extractListings(html) };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return { ok: false, status: 0, error: lastErr?.message || 'fetch failed', listings: [] };
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const byUrl = new Map();
  if (!FORCE && fs.existsSync(OUTPUT)) {
    for (const l of JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))) byUrl.set(l.url, l);
    console.log(`↺ Resume: ${byUrl.size} listing sudah ada`);
  }

  const slugs = ONLY ? [ONLY] : KOTA_SLUGS;
  for (const slug of slugs) {
    let added = 0;
    let emptyStreak = 0;
    for (let page = 1; page <= PAGES; page++) {
      let r;
      try {
        r = await fetchPage(slug, page);
      } catch (err) {
        console.log(`  ${slug} p${page}: ❌ ${err.message}`);
        break;
      }
      if (!r.ok) {
        console.log(`  ${slug} p${page}: http ${r.status} — stop`);
        break;
      }
      let newOnPage = 0;
      for (const l of r.listings) {
        if (!byUrl.has(l.url)) {
          byUrl.set(l.url, l);
          added++;
          newOnPage++;
        }
      }
      // Berhenti kalau 2 halaman berturut tidak menambah listing baru (habis).
      emptyStreak = newOnPage === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= 2) break;
      await new Promise((res) => setTimeout(res, DELAY_MS));
    }
    console.log(`📍 ${slug.padEnd(18)} +${added} listing`);
    // checkpoint per kota
    fs.writeFileSync(OUTPUT, JSON.stringify([...byUrl.values()], null, 2));
  }

  console.log(`\n💾 ${byUrl.size} listing total → ${OUTPUT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
