#!/usr/bin/env bash
# SurfGen installer — prerequisites, dependencies, database, first-run setup.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }

bold "SurfGen installer"

# ---------------------------------------------------------------- prerequisites
command -v node >/dev/null 2>&1 || fail "Node.js 22+ is required (https://nodejs.org)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 22+ required, found $(node --version)"
ok "Node $(node --version)"

if ! command -v pnpm >/dev/null 2>&1; then
  bold "Enabling pnpm via corepack…"
  corepack enable && corepack prepare pnpm@10.12.1 --activate
fi
ok "pnpm $(pnpm --version)"

if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg found — local rendering enabled"
else
  echo "⚠ ffmpeg not found. Local rendering requires it: brew install ffmpeg / apt install ffmpeg"
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  DOCKER_AVAILABLE=1
  ok "Docker running"
else
  DOCKER_AVAILABLE=0
  echo "⚠ Docker not running — infrastructure services must be provided manually"
fi

# ----------------------------------------------------------------- dependencies
bold "Installing workspace dependencies…"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
ok "dependencies installed"

# -------------------------------------------------------------------------- env
if [ ! -f .env ]; then
  cp .env.example .env
  ok "created .env from .env.example"
fi
set -a; source .env; set +a

# --------------------------------------------------------------- infrastructure
if [ "$DOCKER_AVAILABLE" = "1" ]; then
  bold "Starting infrastructure (postgres, redis, rabbitmq, minio)…"
  docker compose -f infra/docker/docker-compose.dev.yml up -d --wait
  ok "infrastructure up"
fi

# -------------------------------------------------------------------- database
bold "Preparing database…"
pnpm --filter @surfgen/db generate
if pnpm --filter @surfgen/db exec prisma migrate deploy 2>/dev/null; then
  ok "migrations applied"
else
  echo "No migrations yet — creating initial migration…"
  pnpm --filter @surfgen/db exec prisma migrate dev --name init --skip-seed
  ok "initial migration created + applied"
fi
pnpm --filter @surfgen/db seed || true

# ------------------------------------------------------------------------ build
bold "Building all packages…"
pnpm turbo build
ok "build complete"

bold "SurfGen is ready."
cat <<'NEXT'

  Start the platform:
    pnpm --filter @surfgen/api start          # API on :4000 (docs at /docs)
    pnpm --filter @surfgen/worker-pipeline start

  Zero-credential demo: the default config uses only local providers
  (piper/ollama when present, deterministic mocks otherwise).

  MinIO console:   http://127.0.0.1:9001   (surfgen / surfgen-dev)
  RabbitMQ UI:     http://127.0.0.1:15672  (surfgen / surfgen-dev)
NEXT
