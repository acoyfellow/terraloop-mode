#!/usr/bin/env bash
set -uo pipefail
: "${GITLAB_HOST:?set GITLAB_HOST}"
recipe=${REVIEW_RECIPE_ROOT:?set REVIEW_RECIPE_ROOT}
queue=/tmp/rv/post.queue
runner=/tmp/rv/post.runner
touch "$queue"
for job in "$@"; do printf '%s\n' "$job" >> "$queue"; done
if [ -f "$runner" ] && kill -0 "$(cat "$runner")" 2>/dev/null; then exit 0; fi
nohup bash "$recipe/postq-drain.sh" < /dev/null >> /tmp/rv/post.log 2>&1 &
echo $! > "$runner"
