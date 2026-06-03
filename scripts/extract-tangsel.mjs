import pkg from 'geojson-indonesia';
import fs from 'fs';
import path from 'path';

const { getKelurahanJson } = pkg;

const OUTPUT_DIR = './data';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'tangsel-kelurahan.geojson');

// Bikin folder kalau belum ada
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const allKelurahan = getKelurahanJson();
console.log(`Total kelurahan Indonesia: ${allKelurahan.features.length}`);

// Helper: normalize string (lowercase + hapus spasi)
const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, '');

const tangsel = {
  type: 'FeatureCollection',
  features: allKelurahan.features.filter(f => {
    const kota = normalize(f.properties.NAME_2);
    // Match: "tangerangselatan" (no space) atau variasi
    return kota === 'tangerangselatan' || kota === 'kotatangerangselatan';
  })
};

console.log(`Tangsel kelurahan: ${tangsel.features.length}`);

if (tangsel.features.length > 0) {
  // Print sample biar yakin
  console.log('\nSample Tangsel:');
  console.log(JSON.stringify(tangsel.features[0].properties, null, 2));
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(tangsel));
console.log(`\nSaved to: ${OUTPUT_FILE}`);