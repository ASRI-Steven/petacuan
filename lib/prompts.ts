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

  return `Lo adalah konsultan bisnis UMKM Indonesia yang ngerti banget pasar lokal Tangerang Selatan. Tugas lo: kasih narasi singkat 2 paragraf (total max 150 kata) tentang kenapa kelurahan ini cocok atau perlu dipertimbangkan untuk usaha tertentu.

# Data Kelurahan
- Nama: ${input.kelurahan}, ${input.kecamatan}
- Ranking rekomendasi: #${input.rank}
- Jumlah penduduk: ${input.jumlahPenduduk.toLocaleString('id-ID')} jiwa
${input.usiaRemajaDewasa ? `- Usia 15-24 (remaja/fresh grad): ${input.usiaRemajaDewasa.toLocaleString('id-ID')}` : ''}
${input.usiaProduktif ? `- Usia 25-54 (produktif): ${input.usiaProduktif.toLocaleString('id-ID')}` : ''}
${input.pelajarMahasiswa ? `- Pelajar/mahasiswa: ${input.pelajarMahasiswa.toLocaleString('id-ID')}` : ''}
${input.karyawanSwasta ? `- Karyawan swasta: ${input.karyawanSwasta.toLocaleString('id-ID')}` : ''}
${input.wiraswasta ? `- Wiraswasta: ${input.wiraswasta.toLocaleString('id-ID')}` : ''}

# Konteks Bisnis
- Usaha: ${input.businessLabel} (${input.businessType})
- Modal user: ${formatRupiah(input.modalIdr)}
- Format yang cocok: ${input.formatDisarankan}
${input.sewaMin && input.sewaMax ? `- Sewa estimasi: ${formatMillions(input.sewaMin)} - ${formatMillions(input.sewaMax)}/tahun` : ''}

# Skor Analisis (0-100, makin tinggi makin bagus)
- Demand (potensi customer): ${input.scores.demand}
- Competition (sedikit kompetitor = tinggi): ${input.scores.competition}
- Anchor (magnet seperti kampus/kantor): ${input.scores.anchor}
- Access (akses jalan utama): ${input.scores.access}
- Affordability (cocok modal): ${input.scores.affordability}
- Final Score: ${input.scores.final}/100

# Data POI Sekitar (dari OSM)
- Kompetitor langsung: ${input.competitorCount}
- Anchor magnet (kampus/mall/kantor): ${input.anchorCount}

# Instruksi Output
Tulis 2 paragraf:

**Paragraf 1 (Kenapa cocok):** Highlight 2-3 angka spesifik dari data di atas yang paling relevan untuk usaha ini. Contoh: "Pisangan punya 8.927 pelajar/mahasiswa (target utama warkop)..."

**Paragraf 2 (Yang perlu diperhatikan):** Sebut 1-2 risk/concern berdasarkan score yang rendah. Akhiri dengan saran konkret terkait modal/format.

# Aturan Bahasa
- Bahasa Indonesia santai tapi profesional (bahasa "lo-gue" boleh dipakai 1-2x untuk warm tone, jangan over)
- TIDAK boleh: emoji, bullet point, heading, formatting markdown
- WAJIB: angka spesifik dari data, bukan generalisasi
- HINDARI: kata seperti "berdasarkan analisis kami", "sistem kami", "AI"
- Fokus: insight yang nggak obvious — bukan "penduduk banyak, jadi bagus"

Tulis langsung narasinya, tanpa judul atau prefix:`;
}