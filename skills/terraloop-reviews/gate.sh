#!/usr/bin/env bash
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage:
  gate.sh --queue [--project group/project]... [--skip-title REGEX] [--skip-author REGEX] [--human-title REGEX]
  gate.sh <group/project!iid>...

--queue discovers the live queue on every run: open, non-draft MRs where the
current user is reviewer or assignee, plus every open non-draft MR in each
--project. It skips self-authored MRs and titles/authors matching the skip
regexes. Titles matching --human-title are listed as HUMAN and do not fail.

An MR is done when the current user has, bound to the CURRENT head sha:
  an approval plus a note with 'reviewed-sha: <head>', or
  a note with 'reviewed-sha: <head>', or
  a note with 'review-blocked:' that also contains '<head>'.
An approval with no note at the current head is STALE after a new push.
A review at the current head is ASKED when, after the user's latest review note,
someone re-requests the user's review, @mentions the user, or replies in a
thread the user started. Bots are ignored.

A review at the current head is UNBLOCKED when the user's latest review note
withheld approval because of other people's threads or CI ('review-waiting-on:'
or 'not approving'), the user has not approved, the head pipeline is not failed,
and no person other than the user now has an unresolved thread.

Prints one line per MR: OWED, STALE, ASKED, UNBLOCKED, HUMAN, or ok. Exits 0
only when nothing is OWED, STALE, ASKED, or UNBLOCKED.
EOF
  exit 2
}

[ "$#" -gt 0 ] || usage
command -v glab >/dev/null || { echo "FAIL glab is not installed"; exit 1; }
command -v jq >/dev/null || { echo "FAIL jq is not installed"; exit 1; }

me=$(glab api user 2>/dev/null | jq -r '.username // empty')
[ -n "$me" ] || { echo "FAIL glab is not authenticated"; exit 1; }

urlencode() { jq -rn --arg value "$1" '$value|@uri'; }

queue_mode=false
projects=()
refs=()
skip_title='^$'
skip_author='^$'
human_title='^$'
while [ "$#" -gt 0 ]; do
  case "$1" in
    --queue) queue_mode=true ;;
    --project) shift; projects+=("$1") ;;
    --skip-title) shift; skip_title="$1" ;;
    --skip-author) shift; skip_author="$1" ;;
    --human-title) shift; human_title="$1" ;;
    -h|--help) usage ;;
    *!*) refs+=("$1") ;;
    *) echo "$1 FAIL expected group/project!iid"; exit 2 ;;
  esac
  shift
done

candidates_json() {
  {
    glab api --paginate "merge_requests?state=opened&scope=all&reviewer_username=$me&per_page=100" 2>/dev/null
    glab api --paginate "merge_requests?state=opened&scope=all&assignee_username=$me&per_page=100" 2>/dev/null
    for project in ${projects[@]+"${projects[@]}"}; do
      glab api --paginate "projects/$(urlencode "$project")/merge_requests?state=opened&per_page=100" 2>/dev/null
    done
  } | jq -s --arg me "$me" --arg st "$skip_title" --arg sa "$skip_author" --arg ht "$human_title" '
    add // [] | unique_by(.web_url) | map(select(
      (.draft | not) and (.work_in_progress | not) and .author.username != $me
      and (.title | test($st; "i") | not) and (.author.username | test($sa; "i") | not)
    )) | map({
      project_id, iid, sha, web_url, title, author: .author.username,
      human: (.title | test($ht; "i"))
    })'
}

asked_since_review() {
  local project_id="$1" iid="$2" raw="$3" since threads
  since=$(printf '%s' "$raw" | jq -rs --arg me "$me" '[add // [] | .[] | select(.author.username == $me and (.system | not) and (.body | contains("reviewed-sha: "))) | .created_at] | max // empty')
  [ -n "$since" ] || return 1
  if printf '%s' "$raw" | jq -es --arg me "$me" --arg since "$since" '
    [add // [] | .[] | select(.created_at > $since and (.author.username | test("bot|^gsa_") | not) and .author.username != $me)
      | select((.system and (.body | test("requested review from .*@" + $me))) or ((.system | not) and (.body | test("@" + $me + "\\b"))))]
    | length > 0' >/dev/null; then
    return 0
  fi
  threads=$(glab api --paginate "projects/$project_id/merge_requests/$iid/discussions?per_page=100" 2>/dev/null) || return 1
  printf '%s' "$threads" | jq -es --arg me "$me" --arg since "$since" '
    [add // [] | .[] | select(.notes[0].author.username == $me) | .notes[1:][]
      | select(.created_at > $since and .author.username != $me and (.author.username | test("bot|^gsa_") | not))]
    | length > 0' >/dev/null
}

