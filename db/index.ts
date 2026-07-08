import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Connection untuk app (pakai pooler Supabase)
const queryClient = postgres(process.env.DATABASE_URL!, {
  prepare: false,        // Supabase pooler (transaction mode) tak dukung prepared statements
  max: 1,                // serverless: 1 koneksi/instance — hindari pooler exhaustion
  idle_timeout: 20,      // lepas koneksi idle cepat (fungsi Vercel sering di-freeze)
  connect_timeout: 10,   // fail fast kalau pooler lambat
});

export const db = drizzle(queryClient);
export { queryClient as sql }; // export raw client juga untuk PostGIS query