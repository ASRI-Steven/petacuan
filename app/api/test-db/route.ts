import { NextResponse } from 'next/server';
import { sql } from '@/db';

export async function GET() {
  try {
    // Test 1: Cek PostGIS extension
    const postgisResult = await sql`SELECT PostGIS_version() as version`;
    
    // Test 2: Cek bisa query PostgreSQL
    const dbInfo = await sql`
      SELECT current_database() as db_name, version() as pg_version
    `;
    
    return NextResponse.json({
      success: true,
      postgis: postgisResult[0].version,
      database: dbInfo[0].db_name,
      postgres: dbInfo[0].pg_version,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}