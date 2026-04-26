# Web-Access — common dev/ops shortcuts.
# Use: `make <target>` (Linux/macOS) or `wsl make <target>` on Windows.
.DEFAULT_GOAL := help

SHELL := /bin/bash
COMPOSE := docker compose --env-file infra/.env -f infra/docker-compose.yml

# ---------- meta ----------
help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_.-]+:.*?## / {printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------- local dev ----------
install: ## Install all node deps (signaling, web-client, host-electron)
	cd signaling-server && npm install
	cd web-client && npm install
	cd host-electron && npm install

dev-signaling: ## Run signaling server in watch mode
	cd signaling-server && npm run dev

dev-web: ## Run Next.js web client in dev mode
	cd web-client && npm run dev

dev-host: ## Run the Electron host
	cd host-electron && npm start

# ---------- production stack (on the VPS) ----------
deploy: ## Build & start full stack (postgres, signaling, web, caddy, coturn)
	$(COMPOSE) up -d --build

deploy-pull: ## Pull latest code, rebuild changed services, zero-downtime restart
	git pull --ff-only
	$(COMPOSE) up -d --build --no-deps signaling web-client

down: ## Stop the full stack
	$(COMPOSE) down

logs: ## Tail logs from all services
	$(COMPOSE) logs -f --tail=200

ps: ## Show running services
	$(COMPOSE) ps

restart-signaling: ## Restart the signaling service only
	$(COMPOSE) restart signaling

restart-web: ## Restart the web client only
	$(COMPOSE) restart web-client

# ---------- ops ----------
verify: ## Hit /healthz, /ice and TURN to verify the stack
	bash infra/verify-vps.sh

backup-db: ## Dump the postgres database to ./backups/
	mkdir -p backups
	$(COMPOSE) exec -T postgres pg_dump -U webaccess webaccess \
		> backups/webaccess-$$(date +%Y%m%d-%H%M%S).sql
	@echo "[backup] saved to backups/"

shell-db: ## Open a psql shell inside the postgres container
	$(COMPOSE) exec postgres psql -U webaccess webaccess

# ---------- CI helpers ----------
build: ## Build all docker images (no start)
	$(COMPOSE) build

lint: ## Lint the web-client (next lint)
	cd web-client && npm run lint

.PHONY: help install dev-signaling dev-web dev-host deploy deploy-pull down logs ps restart-signaling restart-web verify backup-db shell-db build lint
