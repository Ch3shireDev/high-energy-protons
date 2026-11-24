#!/usr/bin/env bash
# Build Pythii 8 do WebAssembly w Dockerze (emscripten/emsdk).
# Wynik: wasm/dist/{pythia.mjs,pythia.wasm,pythia.data,build-info.json}
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# shellcheck source=pythia-version.env
source "$HERE/pythia-version.env"
IMAGE="hep-pythia-wasm:${PYTHIA_VERSION}-emsdk${EMSDK_VERSION}"

docker build -q \
  --build-arg EMSDK_VERSION="$EMSDK_VERSION" \
  --build-arg PYTHIA_VERSION="$PYTHIA_VERSION" \
  --build-arg PYTHIA_SHA256="$PYTHIA_SHA256" \
  -t "$IMAGE" "$HERE" >/dev/null

docker run --rm \
  -u "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e EM_CACHE=/src/wasm/.cache/emcache \
  -e PYTHIA_VERSION="$PYTHIA_VERSION" \
  -e EMSDK_VERSION="$EMSDK_VERSION" \
  -v "$ROOT":/src \
  "$IMAGE" bash /src/wasm/build-inner.sh
