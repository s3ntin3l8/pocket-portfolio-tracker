#!/usr/bin/env bash
# What the demo needs on a clean runner (called by the shared visual-check workflow, after it installed
# Node). `make demo` builds the workspace packages and starts the API and `next dev` itself.
set -euo pipefail

npm ci --no-audit --no-fund
