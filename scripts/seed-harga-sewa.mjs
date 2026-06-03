import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const INPUT_DIR = './data/scrape-raw';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

// Mapping URL slug → Nama kecamatan di DB
const KECAMATAN_MAP = {
  'pamulang':       'Pamulang',
  'ciputat':        'Ciputat',
  'ciputat-timur':  'Ciputat Timur',
  'pondok-aren':    'Pondok Aren',
  'serpong':        'Serpong',
  'serpong-utara':  'Serpong Utara',
  'setu':           'Setu',
};

// === PARSER ===

function parsePrice(text) {
  const match = text.match(/Rp\s*([\d,.]+)\s*(Juta|Miliar)/i);
  if (!match) return null;
  const numStr = match[1].replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const num = parseFloat(numStr);
  const multiplier = match[2].toLowerCase() === 'miliar' ? 1_000_000_000 : 1_000_000;
  return Math.round(num * multiplier);
}

function parseLuas(text, label) {
  const re = new RegExp(`\\*\\*${label}\\*\\*\\s*(\\d+)\\s*m`, 'i');
  const match = text.match(re);
  return match ? parseInt(match[1]) : null;
}

function classifyFormat(priceIdr, lb) {
  // Format classification rules
  if (priceIdr < 25_000_000 || (lb && lb < 30)) return 'kios';
  if (priceIdr < 200_000_000) return 'ruko_std';
  return 'ruko_premium';
}

function extractListings(markdown) {
  const listingPattern = /\*\*Rp\s*[\d,.]+\s*(?:Juta|Miliar)\/Tahun\*\*/gi;
  const indices = [];
  let match;
  while ((match = listingPattern.exec(markdown)) !== null) {
    indices.push(match.index);
  }
  
  if (indices.length === 0) return [];
  
  const listings = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : markdown.length;
    const block = markdown.slice(start, end);
    
    const priceIdr = parsePrice(block);
    if (!priceIdr || priceIdr < 5_000_000 || priceIdr > 5_000_000_000) continue;
    
    const lt = parseLuas(block, 'LT');
    const lb = parseLuas(block, 'LB');
    const format = classifyFormat(priceIdr, lb);
    
    listings.push({ priceIdr, lt, lb, format });
  }
  
  return listings;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function calculateStats(listings) {
  const byFormat = {};
  for (const l of listings) {
    if (!byFormat[l.format]) byFormat[l.format] = [];
    byFormat[l.format].push(l.priceIdr);
  }
  
  const stats = {};
  for (const [fmt, prices] of Object.entries(byFormat)) {
    prices.sort((a, b) => a - b);
    stats[fmt] = {
      count: prices.length,
      min: prices[0],
      max: prices[prices.length - 1],
      median: percentile(prices, 0.5),
      p25: percentile(prices, 0.25),
      p75: percentile(prices, 0.75),
    };
  }
  
  return stats;
}

// === ESTIMATOR untuk format yang missing ===

function estimateMissingFormats(stats) {
  // Estimate kios = 30% dari ruko_std p25-p75
  // Estimate pkl = 12% dari ruko_std p25-p75
  
  const rukoStd = stats.ruko_std;
  if (!rukoStd) return stats; // can't estimate without baseline
  
  if (!stats.kios || stats.kios.count < 2) {
    stats.kios = {
      count: 0, // marker: estimated
      min: Math.round(rukoStd.p25 * 0.30),
      max: Math.round(rukoStd.p75 * 0.30),
      p25: Math.round(rukoStd.p25 * 0.30),
      p75: Math.round(rukoStd.p75 * 0.30),
      estimated: true,
    };
  }
  
  if (!stats.pkl) {
    stats.pkl = {
      count: 0,
      min: Math.round(rukoStd.p25 * 0.12),
      max: Math.round(rukoStd.p75 * 0.12),
      p25: Math.round(rukoStd.p25 * 0.12),
      p75: Math.round(rukoStd.p75 * 0.12),
      estimated: true,
    };
  }
  
  // ruko_premium: if missing or only 1 listing, estimate as 2.5x ruko_std
  if (!stats.ruko_premium || stats.ruko_premium.count < 2) {
    stats.ruko_premium = {
      count: stats.ruko_premium?.count || 0,
      min: Math.round(rukoStd.p75 * 2.0),
      max: Math.round(rukoStd.p75 * 3.5),
      p25: Math.round(rukoStd.p75 * 2.0),
      p75: Math.round(rukoStd.p75 * 3.5),
      estimated: true,
    };
  }
  
  return stats;
}

