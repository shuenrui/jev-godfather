#!/bin/sh
# Deploy Jev Godfather to ifhost/Innstance.
# Requires a local build first: ./build.sh
set -e
export PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")"
APP=jev-godfather

if [ ! -f dist/index.html ]; then
  echo "dist/index.html missing — run: ./build.sh (or npm run build)" >&2
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "-> Staging app..."
cp -R dist "$STAGE/dist"
mkdir -p "$STAGE/server" "$STAGE/src"
cp server/advice.js server/index.js "$STAGE/server/"
# advice.js imports ../src/adviceLibrary.js — preserve that layout.
cp src/adviceLibrary.js "$STAGE/src/adviceLibrary.js"
cp package.json "$STAGE/package.json"

echo "-> Pushing to ifhost..."
ifhost machines push --app "$APP" "$STAGE" --to /app --yes-replace

echo "-> Starting server..."
# Minimal Debian has no pkill/pgrep — kill via /proc scan (prefix match avoids self-kill).
ifhost machines exec --app "$APP" -- sh -c '
  for pid in $(ls /proc | grep -E "^[0-9]+$"); do
    cmd=$(tr "\0" " " < /proc/$pid/cmdline 2>/dev/null) || continue
    case "$cmd" in "node server/index.js"*) kill "$pid" 2>/dev/null || true ;; esac
  done
  sleep 1
  cd /app && setsid nohup node server/index.js </dev/null >/tmp/app.log 2>&1 &
  sleep 1.5
  if grep -q "listening" /tmp/app.log; then
    echo "server started"
  else
    echo "start failed:"; cat /tmp/app.log; exit 1
  fi
'

echo "-> Waiting for health..."
URL=$(ifhost status --json | python3 -c "import json,sys; apps=json.load(sys.stdin)['apps']; print(next(a['url'] for a in apps if a['name']=='$APP'))")
sleep 2
curl -sS -o /dev/null -w "$URL/healthz -> HTTP %{http_code}\n" --max-time 30 "$URL/healthz"
curl -sS -o /dev/null -w "$URL/        -> HTTP %{http_code}\n" --max-time 30 "$URL/"
echo "Live at $URL"
