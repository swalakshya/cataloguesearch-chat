#!/usr/bin/env sh
set -e

IMAGE_NAME="cataloguesearch-chat-service-tests"

docker build -t "$IMAGE_NAME" -f Dockerfile.test .
docker run --rm "$IMAGE_NAME"
