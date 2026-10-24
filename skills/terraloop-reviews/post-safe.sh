#!/usr/bin/env bash
set -uo pipefail
[ -n "${2:-}" ] || { echo "usage: PROJECT=group/project post-safe.sh <iid> \"<verdict>\"" >&2; exit 2; }
: "${PROJECT:?set PROJECT=group/project}"
iid=$1
verdict=$2
dir=${REVIEW_RECIPE_DIR:-/tmp/rv/recipe}/$iid
receipts=${REVIEW_RECEIPT_DIR:-$HOME/.review-receipts}
here=$(cd "$(dirname "$0")" && pwd)
encoded=$(printf '%s' "$PROJECT" | sed 's|/|%2F|g')
cd "$dir" || exit 2
head=$(jq -r .sha mr.json)
dry=$(bash "$here/recipe-gate.sh" "$PROJECT" "$iid" --dry-run 2>&1 | tail -1)
[ "$dry" = PASS ] || { echo "$iid SKIP recipe-gate=$dry"; exit 1; }
live=$(glab api "projects/$encoded/merge_requests/$iid" | jq -r '.state+" "+.sha')
[ "$live" = "opened $head" ] || { echo "$iid SKIP head moved: $live"; exit 1; }
body_file=note.md
if [ -f lantern/steps.png ] && [ "${REVIEW_SKIP_LANTERN:-0}" != 1 ]; then
  upload=$(GITLAB_HOST="${GITLAB_HOST:?set GITLAB_HOST}" bash "$here/lantern/upload.sh" "$PROJECT" lantern/steps.png 2>&1 | tail -1)
  case "$upload" in
    "!["*) ;;
    *) echo "$iid SKIP lantern upload failed: $upload"; exit 1 ;;
  esac
  echo "$upload" > lantern/upload.md
  python3 "$here/lantern/embed.py" note.md "$upload" > note.posted.md
  body_file=note.posted.md
fi
note=$(glab api -X POST "projects/$encoded/merge_requests/$iid/notes" -F "body=@$body_file" | jq -r .id)
[ -n "$note" ] && [ "$note" != null ] || { echo "$iid POST FAILED"; exit 1; }
echo "$note" > note-id.txt
approvers=$(glab api "projects/$encoded/merge_requests/$iid/approvals" | jq -r '[.approved_by[].user.username]|join(",")')
printf 'VERDICT: %s\nHEAD: %s\nNOTE: %s\nAPPROVALS: %s\n' "$verdict" "$head" "$note" "$approvers" > receipt.md
mkdir -p "$receipts"
cp receipt.md "$receipts/$(basename "$PROJECT")-mr-$iid-receipt.md"
bash "$here/recipe-gate.sh" "$PROJECT" "$iid" > gate-final.out 2>&1
echo "$iid note=$note approvers=$approvers $(tail -1 gate-final.out)"
