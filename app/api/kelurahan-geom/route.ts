import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
});

export async function GET(req: NextRequest) {
  try {
    const kotaKab = req.nextUrl.searchParams.get('kotaKab');

    const rows = kotaKab
      ? await sql<Array<{
          id: number;
          nama: string;
          kecamatan: string;
          kota_kab: string;
          geojson: string;
        }>>`
          SELECT id, nama, kecamatan, kota_kab,
                 ST_AsGeoJSON(ST_Simplify(geom, 0.0001)) AS geojson
          FROM kelurahan
          WHERE kota_kab = ${kotaKab}
          ORDER BY id
        `
      : await sql<Array<{
          id: number;
          nama: string;
          kecamatan: string;
          kota_kab: string;
          geojson: string;
        }>>`
          SELECT id, nama, kecamatan, kota_kab,
                 ST_AsGeoJSON(ST_Simplify(geom, 0.0001)) AS geojson
          FROM kelurahan
          ORDER BY id
        `;

    const features = rows.map(r => ({
      type: 'Feature',
      id: r.id,
      properties: {
        kelurahanId: r.id,
        kelurahan: r.nama,
        kecamatan: r.kecamatan,
        kotaKab: r.kota_kab,
      },
      geometry: JSON.parse(r.geojson),
    }));

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
    });
  } catch (err: any) {
    console.error('GeoJSON error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
