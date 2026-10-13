#!/usr/bin/env bash
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage: recipe-gate.sh <group/project> <iid> [--dry-run]

Checks one review against the educational review recipe. Evidence lives in
${REVIEW_RECIPE_DIR:-/tmp/rv/recipe}/<iid>/. Exit 0 only when every gate passes.

Gates:
  freshness      mr.json head == live head, MR still open
  pass1          p1.md names the live head and records tests
  blast          blast.md names the live head
  pass2          p2.out ends a line with VERDICT:
  reconcile      reconcile.md names the live head
  convergence    p3.out has a VERDICT: line
  repro          REPRO_CMD (from teach/repro.env) exits non-zero at head
  lesson         note.md: visible lines (outside <details>) <= 25, has a
                 mermaid block or image, a "Run it" command, and a
                 reviewed-sha:/review-blocked: line with the live head
  posted         (skipped with --dry-run) a jcoeyman note on the MR carries
                 reviewed-sha:<live head>; receipt.md exists
EOF
  exit 2
}

[ -n "${2:-}" ] || usage
project=$1
iid=$2
dry_run=0
[ "${3:-}" = "--dry-run" ] && dry_run=1
dir=${REVIEW_RECIPE_DIR:-/tmp/rv/recipe}/$iid
encoded=$(printf '%s' "$project" | sed 's|/|%2F|g')
failures=0

pass() { printf 'ok   %-12s %s\n' "$1" "$2"; }
fail() { printf 'FAIL %-12s %s\n' "$1" "$2"; failures=$((failures + 1)); }

live=$(glab api "projects/$encoded/merge_requests/$iid")
live_head=$(printf '%s' "$live" | jq -r .sha)
live_state=$(printf '%s' "$live" | jq -r .state)

recorded_head=$(jq -r .sha "$dir/mr.json" 2>/dev/null)
if [ "$live_state" = opened ] && [ "$recorded_head" = "$live_head" ]; then
  pass freshness "$live_head"
else
  fail freshness "state=$live_state recorded=$recorded_head live=$live_head"
fi

names_head() { grep -q "$live_head" "$dir/$1" 2>/dev/null; }

if names_head p1.md && grep -qi '^tests:' "$dir/p1.md"; then pass pass1 p1.md; else fail pass1 "p1.md missing head or tests line"; fi
if names_head blast.md; then pass blast blast.md; else fail blast "blast.md missing head"; fi
if grep -q '^VERDICT:' "$dir/p2.out" 2>/dev/null; then pass pass2 "$(grep '^VERDICT:' "$dir/p2.out" | tail -1)"; else fail pass2 "no VERDICT line"; fi
if names_head reconcile.md; then pass reconcile reconcile.md; else fail reconcile "reconcile.md missing head"; fi
if grep -q '^VERDICT:' "$dir/p3.out" 2>/dev/null; then pass convergence "$(grep '^VERDICT:' "$dir/p3.out" | tail -1)"; else fail convergence "no VERDICT line"; fi

if [ -f "$dir/teach/repro.env" ]; then
  REPRO_CMD=""
  REPRO_CWD=""
  . "$dir/teach/repro.env"
  if [ ! -d "$REPRO_CWD" ]; then
    fail repro "repro directory missing: $REPRO_CWD"
  elif (cd "$REPRO_CWD" && sh -c "$REPRO_CMD" >/dev/null 2>&1); then
    fail repro "repro passes at head; it must fail"
  else
    pass repro "fails at head"
  fi
else
  pass repro "no findings (teach/repro.env absent)"
fi

note=$dir/note.md
if [ -f "$note" ]; then
  visible=$(awk '/<details>/{hidden=1} !hidden && NF{count++} /<\/details>/{hidden=0} END{print count+0}' "$note")
  problems=""
  [ "$visible" -le 25 ] || problems="$problems visible=$visible>25"
  grep -qE '```mermaid|!\[' "$note" || problems="$problems no-visual"
  grep -q 'Run it' "$note" || problems="$problems no-run-it"
  grep -qE "^(reviewed-sha|review-blocked):.*$live_head" "$note" || problems="$problems no-sha-footer"
  if [ -z "$problems" ]; then pass lesson "visible=$visible"; else fail lesson "$problems"; fi
else
  fail lesson "note.md missing"
fi

if [ "$dry_run" = 1 ]; then
  printf 'skip %-12s %s\n' posted "--dry-run"
else
  me=$(glab api user | jq -r .username)
  posted=$(glab api "projects/$encoded/merge_requests/$iid/notes?per_page=100&sort=desc" \
    | jq -r --arg me "$me" --arg head "$live_head" \
      '[.[] | select(.author.username == $me and (.body | test("reviewed-sha: " + $head)))] | length')
  if [ "${posted:-0}" -ge 1 ] && [ -f "$dir/receipt.md" ]; then
    pass posted "note on $live_head, receipt present"
  else
    fail posted "notes=$posted receipt=$([ -f "$dir/receipt.md" ] && echo yes || echo no)"
  fi
fi

[ "$failures" -eq 0 ] && { echo PASS; exit 0; }
echo "FAIL $failures gate(s)"
exit 1
