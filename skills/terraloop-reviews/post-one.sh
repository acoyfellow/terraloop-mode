#!/usr/bin/env bash
set -uo pipefail
: "${GITLAB_HOST:?set GITLAB_HOST}"
recipe=${REVIEW_RECIPE_ROOT:?set REVIEW_RECIPE_ROOT}
project=$1 iid=$2 verdict=$3
repo=$(basename "$project")
export REVIEW_RECIPE_DIR=$recipe/ns-$repo PROJECT=$project
encoded=${project//\//%2F}
cd "$recipe" || exit 2
lantern_dir=/tmp/rv/lantern
rm -rf "$lantern_dir"/scenes/review-*
grep -v "review" "$lantern_dir/scenes/index.ts" > "$lantern_dir/scenes/index.clean" && mv "$lantern_dir/scenes/index.clean" "$lantern_dir/scenes/index.ts"
bash lantern/build.sh "$iid" > "$REVIEW_RECIPE_DIR/$iid/build.log" 2>&1 || { echo "$repo!$iid SKIP lantern build: $(tail -1 "$REVIEW_RECIPE_DIR/$iid/build.log")"; exit 1; }
live=$(glab api "projects/$encoded/merge_requests/$iid" | jq -r '"\(.state) \(.sha) \(.head_pipeline.status)"')
read -r state head pipe <<< "$live"
want=$(jq -r .sha "$REVIEW_RECIPE_DIR/$iid/mr.json")
[ "$state" = opened ] && [ "$head" = "$want" ] || { echo "$repo!$iid STALE live=$state ${head:0:8}"; exit 1; }
if [ "$verdict" = approve ] && [ "$pipe" = failed ]; then verdict=comment; echo "$repo!$iid pipeline failed: posting as comment"; fi
bash post-safe.sh "$iid" "$verdict" 2>&1 | tail -1
[ "$verdict" = approve ] && [ "$pipe" = success ] && bash approve-safe.sh "$iid" 2>&1 | tail -1
printf '%s' "$head" > "$REVIEW_RECIPE_DIR/$iid.last-head"
