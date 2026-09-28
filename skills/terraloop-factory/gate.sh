#!/usr/bin/env bash
set -uo pipefail

repo="${FACTORY_REPO:-acoyfellow/my-ax}"
test_pattern='(^|/)(test|tests|__tests__)/|\.(test|spec)\.[cm]?[jt]sx?$'

[ "$#" -gt 0 ] || { echo "usage: gate.sh <issue>..." >&2; exit 2; }
command -v gh >/dev/null || { echo "FAIL gh is not installed"; exit 1; }
command -v jq >/dev/null || { echo "FAIL jq is not installed"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "FAIL gh is not authenticated"; exit 1; }

closes_issue() {
  jq -r --argjson n "$1" '
    [.[] | select(.body // "" | test("(?i)\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#" + ($n|tostring) + "\\b"))]
    | .[0].number // empty'
}

failures=0
for n in "$@"; do
  case "$n" in
    ''|*[!0-9]*) echo "#$n FAIL not an issue number"; failures=$((failures + 1)); continue ;;
  esac
  issue=$(gh issue view "$n" -R "$repo" --json state,labels 2>/dev/null)
  if [ -z "$issue" ]; then
    echo "#$n FAIL cannot read issue"
    failures=$((failures + 1))
    continue
  fi
  state=$(printf '%s' "$issue" | jq -r '.state')
  if [ "$state" = "CLOSED" ]; then echo "#$n ok closed"; continue; fi
  if printf '%s' "$issue" | jq -e '[.labels[].name] | index("triage:needs-human") != null' >/dev/null; then
    echo "#$n ok needs-human"
    continue
  fi
  pr=$(gh pr list -R "$repo" --state open --search "#$n in:body" --json number,body --limit 50 2>/dev/null | closes_issue "$n")
  if [ -z "$pr" ]; then
    echo "#$n FAIL no open PR that closes #$n"
    failures=$((failures + 1))
    continue
  fi
  files=$(gh pr view "$pr" -R "$repo" --json files -q '.files[].path' 2>/dev/null)
  test_files=$(printf '%s\n' "$files" | grep -cE "$test_pattern")
  source_files=$(printf '%s\n' "$files" | grep -vE "$test_pattern" | grep -c .)
  if [ "$test_files" -eq 0 ]; then
    echo "#$n FAIL PR #$pr changes no test file"
    failures=$((failures + 1))
    continue
  fi
  if [ "$source_files" -eq 0 ]; then
    echo "#$n FAIL PR #$pr changes only tests"
    failures=$((failures + 1))
    continue
  fi
  if ! gh pr checks "$pr" -R "$repo" >/dev/null 2>&1; then
    echo "#$n FAIL PR #$pr checks not green"
    failures=$((failures + 1))
    continue
  fi
  echo "#$n ok PR #$pr green, $test_files test file(s)"
done

[ "$failures" -eq 0 ]
