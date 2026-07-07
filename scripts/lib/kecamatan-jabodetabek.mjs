// Sumber acuan tunggal daftar kecamatan Jabodetabek untuk pipeline harga sewa.
//
// Sebelumnya daftar kecamatan di-hardcode (hanya 7 kecamatan Tangerang Selatan)
// dan tersebar di 3 script: scrape-jina, parse-harga, seed-harga-sewa.
// Modul ini menjadikannya satu sumber yang di-generate dari data kelurahan
// (data/demografi-jabodetabek.json) sehingga cakupannya seluruh Jabodetabek
// (186 kecamatan) dan konsisten di semua tahap pipeline.
//
// Setiap entri memuat:
//   kotaKab   : nama kota/kabupaten sesuai DB (mis. "Jakarta Selatan")
//   kecamatan : nama kecamatan sesuai DB      (mis. "Ciputat Timur")
//   kotaSlug  : slug kota untuk URL 99.co      (mis. "jakarta-selatan")
//   kecSlug   : slug kecamatan untuk URL 99.co (mis. "ciputat-timur")
//   file      : nama file .md hasil scrape      (mis. "tangerang-selatan__ciputat-timur.md")
//   url       : URL target 99.co lengkap
//
// Catatan: slug 99.co sebagian nama kecamatan dari geojson tidak 1:1 (mis.
// "Grogolpetamburan" → "grogol-petamburan"). Tambahkan koreksi di KEC_SLUG_OVERRIDE
// setiap kali scraper melaporkan 404 untuk sebuah kecamatan.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMOGRAFI_PATH = path.join(__dirname, '..', '..', 'data', 'demografi-jabodetabek.json');

// Nama kota_kab (DB) → slug wilayah di URL 99.co.
// 99.co memakai slug wilayah tanpa prefix "Kota"/"Kabupaten"; kota & kabupaten
// dengan nama sama (Bogor, Bekasi, Tangerang) memakai slug yang sama.
const KOTA_SLUG = {
  'Jakarta Barat':       'jakarta-barat',
  'Jakarta Pusat':       'jakarta-pusat',
  'Jakarta Selatan':     'jakarta-selatan',
  'Jakarta Timur':       'jakarta-timur',
  'Jakarta Utara':       'jakarta-utara',
  'Depok':               'depok',
  'Kota Bogor':          'bogor',
  'Kabupaten Bogor':     'bogor',
  'Kota Bekasi':         'bekasi',
  'Kabupaten Bekasi':    'bekasi',
  'Kota Tangerang':      'tangerang',
  'Kabupaten Tangerang': 'tangerang',
  'Tangerang Selatan':   'tangerang-selatan',
};

// Koreksi slug kecamatan untuk nama yang menyatu / berbeda dari slug 99.co.
// key = nama kecamatan persis seperti di DB.
const KEC_SLUG_OVERRIDE = {
  'Grogolpetamburan': 'grogol-petamburan',
  'Kebonjeruk':       'kebon-jeruk',
  'Kabayoran Lama':   'kebayoran-lama',
  'Danau Sunter Dll': 'tanjung-priok',
};

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // buang diakritik
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function kecSlug(kecamatan) {
  return KEC_SLUG_OVERRIDE[kecamatan] || slugify(kecamatan);
}

/**
 * Kembalikan daftar kecamatan Jabodetabek unik dari data demografi.
 * @returns {Array<{kotaKab, kecamatan, kotaSlug, kecSlug, file, url}>}
 */
export function loadKecamatanList() {
  if (!fs.existsSync(DEMOGRAFI_PATH)) {
    throw new Error(`Missing ${DEMOGRAFI_PATH} — jalankan pipeline demografi dulu`);
  }
  const rows = JSON.parse(fs.readFileSync(DEMOGRAFI_PATH, 'utf8'));

  const seen = new Map(); // key "kotaKab|kecamatan" → entri
  for (const r of rows) {
    if (!r.kota_kab || !r.kecamatan) continue;
    const key = `${r.kota_kab}|${r.kecamatan}`;
    if (seen.has(key)) continue;

    const kotaSlug = KOTA_SLUG[r.kota_kab];
    if (!kotaSlug) {
      console.warn(`⚠️  kota_kab tanpa slug 99.co: "${r.kota_kab}" (kecamatan ${r.kecamatan}) — dilewati`);
      continue;
    }
    const ks = kecSlug(r.kecamatan);
    seen.set(key, {
      kotaKab: r.kota_kab,
      kecamatan: r.kecamatan,
      kotaSlug,
      kecSlug: ks,
      // filename di-prefix kota agar unik lintas kota (mis. "Setu" ada di
      // Tangsel & Kab. Bekasi)
      file: `${kotaSlug}__${ks}.md`,
      url: `https://www.99.co/id/sewa/ruko/${kotaSlug}/${ks}`,
    });
  }

  return [...seen.values()].sort((a, b) =>
    a.kotaKab.localeCompare(b.kotaKab) || a.kecamatan.localeCompare(b.kecamatan),
  );
}

// Nama file .md legacy (skema lama, flat, hanya slug kecamatan) HANYA untuk 7
// kecamatan Tangsel yang sudah ter-scrape sebelum penamaan di-prefix kota.
// Dibatasi ke Tangsel agar kecamatan bernama sama di kota lain (mis. "Setu" di
// Kab. Bekasi) tidak salah ambil file Tangsel. Kembalikan null jika tak berlaku.
export function legacyFile(entry) {
  if (entry.kotaKab !== 'Tangerang Selatan') return null;
  return `${entry.kecSlug}.md`;
}

export { KOTA_SLUG, KEC_SLUG_OVERRIDE, slugify, kecSlug };
