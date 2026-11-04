#!/usr/bin/env bash
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage: gate.sh [--jql JQL] [--parked FILE] [--stale-days N] [--repo PATH]

Reads the user's open Jira tickets, finds each ticket's GitLab MRs and
GitHub PRs by key, and prints one line per ticket:

  STATE<TAB>KEY<TAB>JIRA_STATUS<TAB>MRS<TAB>NEXT<TAB>SUMMARY

States that need work make the gate exit 1. HUMAN, PARKED, WAIT and ok do not.
asked.txt lines are KEY  # reason. A reason that starts with DECIDED makes the
row a DECIDED work row. Any other reason makes it HUMAN.
EOF
  exit 2
}

jql='assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'
parked_file="${TICKETS_PARKED_FILE:-$HOME/cloudflare/.context/tickets/parked.txt}"
asked_file="${TICKETS_ASKED_FILE:-$HOME/cloudflare/.context/tickets/asked.txt}"
stale_days=30
repo="${TICKETS_RELEASE_REPO:-$HOME/cloudflare/cloudflare-agent}"
release_branch="${TICKETS_RELEASE_BRANCH:-main}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --jql) jql="$2"; shift 2 ;;
    --parked) parked_file="$2"; shift 2 ;;
    --stale-days) stale_days="$2"; shift 2 ;;
    --repo) repo="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

for bin in cfi glab gh jq git; do
  command -v "$bin" >/dev/null || { echo "FAIL $bin is not installed"; exit 1; }
done

tickets=$(cfi --json jira query "$jql" -n 100 2>/dev/null)
echo "$tickets" | jq -e '.results' >/dev/null 2>&1 || {
  echo "FAIL jira query: $(echo "$tickets" | jq -r '.error.message // "no results"' 2>/dev/null | head -1)"
  exit 1
}

me=$(glab api user 2>/dev/null | jq -r '.username // empty')
[ -n "$me" ] || { echo "FAIL glab is not authenticated"; exit 1; }

git -C "$repo" fetch -q origin "$release_branch" 2>/dev/null
now=$(date -u +%s)

listed_in() { [ -s "$2" ] && grep -qxF "$1" <(sed 's/[[:space:]#].*//' "$2"); }
is_parked() { listed_in "$1" "$parked_file"; }
asked_reason() { [ -s "$asked_file" ] && grep -E "^$1([[:space:]]|$)" "$asked_file" | head -1 | sed 's/^[^#]*#[[:space:]]*//'; }

