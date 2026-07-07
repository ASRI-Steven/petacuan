import fs from 'fs';
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const INPUT_PATH = './data/demografi-jabodetabek.json';

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

// Proporsi populasi → kolom-kolom scoring.
// Sumber: BPS Sakernas Agt 2024 + SP2020 per provinsi (rata-rata, dibulatkan).
// Catatan: angka kasar — cukup untuk konsistensi cross-kota.
const PROPORSI = {
  'DKI Jakarta': {
    usia_remaja_dewasa: 0.18,
    usia_produktif:     0.70,
    pelajar_mahasiswa:  0.20,
    karyawan_swasta:    0.28,
    wiraswasta:         0.08,
  },
  'Banten': {
    usia_remaja_dewasa: 0.19,
    usia_produktif:     0.68,
    pelajar_mahasiswa:  0.22,
    karyawan_swasta:    0.22,
    wiraswasta:         0.10,
  },
  'Jawa Barat': {
    usia_remaja_dewasa: 0.19,
    usia_produktif:     0.66,
    pelajar_mahasiswa:  0.21,
    karyawan_swasta:    0.19,
    wiraswasta:         0.12,
  },
};

async function fillFallback(records) {
  // Untuk record dengan jumlah_penduduk null:
  // 1. Hitung kepadatan median per kecamatan (dari record wikipedia di kecamatan yang sama)
  // 2. Penduduk = kepadatan_median × luas_km2_geom
  // 3. Kalau kecamatan tidak punya satupun wiki record → pakai median kota
  // 4. Kalau kota juga kosong → pakai 8000/km² (rata-rata Jabodetabek kasar)
  const byKec = new Map();
  const byKota = new Map();
  for (const r of records) {
    if (r.source === 'wikipedia' && r.kepadatan > 0) {
      const kecKey = `${r.kota_kab}|${r.kecamatan}`;
      if (!byKec.has(kecKey)) byKec.set(kecKey, []);
      byKec.get(kecKey).push(r.kepadatan);
      if (!byKota.has(r.kota_kab)) byKota.set(r.kota_kab, []);
      byKota.get(r.kota_kab).push(r.kepadatan);
    }
  }
  const median = (arr) => {
    if (!arr || !arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  for (const r of records) {
    if (r.jumlah_penduduk != null) continue;
    const kecKey = `${r.kota_kab}|${r.kecamatan}`;
    const kepadatan =
      median(byKec.get(kecKey)) ||
      median(byKota.get(r.kota_kab)) ||
      8000;
    r.kepadatan = Math.round(kepadatan);
    r.jumlah_penduduk = Math.round(kepadatan * r.luas_km2_geom);
    r.source = 'fallback_kepadatan';
  }
}

async function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Missing ${INPUT_PATH} — jalankan scrape-demografi.mjs dulu`);
    process.exit(1);
  }
  const records = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
  console.log(`Loaded ${records.length} records`);

  await fillFallback(records);

  let inserted = 0, skipped = 0;
  const sourceCount = {};

  await sql`DELETE FROM demografi`;

  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH);
    await sql.begin(async (tx) => {
      for (const r of slice) {
        const proporsi = PROPORSI[r.provinsi];
        if (!proporsi) {
          console.warn(`⚠️  Provinsi tidak ada di PROPORSI: ${r.provinsi}`);
          skipped++;
          continue;
        }
        const p = r.jumlah_penduduk;
        await tx`
          INSERT INTO demografi (
            kelurahan_id, jumlah_penduduk,
            usia_remaja_dewasa, usia_produktif, pelajar_mahasiswa,
            karyawan_swasta, wiraswasta,
            luas_km2, kepadatan, metadata
          ) VALUES (
            ${r.id}, ${p},
            ${Math.round(p * proporsi.usia_remaja_dewasa)},
            ${Math.round(p * proporsi.usia_produktif)},
            ${Math.round(p * proporsi.pelajar_mahasiswa)},
            ${Math.round(p * proporsi.karyawan_swasta)},
            ${Math.round(p * proporsi.wiraswasta)},
            ${r.luas_km2.toFixed(4)},
            ${r.kepadatan},
            ${{ source: r.source, wiki_title: r.title || null, provinsi_proporsi: r.provinsi }}
          )
        `;
        inserted++;
        sourceCount[r.source] = (sourceCount[r.source] || 0) + 1;
      }
    });
    process.stdout.write(`\r  ${Math.min(i + BATCH, records.length)}/${records.length}`);
  }
  console.log('');

  console.log(`\nInserted: ${inserted}, Skipped: ${skipped}`);
  console.log('Per source:');
  for (const [s, n] of Object.entries(sourceCount)) console.log(`  ${s}: ${n}`);

  await sql.end();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
