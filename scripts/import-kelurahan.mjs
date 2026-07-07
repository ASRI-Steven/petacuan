import fs from 'fs';
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const GEOJSON_PATH = './data/jabodetabek-kelurahan.geojson';

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

async function ensureSchema() {
  // PostGIS wajib ada
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  // Tabel base (kalau belum)
  await sql`
    CREATE TABLE IF NOT EXISTS kelurahan (
      id SERIAL PRIMARY KEY,
      kode TEXT,
      nama TEXT NOT NULL,
      kecamatan TEXT NOT NULL,
      kota_kab TEXT NOT NULL,
      provinsi TEXT NOT NULL DEFAULT 'Banten',
      geom geometry NOT NULL
    )
  `;

  // Idempotent migration untuk DB existing (Tangsel-only)
  await sql`ALTER TABLE kelurahan ADD COLUMN IF NOT EXISTS provinsi TEXT`;
  await sql`UPDATE kelurahan SET provinsi = 'Banten' WHERE provinsi IS NULL`;
  await sql`ALTER TABLE kelurahan ALTER COLUMN provinsi SET NOT NULL`;
  await sql`ALTER TABLE kelurahan ALTER COLUMN kota_kab DROP DEFAULT`;

  await sql`CREATE INDEX IF NOT EXISTS kelurahan_kota_kab_idx ON kelurahan (kota_kab)`;
  await sql`CREATE INDEX IF NOT EXISTS kelurahan_geom_gix ON kelurahan USING GIST (geom)`;
}

async function main() {
  await ensureSchema();

  const data = JSON.parse(fs.readFileSync(GEOJSON_PATH, 'utf8'));
  console.log(`Importing ${data.features.length} kelurahan...`);

  // Bersihkan demografi dulu (FK), lalu kelurahan
  await sql`DELETE FROM demografi`;
  await sql`DELETE FROM kelurahan`;
  await sql`ALTER SEQUENCE kelurahan_id_seq RESTART WITH 1`;

  // Batch insert per 50 untuk kecepatan
  const BATCH = 50;
  let count = 0;
  for (let i = 0; i < data.features.length; i += BATCH) {
    const slice = data.features.slice(i, i + BATCH);
    await sql.begin(async (tx) => {
      for (const feature of slice) {
        const p = feature.properties;
        const geom = JSON.stringify(feature.geometry);
        await tx`
          INSERT INTO kelurahan (kode, nama, kecamatan, kota_kab, provinsi, geom)
          VALUES (
            ${p.kode},
            ${p.nama},
            ${p.kecamatan},
            ${p.kotaKab},
            ${p.provinsi},
            ST_SetSRID(ST_GeomFromGeoJSON(${geom}), 4326)
          )
        `;
      }
    });
    count += slice.length;
    process.stdout.write(`\r  ${count}/${data.features.length}`);
  }
  console.log('');

  const summary = await sql`
    SELECT kota_kab, COUNT(*)::INT AS n
    FROM kelurahan
    GROUP BY kota_kab
    ORDER BY n DESC
  `;
  console.log('\nDistribusi tersimpan:');
  for (const r of summary) console.log(`  ${r.kota_kab.padEnd(22)} ${r.n}`);

  console.log('\nDone!');
  await sql.end();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
