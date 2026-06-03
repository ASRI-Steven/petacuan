import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { 
  prepare: false,
  max: 5,
});

// Bobot default per business type
// Nanti ini bisa di-override sama AI
const DEFAULT_WEIGHTS = {
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

type BusinessType = keyof typeof DEFAULT_WEIGHTS;

interface RecommendRequest {
  businessType: BusinessType;
  modalIdr: number;
  topN?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body: RecommendRequest = await req.json();
    const { businessType, modalIdr, topN = 3 } = body;
    
    // Validation
    if (!businessType || !DEFAULT_WEIGHTS[businessType]) {
      return NextResponse.json(
        { error: 'Invalid businessType', validTypes: Object.keys(DEFAULT_WEIGHTS) },
        { status: 400 }
      );
    }
    if (!modalIdr || modalIdr < 1_000_000) {
      return NextResponse.json(
        { error: 'modalIdr must be >= 1,000,000' },
        { status: 400 }
      );
    }
    
    const weights = DEFAULT_WEIGHTS[businessType];
    
    // Call SQL function
    const rows = await sql`
      SELECT *
      FROM calculate_scores(${businessType}, ${modalIdr}::BIGINT)
    `;
    
    // Calculate final_score with weights
    const scored = rows.map(r => {
      const finalScore = 
        Number(r.demand_score) * weights.demand +
        Number(r.competition_score) * weights.competition +
        Number(r.anchor_score) * weights.anchor +
        Number(r.access_score) * weights.access +
        Number(r.affordability_score) * weights.affordability;
      
      return {
        kelurahanId: r.kelurahan_id,
        kelurahan: r.kelurahan,
        kecamatan: r.kecamatan,
        coordinates: { lat: Number(r.lat), lng: Number(r.lng) },
        demografis: {
          jumlahPenduduk: r.jumlah_penduduk,
          demandTarget: r.demand_target,
        },
        market: {
          competitorCount: r.competitor_count,
          anchorCount: r.anchor_count,
        },
        scores: {
          demand: Number(r.demand_score),
          competition: Number(r.competition_score),
          anchor: Number(r.anchor_score),
          access: Number(r.access_score),
          affordability: Number(r.affordability_score),
          final: Math.round(finalScore * 10) / 10,
        },
        sewa: {
          minIdr: Number(r.sewa_min_idr) || null,
          maxIdr: Number(r.sewa_max_idr) || null,
          format: r.format_disarankan,
        },
      };
    });
    
    // Sort by final score, take top N
    const top = scored
      .sort((a, b) => b.scores.final - a.scores.final)
      .slice(0, topN);
    
    // Heatmap data (all 54 kelurahan, untuk render map)
    const heatmap = scored.map(s => ({
      lat: s.coordinates.lat,
      lng: s.coordinates.lng,
      kelurahanId: s.kelurahanId,
      kelurahan: s.kelurahan,
      kecamatan: s.kecamatan,
      score: s.scores.final,
    }));
    
    return NextResponse.json({
      input: { businessType, modalIdr, topN },
      weights,
      top,
      heatmap,
      meta: {
        totalKelurahan: scored.length,
        timestamp: new Date().toISOString(),
      },
    });
    
  } catch (err: any) {
    console.error('API error:', err);
    return NextResponse.json(
      { error: 'Internal server error', message: err.message },
      { status: 500 }
    );
  }
}

// GET handler untuk dokumentasi quick
export async function GET() {
  return NextResponse.json({
    description: 'PetaCuan recommendation API',
    method: 'POST',
    body: {
      businessType: `One of: ${Object.keys(DEFAULT_WEIGHTS).join(', ')}`,
      modalIdr: 'Number, minimum 1,000,000',
      topN: 'Optional, default 3',
    },
    example: {
      businessType: 'warkop',
      modalIdr: 80000000,
      topN: 3,
    },
  });
}