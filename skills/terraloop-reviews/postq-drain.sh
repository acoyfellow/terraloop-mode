#!/usr/bin/env bash
set -uo pipefail
recipe=${REVIEW_RECIPE_ROOT:?set REVIEW_RECIPE_ROOT}
queue=/tmp/rv/post.queue
while [ -s "$queue" ]; do
  job=$(head -1 "$queue")
  tail -n +2 "$queue" > "$queue.tmp" && mv "$queue.tmp" "$queue"
  cp "$recipe/post-one.sh" /tmp/rv/post-one.run.sh
  bash /tmp/rv/post-one.run.sh $job
done
rm -f /tmp/rv/post.runner
