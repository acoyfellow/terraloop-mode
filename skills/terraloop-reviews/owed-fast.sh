#!/usr/bin/env bash
set -uo pipefail
: "${GITLAB_HOST:?set GITLAB_HOST}"
recipe=${REVIEW_RECIPE_ROOT:?set REVIEW_RECIPE_ROOT}
gate=$HOME/.pi/agent/git/github.com/acoyfellow/terraloop-mode/skills/terraloop-reviews/gate.sh
out=/tmp/rv/owed-fast
rm -rf "$out"
mkdir -p "$out/rows"
me=$(glab api user | jq -r .username)
skip_title='(ship|conversation) digest|^\[ucascade\]|Auto MR'
{
  glab api --paginate "merge_requests?state=opened&scope=all&reviewer_username=$me&per_page=100"
  glab api --paginate "merge_requests?state=opened&scope=all&assignee_username=$me&per_page=100"
  while IFS= read -r project; do
    [ -n "$project" ] || continue
    glab api --paginate "projects/$(jq -rn --arg v "$project" '$v|@uri')/merge_requests?state=opened&per_page=100"
  done < "$recipe/projects.txt"
} | jq -rs --arg me "$me" --arg st "$skip_title" '
  add // [] | unique_by(.web_url) | map(select(
    (.draft | not) and .author.username != $me and (.title | test($st; "i") | not)
  )) | .[] | (.web_url | capture("gitlab[^/]*/(?<p>.+)/-/merge_requests/(?<i>[0-9]+)") | "\(.p)!\(.i)")' > "$out/refs"
check_one() {
  ref=$1
  name=$(printf '%s' "$ref" | tr '/!' '__')
  perl -e 'alarm 90; exec @ARGV' bash "$gate" "$ref" > "$out/rows/$name" 2>&1 || true
  [ -s "$out/rows/$name" ] || echo "TIMEOUT $ref" > "$out/rows/$name"
}
export -f check_one
export gate out
xargs -P 8 -I{} bash -c 'check_one "$@"' _ {} < "$out/refs"
cat "$out"/rows/* | grep -vE '^(PASS|FAIL [0-9]|owed=)' | sort -u > "$out/all"
grep -vE '^(ok|HUMAN) ' "$out/all"
echo "candidates=$(wc -l < "$out/refs" | tr -d ' ')"
echo "owed=$(grep -cE '^(OWED|STALE|ASKED|UNBLOCKED|TIMEOUT) ' "$out/all")"
