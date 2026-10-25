# Contributing

## Setup

```bash
npm install                # installs all workspace deps (single root lockfile)
cp .env.example .env       # defaults to embedded PGlite + local-folder storage
make dev-setup              # links .env into apps/web, seeds the demo dataset
make install-hooks          # pre-commit + pre-push git hooks (see below)
```

See the Quick Start in `README.md` for running the app locally, and
[`CLAUDE.md`](CLAUDE.md) for the full architecture/layout tour.

## Before opening a PR

`make install-hooks` wires up local git hooks that catch most of this
automatically — `pre-commit` runs detect-secrets, Prettier, and ESLint;
`pre-push` additionally runs the full test suite and a typecheck. Run the
same checks manually before opening a PR:

```bash
npm run lint && npm run typecheck && npm run test:coverage && npm run format:check
```

If `npm run format:check` fails, `npm run format` applies the fix in place.

If you changed the Drizzle schema (`packages/db/src/schema/*.ts`), also run
`npm run db:generate --workspace @portfolio/db` and commit the generated
migration under `packages/db/drizzle/`.

If you changed the vendored Trade Republic Python code
(`services/api/python`), run `npm run test:py --workspace @portfolio/api`
(needs the `.venv-pytr` venv — `make pytr-venv` creates it).

All issues and pull request descriptions must adhere to the standard
templates:

- Issue blueprint: [.github/ISSUE_TEMPLATE/issue-blueprint.md](.github/ISSUE_TEMPLATE/issue-blueprint.md)
- PR template: [.github/pull_request_template.md](.github/pull_request_template.md)

The templates enforce checking all guidelines (lint, typecheck, test,
format-check, migrations) before submission. Fill them in rather than
skipping them.

## Web e2e (Playwright)

`apps/web/e2e/` holds real-browser specs (currently the command bar: palette, `g` chords,
`n`/`?`, focus restore, `?entry=` deep links, Android back). They are **not** part of
`npm test` — they are a separate suite that runs in its own CI job (the `e2e` job in
`.github/workflows/ci-cd.yml`). One-time: `npx playwright install chromium`. Then, from the
repo root:

```bash
npm run e2e --workspace @portfolio/web
```

Playwright's `webServer` boots a `make dev`-equivalent stack on its own ports (API `3101`,
web `3105`; override with `E2E_API_PORT` / `E2E_WEB_PORT`): the API on a throwaway PGlite
database (`.pglite-e2e/`, wiped and re-seeded with the demo dataset on every run) and
`next dev`, with the `DEV_AUTH_TOKEN` bypass. No `.env` is needed, and it does not touch
your normal dev database. The first run compiles routes in `next dev`, so allow a few
minutes. Failure traces land in `apps/web/test-results/`.

**Build the workspace packages first** — the API resolves `@portfolio/core`,
`@portfolio/db` and the other workspace packages from their `dist/` folder, so a fresh
checkout has no `dist/` to run against:

```bash
npm run build
```

(That is what the CI job does too, with `npx turbo run build --filter=@portfolio/api...`.
Skipping it is the classic "column does not exist" / "cannot find module" failure — the
compiled `dist/` and the checked-out migrations have to agree.)

In CI the run writes an HTML report to `apps/web/playwright-report/` and uploads it, with
the failure traces, as the `playwright-report` artifact.

## Branching

Branch off the **latest remote** default branch, not your local one —
`git fetch` updates `origin/*` but never fast-forwards a local `main`, so a
stale local `main` is what makes a PR show up as "out-of-date with the base
branch" the moment it's opened:

```bash
git fetch origin && git checkout -b <branch> origin/main
```

No direct commits to `main` — always branch and open a PR.

## PR title

Must use a [Conventional Commits](https://www.conventionalcommits.org/)
prefix (`feat:`, `fix:`, `chore:`, `docs:`, ...) — this repo squash-merges
most PRs and Release Please parses the merge commit subject (which defaults
to the **PR title**) to cut versions/changelogs. An unprefixed title
silently drops the change from `CHANGELOG.md`.

## Keep descriptions and commit messages generic

PR/issue descriptions **and commit messages** must not contain personal or
account-holder names, or private account specifics (depot/account numbers,
exact balances). Describe the change and the class of problem, not the
individual account that surfaced it. This matters most for commit
messages — no pre-commit hook catches it, and Release Please copies commit
subjects into `CHANGELOG.md` permanently.

## Branch protection

`main` requires a PR (no direct pushes, no admin bypass) and these status
checks: `test-node / lint-and-test`, `test-python`,
`dependency-review / dependency-review`, and CodeQL's
`analyze / Analyze (javascript-typescript)`. A clean local run of the
commands above should mean a clean CI run.