mr_lines() {
  glab api "merge_requests?scope=all&author_username=$me&search=$1&in=title,description&per_page=50" 2>/dev/null \
    | jq -r --arg k "$1" '.[] | select((.title + " " + .source_branch + " " + (.description // "")) | test($k + "([^0-9]|$)"))
        | [.project_id, .iid, .state, .draft, (.has_conflicts // false), (.detailed_merge_status // "-"),
           (.merge_commit_sha // .squash_commit_sha // "-"), .references.full] | @tsv'
}

github_pr_lines() {
  gh api graphql -f query="{search(query:\"author:@me is:pr $1 in:title,body\",type:ISSUE,first:20){nodes{... on PullRequest{number state isDraft mergeable url title body headRefName commits(last:1){nodes{commit{statusCheckRollup{state}}}} reviewThreads(first:100){nodes{isResolved}}}}}}" 2>/dev/null \
    | jq -r --arg k "$1" '.data.search.nodes[]? | select((.title + " " + .headRefName + " " + (.body // "")) | test($k + "([^0-9]|$)"))
        | [.number,
           ({"OPEN":"opened","MERGED":"merged","CLOSED":"closed"}[.state] // "closed"),
           .isDraft, (.mergeable == "CONFLICTING"),
           ([.reviewThreads.nodes[]? | select(.isResolved == false)] | length),
           (.commits.nodes[0].commit.statusCheckRollup.state // "NONE"),
           (.url | sub("^https://github.com/"; "github:"))] | @tsv'
}

open_threads() {
  glab api --paginate "projects/$1/merge_requests/$2/discussions?per_page=100" 2>/dev/null \
    | jq -s '[add[]? | select(.notes[0].resolvable == true and (.notes | any(.resolved == false)))] | length'
}

pipeline_status() {
  glab api "projects/$1/merge_requests/$2" 2>/dev/null | jq -r '.head_pipeline.status // "none"'
}

released() {
  [ "$1" != "-" ] && git -C "$repo" merge-base --is-ancestor "$1" "origin/$release_branch" 2>/dev/null
}

work=0
while IFS=$'\t' read -r key status updated summary; do
  [ -n "$key" ] || continue
  age_days=$(( (now - $(date -u -j -f '%Y-%m-%d' "${updated:0:10}" +%s 2>/dev/null || echo "$now")) / 86400 ))
  if is_parked "$key"; then
    printf 'PARKED\t%s\t%s\t-\tnone (parked by user)\t%s\n' "$key" "$status" "$summary"
    continue
  fi

  open=0; merged=0; unreleased=0; broken=0; green_waiting=0; drafts=0; refs=()
  while IFS=$'\t' read -r pid iid state draft conflicts mstatus msha ref; do
    [ -n "$pid" ] || continue
    refs+=("$ref:$state")
    case "$state" in
      merged)
        merged=$((merged + 1))
        released "$msha" || unreleased=$((unreleased + 1))
        ;;
      opened)
        open=$((open + 1))
        [ "$draft" = "true" ] && drafts=$((drafts + 1))
        threads=$(open_threads "$pid" "$iid")
        pipe=$(pipeline_status "$pid" "$iid")
        if [ "$conflicts" = "true" ] || [ "${threads:-0}" -gt 0 ] || [ "$pipe" = "failed" ] || [ "$draft" = "true" ]; then
          broken=$((broken + 1))
        else
          green_waiting=$((green_waiting + 1))
        fi
        ;;
    esac
  done < <(mr_lines "$key")
  while IFS=$'\t' read -r number state draft conflicts threads checks ref; do
    [ -n "$number" ] || continue
    refs+=("$ref:$state")
    case "$state" in
      merged) merged=$((merged + 1)); unreleased=$((unreleased + 1)) ;;
      opened)
        open=$((open + 1))
        [ "$draft" = "true" ] && drafts=$((drafts + 1))
        if [ "$conflicts" = "true" ] || [ "${threads:-0}" -gt 0 ] || [ "$checks" = "FAILURE" ] || [ "$checks" = "ERROR" ] || [ "$draft" = "true" ]; then
          broken=$((broken + 1))
        else
          green_waiting=$((green_waiting + 1))
        fi
        ;;
    esac
  done < <(github_pr_lines "$key")
  mrs=$(IFS=,; echo "${refs[*]:-none}")

  state=ok; next="none"
  case "$status" in
    "To Do"|"Backlog")
      if [ "$open" -gt 0 ]; then state=MOVE; next="move to In Progress (21): an MR is open"
      elif [ "$age_days" -ge "$stale_days" ]; then state=STALE; next="ask user: plan, park or close (${age_days}d untouched)"
      else state=TRIAGE; next="write a plan, or ask user to park it"; fi
      ;;
    "In Progress")
      if [ "$broken" -gt 0 ]; then state=MR_WORK; next="fix MR: conflicts, threads, red pipeline or draft"
      elif [ "$green_waiting" -gt 0 ]; then state=MOVE; next="move to In Review (61): MR is green"
      elif [ "$merged" -gt 0 ] && [ "$open" -eq 0 ]; then state=MOVE; next="move to Awaiting Release (71): MRs merged"
      else state=BUILD; next="no MR yet: build it and open an MR"; fi
      ;;
    "In Review")
      if [ "$broken" -gt 0 ]; then state=MR_WORK; next="fix MR: conflicts, threads, red pipeline or draft"
      elif [ "$green_waiting" -gt 0 ]; then state=HUMAN; next="needs approvals: ask user who reviews"
      elif [ "$merged" -gt 0 ]; then state=MOVE; next="move to Awaiting Release (71): MRs merged"
      else state=HUMAN; next="In Review with no MR found: ask user"; fi
      ;;
    "Awaiting Release")
      if [ "$merged" -gt 0 ] && [ "$unreleased" -eq 0 ]; then state=MOVE; next="close (31): merged change is on $release_branch"
      else state=WAIT; next="waiting for release to $release_branch"; fi
      ;;
    "Blocked")
      state=HUMAN; next="blocked: report the blocker to the user"
      ;;
    *)
      state=HUMAN; next="unknown status: ask user"
      ;;
  esac

  if listed_in "$key" "$asked_file"; then
    reason=$(asked_reason "$key")
    case "$reason" in
      DECIDED*) state=DECIDED; next="act on the user's decision: $reason" ;;
      *) state=HUMAN; next="asked user: $reason" ;;
    esac
  fi
  case "$state" in MOVE|MR_WORK|BUILD|TRIAGE|STALE|DECIDED) work=$((work + 1)) ;; esac
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$state" "$key" "$status" "$mrs" "$next" "$summary"
done < <(echo "$tickets" | jq -r '.results[] | [.metadata.key, (.metadata.status // "-"), (.updated_at // "-"), (.title | sub("^[A-Z]+-[0-9]+: "; "") | .[:90])] | @tsv')

echo "SUMMARY work=$work"
[ "$work" -eq 0 ]
