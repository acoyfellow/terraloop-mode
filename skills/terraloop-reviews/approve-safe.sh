#!/usr/bin/env bash
set -uo pipefail
[ -n "${1:-}" ] || { echo "usage: PROJECT=group/project approve-safe.sh <iid>" >&2; exit 2; }
: "${PROJECT:?set PROJECT=group/project}"
iid=$1
dir=${REVIEW_RECIPE_DIR:-$HOME/cloudflare/.context/reviews/recipe}/$iid
encoded=$(printf '%s' "$PROJECT" | sed 's|/|%2F|g')
api="projects/$encoded/merge_requests/$iid"
cd "$dir" || exit 2
head=$(jq -r .sha mr.json)
grep -q "^HEAD: $head$" receipt.md 2>/dev/null || { echo "$iid NO-APPROVE: no posted note for $head"; exit 1; }
note_id=$(cat note-id.txt 2>/dev/null)
glab api "$api/notes/$note_id" | jq -e --arg h "$head" '.body | contains("reviewed-sha: " + $h)' >/dev/null || { echo "$iid NO-APPROVE: note $note_id lacks reviewed-sha $head"; exit 1; }
read -r live pipe < <(glab api "$api" | jq -r '"\(.sha) \(.head_pipeline.status)"')
[ "$live" = "$head" ] || { echo "$iid NO-APPROVE: head moved to $live"; exit 1; }
[ "$pipe" = success ] || { echo "$iid NO-APPROVE: pipeline $pipe"; exit 1; }
open=$(glab api "$api/discussions?per_page=100" | jq '[.[]|select(.notes[0].resolvable and (.notes[0].resolved|not) and (.notes[0].author.username|test("bot|gsa_")|not) and .notes[0].author.username!="jcoeyman")]|length')
[ "$open" = 0 ] || { echo "$iid NO-APPROVE: $open open human thread(s)"; exit 1; }
glab api -X POST "$api/approve" -f sha="$head" >/dev/null 2>&1 || true
approvers=$(glab api "$api/approvals" | jq -r '[.approved_by[].user.username]|join(",")')
case ",$approvers," in *,jcoeyman,*) echo "$iid APPROVED approvers=$approvers" ;; *) echo "$iid APPROVE FAILED approvers=$approvers"; exit 1 ;; esac
