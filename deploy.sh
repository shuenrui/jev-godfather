#!/bin/sh
# Deploy Jev Godfather to ifhost/Innstance.
# Requires a local build first: npm install && npm run build
set -e
export PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")"

if [ ! -f dist/index.html ]; then
  echo "dist/index.html missing — run: npm install && npm run build" >&2
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
ifhost machines push --app jev-godfather "$STAGE" --to /app --yes-replace

echo "-> Starting server..."
ifhost machines exec --app jev-godfather -- sh -c \
  "pkill -f 'node server/index.js' 2>/dev/null; cd /app && setsid nohup node server/index.js </dev/null >/tmp/app.log 2>&1 & sleep 1"

echo "-> Waiting for health..."
sleep 2
URL=$(ifhost status --json 2>/dev/null | sed -n 's/.*"url":"\([^"]*\)".*/\1/p' | head -1)
if [ -n "$URL" ]; then
  curl -sS -o /dev/null -w "$URL -> HTTP %{http_code}\n" --max-time 30 "$URL/healthz" || true
  echo "Live at $URL"
else
  echo "Check URL with: ifhost status"
fi
