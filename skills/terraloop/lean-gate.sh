#!/bin/sh
set -u

pinned_files='Claims.lean Check.lean lakefile.toml lean-toolchain'
allowed_axioms='propext|Classical\.choice|Quot\.sound'

usage() {
  echo "usage: lean-gate.sh <project-dir> [theorem]..." >&2
  echo "  project-dir holds Claims.lean, Check.lean, Proofs/, lakefile.toml, lean-toolchain, lean-gate.lock" >&2
  echo "  every 'def Claim.<name> : Prop' in Claims.lean is a required theorem <name>" >&2
  exit 2
}

fail() {
  echo "FAIL $1"
  exit 1
}

[ "$#" -ge 1 ] || usage
project=$1
shift
cd "$project" 2>/dev/null || fail "project: cannot enter $project"

check_lock() {
  [ -f lean-gate.lock ] || fail "lock: lean-gate.lock is missing"
  for pinned in $pinned_files; do
    [ -f "$pinned" ] || fail "lock: $pinned is missing"
    expected=$(grep "  $pinned\$" lean-gate.lock | cut -d' ' -f1)
    [ -n "$expected" ] || fail "lock: $pinned is not pinned"
    actual=$(shasum -a 256 "$pinned" | cut -d' ' -f1)
    [ "$expected" = "$actual" ] || fail "lock: $pinned changed"
  done
}

check_proofs_have_no_options() {
  [ -d Proofs ] || fail "proofs: Proofs/ is missing"
  offender=$(grep -rlE '(^|[^A-Za-z0-9_.])set_option([^A-Za-z0-9_]|$)' Proofs | head -1)
  [ -z "$offender" ] || fail "options: set_option in $offender"
}

claim_names() {
  sed -nE 's/^[[:space:]]*def[[:space:]]+Claim\.([A-Za-z0-9_]+)[[:space:]]*:[[:space:]]*Prop.*/\1/p' Claims.lean
}

check_every_claim_is_checked() {
  names=$1
  [ -n "$names" ] || fail "claims: no 'def Claim.<name> : Prop' in Claims.lean"
  for name in $names; do
    grep -qE "^[[:space:]]*example[[:space:]]*:[[:space:]]*Claim\.$name[[:space:]]*:=[[:space:]]*$name[[:space:]]*\$" Check.lean \
      || fail "check: Check.lean has no 'example : Claim.$name := $name'"
    grep -qE "^[[:space:]]*#print[[:space:]]+axioms[[:space:]]+$name[[:space:]]*\$" Check.lean \
      || fail "check: Check.lean has no '#print axioms $name'"
  done
}

build() {
  build_log=$(mktemp)
  if ! lake build Claims Proofs >"$build_log" 2>&1; then
    detail=$(grep -m1 'error' "$build_log" | cut -c1-160)
    rm -f "$build_log"
    fail "build: $detail"
  fi
  rm -f "$build_log"
}

check_axioms() {
  output=$1
  theorem=$2
  line=$(printf '%s\n' "$output" | grep -m1 "^'$theorem'")
  case "$line" in
    "") fail "axioms: no #print axioms output for $theorem" ;;
    *"does not depend on any axioms"*) echo "ok $theorem axioms=none"; return ;;
  esac
  axioms=$(printf '%s\n' "$line" | sed -E 's/.*\[(.*)\].*/\1/' | tr -d ' ' | tr ',' '\n')
  disallowed=$(printf '%s\n' "$axioms" | grep -vxE "$allowed_axioms")
  [ -z "$disallowed" ] || fail "axioms: $theorem uses $(echo $disallowed)"
  echo "ok $theorem axioms=$(echo $axioms)"
}

check_lock
check_proofs_have_no_options
names=$(claim_names)
check_every_claim_is_checked "$names"
build

check_output=$(lake env lean Check.lean 2>&1)
status=$?
if [ $status -ne 0 ] || printf '%s\n' "$check_output" | grep -q 'error'; then
  fail "statement: $(printf '%s\n' "$check_output" | grep -m1 'error' | cut -c1-160)"
fi

for theorem in $names "$@"; do
  check_axioms "$check_output" "$theorem"
done

echo "PASS"