// === DB OPERATIONS ===

async function ensureSchema() {
  // Ensure harga_sewa table has kecamatan column & nullable kelurahan_id
  await sql`
    ALTER TABLE harga_sewa 
    ALTER COLUMN kelurahan_id DROP NOT NULL
  `.catch(() => {}); // ignore if already nullable
  
  await sql`
    ALTER TABLE harga_sewa 
    ADD COLUMN IF NOT EXISTS kecamatan TEXT
  `.catch(() => {});
  
  console.log('✅ Schema ensured');
}

async function clearExisting() {
  const result = await sql`DELETE FROM harga_sewa`;
  console.log(`🗑️  Cleared ${result.count} existing rows`);
}

async function insertHargaSewa(kecamatan, format, stats) {
  const sourceLabel = stats.estimated
    ? `99.co Dec 2025: estimated from ruko_std baseline`
    : `99.co Dec 2025: ${stats.count} listings, p25-p75`;
  
  await sql`
    INSERT INTO harga_sewa (kecamatan, format, min_yearly_idr, max_yearly_idr, source)
    VALUES (
      ${kecamatan},
      ${format},
      ${stats.p25},
      ${stats.p75},
      ${sourceLabel}
    )
  `;
}

// === MAIN ===

async function main() {
  console.log('🚀 Starting harga sewa pipeline...\n');
  
  // 1. Ensure schema
  await ensureSchema();
  
  // 2. Clear existing data (idempotent)
  await clearExisting();
  
  // 3. Process each kecamatan
  let totalInserted = 0;
  
  for (const [slug, namaKecamatan] of Object.entries(KECAMATAN_MAP)) {
    const filepath = path.join(INPUT_DIR, `${slug}.md`);
    
    if (!fs.existsSync(filepath)) {
      console.log(`\n⚠️  Skip ${namaKecamatan}: file ${filepath} not found`);
      continue;
    }
    
    const markdown = fs.readFileSync(filepath, 'utf8');
    const listings = extractListings(markdown);
    const rawStats = calculateStats(listings);
    const stats = estimateMissingFormats(rawStats);
    
    console.log(`\n📍 ${namaKecamatan} (${listings.length} listings)`);
    
    // Insert 4 formats: pkl, kios, ruko_std, ruko_premium
    const formats = ['pkl', 'kios', 'ruko_std', 'ruko_premium'];
    
    for (const fmt of formats) {
      const s = stats[fmt];
      if (!s) {
        console.log(`   ⚠️  ${fmt.padEnd(15)} no data, skip`);
        continue;
      }
      
      await insertHargaSewa(namaKecamatan, fmt, s);
      
      const marker = s.estimated ? '🔮 estimated' : `📊 n=${s.count} real`;
      const range = `Rp ${(s.p25/1e6).toFixed(0)}-${(s.p75/1e6).toFixed(0)}jt`;
      console.log(`   ✓ ${fmt.padEnd(15)} ${range.padEnd(20)} ${marker}`);
      totalInserted++;
    }
  }
  
  console.log(`\n✅ Inserted ${totalInserted} rows`);
  
  // 4. Verify
  const result = await sql`
    SELECT 
      kecamatan,
      COUNT(*) AS jumlah_format,
      MIN(min_yearly_idr) / 1000000 AS termurah_jt,
      MAX(max_yearly_idr) / 1000000 AS termahal_jt
    FROM harga_sewa
    GROUP BY kecamatan
    ORDER BY termurah_jt
  `;
  
  console.log('\n📊 Final state:');
  console.table(result);
  
  await sql.end();
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});