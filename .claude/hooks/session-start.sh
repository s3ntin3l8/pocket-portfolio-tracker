#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (remote) sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Install dependencies so linters and tests are ready.
# npm ci, like CI and the Dockerfile: it installs exactly what package-lock.json
# pins and never rewrites it, so a session doesn't start with a dirty lockfile.
# npm ci removes node_modules first, so retry transient registry errors the same
# way the Dockerfile does. If package.json and the lockfile disagree, npm ci
# fails on purpose; run `npm install` by hand to repair the lockfile.
export NPM_CONFIG_FETCH_RETRIES=5
export NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
export NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
npm ci
