#!/usr/bin/env bash
set -euo pipefail

cargo build --target wasm32-unknown-unknown --release --lib
node scripts/embed-wasm.mjs
node scripts/prebuild-cache.mjs
