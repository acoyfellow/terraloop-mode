#!/usr/bin/env bash
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage: recipe-gate.sh <experiment-id> [--dry-run]

Checks one rank experiment against the recipe. Evidence lives in
${RANK_REPO:-~/cloudflare/rank}/experiments/<id>/. Exit 0 only when every gate passes.
With --dry-run, only steps 1-4 (research to baseline) are required.
EOF
  exit 2
}

[ -n "${1:-}" ] || usage
id=$1
dry=${2:-}
repo=${RANK_REPO:-$HOME/cloudflare/rank}
site_repo=${RANK_SITE_REPO:-$HOME/cloudflare/coey.dev}
exp="$repo/experiments/$id"
fail=0

check() {
  if eval "$2" >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; fail=$((fail + 1)); fi
}

check research "grep -q '^## Gap' '$exp/research.md' && grep -qiE 'graphql|ai search|crawl|web search|request log' '$exp/research.md'"
check hypothesis "jq -e '.hypothesis and .metric and .target and (.control|length>0) and .windowDays>=14' '$exp/experiment.json'"
check commit "git -C '$site_repo' cat-file -e \"\$(jq -r .commit '$exp/experiment.json')^{commit}\""
check baseline "jq -e '(.rows|length>0) and .windowEnd' '$exp/baseline.json'"

if [ "$dry" != "--dry-run" ]; then
  check after "jq -e --slurpfile b '$exp/baseline.json' '(.rows|length>0) and .windowDays == \$b[0].windowDays' '$exp/after.json'"
  check verdict "cd '$repo' && bun run iterate verdict '$id' --check"
  check receipt "grep -q \"COMMIT\" '$exp/receipt.md' && grep -q 'VERDICT' '$exp/receipt.md'"
fi

[ "$fail" -eq 0 ] && echo "experiment $id: all gates passed" || echo "experiment $id: $fail gate(s) failed"
[ "$fail" -eq 0 ]
