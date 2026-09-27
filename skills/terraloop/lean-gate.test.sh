#!/bin/sh
set -u

skill_dir=$(cd "$(dirname "$0")" && pwd)
gate="$skill_dir/lean-gate.sh"
fixtures="$skill_dir/lean-gate-fixtures"
work=${LEAN_GATE_WORK:-/tmp/leandry/lean-gate-test}
expected_total=16

pinned_files='Claims.lean Check.lean lakefile.toml lean-toolchain'

write_lock() {
  (cd "$1" && shasum -a 256 $pinned_files > lean-gate.lock)
}

prepare_case() {
  case_dir=$1
  project=$2
  rm -rf "$project"
  cp -R "$fixtures/project" "$project"
  mkdir -p "$project/Proofs"
  write_lock "$project"
  (cd "$case_dir" && find . -type f ! -name '.*' | while read -r file; do
    mkdir -p "$project/$(dirname "$file")"
    cp "$file" "$project/$file"
  done)
  if [ -f "$case_dir/.relock" ]; then
    write_lock "$project"
  fi
  if [ -f "$case_dir/.no-lock" ]; then
    rm -f "$project/lean-gate.lock"
  fi
}

rm -rf "$work"
mkdir -p "$work"

total=0
correct=0
for case_dir in "$fixtures"/cases/*/; do
  case_dir=${case_dir%/}
  name=$(basename "$case_dir")
  expected=${name%%-*}
  project="$work/$name"
  prepare_case "$case_dir" "$project"
  theorems=denied_302
  if [ -f "$case_dir/.theorems" ]; then
    theorems=$(cat "$case_dir/.theorems")
  fi
  output=$(sh "$gate" "$project" $theorems 2>&1)
  if [ $? -eq 0 ]; then actual=pass; else actual=fail; fi
  total=$((total + 1))
  if [ "$actual" = "$expected" ]; then
    correct=$((correct + 1))
    mark=ok
  else
    mark=WRONG
  fi
  printf '%-5s %-24s expected=%s actual=%s  %s\n' "$mark" "$name" "$expected" "$actual" "$(printf '%s\n' "$output" | tail -1)"
done

echo "$correct/$total"
[ "$correct" -eq "$total" ] && [ "$total" -eq "$expected_total" ]
