#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
bun run check
bun evals/full-stop/run.ts --require-frozen --require-baseline-below-half
