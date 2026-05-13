#!/usr/bin/env bash
set -euo pipefail

cargo build --target wasm32-unknown-unknown --release --lib
node scripts/copy-wasm.mjs
node scripts/prebuild-cache.mjs
