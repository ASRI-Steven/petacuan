// Apply file SQL ke Supabase (DDL: view, function, dll).
// Pakai: node scripts/apply-sql.mjs db/sql/scoring.sql [file2.sql ...]
import fs from 'fs';
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/apply-sql.mjs <file.sql> [file2.sql ...]');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
try {
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    await sql.unsafe(content);
    console.log(`✅ Applied ${file}`);
  }
} catch (err) {
  console.error(`❌ Gagal:`, err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
