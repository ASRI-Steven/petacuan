import { 
  pgTable, 
  serial, 
  text, 
  integer, 
  decimal, 
  jsonb,
  customType 
} from 'drizzle-orm/pg-core';

const geometry = customType<{ data: string }>({
  dataType() { return 'geometry'; },
});

export const kelurahan = pgTable('kelurahan', {
  id: serial('id').primaryKey(),
  kode: text('kode'),
  nama: text('nama').notNull(),
  kecamatan: text('kecamatan').notNull(),
  kotaKab: text('kota_kab').notNull().default('Tangerang Selatan'),
  geom: geometry('geom').notNull(),
});

export const demografi = pgTable('demografi', {
  id: serial('id').primaryKey(),
  kelurahanId: integer('kelurahan_id').references(() => kelurahan.id),
  jumlahPenduduk: integer('jumlah_penduduk'),
  usiaRemajaDewasa: integer('usia_remaja_dewasa'),
  usiaProduktif: integer('usia_produktif'),
  pelajarMahasiswa: integer('pelajar_mahasiswa'),
  karyawanSwasta: integer('karyawan_swasta'),
  wiraswasta: integer('wiraswasta'),
  luasKm2: decimal('luas_km2', { precision: 10, scale: 4 }),
  kepadatan: integer('kepadatan'),
  metadata: jsonb('metadata'),
});

export const hargaSewa = pgTable('harga_sewa', {
  id: serial('id').primaryKey(),
  kelurahanId: integer('kelurahan_id').references(() => kelurahan.id),
  kecamatan: text('kecamatan'),
  format: text('format').notNull(),
  minYearlyIdr: integer('min_yearly_idr'),
  maxYearlyIdr: integer('max_yearly_idr'),
  source: text('source'),
});