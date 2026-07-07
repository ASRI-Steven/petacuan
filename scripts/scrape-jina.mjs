// Scrape listing sewa ruko 99.co per kecamatan Jabodetabek via proxy r.jina.ai.
//
// Daftar kecamatan diambil dari sumber acuan tunggal
// (scripts/lib/kecamatan-jabodetabek.mjs → 186 kecamatan Jabodetabek),
// bukan lagi hardcode 7 kecamatan Tangsel.
//
// Fitur:
//   - Resume: kecamatan yang file .md-nya sudah ada dilewati (pakai --force untuk ulang).
//   - Deteksi blokir Cloudflare ("Just a moment"/"security verification") → dilaporkan.
//   - Ringkasan ok / blocked / notfound / error di akhir.
//
// CATATAN PENTING: per Des 2025 99.co berada di balik Cloudflare, sehingga
// r.jina.ai gratisan umumnya kena blokir. Untuk scrape massal gunakan Jina API
// key (set JINA_API_KEY di .env.local) atau sumber alternatif.

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { loadKecamatanList, legacyFile } from './lib/kecamatan-jabodetabek.mjs';

config({ path: '.env.local' });

const OUTPUT_DIR = './data/scrape-raw';
const DELAY_MS = 3000;         // jeda sopan antar-request
const FORCE = process.argv.includes('--force');
const JINA_KEY = process.env.JINA_API_KEY || '';

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function isBlocked(markdown) {
  return /security verification|just a moment|Performing security/i.test(markdown);
}

function hasListings(markdown) {
  return /Rp\s*[\d,.]+\s*(?:Juta|Miliar)/i.test(markdown);
}

// Skip kalau sudah pernah ter-scrape (nama baru atau nama legacy Tangsel).
function alreadyScraped(entry) {
  if (fs.existsSync(path.join(OUTPUT_DIR, entry.file))) return true;
  const legacyName = legacyFile(entry);
  return legacyName ? fs.existsSync(path.join(OUTPUT_DIR, legacyName)) : false;
}

async function scrapeOne(entry) {
  const jinaUrl = `https://r.jina.ai/${entry.url}`;
  const headers = JINA_KEY ? { Authorization: `Bearer ${JINA_KEY}` } : {};

  try {
    const res = await fetch(jinaUrl, { headers });
    if (!res.ok) {
      console.log(`   ❌ HTTP ${res.status}`);
      return res.status === 404 ? 'notfound' : 'error';
    }

    const markdown = await res.text();

    if (isBlocked(markdown)) {
      console.log('   ⚠️  diblokir (Cloudflare/security check)');
      return 'blocked';
    }
    if (!hasListings(markdown)) {
      console.log('   ⚠️  tidak ada listing (mungkin 404 halus / kecamatan kosong)');
      return 'notfound';
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, entry.file), markdown);
    console.log(`   ✅ ${markdown.length} chars → ${entry.file}`);
    return 'ok';
  } catch (err) {
    console.log(`   ❌ ${err.message}`);
    return 'error';
  }
}

async function main() {
  const list = loadKecamatanList();
  console.log(`📋 ${list.length} kecamatan Jabodetabek`);
  if (!JINA_KEY) {
    console.log('ℹ️  JINA_API_KEY tidak diset — memakai r.jina.ai gratis (rawan blokir Cloudflare).');
  }

  const tally = { ok: 0, blocked: 0, notfound: 0, error: 0, skip: 0 };
  const failed = [];

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const tag = `[${i + 1}/${list.length}] ${entry.kotaKab} / ${entry.kecamatan}`;

    if (!FORCE && alreadyScraped(entry)) {
      tally.skip++;
      continue;
    }

    console.log(`\n📍 ${tag}\n   ${entry.url}`);
    const status = await scrapeOne(entry);
    tally[status]++;
    if (status !== 'ok') failed.push(`${entry.kotaKab}/${entry.kecamatan} (${status})`);

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\n💾 Selesai. Tersimpan di ${OUTPUT_DIR}/`);
  console.log(
    `   ok=${tally.ok} skip=${tally.skip} blocked=${tally.blocked} ` +
    `notfound=${tally.notfound} error=${tally.error}`,
  );
  if (tally.blocked > 0) {
    console.log('\n⚠️  Banyak yang diblokir — set JINA_API_KEY atau pakai sumber lain.');
  }
  if (failed.length) {
    console.log(`\nGagal (${failed.length}):`);
    for (const f of failed) console.log(`   - ${f}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
