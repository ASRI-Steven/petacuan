import fs from 'fs';
import path from 'path';

const KECAMATAN_URLS = {
  'pamulang':       'https://www.99.co/id/sewa/ruko/tangerang-selatan/pamulang',
  'ciputat':        'https://www.99.co/id/sewa/ruko/tangerang-selatan/ciputat',
  'ciputat-timur':  'https://www.99.co/id/sewa/ruko/tangerang-selatan/ciputat-timur',
  'pondok-aren':    'https://www.99.co/id/sewa/ruko/tangerang-selatan/pondok-aren',
  'serpong':        'https://www.99.co/id/sewa/ruko/tangerang-selatan/serpong',
  'serpong-utara':  'https://www.99.co/id/sewa/ruko/tangerang-selatan/serpong-utara',
  'setu':           'https://www.99.co/id/sewa/ruko/tangerang-selatan/setu',
};

const OUTPUT_DIR = './data/scrape-raw';

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function scrapeKecamatan(kecamatan, targetUrl) {
  const jinaUrl = `https://r.jina.ai/${targetUrl}`;
  
  console.log(`\n📍 Scraping ${kecamatan}...`);
  console.log(`   Target: ${targetUrl}`);
  
  try {
    const res = await fetch(jinaUrl);
    
    if (!res.ok) {
      console.log(`   ❌ HTTP ${res.status}`);
      return null;
    }
    
    const markdown = await res.text();
    
    if (markdown.includes('security verification') || markdown.includes('Just a moment')) {
      console.log(`   ⚠️ Blocked by security check`);
      return null;
    }
    
    const filepath = path.join(OUTPUT_DIR, `${kecamatan}.md`);
    fs.writeFileSync(filepath, markdown);
    
    console.log(`   ✅ Saved ${markdown.length} chars → ${filepath}`);
    return markdown;
    
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    return null;
  }
}

async function main() {
  for (const [kec, url] of Object.entries(KECAMATAN_URLS)) {
    await scrapeKecamatan(kec, url);
    await new Promise(r => setTimeout(r, 3000)); // polite delay 3 detik
  }
  
  console.log(`\n💾 All saved to ${OUTPUT_DIR}/`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});