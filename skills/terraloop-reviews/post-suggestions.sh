#!/usr/bin/env bash
set -uo pipefail

usage() {
  cat <<'EOF'
usage: post-suggestions.sh <group/project> <iid> <review-dir> [--dry-run]

Reads <review-dir>/suggestions.jsonl, one JSON object per line:
  {"path":"src/x.ts","line":42,"body":"Why this matters.","replacement":"new line text","old_line_count":0}

Posts each as a diff discussion on the new side of <path>:<line> with a
GitLab ```suggestion:-N+0 block, so the author can apply it in one click.
Refuses to post when the MR head moved since <review-dir>/mr.json was written.
Writes posted discussion ids to <review-dir>/suggestions-posted.txt.
EOF
}

[ -n "${3:-}" ] || { usage; exit 2; }
project=$1; iid=$2; dir=$3; dry=${4:-}
enc=$(printf '%s' "$project" | jq -sRr @uri)
file="$dir/suggestions.jsonl"
[ -f "$file" ] || { echo "no $file"; exit 2; }

recorded_head=$(jq -r .sha "$dir/mr.json")
live=$(glab api "projects/$enc/merge_requests/$iid")
live_head=$(printf '%s' "$live" | jq -r .sha)
live_state=$(printf '%s' "$live" | jq -r .state)
[ "$live_state" = opened ] && [ "$live_head" = "$recorded_head" ] || {
  echo "SKIP state=$live_state recorded=$recorded_head live=$live_head"; exit 1; }
base_sha=$(printf '%s' "$live" | jq -r .diff_refs.base_sha)
start_sha=$(printf '%s' "$live" | jq -r .diff_refs.start_sha)

suggestion_body() {
  local row=$1 body replacement above
  body=$(printf '%s' "$row" | jq -r .body)
  replacement=$(printf '%s' "$row" | jq -r .replacement)
  above=$(printf '%s' "$row" | jq -r '.old_line_count // 0')
  printf '%s\n\n```suggestion:-%s+0\n%s\n```\n' "$body" "$above" "$replacement"
}

: > "$dir/suggestions-posted.txt"
count=0
while IFS= read -r row; do
  [ -n "$row" ] || continue
  path=$(printf '%s' "$row" | jq -r .path)
  line=$(printf '%s' "$row" | jq -r .line)
  text=$(suggestion_body "$row")
  count=$((count + 1))
  if [ "$dry" = "--dry-run" ]; then
    printf -- '--- %s:%s\n%s\n' "$path" "$line" "$text"
    continue
  fi
  id=$(glab api -X POST "projects/$enc/merge_requests/$iid/discussions" \
    -f "body=$text" \
    -f "position[position_type]=text" \
    -f "position[base_sha]=$base_sha" \
    -f "position[start_sha]=$start_sha" \
    -f "position[head_sha]=$live_head" \
    -f "position[new_path]=$path" \
    -f "position[old_path]=$path" \
    -f "position[new_line]=$line" | jq -r '.id // empty')
  [ -n "$id" ] || { echo "FAILED $path:$line"; exit 1; }
  echo "$id $path:$line" >> "$dir/suggestions-posted.txt"
done < "$file"
echo "suggestions=$count $([ "$dry" = --dry-run ] && echo dry-run || echo posted)"
