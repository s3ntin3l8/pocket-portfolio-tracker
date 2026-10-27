#!/bin/bash
# Host side of visual/hooks.mjs. Usage: host-hooks.sh <name> <demo-dir> [args…]
#   session  prints the demo's session cookie as JSON ({"name","value"}); `make demo` keeps it in
#            <demo-dir>/.demo/instance.json while it runs (scripts/demo/instance.mjs).
set -euo pipefail

case "$1" in
  session)
    file="$2/.demo/instance.json"
    [ -f "$file" ] || { echo "no $file: is the demo running from $2?" >&2; exit 1; }
    node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).cookie))' "$file"
    ;;
  *) echo "unknown host hook $1" >&2; exit 2 ;;
esac
