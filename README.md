# PetaCuan

AI rekomendasi lokasi usaha untuk UMKM di Jabodetabek, berjalan di browser (Next.js + Mapbox). Pilih jenis usaha, modal, dan kota, lalu PetaCuan menilai 1.496 kelurahan dari demografi, POI OpenStreetMap, akses jalan, dan harga sewa. Hasilnya tampil sebagai peringkat di peta, lengkap dengan analisis AI.

Live: https://petacuan.vercel.app

- `app/page.tsx` — UI: pilih kota, jenis usaha & modal, peta (batas kelurahan, POI, rute, Street View), peringkat, analisis AI, chatbot
- `app/api/recommend` — skor & peringkat kelurahan per kota
- `app/api/narrative` — narasi analisis lokasi oleh AI
- `app/api/devil` — devil's advocate: AI mencari 2–3 risiko nyata dari angka skor
- `app/api/spots` — titik usulan di dekat POI pendukung
- `app/api/tune-weights` — AI mengubah kebutuhan user jadi bobot skor
- `app/api/chat` — chatbot tanya-jawab lokasi
- `app/api/cron/scrape` — scrape harga sewa ruko, satu kota per hari (Vercel Cron)
- `app/api/keep-alive` — ping ringan supaya database Supabase (free tier) tidak auto-pause
- `db/` — skema Drizzle + SQL view & fungsi skor `calculate_scores`
- `scripts/` — pipeline data (batas kelurahan, demografi, POI & jalan, harga sewa) dan deploy
- `lib/ai.ts` — pilih provider AI: Claude (default) atau Hugging Face

## Cara skor dihitung

`calculate_scores(jenis_usaha, modal, kota)` di PostGIS menghitung lima komponen per kelurahan. Tiap komponen dinormalisasi 0–100 di dalam kota terpilih, lalu dijumlah dengan bobot.

- **Demand** — populasi target sesuai jenis usaha
- **Competition** — makin sedikit pesaing sejenis, makin tinggi
- **Anchor** — POI pendukung: sekolah, kampus, pasar, rumah ibadah, faskes, mal, kantor, transit
- **Access** — panjang jalan utama & kolektor
- **Affordability** — harga sewa dibanding modal (modal menentukan tipe tempat: PKL, kios, ruko)

## Menjalankan

Butuh Node 20+, pnpm, dan Postgres + PostGIS (Supabase).

```
pnpm install
# isi .env.local, lihat tabel di bawah
pnpm dev
```

Buka http://localhost:3000.

| Variabel | Untuk |
|---|---|
| `DATABASE_URL` | Postgres + PostGIS (Supabase) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | peta, geocoding, rute |
| `ANTHROPIC_API_KEY` | AI (provider default) |
| `ANTHROPIC_MODEL` | opsional, default `claude-haiku-4-5-20251001` |
| `AI_PROVIDER` | `claude` (default) atau `huggingface` |
| `HF_TOKEN`, `HF_MODEL` | kalau `AI_PROVIDER=huggingface` |
| `GOOGLE_MAPS_API_KEY` | Street View |
| `CRON_SECRET` | proteksi `/api/cron/scrape` |
| `JINA_API_KEY` | opsional, untuk scraper harga sewa lewat r.jina.ai |

## Mengisi data

Script di `scripts/`, dijalankan manual dengan `node scripts/<nama>.mjs`:

1. Batas kelurahan: `extract-jabodetabek.mjs`, lalu `import-kelurahan.mjs`
2. Demografi: `scrape-demografi.mjs` atau `parse-wiki-dump.mjs` (Wikipedia), lalu `derive-demografi.mjs`
3. POI & jalan: `import-poi-overpass.mjs`, `import-roads-overpass.mjs` (Overpass API)
4. Harga sewa: `scrape-rumah123.mjs`, lalu `seed-harga-rumah123.mjs`
5. View & fungsi skor: `node scripts/apply-sql.mjs db/sql/scoring.sql db/sql/scoring-function.sql`

## Deploy

- Vercel (region `sin1`): `pnpm deploy:prod`. Tambah `--sync-env` untuk menyalin `.env.local` ke env Vercel.
- Vercel Cron: `/api/cron/scrape` tiap hari pukul 00:00 WIB.
- GitHub Actions (`.github/workflows/keep-alive.yml`): ping `/api/keep-alive` tiap hari.

## Data & layanan pihak ketiga

- Data peta © kontributor OpenStreetMap (ODbL), lewat Overpass API
- Batas kelurahan: `geojson-indonesia`
- Demografi: Wikipedia bahasa Indonesia dan BPS, sisanya estimasi
- Harga sewa: listing 99.co dan rumah123, lewat Jina Reader
- Peta, geocoding, rute: Mapbox · Street View: Google Maps Platform
- AI: Anthropic Claude (default) atau Hugging Face Inference Providers
