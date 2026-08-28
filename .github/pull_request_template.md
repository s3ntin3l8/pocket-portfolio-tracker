## Summary

<!-- Describe what changed, why, and any context or subproblems. -->

### Changes made:

<!-- Numbered list of changes per file/component. E.g.,
1. **packages/core/src/tax.ts**: Fixed Teilfreistellung netting for the DE regime.
-->

### Key design decisions:

<!-- Rationale for non-obvious choices, e.g. why a boundary flag was added, why a
migration was written a particular way, etc. -->

## Test plan / Verification

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:coverage` (runs the suite and the 70% coverage gate)
- [ ] `npm run format:check`
- [ ] Schema changes (`packages/db/src/schema/*.ts`): ran `npm run db:generate --workspace @portfolio/db` and committed the migration under `packages/db/drizzle/`
- [ ] Python changes (`services/api/python`): `npm run test:py --workspace @portfolio/api`
- [ ] Web changes (`apps/web`): exercised manually (`make dev` / `make dev-web`)
- [ ] Description contains no personal/account-holder names, depot/account numbers, or exact balances

Closes #<!-- Issue Number -->

<!--
PR title must use a Conventional Commits prefix (feat:, fix:, chore:, docs:, ...).
Release Please parses the merge commit subject to cut versions/changelogs. This repo
squash-merges most PRs with squash_merge_commit_title = PR title, so an unprefixed PR
title silently drops the change from the changelog.

See CONTRIBUTING.md for the full pre-PR checklist and setup steps.
-->
