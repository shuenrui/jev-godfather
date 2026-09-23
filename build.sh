#!/bin/sh
# Build dist/ with Bun — no Vite dev server or registry needed at build time
# (only requires node_modules/react + react-dom to exist, via npm/bun install).
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules/react ] || [ ! -d node_modules/react-dom ]; then
  echo "react/react-dom missing — run: npm install" >&2
  exit 1
fi

rm -rf dist
bun build src/main.jsx --outdir=dist/assets --minify --target=browser

# Content-hash asset names so 1-year immutable caching never serves a stale bundle.
JS_HASH=$(shasum dist/assets/main.js | cut -c1-8)
CSS_HASH=$(shasum dist/assets/main.css | cut -c1-8)
mv dist/assets/main.js "dist/assets/main.$JS_HASH.js"
mv dist/assets/main.css "dist/assets/main.$CSS_HASH.css"

cat > dist/index.html <<HTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#151412" />
    <meta name="description" content="Jev Godfather turns a messy project idea into a clear decision boundary." />
    <link rel="stylesheet" href="/assets/main.$CSS_HASH.css" />
    <title>Jev Godfather — Decision architect</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/main.$JS_HASH.js"></script>
  </body>
</html>
HTML

cp favicon.svg dist/favicon.svg
echo "Built dist/ ($(du -sh dist | cut -f1))"
