#!/usr/bin/env bash
# Deploy PetaCuan ke Vercel PRODUCTION.
#
# Prasyarat:
#   - Sudah `vercel login` (atau set VERCEL_TOKEN untuk non-interaktif / CI).
#   - Project sudah ter-link (folder .vercel/ ada — sudah ada di repo ini).
#   - Env production sudah di-set di Vercel. Kalau belum / berubah, jalankan dulu:
#       bash scripts/sync-vercel-env.sh
#     atau pakai flag --sync-env di bawah.
#
# Pakai:
#   bash scripts/deploy-prod.sh                # typecheck lokal, lalu deploy (build di server Vercel)
#   bash scripts/deploy-prod.sh --prebuilt     # build lokal, lalu upload hasil build (build server lebih ringan)
#   bash scripts/deploy-prod.sh --sync-env     # sinkron .env.local -> Vercel dulu, baru deploy
#   bash scripts/deploy-prod.sh --skip-checks  # lewati install + typecheck lokal (deploy tercepat)
#   VERCEL_TOKEN=xxxxx bash scripts/deploy-prod.sh   # non-interaktif (CI / server)

set -euo pipefail

# --- Selalu jalan dari root repo, tak peduli dipanggil dari mana ---
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Opsi ---
PREBUILT=0; SYNC_ENV=0; RUN_CHECKS=1
for arg in "$@"; do
  case "$arg" in
    --prebuilt)    PREBUILT=1 ;;
    --sync-env)    SYNC_ENV=1 ;;
    --skip-checks) RUN_CHECKS=0 ;;
    -h|--help)     awk 'NR==1{next} /^set /{exit} {sub(/^# ?/,""); print}' "$0"; exit 0 ;;
    *) echo "❌ Opsi tak dikenal: $arg (pakai -h untuk bantuan)" >&2; exit 1 ;;
  esac
done

# --- Runner Vercel CLI: pakai global kalau ada, kalau tidak pakai pnpm dlx ---
if command -v vercel >/dev/null 2>&1; then
  VERCEL=(vercel)
elif command -v pnpm >/dev/null 2>&1; then
  VERCEL=(pnpm dlx vercel@latest)
else
  echo "❌ vercel CLI / pnpm tidak ditemukan. Install: pnpm add -g vercel" >&2; exit 1
fi

# --- Token untuk mode non-interaktif (opsional) ---
EXTRA=()
if [ -n "${VERCEL_TOKEN:-}" ]; then EXTRA+=(--token "$VERCEL_TOKEN" --yes); fi

# --- Pastikan project ter-link ---
if [ ! -f .vercel/project.json ]; then
  echo "❌ Project belum ter-link (.vercel/project.json tidak ada). Jalankan: ${VERCEL[*]} link" >&2
  exit 1
fi
PROJECT="$(node -p "require('./.vercel/project.json').projectName" 2>/dev/null || echo petacuan)"
echo "▸ Project   : $PROJECT"
echo "▸ Target    : production"
echo "▸ Deploy CLI: ${VERCEL[*]}"

# --- Peringatan kalau ada perubahan belum di-commit (deploy tetap lanjut) ---
if command -v git >/dev/null 2>&1 && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "⚠️  Ada perubahan yang belum di-commit — Vercel akan mendeploy isi folder saat ini apa adanya."
fi

# --- Sinkron env (opsional) ---
if [ "$SYNC_ENV" -eq 1 ]; then
  echo "▸ Sinkron env .env.local -> Vercel…"
  bash scripts/sync-vercel-env.sh
fi

# --- Gerbang mutu: install + typecheck lokal biar gak gagal di server ---
if [ "$RUN_CHECKS" -eq 1 ]; then
  echo "▸ Install dependency (frozen lockfile)…"
  pnpm install --frozen-lockfile
  echo "▸ Typecheck (tsc --noEmit)…"
  pnpm exec tsc --noEmit
  echo "  ✓ Typecheck lolos"
fi

# --- Tarik konfigurasi & env production dari Vercel ---
echo "▸ Pull setting production…"
"${VERCEL[@]}" pull --yes --environment=production ${EXTRA[@]+"${EXTRA[@]}"}

# --- Deploy ---
if [ "$PREBUILT" -eq 1 ]; then
  echo "▸ Build lokal (production)…"
  "${VERCEL[@]}" build --prod ${EXTRA[@]+"${EXTRA[@]}"}
  echo "▸ Deploy hasil build (prebuilt) -> production…"
  "${VERCEL[@]}" deploy --prebuilt --prod ${EXTRA[@]+"${EXTRA[@]}"}
else
  echo "▸ Deploy -> production (build di server Vercel)…"
  "${VERCEL[@]}" deploy --prod ${EXTRA[@]+"${EXTRA[@]}"}
fi

echo ""
echo "✅ Selesai. URL production di atas (baris terakhir dari Vercel)."
echo "   Cek juga: ${VERCEL[*]} inspect --logs <url>   atau dashboard Vercel."
