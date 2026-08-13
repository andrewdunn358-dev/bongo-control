#!/usr/bin/env bash
# Tests for the offline map work. No new dependencies, no test runner -
# plain node assertions, so this runs anywhere npm ci has run.
#
#   npm run test:maps
#
# The heavier end-to-end test (a real Chromium driven through a real
# deploy, proving the map cache survives it) is tests/
# deploy-cache-survival.playwright.mjs - see docs/offline_maps.md. It
# needs playwright installed, which is why it isn't wired in here: the
# Pi builds this image and has no business downloading a browser.
set -euo pipefail

cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The tile maths lives in TypeScript; compile just that module rather
# than pulling in a bundler to test forty lines of arithmetic.
npx tsc src/lib/mapStyle.ts --outDir "$TMP" --module esnext --target es2020 \
  --moduleResolution bundler --skipLibCheck

cp tests/tile-math.test.mjs "$TMP"/
node "$TMP/tile-math.test.mjs"
node tests/service-worker.test.mjs

echo "offline map tests: OK"
