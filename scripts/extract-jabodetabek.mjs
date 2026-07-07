import pkg from 'geojson-indonesia';
import fs from 'fs';
import path from 'path';

const { getKelurahanJson } = pkg;

const OUTPUT_DIR = './data';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'jabodetabek-kelurahan.geojson');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// NAME_2 GADM → display kota_kab + provinsi
// Provinsi penting buat mapping proporsi BPS nanti
const KOTA_KAB_MAP = {
  JakartaBarat:     { kotaKab: 'Jakarta Barat',       provinsi: 'DKI Jakarta' },
  JakartaPusat:     { kotaKab: 'Jakarta Pusat',       provinsi: 'DKI Jakarta' },
  JakartaSelatan:   { kotaKab: 'Jakarta Selatan',     provinsi: 'DKI Jakarta' },
  JakartaTimur:     { kotaKab: 'Jakarta Timur',       provinsi: 'DKI Jakarta' },
  JakartaUtara:     { kotaKab: 'Jakarta Utara',       provinsi: 'DKI Jakarta' },
  KotaBogor:        { kotaKab: 'Kota Bogor',          provinsi: 'Jawa Barat'  },
  KotaBekasi:       { kotaKab: 'Kota Bekasi',         provinsi: 'Jawa Barat'  },
  KotaTangerang:    { kotaKab: 'Kota Tangerang',      provinsi: 'Banten'      },
  Depok:            { kotaKab: 'Depok',               provinsi: 'Jawa Barat'  },
  Bogor:            { kotaKab: 'Kabupaten Bogor',     provinsi: 'Jawa Barat'  },
  Bekasi:           { kotaKab: 'Kabupaten Bekasi',    provinsi: 'Jawa Barat'  },
  Tangerang:        { kotaKab: 'Kabupaten Tangerang', provinsi: 'Banten'      },
  TangerangSelatan: { kotaKab: 'Tangerang Selatan',   provinsi: 'Banten'      },
};

// CamelCase → "Camel Case" (dengan handling angka & akronim)
function splitCamelCase(s) {
  if (!s) return s;
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

const allKelurahan = getKelurahanJson();
console.log(`Total kelurahan Indonesia: ${allKelurahan.features.length}`);

const features = [];
const counts = {};

for (const f of allKelurahan.features) {
  const key = f.properties.NAME_2;
  const mapping = KOTA_KAB_MAP[key];
  if (!mapping) continue;

  const namaKelurahan = splitCamelCase(f.properties.NAME_4);
  const namaKecamatan = splitCamelCase(f.properties.NAME_3);

  features.push({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      kode:      f.properties.CC_4,
      nama:      namaKelurahan,
      kecamatan: namaKecamatan,
      kotaKab:   mapping.kotaKab,
      provinsi:  mapping.provinsi,
      tipe:      f.properties.TYPE_4 || 'Kelurahan',
    },
  });

  counts[mapping.kotaKab] = (counts[mapping.kotaKab] || 0) + 1;
}

const out = { type: 'FeatureCollection', features };
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out));

console.log(`\nSaved ${features.length} kelurahan to ${OUTPUT_FILE}`);
console.log('\nDistribusi per kota/kab:');
Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${k.padEnd(22)} ${v}`));
