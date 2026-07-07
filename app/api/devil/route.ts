import { NextRequest, NextResponse } from 'next/server';
import { generateJson } from '@/lib/ai';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

interface DevilRequest {
  kelurahan: string;
  kecamatan: string;
  businessType: string;
  businessLabel: string;
  modalIdr: number;
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
  sewa: { minIdr: number | null; maxIdr: number | null };
  jumlahPenduduk: number;
}

interface Risk {
  severity: 'high' | 'medium' | 'low';
  text: string;
}

interface DevilResponse {
  risks: Risk[];
  verdict: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: DevilRequest = await req.json();
    const { kelurahan, kecamatan, businessType, businessLabel, modalIdr, scores, competitorCount, anchorCount, sewa, jumlahPenduduk } = body;

    const bLabel = businessLabel || businessType;
    const fmt = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
    const sewaStr = sewa.minIdr && sewa.maxIdr
      ? `${fmt.format(sewa.minIdr)} – ${fmt.format(sewa.maxIdr)}/tahun`
      : 'tidak diketahui';
    const rentRatio = sewa.minIdr ? Math.round((sewa.minIdr / modalIdr) * 100) : null;

    // Find the weakest scores to focus critique on
    const scoreEntries = [
      { name: 'demand', label: 'Demand pasar', val: scores.demand },
      { name: 'competition', label: 'Tekanan kompetitor', val: scores.competition },
      { name: 'anchor', label: 'Anchor/traffic generator', val: scores.anchor },
      { name: 'access', label: 'Aksesibilitas jalan', val: scores.access },
      { name: 'affordability', label: 'Keterjangkauan sewa', val: scores.affordability },
    ].sort((a, b) => a.val - b.val); // weakest first

    const weakest = scoreEntries.slice(0, 2).map(s => `${s.label}: ${s.val}/100`).join(', ');

    const prompt = `Kamu adalah analis risiko bisnis UMKM Indonesia yang skeptis dan kritis. Tugasmu BUKAN memuji lokasi, tapi mencari KELEMAHAN NYATA berdasarkan data.

# Data Lokasi
- Lokasi: ${kelurahan}, Kec. ${kecamatan}
- Usaha: ${bLabel}
- Modal: ${fmt.format(modalIdr)}
- Sewa estimasi: ${sewaStr}${rentRatio ? ` (${rentRatio}% dari modal)` : ''}
- Penduduk: ${jumlahPenduduk.toLocaleString('id-ID')} jiwa

# Skor (0-100, makin tinggi makin baik)
- Demand: ${scores.demand} — ${scores.demand < 40 ? 'LEMAH' : scores.demand < 60 ? 'SEDANG' : 'baik'}
- Kompetisi: ${scores.competition} — ${scores.competition < 40 ? 'BANYAK SAINGAN' : scores.competition < 60 ? 'cukup ketat' : 'longgar'}
- Anchor/traffic: ${scores.anchor} — ${scores.anchor < 40 ? 'MINIM traffic generator' : scores.anchor < 60 ? 'sedang' : 'baik'}
- Akses jalan: ${scores.access} — ${scores.access < 40 ? 'SUSAH DIJANGKAU' : scores.access < 60 ? 'sedang' : 'baik'}
- Affordability: ${scores.affordability} — ${scores.affordability < 40 ? 'SEWA BERAT' : scores.affordability < 60 ? 'pas-pasan' : 'aman'}
- SKOR AKHIR: ${scores.final}/100

# POI Data
- Kompetitor aktif di area: ${competitorCount}
- Anchor POI (kampus/mall/kantor): ${anchorCount}

# Titik Lemah Utama
${weakest}

Berikan 2-3 risiko SPESIFIK yang perlu dipertimbangkan. Gunakan angka dari data. Jangan generik. Severity: "high" jika skor < 35 atau ada risiko fatal, "medium" jika 35-55 atau perlu perhatian, "low" jika ada tapi manageable.

Output JSON saja:
{
  "risks": [
    { "severity": "high|medium|low", "text": "max 25 kata, spesifik, pakai angka dari data" },
    { "severity": "high|medium|low", "text": "..." }
  ],
  "verdict": "1 kalimat jujur max 20 kata — apakah risiko ini fatal atau manageable"
}`;

    const result = await generateJson<DevilResponse>(prompt);

    // Validate structure
    if (!Array.isArray(result.risks) || result.risks.length === 0) {
      throw new Error('Invalid response structure');
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Devil API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
