DROP FUNCTION IF EXISTS calculate_scores(TEXT, BIGINT);

CREATE OR REPLACE FUNCTION calculate_scores(
  p_business_type TEXT,
  p_modal_idr BIGINT
)
RETURNS TABLE (
  kelurahan_id INT,
  kelurahan TEXT,
  kecamatan TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  jumlah_penduduk INT,
  demand_target INT,
  competitor_count INT,
  anchor_count INT,
  access_meter NUMERIC,
  demand_score NUMERIC,
  competition_score NUMERIC,
  anchor_score NUMERIC,
  access_score NUMERIC,
  affordability_score NUMERIC,
  sewa_min_idr BIGINT,
  sewa_max_idr BIGINT,
  format_disarankan TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH 
  format_pilihan AS (
    SELECT CASE 
      WHEN p_modal_idr < 15000000 THEN 'pkl'
      WHEN p_modal_idr < 50000000 THEN 'kios'
      WHEN p_modal_idr < 150000000 THEN 'kios'
      WHEN p_modal_idr < 350000000 THEN 'ruko_std'
      ELSE 'ruko_std'
    END AS fmt
  ),
  
  raw_metrics AS (
    SELECT 
      m.id AS r_id,
      m.kelurahan AS r_kelurahan,
      m.kecamatan AS r_kecamatan,
      m.lat AS r_lat,
      m.lng AS r_lng,
      m.jumlah_penduduk AS r_jumlah_penduduk,
      
      (CASE p_business_type
        WHEN 'warkop' THEN 
          COALESCE(m.usia_remaja_dewasa, 0) * 4 + 
          COALESCE(m.karyawan_swasta, 0) * 3 + 
          COALESCE(m.pelajar_mahasiswa, 0) * 3
        WHEN 'restoran' THEN 
          COALESCE(m.usia_produktif, 0) * 5 + 
          COALESCE(m.karyawan_swasta, 0) * 5
        WHEN 'laundry' THEN 
          COALESCE(m.karyawan_swasta, 0) * 5 + 
          COALESCE(m.pelajar_mahasiswa, 0) * 3 + 
          COALESCE(m.usia_produktif, 0) * 2
        WHEN 'klinik' THEN 
          COALESCE(m.usia_produktif, 0) * 7 + 
          COALESCE(m.karyawan_swasta, 0) * 3
        WHEN 'salon' THEN 
          COALESCE(m.usia_produktif, 0) * 5 + 
          COALESCE(m.usia_remaja_dewasa, 0) * 5
        WHEN 'minimarket' THEN 
          COALESCE(m.usia_produktif, 0) * 6 + 
          COALESCE(m.karyawan_swasta, 0) * 4
        WHEN 'apotek' THEN 
          COALESCE(m.jumlah_penduduk, 0) * 10
        WHEN 'fotokopi' THEN 
          COALESCE(m.pelajar_mahasiswa, 0) * 7 + 
          COALESCE(m.karyawan_swasta, 0) * 3
        WHEN 'bengkel' THEN 
          COALESCE(m.usia_produktif, 0) * 5 + 
          COALESCE(m.karyawan_swasta, 0) * 5
        WHEN 'barbershop' THEN 
          COALESCE(m.usia_remaja_dewasa, 0) * 6 + 
          COALESCE(m.usia_produktif, 0) * 4
        ELSE COALESCE(m.jumlah_penduduk, 0) * 10
      END) / 10 AS r_demand_target,
      
      (CASE p_business_type
        WHEN 'warkop' THEN m.fnb_count + m.coffee_count
        WHEN 'restoran' THEN m.fnb_count
        WHEN 'laundry' THEN m.laundry_count
        WHEN 'klinik' THEN m.klinik_count
        WHEN 'salon' THEN m.salon_count
        WHEN 'minimarket' THEN m.minimarket_count
        WHEN 'apotek' THEN m.apotek_count
        WHEN 'fotokopi' THEN m.copy_count
        WHEN 'bengkel' THEN m.bengkel_count
        WHEN 'barbershop' THEN m.salon_count
        ELSE 0
      END)::INT AS r_competitor_count,
      
      (CASE p_business_type
        WHEN 'warkop' THEN 
          (m.kampus_count * 3) + (m.office_count * 2) + (m.mall_count * 1)
        WHEN 'restoran' THEN 
          (m.office_count * 3) + (m.mall_count * 2) + (m.pasar_count * 1)
        WHEN 'laundry' THEN 
          (m.kampus_count * 4) + (m.office_count * 2)
        WHEN 'klinik' THEN 
          (m.sekolah_count * 2) + (m.office_count * 1)
        WHEN 'salon' THEN 
          (m.mall_count * 3) + (m.kampus_count * 1)
        WHEN 'minimarket' THEN 
          (m.transit_count * 3) + (m.pasar_count * 1)
        WHEN 'apotek' THEN 
          (m.klinik_count * 4) + (m.sekolah_count * 1)
        WHEN 'fotokopi' THEN 
          (m.kampus_count * 5) + (m.sekolah_count * 3) + (m.office_count * 2)
        WHEN 'bengkel' THEN 
          (m.transit_count * 1) + (m.pasar_count * 1)
        WHEN 'barbershop' THEN 
          (m.kampus_count * 2) + (m.sekolah_count * 1) + (m.mall_count * 1)
        ELSE m.kampus_count + m.mall_count + m.office_count
      END)::INT AS r_anchor_count,
      
      ((m.jalan_utama_meter * 2) + m.jalan_kolektor_meter)::NUMERIC AS r_access_meter
      
    FROM v_kelurahan_master m
  ),
  
  bounds AS (
    SELECT 
      MAX(r_demand_target)::NUMERIC AS max_demand,
      MAX(r_competitor_count)::NUMERIC AS max_competitor,
      MAX(r_anchor_count)::NUMERIC AS max_anchor,
      MAX(r_access_meter)::NUMERIC AS max_access
    FROM raw_metrics
  ),
  
  harga AS (
    SELECT 
      h.kecamatan AS h_kecamatan,
      MIN(h.min_yearly_idr)::BIGINT AS sewa_min,
      MAX(h.max_yearly_idr)::BIGINT AS sewa_max
    FROM harga_sewa h
    WHERE h.format = (SELECT fmt FROM format_pilihan)
    GROUP BY h.kecamatan
  )
  
  SELECT 
    r.r_id,
    r.r_kelurahan,
    r.r_kecamatan,
    r.r_lat,
    r.r_lng,
    r.r_jumlah_penduduk,
    r.r_demand_target::INT,
    r.r_competitor_count::INT,
    r.r_anchor_count::INT,
    r.r_access_meter,
    
    ROUND((r.r_demand_target::NUMERIC / NULLIF(b.max_demand, 0)) * 100, 1) AS d_score,
    ROUND((100 - LEAST((r.r_competitor_count::NUMERIC / 10) * 100, 100))::NUMERIC, 1) AS c_score,
    ROUND((r.r_anchor_count::NUMERIC / NULLIF(b.max_anchor, 0)) * 100, 1) AS an_score,
    ROUND((r.r_access_meter / NULLIF(b.max_access, 0)) * 100, 1) AS ac_score,
    
    CASE 
      WHEN h.sewa_min IS NULL THEN 50.0::NUMERIC
      WHEN p_modal_idr >= h.sewa_max THEN 100.0::NUMERIC
      WHEN p_modal_idr < h.sewa_min THEN 0.0::NUMERIC
      ELSE ROUND(
        (((p_modal_idr - h.sewa_min)::NUMERIC / (h.sewa_max - h.sewa_min)::NUMERIC) * 100)::NUMERIC, 1
      )
    END AS af_score,
    
    h.sewa_min,
    h.sewa_max,
    (SELECT fmt FROM format_pilihan)::TEXT
    
  FROM raw_metrics r
  CROSS JOIN bounds b
  LEFT JOIN harga h ON h.h_kecamatan = r.r_kecamatan
  ORDER BY r.r_kelurahan;
END;
$$;