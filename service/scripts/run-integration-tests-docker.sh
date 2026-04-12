#!/usr/bin/env sh
set -e

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.test.yml" up --build --abort-on-container-exit --exit-code-from integration-tests
