import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

const GENERIC_WEIGHTS = { demand: 0.30, competition: 0.20, anchor: 0.25, access: 0.10, affordability: 0.15 };

interface LocationFilter {
  kecamatan: string[];
  kelurahan?: string[];
}

interface RecommendRequest {
  businessType: string;
  sqlCategory?: string;
  modalIdr: number;
  topN?: number;
  kotaKab?: string;
  customWeights?: {
    demand: number;
    competition: number;
    anchor: number;
    access: number;
    affordability: number;
  };
  locationFilter?: LocationFilter | null;
}

const DEFAULT_KOTA_KAB = 'Jakarta Selatan';

export async function POST(req: NextRequest) {
  try {
    const body: RecommendRequest = await req.json();
    const { businessType, modalIdr, topN = 3 } = body;
    const sqlCategory = body.sqlCategory || 'warkop';
    const kotaKab = body.kotaKab || DEFAULT_KOTA_KAB;

    if (!businessType || !modalIdr || modalIdr < 1_000_000) {
      return NextResponse.json(
        { error: 'Missing or invalid: businessType, modalIdr (min 1.000.000)' },
        { status: 400 }
      );
    }

    const weights = body.customWeights || GENERIC_WEIGHTS;

    // Scoring di-scope per kota — normalisasi MAX dihitung dalam kota terpilih
    const rows = await sql`
      SELECT *
      FROM calculate_scores(${sqlCategory}, ${modalIdr}::BIGINT, ${kotaKab})
    `;
    
    // Calculate final_score with weights
    let scored = rows.map(r => {
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

    // Apply location filter — match langsung dari kecamatan/kelurahan name
    if (body.locationFilter) {
      const { kecamatan: kecFilter, kelurahan: kelFilter } = body.locationFilter;

      const lowerKel = (kelFilter ?? []).map(k => k.toLowerCase());
      const lowerKec = (kecFilter ?? []).map(k => k.toLowerCase());

      let filtered = scored;

      if (lowerKel.length > 0) {
        // Kelurahan spesifik dulu
        filtered = scored.filter(s =>
          lowerKel.some(k => s.kelurahan.toLowerCase() === k)
        );
        // Fallback ke kecamatan jika kelurahan tidak ada match
        if (filtered.length === 0 && lowerKec.length > 0) {
          filtered = scored.filter(s =>
            lowerKec.some(k => s.kecamatan.toLowerCase() === k)
          );
        }
      } else if (lowerKec.length > 0) {
        // Hanya kecamatan — apply langsung sebagai filter utama
        filtered = scored.filter(s =>
          lowerKec.some(k => s.kecamatan.toLowerCase() === k)
        );
      }

      if (filtered.length > 0) {
        scored = filtered;
      }
    }
    
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
      competitorCount: s.market.competitorCount,
    }));
    
    return NextResponse.json({
      input: { businessType, modalIdr, topN, kotaKab },
      weights,
      top,
      heatmap,
      meta: {
        totalKelurahan: scored.length,
        kotaKab,
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
      businessType: 'Free text — AI maps to one of: warkop, restoran, laundry, klinik, salon, minimarket, apotek, fotokopi, bengkel, barbershop',
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