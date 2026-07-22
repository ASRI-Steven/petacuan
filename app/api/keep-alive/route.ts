import { NextResponse } from 'next/server';
import postgres from 'postgres';

// Route ini SATU tujuan: menyentuh database secara ringan & rutin supaya
// project Supabase (free tier) tidak dianggap "inactive" lalu di-pause otomatis
// setelah 7 hari. Dipanggil oleh Vercel Cron, GitHub Actions, atau uptime pinger.
//
// Wajib force-dynamic + no-store: kalau responsnya kena cache CDN, query DB
// TIDAK jalan dan keep-alive jadi percuma.
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 8,
});

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };

export async function GET() {
  const started = Date.now();
  try {
    // Query nyata & murah pada tabel asli — dihitung sebagai aktivitas DB oleh Supabase.
    const rows = await sql`SELECT count(*)::int AS n FROM kelurahan`;
    return NextResponse.json(
      {
        ok: true,
        kelurahan: rows[0]?.n ?? null,
        tookMs: Date.now() - started,
        ts: new Date().toISOString(),
      },
      { headers: NO_STORE },
    );
  } catch (err: any) {
    // DB kemungkinan sedang paused / tidak terjangkau. Balas 503 (bukan 500)
    // supaya scheduler tahu ini "service unavailable" dan bisa alert.
    return NextResponse.json(
      {
        ok: false,
        error: 'database-unreachable',
        message: err?.message ?? String(err),
        hint: 'Kalau ini muncul terus, resume project Supabase-nya di dashboard.',
        ts: new Date().toISOString(),
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
