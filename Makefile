.DEFAULT_GOAL := help

.PHONY: help install install-hooks web-env pytr-venv services services-down dev dev-web dev-setup seed-demo seed-demo-login dev-reset test test-coverage lint typecheck format build clean prod prod-down prod-logs prod-ps dev-clean-legacy-volumes

# Both compose files now pin an explicit `name:` (docker-compose.yml -> pocket-dev,
# docker-compose.prod.yml -> pocket-portfolio-tracker) so the dev and prod stacks never
# share a project — see the header comments in each file for why. Kept as variables here
# so all three prod targets stay in lockstep instead of repeating the flags.
COMPOSE_DEV := docker compose -f docker-compose.yml
COMPOSE_PROD := docker compose -f docker-compose.prod.yml --env-file .env.prod

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm ci

install-hooks: ## Install pre-commit hooks (requires pre-commit installed)
	pre-commit install
	pre-commit install --hook-type pre-push

web-env: ## Link root .env into apps/web so Next.js (cwd=apps/web) can read it
	ln -sf ../../.env apps/web/.env.local

pytr-venv: ## Create local pytr venv for Trade Republic sync (then set PYTR_PYTHON_BIN in .env)
	python3 -m venv .venv-pytr
	.venv-pytr/bin/pip install --upgrade pip
	.venv-pytr/bin/pip install -r services/api/python/requirements.txt
	@echo "Add to .env:  PYTR_PYTHON_BIN=$(CURDIR)/.venv-pytr/bin/python"

services: ## Start local Postgres + MinIO (optional — dev defaults to PGlite + local folder storage; use for Postgres-parity dev)
	$(COMPOSE_DEV) up -d postgres minio

services-down: ## Stop local backing services
	$(COMPOSE_DEV) down

prod: ## Build and start the production stack (docker-compose.prod.yml; requires .env.prod, see its header comment)
	@if [ -z "$$($(COMPOSE_PROD) ps -aq 2>/dev/null)" ]; then \
		echo "warning: no existing 'pocket-portfolio-tracker' project containers found."; \
		echo "If you expected this to adopt a running deployment, double-check the project"; \
		echo "name in docker-compose.prod.yml and that you're on the right host — otherwise"; \
		echo "this creates a fresh stack with empty volumes. Ctrl-C within 5s to abort."; \
		sleep 5; \
	fi
	$(COMPOSE_PROD) up -d --build

prod-down: ## Stop the production stack
	$(COMPOSE_PROD) down

prod-logs: ## Follow logs from the production stack
	$(COMPOSE_PROD) logs -f

prod-ps: ## Show production stack container status (plain `docker compose ps` here only shows the dev stack)
	$(COMPOSE_PROD) ps

dev: web-env ## Start all dev servers (API + web via Turbo)
	fuser -k 3005/tcp 2>/dev/null || true
	npm run dev

dev-web: web-env ## Start only the web app dev server (mock data, no API needed)
	fuser -k 3005/tcp 2>/dev/null || true
	npm run dev --workspace @portfolio/web

dev-setup: web-env seed-demo ## One-shot first run: link .env into apps/web, then seed the demo dataset

seed-demo: ## Seed the rich demo dataset (deterministic dev PAT); refuses a non-PGlite DATABASE_URL unless FORCE=1
	@if [ ! -f .env ]; then \
		echo "No .env found — run: cp .env.example .env"; exit 1; \
	fi
	@db_url=$$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-); \
	case "$$db_url" in \
		pglite://*) ;; \
		*) if [ -z "$(FORCE)" ]; then \
			echo "Refusing: .env's DATABASE_URL is not pglite:// ($$db_url)."; \
			echo "seed-demo deletes/reinserts rows by email plus global instrument rows by"; \
			echo "symbol — running it against a real database is destructive. Override with"; \
			echo "FORCE=1 if you really mean it."; \
			exit 1; \
		   fi ;; \
	esac
	npm run db:seed-demo --workspace @portfolio/api

seed-demo-login: ## Seed demo data with local-password login instead of DEV_AUTH_TOKEN (requires SEED_DEMO_PASSWORD; see AUTH_LOCAL_SECRET)
	@if [ -z "$(SEED_DEMO_PASSWORD)" ]; then \
		echo "Set SEED_DEMO_PASSWORD, e.g.: make seed-demo-login SEED_DEMO_PASSWORD=changeme"; exit 1; \
	fi
	SEED_DEMO_EMAIL="$${SEED_DEMO_EMAIL:-demo@pocket.invalid}" SEED_DEMO_PASSWORD="$(SEED_DEMO_PASSWORD)" $(MAKE) seed-demo

dev-reset: ## Delete the PGlite dev database + local folder storage (next make dev re-creates + auto-migrates)
	rm -rf .pglite-dev services/api/.pglite-dev .storage services/api/.storage

dev-clean-legacy-volumes: ## One-time cleanup: remove dev Postgres/MinIO volumes orphaned by #658's compose project split
	docker volume rm pocket-portfolio-tracker_pgdata pocket-portfolio-tracker_miniodata

test: ## Run tests
	npm run test

test-coverage: ## Run tests with coverage
	npm run test:coverage

lint: ## Run linter
	npm run lint

typecheck: ## Run type checking
	npm run typecheck

format: ## Format with Prettier
	npm run format

build: ## Production build
	npm run build

clean: ## Remove node_modules and build/cache artifacts (all workspaces)
	rm -rf node_modules **/node_modules **/dist **/.next **/.turbo **/coverage .vitest-cache .turbo
