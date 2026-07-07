export const JABODETABEK_KOTAS = [
  'Jakarta Pusat',
  'Jakarta Utara',
  'Jakarta Barat',
  'Jakarta Selatan',
  'Jakarta Timur',
  'Kota Bogor',
  'Kabupaten Bogor',
  'Depok',
  'Kota Tangerang',
  'Kabupaten Tangerang',
  'Tangerang Selatan',
  'Kota Bekasi',
  'Kabupaten Bekasi',
] as const;

export type KotaKab = (typeof JABODETABEK_KOTAS)[number];

export const DEFAULT_KOTA_KAB: KotaKab = 'Jakarta Selatan';

export function isJabodetabekKota(value: string): value is KotaKab {
  return (JABODETABEK_KOTAS as readonly string[]).includes(value);
}
