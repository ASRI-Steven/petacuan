interface NarrativeInput {
  kelurahan: string;
  kecamatan: string;
  rank: number; // 1, 2, 3

  businessType: string;
  businessLabel: string; // "Warung Kopi / Cafe"
  modalIdr: number;

  jumlahPenduduk: number;
  usiaRemajaDewasa?: number;
  usiaProduktif?: number;
  pelajarMahasiswa?: number;
  karyawanSwasta?: number;
  wiraswasta?: number;

  scores: {
    demand: number;
    competition: number;
    anchor: number;
    access: number;
    affordability: number;
    final: number;
  };

  competitorCount: number;
  anchorCount: number;

  sewaMin?: number;
  sewaMax?: number;
  formatDisarankan: string;
}

export function buildNarrativePrompt(input: NarrativeInput): string {
  const formatRupiah = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
      .format(n);

  const formatMillions = (n: number) => `Rp ${(n / 1_000_000).toFixed(0)} juta`;

  return `Konsultan bisnis UMKM Indonesia. Analisis lokasi usaha dalam 2 paragraf singkat (total max 70 kata).

# Data
- Lokasi: ${input.kelurahan}, ${input.kecamatan} (Ranking #${input.rank})
- Penduduk: ${input.jumlahPenduduk.toLocaleString('id-ID')} jiwa
${input.usiaRemajaDewasa ? `- Usia 15-24: ${input.usiaRemajaDewasa.toLocaleString('id-ID')}` : ''}
${input.usiaProduktif ? `- Usia produktif: ${input.usiaProduktif.toLocaleString('id-ID')}` : ''}
${input.pelajarMahasiswa ? `- Pelajar/mahasiswa: ${input.pelajarMahasiswa.toLocaleString('id-ID')}` : ''}
${input.karyawanSwasta ? `- Karyawan swasta: ${input.karyawanSwasta.toLocaleString('id-ID')}` : ''}

# Bisnis
- Usaha: ${input.businessLabel}
- Modal: ${formatRupiah(input.modalIdr)}
- Format: ${input.formatDisarankan}
${input.sewaMin && input.sewaMax ? `- Sewa: ${formatMillions(input.sewaMin)} - ${formatMillions(input.sewaMax)}/tahun` : ''}

# Skor (0-100)
Demand: ${input.scores.demand} | Competition: ${input.scores.competition} | Anchor: ${input.scores.anchor} | Access: ${input.scores.access} | Affordability: ${input.scores.affordability}

# POI
Kompetitor: ${input.competitorCount} | Anchor: ${input.anchorCount}

# Output
Paragraf 1 (Kekuatan): 1-2 kalimat. Sebut 1 angka spesifik yang menonjol.
Paragraf 2 (Perhatian): 1-2 kalimat. Sebut 1 risiko + saran konkret.

# Aturan
- Bahasa Indonesia formal, ringkas
- DILARANG: kata ganti orang (lo, gw, kamu, anda, kita)
- DILARANG: emoji, bullet, heading, markdown
- DILARANG: kata "sistem", "AI", "kami", "analisis"
- WAJIB: angka spesifik dari data

Output langsung narasi:`;
}

// ── Landmark map per kota (opsional) ──────────────────────────
// Hanya Tangerang Selatan yang sudah punya pemetaan landmark detail.
// Untuk kota lain, AI cukup menafsirkan nama kelurahan/kecamatan dari konteks user.
const KOTA_LANDMARKS: Record<string, string> = {
  'Tangerang Selatan': `# Landmark Tangerang Selatan
- Binus / Bina Nusantara Alam Sutera → Serpong Utara → [Pakulonan, Pakualam, Pondok Jagung]
- UMN / Multimedia Nusantara → Serpong Utara → [Pakulonan, Pondok Jagung]
- UIN / Syarif Hidayatullah / kampus Ciputat → Ciputat Timur → [Pisangan, Cireundeu]
- Unpam / Universitas Pamulang → Pamulang → [Pamulang Timur, Pamulang Barat]
- BSD / BSD City / Nuvasa Bay → Serpong → [Lengkong Gudang, Ciater, Serpong]
- AEON Mall → Serpong Utara → [Pakulonan, Pondok Jagung]
- Summarecon / Gading Serpong / Mall Gading → Serpong Utara → [Pakualam, Pakulonan, Pondok Jagung]
- Tangerang City Mall / Lippo → Pondok Aren → [Pondok Aren, Pondok Jaya]
- ICE BSD → Serpong → [Buaran, Ciater]
- Pamulang Square / pusat Pamulang → Pamulang → [Pamulang Barat, Pamulang Timur]
- Ciputat kota / alun-alun Ciputat → Ciputat → [Ciputat, Jombang]
- Bintaro → Pondok Aren → [Pondok Aren, Pondok Jaya, Parigi]
- Jurangmangu → Pondok Aren → [Jurangmangu Barat, Jurangmangu Timur]
- Pondok Cabe → Pamulang → [Pondok Cabe Ilir, Pondok Cabe Udik]

CATATAN: "serpong" / "daerah serpong" / "bsd" / "gading serpong" tanpa landmark spesifik → kecamatan: ["Serpong", "Serpong Utara"]`,
};

