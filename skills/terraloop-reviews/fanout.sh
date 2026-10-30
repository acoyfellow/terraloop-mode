#!/usr/bin/env bash
set -uo pipefail
: "${GITLAB_HOST:?set GITLAB_HOST}"
recipe=${REVIEW_RECIPE_ROOT:-$HOME/.review-recipe}

repo_dir() {
  case "$1" in
    hivemind|evalkit-ci) echo "/tmp/rv/$1" ;;
    *) echo "${REVIEW_REPOS_ROOT:?set REVIEW_REPOS_ROOT}/$1" ;;
  esac
}

launch_one() {
  local project=$1 iid=$2
  local repo; repo=$(basename "$project")
  local ns=$recipe/ns-$repo
  local dir=$ns/$iid
  local encoded=${project//\//%2F}
  mkdir -p "$dir"
  ln -sfn ../lantern "$ns/lantern"
  glab api "projects/$encoded/merge_requests/$iid" > "$dir/mr.json" || { echo "$repo!$iid SKIP fetch"; return; }
  local head base title
  head=$(jq -r .sha "$dir/mr.json")
  base=$(jq -r .diff_refs.base_sha "$dir/mr.json")
  title=$(jq -r .title "$dir/mr.json")
  local src
  src=$(repo_dir "$repo")
  [ -d "$src/.git" ] || git clone -q "git@$GITLAB_HOST:$project.git" "$src"
  git -C "$src" fetch -q origin "merge-requests/$iid/head" "$base" 2>/dev/null || git -C "$src" fetch -q origin "merge-requests/$iid/head"
  local wt=$src/.worktrees/rv$iid
  [ -d "$wt" ] && git -C "$src" worktree remove --force "$wt" 2>/dev/null
  git -C "$src" worktree add -q --detach "$wt" "$head" || { echo "$repo!$iid SKIP worktree"; return; }
  rm -f "$dir"/p2.out "$dir"/p3.out "$dir"/receipt.md "$dir"/note.md "$dir"/lantern.json
  rm -rf "$dir/lantern"
  local prior=""
  [ -f "$ns/$iid.last-head" ] && prior="Prior review was at $(cat "$ns/$iid.last-head"). Focus on git diff $(cat "$ns/$iid.last-head") HEAD but run tests the change can break."
  local tail="cwd is the worktree at head ${head:0:8}. Diff: git diff $base HEAD. $prior Run narrow tests only, with explicit file args. Scratch files zz- prefix, delete after. Under 25 lines. Tag BLOCK/NIT/QUESTION with file:line; BLOCK needs a concrete failing input. Last line exactly 'VERDICT: APPROVE' or 'VERDICT: BLOCK <reason>'."
  { echo "Correctness review of $repo !$iid: $title. Check it does what the description says, edge cases, tests."; jq -r .description "$dir/mr.json" | head -c 3000; echo; echo "$tail"; } > "$dir/t2.txt"
  { echo "Adversarial review of $repo !$iid: $title. Hunt races, auth and secret exposure, data loss, fail-open paths, regressions in callers. Repro any BLOCK."; jq -r .description "$dir/mr.json" | head -c 3000; echo; echo "$tail"; } > "$dir/t3.txt"
  (cd "$wt" && nohup pi -p --no-session ${REVIEW_P2_MODEL_ARGS:---model gpt-6-astra} @"$dir/t2.txt" "Do the task in the attached file." > "$dir/p2.out" 2>&1 < /dev/null & disown)
  (cd "$wt" && nohup pi -p --no-session ${REVIEW_P3_MODEL_ARGS:---model claude-opus-5-5} @"$dir/t3.txt" "Do the task in the attached file." > "$dir/p3.out" 2>&1 < /dev/null & disown)
  echo "$repo!$iid launched ${head:0:8}"
}

for spec in "$@"; do
  launch_one "${spec%!*}" "${spec#*!}" &
done
wait
