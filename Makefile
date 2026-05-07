.PHONY: dev serve ensure-bun

BUN ?= $(shell \
	if command -v bun >/dev/null 2>&1; then \
		command -v bun; \
	elif [ -x /opt/homebrew/bin/bun ]; then \
		printf '%s\n' /opt/homebrew/bin/bun; \
	elif [ -x "$$HOME/.bun/bin/bun" ]; then \
		printf '%s\n' "$$HOME/.bun/bin/bun"; \
	fi)

ensure-bun:
	@test -n "$(BUN)" || (echo "bun not found. Install bun or add it to PATH." >&2; exit 127)

dev: ensure-bun
	PATH="$(dir $(BUN)):$$PATH"; export PATH; cd web && "$(BUN)" dev.ts

serve: ensure-bun
	PATH="$(dir $(BUN)):$$PATH"; export PATH; cd web && "$(BUN)" serve.ts
