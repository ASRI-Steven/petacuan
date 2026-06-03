import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';
import { generateText } from '@/lib/ai';
import { buildNarrativePrompt } from '@/lib/prompts';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 5 });

const BUSINESS_LABELS: Record<string, string> = {
  warkop: 'Warung Kopi / Cafe',
  restoran: 'Restoran / Rumah Makan',
  laundry: 'Laundry Kiloan',
  klinik: 'Klinik / Dokter',
  salon: 'Salon Kecantikan',
  minimarket: 'Minimarket',
  apotek: 'Apotek',
  fotokopi: 'Fotokopi & Print',
  bengkel: 'Bengkel Kendaraan',
  barbershop: 'Barbershop',
};

interface RequestBody {
  kelurahanId: number;
  businessType: string;
  modalIdr: number;
  rank: number; // 1, 2, 3
}

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json();
    const { kelurahanId, businessType, modalIdr, rank } = body;
    
    // Validate
    if (!kelurahanId || !businessType || !modalIdr || !rank) {
      return NextResponse.json(
        { error: 'Missing required: kelurahanId, businessType, modalIdr, rank' },
        { status: 400 }
      );
    }
    
    // Fetch full data dari calculate_scores
    const scores = await sql`
      SELECT *
      FROM calculate_scores(${businessType}, ${modalIdr}::BIGINT)
      WHERE kelurahan_id = ${kelurahanId}
    `;
    
    if (scores.length === 0) {
      return NextResponse.json(
        { error: 'Kelurahan not found' },
        { status: 404 }
      );
    }
    
    const s = scores[0];
    
    // Fetch demografi detail
    const demografi = await sql`
      SELECT 
        usia_remaja_dewasa,
        usia_produktif,
        pelajar_mahasiswa,
        karyawan_swasta,
        wiraswasta
      FROM demografi
      WHERE kelurahan_id = ${kelurahanId}
    `;
    
    const d = demografi[0] || {};
    
    // Compute final score with default weights (sama dengan API recommend)
    const DEFAULT_WEIGHTS: Record<string, any> = {
      warkop:     { demand: 0.30, competition: 0.20, anchor: 0.25, access: 0.10, affordability: 0.15 },
      restoran:   { demand: 0.35, competition: 0.20, anchor: 0.20, access: 0.10, affordability: 0.15 },
      laundry:    { demand: 0.40, competition: 0.25, anchor: 0.15, access: 0.05, affordability: 0.15 },
      klinik:     { demand: 0.35, competition: 0.25, anchor: 0.10, access: 0.10, affordability: 0.20 },
      salon:      { demand: 0.30, competition: 0.20, anchor: 0.25, access: 0.10, affordability: 0.15 },
      minimarket: { demand: 0.35, competition: 0.25, anchor: 0.10, access: 0.20, affordability: 0.10 },
      apotek:     { demand: 0.25, competition: 0.20, anchor: 0.30, access: 0.10, affordability: 0.15 },
      fotokopi:   { demand: 0.25, competition: 0.15, anchor: 0.40, access: 0.05, affordability: 0.15 },
      bengkel:    { demand: 0.25, competition: 0.20, anchor: 0.10, access: 0.30, affordability: 0.15 },
      barbershop: { demand: 0.30, competition: 0.20, anchor: 0.25, access: 0.10, affordability: 0.15 },
    };
    const w = DEFAULT_WEIGHTS[businessType] || DEFAULT_WEIGHTS.warkop;
    const finalScore = 
      Number(s.demand_score) * w.demand +
      Number(s.competition_score) * w.competition +
      Number(s.anchor_score) * w.anchor +
      Number(s.access_score) * w.access +
      Number(s.affordability_score) * w.affordability;
    
    // Build prompt
    const prompt = buildNarrativePrompt({
      kelurahan: s.kelurahan,
      kecamatan: s.kecamatan,
      rank,
      businessType,
      businessLabel: BUSINESS_LABELS[businessType] || businessType,
      modalIdr,
      jumlahPenduduk: s.jumlah_penduduk,
      usiaRemajaDewasa: d.usia_remaja_dewasa,
      usiaProduktif: d.usia_produktif,
      pelajarMahasiswa: d.pelajar_mahasiswa,
      karyawanSwasta: d.karyawan_swasta,
      wiraswasta: d.wiraswasta,
      scores: {
        demand: Number(s.demand_score),
        competition: Number(s.competition_score),
        anchor: Number(s.anchor_score),
        access: Number(s.access_score),
        affordability: Number(s.affordability_score),
        final: Math.round(finalScore * 10) / 10,
      },
      competitorCount: s.competitor_count,
      anchorCount: s.anchor_count,
      sewaMin: s.sewa_min_idr ? Number(s.sewa_min_idr) : undefined,
      sewaMax: s.sewa_max_idr ? Number(s.sewa_max_idr) : undefined,
      formatDisarankan: s.format_disarankan,
    });
    
    // Call Gemini
    const narrative = await generateText(prompt);
    
    return NextResponse.json({
      kelurahanId,
      kelurahan: s.kelurahan,
      kecamatan: s.kecamatan,
      narrative: narrative.trim(),
      meta: {
        rank,
        finalScore: Math.round(finalScore * 10) / 10,
        timestamp: new Date().toISOString(),
      },
    });
    
  } catch (err: any) {
    console.error('Narrative API error:', err);
    return NextResponse.json(
      { error: 'Failed to generate narrative', message: err.message },
      { status: 500 }
    );
  }
}