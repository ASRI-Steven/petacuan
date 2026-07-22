#!/bin/bash
# Keep-alive PetaCuan (LOKAL) — ping endpoint biar DB Supabase gak kena auto-pause.
#
# Dijalankan otomatis oleh launchd:
#   ~/Library/LaunchAgents/com.petacuan.keepalive.plist
#     - tiap login/boot (RunAtLoad), dan
#     - tiap hari 10:00 (StartCalendarInterval). Kalau laptop lagi tidur/mati
#       pas jamnya, launchd otomatis jalanin begitu laptop nyala/bangun.
#
# Target bisa diganti via env KEEPALIVE_URL.
# Log: ~/Library/Logs/petacuan-keepalive.log
#   lihat:  tail -n 20 ~/Library/Logs/petacuan-keepalive.log
#
# --- Mode alternatif: langsung ke DB (tanpa lewat Vercel) ---
# Kalau mau murni lokal tanpa bergantung endpoint yang ke-deploy, ganti blok curl
# di bawah dengan (psql sudah ada di /opt/homebrew/bin/psql):
#   DB=$(grep -oE 'postgresql://[^ ]+' "$HOME/petacuan/.env.local" | head -1)
#   /opt/homebrew/bin/psql "$DB" -tAc 'select count(*) from kelurahan'

URL="${KEEPALIVE_URL:-https://petacuan.vercel.app/api/keep-alive}"
ts="$(date '+%Y-%m-%d %H:%M:%S %z')"

tmp="$(mktemp)"
code="$(/usr/bin/curl -sS -m 30 --retry 3 --retry-delay 5 -o "$tmp" -w '%{http_code}' "$URL" 2>>"$tmp" || echo 000)"
payload="$(head -c 300 "$tmp" 2>/dev/null | tr '\n' ' ')"
rm -f "$tmp"

if [ "$code" = "200" ]; then
  echo "[$ts] OK ($code) $payload"
else
  echo "[$ts] FAIL ($code) $payload"
fi