export function buildWeightTuningPrompt(
  businessType: string,
  businessLabel: string,
  modalIdr: number,
  userContext: string,
  kotaKab: string,
): string {
  const formatRupiah = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
      .format(n);

  const landmarkSection =
    KOTA_LANDMARKS[kotaKab] ||
    `# Landmark ${kotaKab}
(Belum ada peta landmark detail untuk kota ini. Interpretasi locationFilter HANYA dari nama kelurahan/kecamatan yang persis disebut user di konteks. Jika tidak ada nama eksplisit, set locationFilter ke null.)`;

  return `Expert location scoring UMKM Jabodetabek. Tugas: validasi scope, tentukan bobot, petakan lokasi TEPAT, dan pilih sqlCategory.

# Input
- Usaha: ${businessLabel}
- Modal: ${formatRupiah(modalIdr)}
- Konteks user: "${userContext}"
- Kota analisis saat ini: ${kotaKab}

# Scope Database
Database mencakup 13 kota/kabupaten Jabodetabek: Jakarta Pusat/Utara/Barat/Selatan/Timur, Kota & Kabupaten Bogor, Depok, Kota & Kabupaten Tangerang, Tangerang Selatan, Kota & Kabupaten Bekasi.

Aturan outOfScope:
- outOfScope = true → user menyebut wilayah LUAR Jabodetabek (Bandung, Surabaya, Yogyakarta, Karawang, dll).
- outOfScope = false → user menyebut wilayah DALAM Jabodetabek meskipun kota berbeda dari "Kota analisis saat ini". Jangan blokir — beri reasoning bahwa user perlu mengganti dropdown kota ke kota yang dimaksud, set locationFilter = null.

${landmarkSection}

# 5 Score
1. demand = banyak target customer
2. competition = sedikit kompetitor (tinggi = bagus)
3. anchor = magnet sekitar (kampus, mall, kantor)
4. access = akses jalan utama
5. affordability = modal cocok dengan sewa

# Aturan Bobot
Total = 1.0, minimal 0.05 per item. Sesuaikan bobot dengan konteks bisnis user.

# sqlCategory — WAJIB
Pilih 1 dari 10 kategori SQL berikut yang paling mirip dengan jenis usaha user (digunakan untuk menghitung jumlah kompetitor di database):
warkop, restoran, laundry, klinik, salon, minimarket, apotek, fotokopi, bengkel, barbershop

Panduan pemilihan (gunakan yang paling dekat secara segmen pasar & tipe kompetitor):
- Makanan/minuman (cafe, warteg, bakso, dll) → warkop atau restoran
- Jasa kebersihan/perawatan (cuci baju, dry clean) → laundry
- Kesehatan (klinik gigi, apotek, lab) → klinik atau apotek
- Kecantikan/grooming (spa, nail art, barbershop) → salon atau barbershop
- Servis kendaraan (tambal ban, cuci motor) → bengkel
- Ritel kebutuhan harian (sembako, ATK) → minimarket atau fotokopi
- Jasa cetak/print/percetakan → fotokopi

# locationFilter
WAJIB isi jika user menyebut nama kelurahan/kecamatan SPESIFIK yang valid di ${kotaKab}.
- Jika user menyebut nama kelurahan langsung → isi locationFilter.kelurahan + kelurahan terdekat yang relevan.
- Jika user menyebut nama landmark/kawasan dan ada di peta landmark di atas → petakan ke kelurahan terdekat.
- Jika user hanya menyebut kecamatan → isi kecamatan saja, kosongkan kelurahan.
- Jika user menyebut kota BERBEDA dari "${kotaKab}" → set locationFilter null.
- Jika user tidak menyebut lokasi apapun → set locationFilter null.

# Output JSON saja
{
  "outOfScope": true/false,
  "outOfScopeReason": "null atau alasan jika outOfScope=true",
  "sqlCategory": "salah satu dari: warkop restoran laundry klinik salon minimarket apotek fotokopi bengkel barbershop",
  "weights": {
    "demand": 0.xx,
    "competition": 0.xx,
    "anchor": 0.xx,
    "access": 0.xx,
    "affordability": 0.xx
  },
  "locationFilter": {
    "kecamatan": ["NamaKecamatan"],
    "kelurahan": ["NamaKelurahan1", "NamaKelurahan2"]
  } atau null,
  "reasoning": "1 kalimat formal max 30 kata tentang strategi bobot dan lokasi"
}`;
}
