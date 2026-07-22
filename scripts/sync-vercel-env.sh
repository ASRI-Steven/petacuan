#!/usr/bin/env bash
# Sinkron semua variabel dari .env.local ke Vercel untuk Production + Preview.
# Prasyarat: sudah `vercel login` dan project ter-link (.vercel/ ada).
# Aman diulang (upsert: hapus lalu tambah). Nilai rahasia tidak dicetak.
#
# Pakai:  bash scripts/sync-vercel-env.sh
# Opsi :  TARGETS="production preview development" bash scripts/sync-vercel-env.sh

set -uo pipefail
ENVFILE="${ENVFILE:-.env.local}"
read -r -a TARGETS <<< "${TARGETS:-production preview}"

[ -f "$ENVFILE" ] || { echo "❌ $ENVFILE tidak ada"; exit 1; }
command -v vercel >/dev/null || { echo "❌ vercel CLI tidak ada"; exit 1; }

echo "Sinkron $ENVFILE → [${TARGETS[*]}]"
while IFS= read -r line || [ -n "$line" ]; do
  # lewati komentar & baris tanpa '='
  case "$line" in \#*|'') continue ;; esac
  [ "${line%%=*}" = "$line" ] && continue

  name="${line%%=*}"; name="$(echo "$name" | xargs)"
  value="${line#*=}"
  # buang spasi tepi & tanda kutip pembungkus
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  [ -z "$name" ] && continue
  [ -z "$value" ] && { echo "· $name (kosong, dilewati)"; continue; }

  for env in "${TARGETS[@]}"; do
    vercel env rm "$name" "$env" -y >/dev/null 2>&1
    if printf '%s' "$value" | vercel env add "$name" "$env" >/dev/null 2>&1; then
      echo "✓ $name → $env"
    else
      echo "✗ $name → $env (gagal)"
    fi
  done
done < "$ENVFILE"

echo
echo "Selesai. WAJIB redeploy agar NEXT_PUBLIC_* ikut ter-build:"
echo "  vercel --prod          # production"
echo "  (preview terbuild otomatis saat push branch / PR berikutnya)"
