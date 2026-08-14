# Home Guardian — task runner. Run `make help` to list targets.
PAGES_PROJECT ?= home-guardian
COMPOSE := docker compose

.PHONY: help
help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install backend + frontend dependencies
	cd backend && npm install
	cd frontend && npm install

.PHONY: test
test: ## Run backend unit tests
	cd backend && npm test

.PHONY: build
build: ## Build backend + frontend
	cd backend && npm run build
	cd frontend && npm run build

.PHONY: dev-api
dev-api: ## Run the backend in watch mode (:3001)
	cd backend && npm run start:dev

.PHONY: dev-web
dev-web: ## Run the dashboard dev server (:5173)
	cd frontend && npm run dev

.PHONY: up
up: ## Start the full home stack (Postgres + AdGuard + API + web)
	$(COMPOSE) up -d --build

.PHONY: down
down: ## Stop the stack
	$(COMPOSE) down

.PHONY: logs
logs: ## Tail stack logs
	$(COMPOSE) logs -f

.PHONY: tunnel
tunnel: ## Start the Cloudflare Tunnel (needs TUNNEL_TOKEN in .env)
	$(COMPOSE) --profile cloudflare up -d

.PHONY: deploy-cloudflare
deploy-cloudflare: ## Build + deploy the dashboard to Cloudflare Pages
	@set -a; [ -f .env ] && . ./.env; set +a; \
	API="$${VITE_API_BASE:-$(VITE_API_BASE)}"; \
	if [ -z "$$API" ]; then \
	  echo "ERROR: VITE_API_BASE is not set — your API's public URL (e.g. https://api.example.com)."; \
	  echo "Set it in .env, or: make deploy-cloudflare VITE_API_BASE=https://api.example.com"; \
	  exit 1; \
	fi; \
	if [ -z "$$CLOUDFLARE_API_TOKEN" ]; then \
	  echo "note: CLOUDFLARE_API_TOKEN not set — wrangler will open an interactive login."; \
	fi; \
	echo "==> Building dashboard (VITE_API_BASE=$$API)"; \
	( cd frontend && npm ci && VITE_API_BASE="$$API" npm run build ) || exit 1; \
	echo "==> Deploying to Cloudflare Pages project '$(PAGES_PROJECT)'"; \
	( cd frontend && npx --yes wrangler@3 pages deploy dist \
	    --project-name=$(PAGES_PROJECT) --branch=main )
