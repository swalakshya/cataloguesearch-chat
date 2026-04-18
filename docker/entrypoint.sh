#!/bin/bash
set -e

mkdir -p /app/data /app/logs

exec "$@"
