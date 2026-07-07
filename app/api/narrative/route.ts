import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';
import { generateText } from '@/lib/ai';
import { buildNarrativePrompt } from '@/lib/prompts';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 5 });

interface RequestBody {
  kelurahanId: number;
  businessType: string;
  sqlCategory?: string;
  modalIdr: number;
  rank: number;
}

export async function POST(req: NextRequest) {
  let kelurahanId: number | undefined;
  let businessType: string | undefined;
  let modalIdr: number | undefined;
  let rank: number | undefined;

  try {
    const body: RequestBody = await req.json();
    ({ kelurahanId, businessType, modalIdr, rank } = body);
    const sqlCategory = body.sqlCategory || 'warkop';

    if (!kelurahanId || !businessType || !modalIdr || !rank) {
      return NextResponse.json(
        { error: 'Missing required: kelurahanId, businessType, modalIdr, rank' },
        { status: 400 }
      );
    }

    // Fetch full data dari calculate_scores — pakai sqlCategory untuk SQL
    const scores = await sql`
      SELECT *
      FROM calculate_scores(${sqlCategory}, ${modalIdr}::BIGINT)
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
    
    const w = { demand: 0.30, competition: 0.20, anchor: 0.25, access: 0.10, affordability: 0.15 };
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
      businessLabel: businessType,
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
    console.error('Narrative API error:', {
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 3),
      requestBody: { kelurahanId, businessType, modalIdr, rank },
    });
    return NextResponse.json(
      { error: 'Failed to generate narrative', message: err.message },
      { status: 500 }
    );
  }
}