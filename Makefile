.PHONY: help test test-unit test-integration test-all mock-api-start mock-api-stop mock-api-logs clean

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

test: test-unit ## Run unit tests (default)

test-unit: ## Run unit tests only (no Docker required)
	npm run test:unit

test-integration: ## Run integration tests with mock API
	npm run test:integration

test-all: ## Run all tests (unit + integration)
	npm run test:all

mock-api-start: ## Start mock API container
	@echo "Starting mock API container..."
	@docker compose -f docker-compose.test.yml up -d
	@printf "Waiting for mock API to be healthy..."
	@i=0; while [ $$i -lt 30 ]; do \
		status=$$(docker inspect --format="{{.State.Health.Status}}" quant-mock-api-test 2>/dev/null || echo "starting"); \
		if [ "$$status" = "healthy" ]; then \
			printf "\n✅ Mock API is running at http://localhost:4010\n\n"; \
			printf "Test it:\n  curl http://localhost:4010/api/v3/organisations/test-org/applications\n"; \
			exit 0; \
		fi; \
		printf "."; \
		sleep 1; \
		i=$$((i + 1)); \
	done; \
	printf "\n❌ Mock API failed to start\n"; \
	docker logs quant-mock-api-test 2>&1 | tail -20; \
	exit 1

mock-api-stop: ## Stop mock API container
	docker compose -f docker-compose.test.yml down -v

mock-api-logs: ## Show mock API logs
	docker compose -f docker-compose.test.yml logs -f

clean: ## Clean build artifacts and stop containers
	npm run clean
	docker compose -f docker-compose.test.yml down -v 2>/dev/null || true
	rm -rf coverage node_modules/.cache

