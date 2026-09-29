#!/bin/sh
# Runs every expect script in e2e/. Needs no installs: /usr/bin/expect ships with macOS.
cd "$(dirname "$0")/.." || exit 1
# Test values come from your own library + profile (no names in the scripts).
eval "$(bun e2e/values.ts)" || exit 1
status=0
for f in e2e/*.exp; do
  echo "== $f"
  /usr/bin/expect "$f" | grep -E "^(ok|FAIL|all passed)" || status=1
done
exit $status
