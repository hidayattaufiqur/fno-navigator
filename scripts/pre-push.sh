#!/usr/bin/env bash
# Pre-push guard for fno-navigator.
#
# CI red X badges on this repo come from two failure classes, and both are
# "you changed one hall of the pair and forgot the other":
#
#   check-legend-copy   src/lib/findLegendCopy.js  <->  find-legend-copy.md
#   verify:map          static/data/fk-map.json    <->  map-manifest.json
#
# Both run in CI, both are fast and offline, and both only fire after the push.
# Running them here turns a red badge into a local message with the fix in it.
#
# Install (once per clone):
#   ln -sf ../../scripts/pre-push.sh .git/hooks/pre-push
#
# Bypass for a deliberate WIP push:
#   FNO_SKIP_PREPUSH=1 git push
set -u

[ "${FNO_SKIP_PREPUSH:-0}" = "1" ] && { echo "pre-push: skipped (FNO_SKIP_PREPUSH=1)"; exit 0; }

cd "$(git rev-parse --show-toplevel)" || exit 1

fail=0

if ! node tests/check-legend-copy.mjs >/tmp/fno-prepush-legend.log 2>&1; then
  echo "pre-push: copy drift — src/lib/findLegendCopy.js vs find-legend-copy.md"
  sed -n '1,12p' /tmp/fno-prepush-legend.log | sed 's/^/    /'
  echo "    fix: the deck is the source of truth; update both in one commit."
  fail=1
fi

if ! npm run --silent verify:map >/tmp/fno-prepush-map.log 2>&1; then
  echo "pre-push: dataset fingerprint drift — static/data/fk-map.json vs map-manifest.json"
  tail -6 /tmp/fno-prepush-map.log | sed 's/^/    /'
  echo "    fix: npm run generate:map (regenerates both files together)."
  fail=1
fi

if [ "$fail" -eq 1 ]; then
  echo ""
  echo "Push blocked. Nothing was sent. Re-run with FNO_SKIP_PREPUSH=1 to push anyway."
  exit 1
fi

echo "pre-push: copy + fingerprint guards clean"
exit 0
