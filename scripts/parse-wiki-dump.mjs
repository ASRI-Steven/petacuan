import fs from 'fs';
import postgres from 'postgres';
import { config } from 'dotenv';
import bz2 from 'unbzip2-stream';
import sax from 'sax';

config({ path: '.env.local' });

const DUMP_PATH = './idwiki-latest-pages-articles.xml.bz2';
const OUTPUT_PATH = './data/demografi-jabodetabek.json';

if (!fs.existsSync(DUMP_PATH)) {
  console.error(`Missing dump file: ${DUMP_PATH}`);
  console.error('Download dari https://dumps.wikimedia.org/idwiki/latest/idwiki-latest-pages-articles.xml.bz2');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

function parseNumber(raw) {
  if (!raw) return null;
  const m = String(raw).match(/[\d.,]+/);
  if (!m) return null;
  let s = m[0];
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function extractField(wikitext, field) {
  const re = new RegExp(`\\|\\s*${field}\\s*=\\s*([^|}\\n]+)`, 'i');
  const m = wikitext.match(re);
  return m ? m[1].trim() : null;
}

function parseInfobox(wikitext) {
  if (!wikitext) return null;
  const penduduk =
    parseNumber(extractField(wikitext, 'penduduk')) ||
    parseNumber(extractField(wikitext, 'population')) ||
    parseNumber(extractField(wikitext, 'population_total'));
  const luas =
    parseNumber(extractField(wikitext, 'luas')) ||
    parseNumber(extractField(wikitext, 'area'));
  const kepadatan =
    parseNumber(extractField(wikitext, 'kepadatan')) ||
    parseNumber(extractField(wikitext, 'population_density'));
  if (!penduduk && !luas) return null;
  return { penduduk, luas, kepadatan };
}

function stripPrefix(s) {
  return s.replace(/^Kota\s+/i, '').replace(/^Kabupaten\s+/i, '');
}

function generateTitles(kel, kec, kota) {
  const variants = new Set();
  for (const k of [kota, stripPrefix(kota)]) {
    variants.add(`${kel}, ${kec}, ${k}`);
  }
  variants.add(`${kel}, ${kec}`);
  variants.add(`${kel} (${kec})`);
  return Array.from(variants);
}

function buildIndex(rows) {
  const idx = new Map();
  for (const r of rows) {
    for (const t of generateTitles(r.nama, r.kecamatan, r.kota_kab)) {
      const key = t.toLowerCase();
      if (!idx.has(key)) idx.set(key, r);
    }
  }
  return idx;
}

function detectRedirect(text) {
  const m = text.match(/^\s*#(?:REDIRECT|ALIH)\s*\[\[([^\]|#]+)/i);
  return m ? m[1].trim() : null;
}

async function main() {
  console.log('Loading kelurahan from DB...');
  const rows = await sql`
    SELECT id, nama, kecamatan, kota_kab, provinsi,
           ST_Area(geom::geography) / 1000000 AS luas_km2_geom
    FROM kelurahan
    ORDER BY kota_kab, kecamatan, nama
  `;
  console.log(`  ${rows.length} kelurahan`);

  const titleIndex = buildIndex(rows);
  console.log(`  ${titleIndex.size} title variants`);

  const existing = fs.existsSync(OUTPUT_PATH)
    ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
    : [];
  const existingById = new Map(existing.map((r) => [r.id, r]));

  const hits = new Map();
  const redirects = new Map();

  console.log('\nStreaming dump (bz2 → sax)...');
  const stream = fs.createReadStream(DUMP_PATH);
  const parser = sax.createStream(true, { trim: false, normalize: false });

  let inTitle = false;
  let inText = false;
  let currentTitle = '';
  let currentText = '';
  let pageCount = 0;
  const start = Date.now();

  parser.on('opentag', (node) => {
    if (node.name === 'title') {
      inTitle = true;
      currentTitle = '';
    } else if (node.name === 'text') {
      inText = true;
      currentText = '';
    }
  });

  parser.on('text', (t) => {
    if (inTitle) currentTitle += t;
    else if (inText) currentText += t;
  });

  parser.on('cdata', (t) => {
    if (inText) currentText += t;
  });

  parser.on('closetag', (name) => {
    if (name === 'title') {
      inTitle = false;
    } else if (name === 'text') {
      inText = false;
    } else if (name === 'page') {
      pageCount++;
      const tgt = titleIndex.get(currentTitle.toLowerCase());
      if (tgt && !hits.has(tgt.id)) {
        const redirectTo = detectRedirect(currentText);
        if (redirectTo) {
          redirects.set(tgt.id, { from: currentTitle, to: redirectTo });
        } else {
          const parsed = parseInfobox(currentText);
          if (parsed && parsed.penduduk) {
            hits.set(tgt.id, { wiki: parsed, title: currentTitle });
          }
        }
      }
      if (pageCount % 100000 === 0) {
        const elapsed = (Date.now() - start) / 1000;
        const rate = pageCount / elapsed;
        console.log(
          `  pages=${pageCount}  hits=${hits.size}/${rows.length}  redirects=${redirects.size}  ${rate.toFixed(0)}/s  ${elapsed.toFixed(0)}s`,
        );
      }
      currentTitle = '';
      currentText = '';
    }
  });

  const done = new Promise((resolve, reject) => {
    parser.on('end', resolve);
    parser.on('error', reject);
    stream.on('error', reject);
  });

  stream.pipe(bz2()).pipe(parser);

  await done;

  console.log(`\nPass 1 done: pages=${pageCount} hits=${hits.size} redirects-pending=${redirects.size}`);

  if (redirects.size > 0) {
    const redirectTargets = new Map();
    for (const [id, { to }] of redirects) {
      redirectTargets.set(to.toLowerCase(), id);
    }
    console.log(`Pass 2: resolving ${redirectTargets.size} redirect targets...`);

    const stream2 = fs.createReadStream(DUMP_PATH);
    const parser2 = sax.createStream(true, { trim: false, normalize: false });
    let t2 = false, x2 = false, ct2 = '', cx2 = '', pc2 = 0;
    const s2 = Date.now();

    parser2.on('opentag', (n) => {
      if (n.name === 'title') { t2 = true; ct2 = ''; }
      else if (n.name === 'text') { x2 = true; cx2 = ''; }
    });
    parser2.on('text', (t) => { if (t2) ct2 += t; else if (x2) cx2 += t; });
    parser2.on('cdata', (t) => { if (x2) cx2 += t; });
    parser2.on('closetag', (n) => {
      if (n === 'title') t2 = false;
      else if (n === 'text') x2 = false;
      else if (n === 'page') {
        pc2++;
        const id = redirectTargets.get(ct2.toLowerCase());
        if (id != null && !hits.has(id)) {
          const parsed = parseInfobox(cx2);
          if (parsed && parsed.penduduk) {
            hits.set(id, { wiki: parsed, title: ct2 });
          }
        }
        if (pc2 % 200000 === 0) {
          const el = (Date.now() - s2) / 1000;
          console.log(`  pass2 pages=${pc2}  hits=${hits.size}/${rows.length}  ${(pc2/el).toFixed(0)}/s`);
        }
        ct2 = ''; cx2 = '';
      }
    });

    const done2 = new Promise((resolve, reject) => {
      parser2.on('end', resolve);
      parser2.on('error', reject);
      stream2.on('error', reject);
    });
    stream2.pipe(bz2()).pipe(parser2);
    await done2;
    console.log(`Pass 2 done: pages=${pc2} hits=${hits.size}`);
  }

  const results = rows.map((r) => {
    const luasGeom = parseFloat(r.luas_km2_geom);
    const hit = hits.get(r.id);
    if (hit && hit.wiki.penduduk) {
      return {
        id: r.id,
        nama: r.nama,
        kecamatan: r.kecamatan,
        kota_kab: r.kota_kab,
        provinsi: r.provinsi,
        jumlah_penduduk: Math.round(hit.wiki.penduduk),
        luas_km2: hit.wiki.luas || luasGeom,
        luas_km2_geom: luasGeom,
        kepadatan: hit.wiki.kepadatan
          ? Math.round(hit.wiki.kepadatan)
          : Math.round(hit.wiki.penduduk / (hit.wiki.luas || luasGeom)),
        title: hit.title,
        source: 'wikipedia',
      };
    }
    const prev = existingById.get(r.id);
    if (prev && prev.source === 'wikipedia') return prev;
    return {
      id: r.id,
      nama: r.nama,
      kecamatan: r.kecamatan,
      kota_kab: r.kota_kab,
      provinsi: r.provinsi,
      jumlah_penduduk: null,
      luas_km2: luasGeom,
      luas_km2_geom: luasGeom,
      kepadatan: null,
      source: 'fallback',
    };
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const wiki = results.filter((r) => r.source === 'wikipedia').length;
  const fallback = results.filter((r) => r.source === 'fallback').length;
  console.log(`\nSaved to ${OUTPUT_PATH}`);
  console.log(`  wikipedia: ${wiki}/${results.length}`);
  console.log(`  fallback:  ${fallback}/${results.length}`);

  const perKota = new Map();
  for (const r of results) {
    if (!perKota.has(r.kota_kab)) perKota.set(r.kota_kab, { wiki: 0, fallback: 0 });
    perKota.get(r.kota_kab)[r.source === 'wikipedia' ? 'wiki' : 'fallback']++;
  }
  console.log('\nPer kota:');
  for (const [kota, c] of [...perKota.entries()].sort()) {
    const total = c.wiki + c.fallback;
    const pct = ((c.wiki / total) * 100).toFixed(0);
    console.log(`  ${kota.padEnd(22)} wiki=${String(c.wiki).padStart(4)} / ${String(total).padStart(4)}  (${pct}%)`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
