import fs from 'fs';
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const GEOJSON_PATH = './data/tangsel-kelurahan.geojson';

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

async function main() {
  const data = JSON.parse(fs.readFileSync(GEOJSON_PATH, 'utf8'));
  
  console.log(`Importing ${data.features.length} kelurahan...`);
  
  await sql`DELETE FROM kelurahan`;
  
  for (const feature of data.features) {
    const props = feature.properties;
    const geojsonGeom = JSON.stringify(feature.geometry);
    
    await sql`
      INSERT INTO kelurahan (kode, nama, kecamatan, geom)
      VALUES (
        ${props.CC_4},
        ${props.NAME_4},
        ${props.NAME_3},
        ST_SetSRID(ST_GeomFromGeoJSON(${geojsonGeom}), 4326)
      )
    `;
    
    console.log(`✓ ${props.NAME_3} - ${props.NAME_4}`);
  }
  
  console.log('\nDone!');
  await sql.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});