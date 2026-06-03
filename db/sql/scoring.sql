-- ============================================
-- PETACUAN SCORING VIEWS
-- ============================================

-- View 1: Base demographics dengan area
-- Sudah handle semua field demografi yang diperlukan
CREATE OR REPLACE VIEW v_kelurahan_demografi AS
SELECT 
  k.id,
  k.nama AS kelurahan,
  k.kecamatan,
  k.geom,
  ST_Area(k.geom::geography) / 1000000 AS luas_km2,
  d.jumlah_penduduk,
  d.usia_remaja_dewasa,
  d.usia_produktif,
  d.pelajar_mahasiswa,
  d.karyawan_swasta,
  d.wiraswasta,
  d.kepadatan
FROM kelurahan k
LEFT JOIN demografi d ON d.kelurahan_id = k.id;

-- View 2: Hitung POI count per kelurahan (untuk semua tags relevan)
-- Bisa di-filter di query time, jadi ini cuma aggregator
CREATE OR REPLACE VIEW v_kelurahan_poi_summary AS
SELECT 
  k.id AS kelurahan_id,
  k.nama AS kelurahan,
  k.kecamatan,
  
  -- F&B
  COUNT(*) FILTER (WHERE p.amenity IN ('cafe', 'restaurant', 'fast_food', 'food_court')) AS fnb_count,
  COUNT(*) FILTER (WHERE p.shop = 'coffee') AS coffee_count,
  
  -- Retail
  COUNT(*) FILTER (WHERE p.shop IN ('convenience', 'supermarket', 'grocery')) AS minimarket_count,
  COUNT(*) FILTER (WHERE p.shop IN ('laundry', 'dry_cleaning')) AS laundry_count,
  COUNT(*) FILTER (WHERE p.shop IN ('hairdresser', 'beauty')) AS salon_count,
  COUNT(*) FILTER (WHERE p.shop = 'copyshop') AS copy_count,
  COUNT(*) FILTER (WHERE p.shop IN ('car_repair', 'motorcycle_repair')) AS bengkel_count,
  
  -- Healthcare
  COUNT(*) FILTER (WHERE p.amenity IN ('clinic', 'doctors', 'hospital')) AS klinik_count,
  COUNT(*) FILTER (WHERE p.amenity = 'pharmacy') AS apotek_count,
  
  -- Anchors (magnet)
  COUNT(*) FILTER (WHERE p.amenity IN ('university', 'college')) AS kampus_count,
  COUNT(*) FILTER (WHERE p.amenity = 'school') AS sekolah_count,
  COUNT(*) FILTER (WHERE p.amenity = 'mall' OR p.shop = 'mall') AS mall_count,
  COUNT(*) FILTER (WHERE p.amenity = 'marketplace') AS pasar_count,
  COUNT(*) FILTER (WHERE p.office IS NOT NULL) AS office_count,
  COUNT(*) FILTER (WHERE p.public_transport IS NOT NULL OR p.railway = 'station') AS transit_count

FROM kelurahan k
LEFT JOIN planet_osm_point p ON ST_Contains(k.geom, ST_Transform(p.way, 4326))
GROUP BY k.id, k.nama, k.kecamatan;

-- View 3: Akses jalan utama
CREATE OR REPLACE VIEW v_kelurahan_access AS
SELECT 
  k.id AS kelurahan_id,
  -- Total panjang jalan utama (meter) dalam kelurahan
  COALESCE(SUM(ST_Length(ST_Transform(l.way, 4326)::geography)) 
    FILTER (WHERE l.highway IN ('primary', 'trunk', 'motorway'))
  , 0) AS jalan_utama_meter,
  
  COALESCE(SUM(ST_Length(ST_Transform(l.way, 4326)::geography))
    FILTER (WHERE l.highway IN ('secondary', 'tertiary'))
  , 0) AS jalan_kolektor_meter
FROM kelurahan k
LEFT JOIN planet_osm_line l ON ST_Intersects(k.geom, ST_Transform(l.way, 4326))
  AND l.highway IS NOT NULL
GROUP BY k.id;

-- View 4: Master view - semua data per kelurahan, ready for scoring
CREATE OR REPLACE VIEW v_kelurahan_master AS
SELECT 
  d.id,
  d.kelurahan,
  d.kecamatan,
  d.luas_km2,
  d.jumlah_penduduk,
  d.usia_remaja_dewasa,
  d.usia_produktif,
  d.pelajar_mahasiswa,
  d.karyawan_swasta,
  d.wiraswasta,
  d.kepadatan,
  d.geom,
  
  -- POI counts
  p.fnb_count, p.coffee_count, p.minimarket_count, p.laundry_count,
  p.salon_count, p.copy_count, p.bengkel_count, p.klinik_count, p.apotek_count,
  
  -- Anchor counts
  p.kampus_count, p.sekolah_count, p.mall_count, p.pasar_count,
  p.office_count, p.transit_count,
  
  -- Access
  a.jalan_utama_meter,
  a.jalan_kolektor_meter,
  
  -- Centroid untuk frontend map
  ST_Y(ST_Centroid(d.geom)) AS lat,
  ST_X(ST_Centroid(d.geom)) AS lng
  
FROM v_kelurahan_demografi d
LEFT JOIN v_kelurahan_poi_summary p ON p.kelurahan_id = d.id
LEFT JOIN v_kelurahan_access a ON a.kelurahan_id = d.id;