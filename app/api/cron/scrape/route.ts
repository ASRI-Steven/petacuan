import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { JABODETABEK_KOTAS, isJabodetabekKota } from '@/lib/kotas';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });

// Rotasi 1 kota/hari supaya total request ke Jina ≤ jumlah kecamatan satu kota
// (hindari rate-limit saat ekspansi Jabodetabek).
const ROTATION_ORDER = JABODETABEK_KOTAS;

type KecamatanConfig = { name: string; url: string };

// URL 99.co per kota → kecamatan-slug. Tambahkan slug baru kalau sudah verifikasi
// formatnya benar (cek manual di browser). Kota yang belum punya config akan di-skip
// pada hari rotasinya — bukan error.
const KOTA_KECAMATAN_URLS: Record<string, Record<string, KecamatanConfig>> = {
  'Tangerang Selatan': {
    'pamulang':      { name: 'Pamulang',       url: 'https://www.99.co/id/sewa/ruko/tangerang-selatan/pamulang' },
    'ciputat':       { name: 'Ciputat',        url: 'https://www.99.co/id/sewa/ruko/tangerang-selatan/ciputat' },
    'ciputat-timur': { name: 'Ciputat Timur',  url: 'https://www.99.co/id/sewa/ruko/tangerang-selatan/ciputat-timur' },
    'pondok-aren':   { name: 'Pondok Aren',    url: 'https://www.99.co/id/sewa/ruko/tangerang-selatan/pondok-aren' },
    'serpong':       { name: 'Serpong',        url: 'https://www.99.co/id/sewa/ruko/tangerang-selatan/serpong' },
    'serpong-utara': { name: 'Serpong Utara',  url: 'https://www.99.co/id/sewa/ruko/tangerang-selatan/serpong-utara' },
    'setu':          { name: 'Setu',           url: 'https://www.99.co/id/sewa/ruko/tangerang-selatan/setu' },
  },
};

function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

// ── Parser ────────────────────────────────────────────────────

function parsePrice(text: string): number | null {
  const match = text.match(/Rp\s*([\d,.]+)\s*(Juta|Miliar)/i);
  if (!match) return null;
  const numStr = match[1].replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const num = parseFloat(numStr);
  const mult = match[2].toLowerCase() === 'miliar' ? 1_000_000_000 : 1_000_000;
  return Math.round(num * mult);
}

function parseLuas(text: string, label: string): number | null {
  const re = new RegExp(`\\*\\*${label}\\*\\*\\s*(\\d+)\\s*m`, 'i');
  const m = text.match(re);
  return m ? parseInt(m[1]) : null;
}

function classifyFormat(priceIdr: number, lb: number | null): string {
  if (priceIdr < 25_000_000 || (lb !== null && lb < 30)) return 'kios';
  if (priceIdr < 200_000_000) return 'ruko_std';
  return 'ruko_premium';
}

interface FormatStats {
  count: number;
  p25: number;
  p75: number;
  estimated?: boolean;
}
type Stats = Record<string, FormatStats>;

function extractAndParse(markdown: string): Stats {
  const listingPattern = /\*\*Rp\s*[\d,.]+\s*(?:Juta|Miliar)\/Tahun\*\*/gi;
  const indices: number[] = [];
  let m;
  while ((m = listingPattern.exec(markdown)) !== null) indices.push(m.index);

  const byFormat: Record<string, number[]> = {};
  for (let i = 0; i < indices.length; i++) {
    const block = markdown.slice(indices[i], i + 1 < indices.length ? indices[i + 1] : markdown.length);
    const price = parsePrice(block);
    if (!price || price < 5_000_000 || price > 5_000_000_000) continue;
    const lb = parseLuas(block, 'LB');
    const fmt = classifyFormat(price, lb);
    if (!byFormat[fmt]) byFormat[fmt] = [];
    byFormat[fmt].push(price);
  }

  const stats: Stats = {};
  for (const [fmt, prices] of Object.entries(byFormat)) {
    prices.sort((a, b) => a - b);
    const p = (pct: number) => prices[Math.min(Math.floor(prices.length * pct), prices.length - 1)];
    stats[fmt] = { count: prices.length, p25: p(0.25), p75: p(0.75) };
  }

  const base = stats.ruko_std;
  if (base) {
    if (!stats.kios || stats.kios.count < 2) {
      stats.kios = { count: 0, p25: Math.round(base.p25 * 0.30), p75: Math.round(base.p75 * 0.30), estimated: true };
    }
    if (!stats.pkl) {
      stats.pkl = { count: 0, p25: Math.round(base.p25 * 0.12), p75: Math.round(base.p75 * 0.12), estimated: true };
    }
    if (!stats.ruko_premium || stats.ruko_premium.count < 2) {
      stats.ruko_premium = { count: stats.ruko_premium?.count ?? 0, p25: Math.round(base.p75 * 2.0), p75: Math.round(base.p75 * 3.5), estimated: true };
    }
  }

  return stats;
}

