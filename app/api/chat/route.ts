import { NextRequest, NextResponse } from 'next/server';
import { chatWithTools } from '@/lib/ai';
import type { ToolDef, ChatMessage } from '@/lib/ai';
import { JABODETABEK_KOTAS } from '@/lib/kotas';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

interface UiState {
  businessType: string;
  modalIdr: number;
  userContext: string;
  sqlCategory: string;
  kotaKab: string;
  darkMode: boolean;
  hasResults: boolean;
  topRankings: Array<{ rank: number; kelurahan: string; kecamatan: string; score: number }>;
  selectedKelurahan: { kelurahan: string; kecamatan: string; rank: number; score: number } | null;
  spotsForSelected: Array<{ rank: number; name: string; placeType: string; anchorName: string; score: number }>;
}

interface RequestBody {
  messages: ChatMessage[];
  state: UiState;
}

const tools: ToolDef[] = [
  {
    name: 'setBusinessType',
    description: 'Ganti jenis usaha (jenis bisnis) yang sedang dicari user. Contoh: "Toko Buku", "Warung Kopi", "Toko Roti".',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Jenis usaha baru, dalam bahasa natural Indonesia.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'setModalIdr',
    description: 'Ganti besar modal user dalam Rupiah (angka penuh, bukan singkatan). Contoh: 80000000 untuk 80 juta.',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Modal dalam IDR (angka penuh, mis. 50000000).' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'setUserContext',
    description: 'Ganti konteks lokasi/target user. Konteks ini menjelaskan area di kota aktif yang user incar atau segmen target. Contoh: "dekat kampus UI, target mahasiswa" atau "dekat stasiun MRT Lebak Bulus".',
    parameters: {
      type: 'object',
      properties: {
        context: { type: 'string', description: 'Konteks baru, kalimat natural Indonesia.' },
      },
      required: ['context'],
    },
  },
  {
    name: 'setKotaKab',
    description: 'Ganti kota/kabupaten aktif analisis. Wajib dipanggil kalau user minta pindah ke kota lain (contoh: "ganti ke Bekasi", "coba di Depok"). Setelah ini biasanya panggil triggerSearch.',
    parameters: {
      type: 'object',
      properties: {
        kotaKab: {
          type: 'string',
          description: 'Nama kota/kabupaten yang valid di Jabodetabek.',
          enum: [...JABODETABEK_KOTAS],
        },
      },
      required: ['kotaKab'],
    },
  },
  {
    name: 'triggerSearch',
    description: 'Jalankan pencarian rekomendasi lokasi dengan input saat ini (jenis usaha, modal, konteks). Panggil setelah semua input terisi. WAJIB pakai ini kalau user minta "cari", "analisis", "rekomendasi", atau setelah ganti input.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'selectKelurahan',
    description: 'Pilih (focus) kelurahan ranking ke-N dari hasil rekomendasi. Mengubah tab aktif di sidebar dan zoom peta. Hanya bisa dipanggil kalau sudah ada hasil rekomendasi.',
    parameters: {
      type: 'object',
      properties: {
        rank: { type: 'number', description: 'Ranking 1, 2, atau 3.', enum: [1, 2, 3] },
      },
      required: ['rank'],
    },
  },
  {
    name: 'flyToSpot',
    description: 'Zoom peta ke spot/titik POI ke-N di kelurahan yang lagi dipilih. Hanya berfungsi kalau ada selectedKelurahan + spotsForSelected.',
    parameters: {
      type: 'object',
      properties: {
        spotRank: { type: 'number', description: 'Nomor urut spot mulai dari 1.' },
      },
      required: ['spotRank'],
    },
  },
  {
    name: 'compareKelurahan',
    description: 'Tampilkan perbandingan side-by-side antara 2 kelurahan dari hasil rekomendasi.',
    parameters: {
      type: 'object',
      properties: {
        rankA: { type: 'number', enum: [1, 2, 3] },
        rankB: { type: 'number', enum: [1, 2, 3] },
      },
      required: ['rankA', 'rankB'],
    },
  },
  {
    name: 'exportPDF',
    description: 'Export laporan PDF untuk kelurahan yang lagi dipilih. Hanya bisa dipakai kalau ada selectedKelurahan dan narrative-nya sudah ada.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'toggleDarkMode',
    description: 'Ganti tema antara dark dan light mode.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

function buildSystemPrompt(state: UiState): string {
  const rankingsText = state.topRankings.length > 0
    ? state.topRankings.map(r => `  #${r.rank} ${r.kelurahan} (Kec. ${r.kecamatan}) — skor ${r.score}`).join('\n')
    : '  (belum ada hasil)';

  const selectedText = state.selectedKelurahan
    ? `${state.selectedKelurahan.kelurahan}, Kec. ${state.selectedKelurahan.kecamatan} (rank #${state.selectedKelurahan.rank}, skor ${state.selectedKelurahan.score})`
    : '(belum ada kelurahan dipilih)';

  const spotsText = state.spotsForSelected.length > 0
    ? state.spotsForSelected.slice(0, 6).map(s => `  ${s.rank}. ${s.name} (${s.placeType}) — dekat ${s.anchorName}, skor ${s.score}`).join('\n')
    : '  (tidak ada spot)';

  return `Anda adalah asisten interaktif PetaCuan — aplikasi rekomendasi lokasi UMKM Jabodetabek (13 kota/kabupaten).

# Cara kerja
- Anda dapat menjawab pertanyaan ATAU melakukan tindakan via tools. Pilih yang benar.
- Bahasa: Indonesia yang sopan dan formal. Sapa dengan "Anda". Hindari "lo", "gw", "kamu", slang.
- Jawaban singkat — 1-3 kalimat. Hindari basa-basi.

# ATURAN KRITIS: Bedakan PERTANYAAN dari PERINTAH

## PERTANYAAN → JAWAB SAJA, JANGAN PANGGIL TOOL APAPUN
Tanda pertanyaan: kalimat mengandung "kenapa", "mengapa", "apa", "apakah", "bagaimana", "di mana", "kapan", "siapa", "mana", "jelaskan", "tolong jelaskan", atau diakhiri "?".
Termasuk pembukaan: "saya tanya...", "tolong dijawab...", "boleh tanya...", "mau nanya...".

Contoh PERTANYAAN (jawab dengan teks saja, ZERO tool calls):
- "Kenapa top 1 di Pamulang Barat itu sekolah di jalan guru?" → JAWAB dengan reasoning dari data (anchorName, placeType, skor). JANGAN panggil triggerSearch.
- "Apa keunggulan ranking #1?" → JAWAB dari scores dan stats. JANGAN panggil selectKelurahan.
- "Mengapa skor di Serpong rendah?" → JAWAB dari data. JANGAN panggil tool.
- "Itu spot apa?" → JAWAB. JANGAN panggil tool.

## PERINTAH AKSI → PANGGIL TOOL
Tanda perintah: kata kerja imperatif tanpa tanda tanya: "ganti", "ubah", "set", "pilih", "cari", "analisis", "jalankan", "tampilkan", "bandingkan", "export", "kirim", "buka", "pindah".

Contoh PERINTAH (panggil tool yang sesuai):
- "Ganti jenis usaha jadi Toko Roti" → setBusinessType
- "Pindah analisis ke Bekasi" / "Coba di Depok" → setKotaKab + triggerSearch
- "Cari di Pamulang" → setUserContext + triggerSearch
- "Pilih ranking #2" → selectKelurahan
- "Bandingkan #1 dan #2" → compareKelurahan
- "Ulangi analisisnya" → triggerSearch

# Aturan tambahan
- Jika modal disebut "50 juta" konversi ke 50000000. "1.5M" → 1500000000.
- Cakupan area: 13 kota/kabupaten Jabodetabek — Jakarta (5 wilayah), Bogor (kota & kab), Depok, Tangerang (kota, kab, Tangsel), Bekasi (kota & kab).
- Analisis saat ini fokus di kota: **${state.kotaKab}**. Konteks user di-interpretasi dalam kota ini. Jika user menyebut kota lain di Jabodetabek, panggil setKotaKab dulu sebelum triggerSearch.
- Saat pengguna bertanya tentang spot tertentu, identifikasi dari daftar "Spot di kelurahan dipilih" di bawah dan jelaskan berdasarkan placeType, anchorName, skor, dan ranking kelurahannya.

# State sekarang
- Kota aktif: ${state.kotaKab}
- Jenis usaha: ${state.businessType || '(kosong)'}
- Modal: Rp ${state.modalIdr.toLocaleString('id-ID')}
- Konteks: ${state.userContext || '(kosong)'}
- Kategori SQL: ${state.sqlCategory}
- Tema: ${state.darkMode ? 'dark' : 'light'}
- Ada hasil? ${state.hasResults ? 'Ya' : 'Belum'}

# Top ranking
${rankingsText}

# Kelurahan dipilih
${selectedText}

# Spot di kelurahan dipilih
${spotsText}

# Output
- Selalu berikan balasan teks singkat (1-3 kalimat) agar pengguna tahu tindakan yang dilakukan.
- Boleh memanggil beberapa tool sekaligus dalam 1 response jika perlu (misal setBusinessType + triggerSearch).
- Jangan menyebut "saya akan memanggil tool X" — langsung panggil dan sampaikan hasilnya, contoh: "Baik, jenis usaha sudah diubah menjadi Toko Roti."`;
}

function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter(m => m.content.trim().length > 0)
    .map(m => ({ role: m.role, content: m.content }));
}

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json();
    const { messages, state } = body;

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 });
    }

    const { text, toolCalls } = await chatWithTools({
      system: buildSystemPrompt(state),
      messages: sanitizeMessages(messages),
      tools,
      maxTokens: 600,
      temperature: 0.2,
    });

    return NextResponse.json({ text, toolCalls });
  } catch (err) {
    console.error('Chat API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Chat failed' },
      { status: 500 }
    );
  }
}
