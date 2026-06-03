// Mapping business type ke OSM tags (untuk hitung kompetisi)
// dan ke demografi field (untuk hitung demand)

export type BusinessType = 
  | 'warkop' 
  | 'restoran' 
  | 'laundry' 
  | 'klinik' 
  | 'salon' 
  | 'minimarket' 
  | 'apotek' 
  | 'fotokopi'
  | 'bengkel'
  | 'barbershop';

export interface BusinessProfile {
  label: string;
  description: string;
  // OSM tags yang dianggap KOMPETITOR
  competitorTags: { key: string; values: string[] }[];
  // Demografi field yang relevan (untuk demand score)
  demandFactors: {
    field: 'usia_remaja_dewasa' | 'usia_produktif' | 'pelajar_mahasiswa' | 'karyawan_swasta' | 'wiraswasta';
    weight: number; // 0-1, total tidak harus 1
  }[];
  // Anchor yang nge-boost (kampus, kantor, dll)
  anchorTags: { key: string; values: string[]; weight: number }[];
}

export const BUSINESS_PROFILES: Record<BusinessType, BusinessProfile> = {
  warkop: {
    label: 'Warung Kopi / Coffee Shop',
    description: 'Tempat ngopi & nongkrong target anak muda/karyawan',
    competitorTags: [
      { key: 'amenity', values: ['cafe', 'restaurant', 'fast_food'] },
      { key: 'shop', values: ['coffee'] },
    ],
    demandFactors: [
      { field: 'usia_remaja_dewasa', weight: 0.4 },
      { field: 'karyawan_swasta', weight: 0.3 },
      { field: 'pelajar_mahasiswa', weight: 0.3 },
    ],
    anchorTags: [
      { key: 'amenity', values: ['university', 'college', 'school'], weight: 0.5 },
      { key: 'office', values: ['*'], weight: 0.3 },
      { key: 'amenity', values: ['mall'], weight: 0.2 },
    ],
  },
  
  restoran: {
    label: 'Restoran / Rumah Makan',
    description: 'Makanan untuk semua kalangan',
    competitorTags: [
      { key: 'amenity', values: ['restaurant', 'fast_food', 'food_court'] },
    ],
    demandFactors: [
      { field: 'usia_produktif', weight: 0.5 },
      { field: 'karyawan_swasta', weight: 0.5 },
    ],
    anchorTags: [
      { key: 'office', values: ['*'], weight: 0.4 },
      { key: 'amenity', values: ['mall', 'marketplace'], weight: 0.3 },
      { key: 'amenity', values: ['hospital', 'school'], weight: 0.3 },
    ],
  },
  
  laundry: {
    label: 'Laundry Kiloan',
    description: 'Cuci-setrika untuk hunian padat',
    competitorTags: [
      { key: 'shop', values: ['laundry', 'dry_cleaning'] },
    ],
    demandFactors: [
      { field: 'karyawan_swasta', weight: 0.5 },
      { field: 'pelajar_mahasiswa', weight: 0.3 },
      { field: 'usia_produktif', weight: 0.2 },
    ],
    anchorTags: [
      { key: 'building', values: ['apartments', 'dormitory'], weight: 0.5 },
      { key: 'amenity', values: ['university'], weight: 0.5 },
    ],
  },
  
  klinik: {
    label: 'Klinik / Praktik Dokter',
    description: 'Layanan kesehatan',
    competitorTags: [
      { key: 'amenity', values: ['clinic', 'doctors', 'hospital'] },
      { key: 'healthcare', values: ['*'] },
    ],
    demandFactors: [
      { field: 'usia_produktif', weight: 0.7 },
      { field: 'karyawan_swasta', weight: 0.3 },
    ],
    anchorTags: [
      { key: 'building', values: ['residential', 'apartments'], weight: 0.5 },
      { key: 'amenity', values: ['school'], weight: 0.3 },
    ],
  },
  
  salon: {
    label: 'Salon Kecantikan / Barbershop',
    description: 'Perawatan rambut & kecantikan',
    competitorTags: [
      { key: 'shop', values: ['hairdresser', 'beauty', 'cosmetics'] },
    ],
    demandFactors: [
      { field: 'usia_produktif', weight: 0.5 },
      { field: 'usia_remaja_dewasa', weight: 0.5 },
    ],
    anchorTags: [
      { key: 'amenity', values: ['mall', 'marketplace'], weight: 0.5 },
      { key: 'building', values: ['apartments'], weight: 0.3 },
    ],
  },
  
  minimarket: {
    label: 'Minimarket / Toko Kelontong',
    description: 'Kebutuhan sehari-hari',
    competitorTags: [
      { key: 'shop', values: ['convenience', 'supermarket', 'grocery'] },
    ],
    demandFactors: [
      { field: 'usia_produktif', weight: 0.6 },
      { field: 'karyawan_swasta', weight: 0.4 },
    ],
    anchorTags: [
      { key: 'building', values: ['residential', 'apartments'], weight: 0.7 },
      { key: 'highway', values: ['primary', 'secondary'], weight: 0.3 },
    ],
  },
  
  apotek: {
    label: 'Apotek',
    description: 'Obat-obatan & farmasi',
    competitorTags: [
      { key: 'amenity', values: ['pharmacy'] },
      { key: 'shop', values: ['chemist'] },
    ],
    demandFactors: [
      { field: 'jumlah_penduduk', weight: 1.0 } as any,
    ],
    anchorTags: [
      { key: 'amenity', values: ['clinic', 'hospital', 'doctors'], weight: 0.7 },
      { key: 'building', values: ['residential'], weight: 0.3 },
    ],
  },
  
  fotokopi: {
    label: 'Fotokopi & Print',
    description: 'Layanan cetak & ATK untuk pelajar/kantor',
    competitorTags: [
      { key: 'shop', values: ['copyshop', 'stationery'] },
    ],
    demandFactors: [
      { field: 'pelajar_mahasiswa', weight: 0.7 },
      { field: 'karyawan_swasta', weight: 0.3 },
    ],
    anchorTags: [
      { key: 'amenity', values: ['university', 'college', 'school'], weight: 0.7 },
      { key: 'office', values: ['*'], weight: 0.3 },
    ],
  },
  
  bengkel: {
    label: 'Bengkel Motor / Mobil',
    description: 'Servis kendaraan',
    competitorTags: [
      { key: 'shop', values: ['car_repair', 'motorcycle_repair'] },
      { key: 'amenity', values: ['fuel'] },
    ],
    demandFactors: [
      { field: 'usia_produktif', weight: 0.5 },
      { field: 'karyawan_swasta', weight: 0.5 },
    ],
    anchorTags: [
      { key: 'highway', values: ['primary', 'secondary', 'tertiary'], weight: 0.7 },
      { key: 'building', values: ['residential'], weight: 0.3 },
    ],
  },
  
  barbershop: {
    label: 'Barbershop / Pangkas Rambut Pria',
    description: 'Cukur rambut pria',
    competitorTags: [
      { key: 'shop', values: ['hairdresser'] },
    ],
    demandFactors: [
      { field: 'usia_remaja_dewasa', weight: 0.6 },
      { field: 'usia_produktif', weight: 0.4 },
    ],
    anchorTags: [
      { key: 'amenity', values: ['mall'], weight: 0.3 },
      { key: 'building', values: ['residential', 'apartments'], weight: 0.4 },
      { key: 'amenity', values: ['university', 'school'], weight: 0.3 },
    ],
  },
};

// Helper untuk dapetin profile
export function getBusinessProfile(type: BusinessType): BusinessProfile {
  return BUSINESS_PROFILES[type];
}

// Map modal range ke format yang direkomendasi
export function suggestFormat(modalIdr: number): ('pkl' | 'kios' | 'ruko_std' | 'ruko_premium')[] {
  if (modalIdr < 15_000_000) return ['pkl'];
  if (modalIdr < 50_000_000) return ['pkl', 'kios'];
  if (modalIdr < 150_000_000) return ['kios', 'ruko_std'];
  if (modalIdr < 350_000_000) return ['ruko_std'];
  return ['ruko_std', 'ruko_premium'];
}