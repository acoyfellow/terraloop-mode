#!/usr/bin/env bash
set -uo pipefail

usage() {
  echo "usage: gate.sh <group/project!iid>..." >&2
  echo "  passes when every MR has, from the current GitLab user, either" >&2
  echo "  an approval, or a note containing 'reviewed-sha: <current head sha>'," >&2
  echo "  or a note containing 'review-blocked:'" >&2
  exit 2
}

[ "$#" -gt 0 ] || usage
command -v glab >/dev/null || { echo "FAIL glab is not installed"; exit 1; }
command -v jq >/dev/null || { echo "FAIL jq is not installed"; exit 1; }

me=$(glab api user 2>/dev/null | jq -r '.username // empty')
[ -n "$me" ] || { echo "FAIL glab is not authenticated"; exit 1; }

urlencode() {
  jq -rn --arg value "$1" '$value|@uri'
}

failures=0
for ref in "$@"; do
  case "$ref" in
    *!*) ;;
    *) echo "$ref FAIL expected group/project!iid"; failures=$((failures + 1)); continue ;;
  esac
  project=$(urlencode "${ref%!*}")
  iid=$(printf "%s" "$ref" | sed "s/.*!//")
  mr=$(glab api "projects/$project/merge_requests/$iid" 2>/dev/null)
  head=$(printf '%s' "$mr" | jq -r '.sha // empty')
  if [ -z "$head" ]; then
    echo "$ref FAIL cannot read MR"
    failures=$((failures + 1))
    continue
  fi
  notes=$(glab api --paginate "projects/$project/merge_requests/$iid/notes?per_page=100" 2>/dev/null | jq -s 'add // []')
  mine=$(printf '%s' "$notes" | jq --arg me "$me" '[.[] | select(.author.username == $me) | .body]')
  if printf '%s' "$mine" | jq -e 'any(test("review-blocked:"))' >/dev/null; then
    echo "$ref ok blocked"
    continue
  fi
  if printf '%s' "$mine" | jq -e --arg sha "$head" 'any(contains("reviewed-sha: " + $sha))' >/dev/null; then
    echo "$ref ok reviewed ${head:0:12}"
    continue
  fi
  approved=$(glab api "projects/$project/merge_requests/$iid/approvals" 2>/dev/null | jq -r --arg me "$me" '[.approved_by[]?.user.username] | index($me) != null')
  if [ "$approved" = "true" ]; then
    echo "$ref ok approved"
    continue
  fi
  echo "$ref FAIL no review bound to head ${head:0:12}"
  failures=$((failures + 1))
done

[ "$failures" -eq 0 ]
