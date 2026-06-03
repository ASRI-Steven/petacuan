import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in .env.local');
}

// Connection untuk app (pakai pooler Supabase)
const queryClient = postgres(process.env.DATABASE_URL, {
  prepare: false, // disable prepared statements (Supabase pooler requirement)
  max: 10,        // max connections in pool
});

export const db = drizzle(queryClient);
export { queryClient as sql }; // export raw client juga untuk PostGIS query