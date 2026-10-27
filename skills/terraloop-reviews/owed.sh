#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
: "${GITLAB_HOST:?set GITLAB_HOST}"
list="${REVIEW_PROJECTS_FILE:-$HOME/cloudflare/.context/reviews/recipe/projects.txt}"
[ -s "$list" ] || { echo "FAIL no project list at $list"; exit 2; }
args=()
while IFS= read -r p; do [ -n "$p" ] && args+=(--project "$p"); done < "$list"
exec bash "$here/gate.sh" --queue "${args[@]}" \
  --skip-title '(ship|conversation) digest' \
  --human-title '^(Release |\[ucascade\])'
