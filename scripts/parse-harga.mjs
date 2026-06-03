import fs from 'fs';
import path from 'path';

const INPUT_DIR = './data/scrape-raw';
const OUTPUT = './data/harga-sewa-parsed.json';

const KECAMATAN = [
  'pamulang', 'ciputat', 'ciputat-timur', 'pondok-aren',
  'serpong', 'serpong-utara', 'setu',
];

function parsePrice(text) {
  // "Rp 200 Juta/Tahun" → 200_000_000
  // "Rp 1,5 Miliar" → 1_500_000_000
  // "Rp 4,78 Miliar" → 4_780_000_000
  const match = text.match(/Rp\s*([\d,.]+)\s*(Juta|Miliar)/i);
  if (!match) return null;
  
  // Indonesian format: comma = decimal, dot = thousand
  const numStr = match[1].replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const num = parseFloat(numStr);
  const multiplier = match[2].toLowerCase() === 'miliar' ? 1_000_000_000 : 1_000_000;
  return Math.round(num * multiplier);
}

function parseLuas(text, label) {
  // "**LT**300 m²" or "**LB**96 m²"
  const re = new RegExp(`\\*\\*${label}\\*\\*\\s*(\\d+)\\s*m`, 'i');
  const match = text.match(re);
  return match ? parseInt(match[1]) : null;
}

function extractListings(markdown) {
  // Setiap listing dimulai dengan pola "**Rp X Juta/Tahun**" atau "**Rp X Miliar/Tahun**"
  // Split berdasarkan pola tersebut
  const listingPattern = /\*\*Rp\s*[\d,.]+\s*(?:Juta|Miliar)\/Tahun\*\*/gi;
  const indices = [];
  let match;
  while ((match = listingPattern.exec(markdown)) !== null) {
    indices.push(match.index);
  }
  
  if (indices.length === 0) return [];
  
  // Split berdasarkan posisi
  const blocks = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : markdown.length;
    blocks.push(markdown.slice(start, end));
  }
  
  const listings = [];
  
  for (const block of blocks) {
    const priceIdr = parsePrice(block);
    if (!priceIdr) continue;
    
    // Filter: harga sewa tahunan ruko reasonable (5jt - 5M)
    if (priceIdr < 5_000_000 || priceIdr > 5_000_000_000) continue;
    
    const lt = parseLuas(block, 'LT');
    const lb = parseLuas(block, 'LB');
    
    // Tentuin format berdasarkan harga & luas
    let format = 'ruko_std';
    if (priceIdr < 25_000_000 || (lb && lb < 30)) format = 'kios';
    else if (priceIdr < 60_000_000) format = 'ruko_std';
    else if (priceIdr < 200_000_000) format = 'ruko_std';
    else format = 'ruko_premium';
    
    listings.push({
      priceIdr,
      lt,
      lb,
      format,
    });
  }
  
  return listings;
}

function calculateStats(listings) {
  if (listings.length === 0) return null;
  
  const byFormat = {};
  
  // Group by format
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
      median: prices[Math.floor(prices.length / 2)],
      p25: prices[Math.floor(prices.length * 0.25)],
      p75: prices[Math.floor(prices.length * 0.75)],
    };
  }
  
  return stats;
}

function fmtIdr(n) {
  return `Rp ${(n / 1e6).toFixed(0)}jt`;
}

async function main() {
  const result = {};
  
  for (const kec of KECAMATAN) {
    const filepath = path.join(INPUT_DIR, `${kec}.md`);
    
    if (!fs.existsSync(filepath)) {
      console.log(`⚠️  Skip ${kec}: file not found`);
      continue;
    }
    
    const markdown = fs.readFileSync(filepath, 'utf8');
    const listings = extractListings(markdown);
    const stats = calculateStats(listings);
    
    result[kec] = { listings, stats };
    
    console.log(`\n📍 ${kec} (${listings.length} listings)`);
    if (stats) {
      for (const [fmt, s] of Object.entries(stats)) {
        console.log(
          `   ${fmt.padEnd(15)} ` +
          `n=${s.count.toString().padStart(2)} | ` +
          `range: ${fmtIdr(s.min)} - ${fmtIdr(s.max)} | ` +
          `median: ${fmtIdr(s.median)} | ` +
          `p25-p75: ${fmtIdr(s.p25)}-${fmtIdr(s.p75)}`
        );
      }
    }
  }
  
  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  console.log(`\n💾 Saved to ${OUTPUT}`);
}

main();