unblocked_since_review() {
  local project_id="$1" iid="$2" raw="$3" head="$4" approved open
  printf '%s' "$raw" | jq -es --arg me "$me" --arg sha "$head" '
    [add // [] | .[] | select(.author.username == $me and (.system | not) and (.body | contains("reviewed-sha: " + $sha)))]
    | sort_by(.created_at) | last | .body // ""
    | test("review-waiting-on:|not approving|No approval from me"; "i")' >/dev/null || return 1
  approved=$(glab api "projects/$project_id/merge_requests/$iid/approvals" 2>/dev/null | jq -r --arg me "$me" '[.approved_by[]?.user.username] | index($me) != null')
  [ "$approved" = "true" ] && return 1
  local pipe="" try
  for try in 1 2 3; do
    pipe=$(glab api "projects/$project_id/merge_requests/$iid" 2>/dev/null | jq -r '.head_pipeline.status // empty')
    [ -n "$pipe" ] && break
    sleep 2
  done
  [ -z "$pipe" ] && return 1
  [ "$pipe" = failed ] && return 1
  open=$(glab api --paginate "projects/$project_id/merge_requests/$iid/discussions?per_page=100" 2>/dev/null | jq -s --arg me "$me" '
    [add // [] | .[] | select(.notes[0].resolvable and (.notes[0].resolved | not))
      | .notes[0].author.username | select(. != $me and (test("bot|^gsa_") | not))] | length') || return 1
  [ "$open" = "0" ]
}

review_state() {
  local project_id="$1" iid="$2" head="$3"
  local notes approved raw attempt
  for attempt in 1 2 3; do
    if raw=$(glab api --paginate "projects/$project_id/merge_requests/$iid/notes?per_page=100" 2>/dev/null) && [ -n "$raw" ]; then
      break
    fi
    raw=""
    sleep 2
  done
  if [ -z "$raw" ]; then
    echo "FAIL notes-read"; return
  fi
  notes=$(printf '%s' "$raw" | jq -s --arg me "$me" '[add // [] | .[] | select(.author.username == $me) | .body]')
  if printf '%s' "$notes" | jq -e --arg sha "$head" 'any(contains("reviewed-sha: " + $sha))' >/dev/null; then
    if asked_since_review "$project_id" "$iid" "$raw"; then
      echo "ASKED"; return
    fi
    if unblocked_since_review "$project_id" "$iid" "$raw" "$head"; then
      echo "UNBLOCKED"; return
    fi
    echo "ok reviewed"; return
  fi
  if printf '%s' "$notes" | jq -e --arg sha "$head" 'any(contains("review-blocked:") and contains($sha))' >/dev/null; then
    echo "ok blocked"; return
  fi
  approved=$(glab api "projects/$project_id/merge_requests/$iid/approvals" 2>/dev/null | jq -r --arg me "$me" '[.approved_by[]?.user.username] | index($me) != null')
  if [ "$approved" = "true" ] || printf '%s' "$notes" | jq -e 'any(contains("reviewed-sha: ") or contains("review-blocked:"))' >/dev/null; then
    echo "STALE"; return
  fi
  echo "OWED"
}

failures=0
if $queue_mode; then
  list=$(candidates_json)
  count=$(printf '%s' "$list" | jq 'length')
  [ -n "$count" ] || { echo "FAIL cannot read queue"; exit 1; }
  for i in $(seq 0 $((count - 1))); do
    row=$(printf '%s' "$list" | jq -c ".[$i]")
    url=$(printf '%s' "$row" | jq -r .web_url)
    label="$url $(printf '%s' "$row" | jq -r '"\(.author) | \(.title[0:70])"')"
    if [ "$(printf '%s' "$row" | jq -r .human)" = "true" ]; then
      echo "HUMAN $label"; continue
    fi
    state=$(review_state "$(printf '%s' "$row" | jq -r .project_id)" "$(printf '%s' "$row" | jq -r .iid)" "$(printf '%s' "$row" | jq -r .sha)")
    echo "$state $label"
    case "$state" in ok*) ;; *) failures=$((failures + 1)) ;; esac
  done
fi

for ref in ${refs[@]+"${refs[@]}"}; do
  project=$(urlencode "${ref%!*}")
  iid="${ref##*!}"
  head=$(glab api "projects/$project/merge_requests/$iid" 2>/dev/null | jq -r '.sha // empty')
  if [ -z "$head" ]; then
    echo "FAIL $ref cannot read MR"; failures=$((failures + 1)); continue
  fi
  state=$(review_state "$project" "$iid" "$head")
  echo "$state $ref ${head:0:12}"
  case "$state" in ok*) ;; *) failures=$((failures + 1)) ;; esac
done

echo "owed=$failures"
[ "$failures" -eq 0 ]
