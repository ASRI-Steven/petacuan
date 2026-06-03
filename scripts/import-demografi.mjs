import fs from 'fs';
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const CSV_PATH = './data/demografi.csv';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

// Normalize: "Setu" / "SetuUtara" / "Setu Utara" semua dianggap match
const normalize = (s) => s.toLowerCase().replace(/\s+/g, '');

async function main() {
  const csv = fs.readFileSync(CSV_PATH, 'utf8').trim();
  const lines = csv.split('\n').slice(1); // skip header
  
  console.log(`Importing ${lines.length} rows...`);
  
  // Ambil mapping kelurahan dari DB
  const kelurahanList = await sql`
    SELECT 
      id, 
      nama, 
      kecamatan,
      ST_Area(geom::geography) / 1000000 AS luas_km2
    FROM kelurahan
  `;
  
  // Bikin lookup map: "setu_muncul" -> { id, luas_km2 }
  const lookup = {};
  for (const k of kelurahanList) {
    const key = `${normalize(k.kecamatan)}_${normalize(k.nama)}`;
    lookup[key] = { id: k.id, luas: parseFloat(k.luas_km2) };
  }
  
  let inserted = 0;
  let skipped = 0;
  
  for (const line of lines) {
    const [
      kec, kel, penduduk, remajaDewasa, produktif, 
      pelajar, karyawan, wiraswasta
    ] = line.split(';');
    
    const key = `${normalize(kec)}_${normalize(kel)}`;
    const match = lookup[key];
    
    if (!match) {
      console.log(`⚠️  Skip: ${kec} - ${kel} (tidak ada di tabel kelurahan)`);
      skipped++;
      continue;
    }
    
    const penddk = parseInt(penduduk);
    const kepadatan = Math.round(penddk / match.luas);
    
    // Upsert: delete dulu kalau ada, lalu insert
    await sql`DELETE FROM demografi WHERE kelurahan_id = ${match.id}`;
    
    await sql`
      INSERT INTO demografi (
        kelurahan_id,
        jumlah_penduduk,
        usia_remaja_dewasa,
        usia_produktif,
        pelajar_mahasiswa,
        karyawan_swasta,
        wiraswasta,
        luas_km2,
        kepadatan,
        metadata
      ) VALUES (
        ${match.id},
        ${penddk},
        ${parseInt(remajaDewasa)},
        ${parseInt(produktif)},
        ${parseInt(pelajar)},
        ${parseInt(karyawan)},
        ${parseInt(wiraswasta)},
        ${match.luas.toFixed(4)},
        ${kepadatan},
        ${{ source: 'Disdukcapil Tangsel Sem II 2025' }}
      )
    `;
    
    console.log(`✓ ${kec} - ${kel}: ${penddk.toLocaleString()} jiwa`);
    inserted++;
  }
  
  console.log(`\n✅ Inserted: ${inserted}, Skipped: ${skipped}`);
  await sql.end();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});