// ── Handler ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Pilih kota: override via ?kotaKab=... atau rotasi harian
  const override = req.nextUrl.searchParams.get('kotaKab');
  const todayKotaIdx = dayOfYearUTC(new Date()) % ROTATION_ORDER.length;
  const kotaKab = override && isJabodetabekKota(override)
    ? override
    : ROTATION_ORDER[todayKotaIdx];

  const config = KOTA_KECAMATAN_URLS[kotaKab];
  if (!config || Object.keys(config).length === 0) {
    return NextResponse.json({
      success: true,
      kotaKab,
      skipped: true,
      reason: `No URL config for "${kotaKab}". Tambah ke KOTA_KECAMATAN_URLS untuk aktifkan.`,
      totalInserted: 0,
      timestamp: new Date().toISOString(),
    });
  }

  const log: string[] = [`Rotation: ${kotaKab} (day index ${todayKotaIdx})`];
  const scrapedData: Record<string, Stats> = {};

  for (const [slug, { url }] of Object.entries(config)) {
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) { log.push(`${slug}: HTTP ${res.status} — skip`); continue; }

      const md = await res.text();
      if (md.includes('security verification') || md.includes('Just a moment')) {
        log.push(`${slug}: blocked — skip`); continue;
      }

      const stats = extractAndParse(md);
      const listingCount = Object.values(stats).reduce((s, f) => s + (f.count || 0), 0);
      scrapedData[slug] = stats;
      log.push(`${slug}: ${listingCount} listings → ${Object.keys(stats).length} formats`);
    } catch (err: any) {
      log.push(`${slug}: error — ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  if (Object.keys(scrapedData).length === 0) {
    return NextResponse.json({ success: false, kotaKab, error: 'No data scraped', log }, { status: 500 });
  }

  // Hanya hapus + insert kecamatan yang termasuk kota rotasi ini
  const kecamatanNames = Object.values(config).map(c => c.name);
  await sql`DELETE FROM harga_sewa WHERE kecamatan = ANY(${kecamatanNames})`;
  log.push(`Cleared rows for ${kecamatanNames.length} kecamatan di ${kotaKab}`);

  let totalInserted = 0;
  const month = new Date().toISOString().slice(0, 7);
  const FORMATS = ['pkl', 'kios', 'ruko_std', 'ruko_premium'] as const;

  for (const [slug, stats] of Object.entries(scrapedData)) {
    const kecamatan = config[slug].name;
    for (const fmt of FORMATS) {
      const s = stats[fmt];
      if (!s) continue;
      const source = s.estimated
        ? `99.co ${month}: estimated from ruko_std`
        : `99.co ${month}: ${s.count} listings p25-p75`;
      await sql`
        INSERT INTO harga_sewa (kecamatan, format, min_yearly_idr, max_yearly_idr, source)
        VALUES (${kecamatan}, ${fmt}, ${s.p25}, ${s.p75}, ${source})
      `;
      totalInserted++;
    }
  }

  log.push(`Inserted ${totalInserted} rows`);

  return NextResponse.json({
    success: true,
    kotaKab,
    totalInserted,
    kecamatanScraped: Object.keys(scrapedData).length,
    log,
    timestamp: new Date().toISOString(),
  });
}
