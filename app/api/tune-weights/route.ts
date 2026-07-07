import { NextRequest, NextResponse } from 'next/server';
import { generateJson } from '@/lib/ai';
import { buildWeightTuningPrompt } from '@/lib/prompts';
import { DEFAULT_KOTA_KAB, isJabodetabekKota } from '@/lib/kotas';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const GENERIC_WEIGHTS = { demand: 0.30, competition: 0.20, anchor: 0.25, access: 0.10, affordability: 0.15 };

interface LocationFilter {
  kecamatan: string[];
  kelurahan?: string[];
}

interface AIResponse {
  outOfScope: boolean;
  outOfScopeReason: string | null;
  sqlCategory: string;
  weights: {
    demand: number;
    competition: number;
    anchor: number;
    access: number;
    affordability: number;
  };
  locationFilter: LocationFilter | null;
  reasoning: string;
}

export async function POST(req: NextRequest) {
  let body: any;
  
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  
  const { businessType, modalIdr, userContext } = body;
  const kotaKab = typeof body.kotaKab === 'string' && isJabodetabekKota(body.kotaKab)
    ? body.kotaKab
    : DEFAULT_KOTA_KAB;

  if (!businessType || !modalIdr) {
    return NextResponse.json(
      { error: 'Missing required: businessType, modalIdr' },
      { status: 400 }
    );
  }

  // Skip AI kalau context kosong
  if (!userContext || userContext.trim().length < 5) {
    return NextResponse.json({
      outOfScope: false,
      sqlCategory: 'warkop',
      weights: GENERIC_WEIGHTS,
      locationFilter: null,
      reasoning: 'Konfigurasi standar.',
      tuned: false,
    });
  }

  try {
    const prompt = buildWeightTuningPrompt(
      businessType,
      businessType,
      modalIdr,
      userContext.trim(),
      kotaKab,
    );
    
    const result = await generateJson<AIResponse>(prompt);
    
    // Out-of-scope handling: return early
    if (result.outOfScope) {
      return NextResponse.json({
        outOfScope: true,
        outOfScopeReason: result.outOfScopeReason || 'Wilayah di luar Jabodetabek',
        sqlCategory: result.sqlCategory || 'warkop',
        weights: GENERIC_WEIGHTS,
        locationFilter: null,
        reasoning: result.reasoning,
        tuned: false,
      });
    }
    
    // Normalize weights
    const w = result.weights;
    let total = w.demand + w.competition + w.anchor + w.access + w.affordability;
    
    if (Math.abs(total - 1.0) > 0.01) {
      w.demand /= total;
      w.competition /= total;
      w.anchor /= total;
      w.access /= total;
      w.affordability /= total;
    }
    
    const MIN = 0.05;
    (Object.keys(w) as Array<keyof typeof w>).forEach(key => {
      if (w[key] < MIN) w[key] = MIN;
    });
    
    total = w.demand + w.competition + w.anchor + w.access + w.affordability;
    if (Math.abs(total - 1.0) > 0.01) {
      const factor = 1.0 / total;
      w.demand *= factor;
      w.competition *= factor;
      w.anchor *= factor;
      w.access *= factor;
      w.affordability *= factor;
    }
    
    const rounded = {
      demand: Math.round(w.demand * 100) / 100,
      competition: Math.round(w.competition * 100) / 100,
      anchor: Math.round(w.anchor * 100) / 100,
      access: Math.round(w.access * 100) / 100,
      affordability: Math.round(w.affordability * 100) / 100,
    };
    
    return NextResponse.json({
      outOfScope: false,
      sqlCategory: result.sqlCategory || 'warkop',
      weights: rounded,
      locationFilter: result.locationFilter || null,
      reasoning: result.reasoning,
      tuned: true,
    });
    
  } catch (err: any) {
    console.error('Tune weights error:', err.message);
    return NextResponse.json({
      outOfScope: false,
      sqlCategory: 'warkop',
      weights: GENERIC_WEIGHTS,
      locationFilter: null,
      reasoning: 'Menggunakan konfigurasi standar.',
      tuned: false,
    });
  }
}