#!/usr/bin/env bash
set -uo pipefail

repo=${RANK_REPO:-$HOME/cloudflare/rank}
dir="$repo/experiments"
[ -d "$dir" ] || { echo "FAIL no experiments dir at $dir"; exit 1; }

now=$(date -u +%s)
owed=0
total=0
for exp in "$dir"/*/; do
  [ -f "$exp/experiment.json" ] || continue
  total=$((total + 1))
  id=$(basename "$exp")
  if [ -f "$exp/verdict.json" ]; then
    echo "ok   $id $(jq -r .verdict "$exp/verdict.json")"
    continue
  fi
  start=$(jq -r '.commitDate // empty' "$exp/experiment.json")
  days=$(jq -r '.windowDays // 14' "$exp/experiment.json")
  if [ -z "$start" ]; then
    echo "open $id (not yet acted)"
    continue
  fi
  closes=$(( $(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$start" +%s 2>/dev/null || date -u -d "$start" +%s) + days * 86400 ))
  if [ "$now" -ge "$closes" ]; then
    echo "OWED $id window closed $(( (now - closes) / 86400 )) day(s) ago, no verdict"
    owed=$((owed + 1))
  else
    echo "open $id measuring, $(( (closes - now) / 86400 )) day(s) left"
  fi
done

echo "$total experiment(s), $owed owed"
[ "$owed" -eq 0 ]
