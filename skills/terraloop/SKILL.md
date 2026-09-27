---
name: terraloop
description: Run or operate inside a terraloop — a driver loop that advances bounded work toward a goal by spawning child agents, verifying their output, and iterating to a hard stop gate. Load this when the user asks for a terraloop, a driver loop, or a long autonomous run that stops at a stated condition; when the gate is already armed (phase armed, driving, or gated); when a tool call is blocked with a terraloop reason; or when a project file points at its own loop contract and says to follow it.
metadata:
  short-description: Lock a contract, run a driver, and verify to the terraloop stop gate
---

# Terraloop

A **north star** becomes a parent-driven loop: the parent does the work, a
driver (`loops_task`) keeps the session moving, and Terrarium is a lever for a
named reason — not the default place work happens. The loop stops at a
falsifiable gate.

The operating rules are in **[protocol.md](./protocol.md)** — read it now and
follow it verbatim. This file explains how to satisfy the enforcement gate.

## The gate is mechanical, not advisory

The `terraloop-mode` extension blocks tool calls. Compliance is not your
decision, and you cannot argue past a block. Satisfy the gate; do not work
around it.

| Phase | What is blocked |
| --- | --- |
| `off` | nothing |
| `armed` | terrarium spawns, inline `edit`/`write`/mutating `bash`, driver creation until the contract is complete |
| `driving` | any parent or child path outside the locked scope, including spawn `cwd`. In-scope parent edits are allowed. Terrarium still needs a named lever. |
| `gated` | new spawns and new drivers until the driver loop is deleted |

Read-only tools are never blocked. Check phase any time with
`terraloop_control action=status`.

## Starting one

When the user asks for a terraloop, arm it yourself:

```
terraloop_control action=arm northStar="<what this loop is for, one line>"
```

The user can also arm it with `/terraloop`. Either way you then owe the contract
before anything else happens.

You cannot leave terraloop mode or clear its state. Only the user can, with
`/terraloop-off`. If you are stuck, say so and ask; do not try to unwedge yourself
by editing state files. Never claim a terraloop is running unless the phase is
actually armed, driving, or gated.

## Satisfying each phase

### 1. `armed` — lock the contract first

Draft from what the user gave you, then **echo it back in about five lines and
wait for a one-word go**:

- **Goal** — falsifiable end state ("the endpoint returns 200 with the new
  field", not "make it good").
- **Gate** — the binary condition that ends the loop.
- **Scope** — absolute paths in play. Parent writes **and** child `cwd`s outside these are blocked. A child cannot be granted a wider surface than the parent.
- **Proof** — the exact command, curl, grep, or receipt proving each step.

If any of these is unclear, ask **one tight batch** of questions and stop. Never
guess the gate. The user drives via terse directives and expects you to fill the
protocol, not interview them.

After the go:

```
terraloop_control action=lock goal=… gate=… scope=[…] proof=…
```

Locking alone does **not** unlock work. The driver loop must exist too.

### 2. Create the driver, which enters `driving`

`loops_task action=create` with a prompt embedding the locked Goal, Gate, Scope,
Proof, the live child run IDs, and "delete this loop when the gate is met".
Creating it moves the phase to `driving`.

### 3. `driving` — parent works; Terrarium is a lever

Do the next cheap in-scope step yourself. Spawn a child only when a lever in
**[protocol.md](./protocol.md)** is named in the task (parallel, isolate, bound,
context, or proof). Never spawn a child to edit a path the parent was blocked
from writing.

On a completion callback, check that known child with
`terrarium_status({ runId })`, then `terrarium_read` it, verify every claim
yourself, consolidate, and advance the next in-scope step **in this turn**.
Do not end the turn so the heartbeat can continue. `loops_task` only fires
while the session is idle; yielding early is a dead spot. Exhaust the turn.
If a driving turn that made tool calls does settle, the extension delivers a
settle tick with the driver prompt at once; treat it as the next tick, not as
a new request.
Do not list recent runs or pass `verbose` unless `pid` or `logPath` is required.
Ride completion callbacks; never sleep or poll inline.

Do the next cheap in-scope edit yourself. Do not take an override for ordinary
in-scope work. Override is for a genuine exception: a path outside scope, or
work after the stop gate. Do not spawn a child to escape a scope block.

```
terraloop_control action=override reason="<12+ chars, why the exception is required>" calls=1
```

Grants are bounded, expire when consumed, and are recorded to
`~/.terrarium/terraloop-audit.jsonl`.

### 4. Reaching the gate

Mark it, delete the driver, report:

```
terraloop_control action=gate
loops_task action=delete id=<driver>
```

Report what is proven, what remains, and what each follow-on tests. On a human,
security, or disproven boundary: stop and surface it. Do not spin a loop against
a boundary only a human can clear.

## When a project owns the contract

If the north star lives in a project file (e.g. a repo whose loop contract says
"Follow .context/TERRALOOP.md"), read that file for the Goal and Gate instead of
asking. It is already the customized instance.

## Lean gate

Use a Lean gate when the goal is a formal claim: a property of a pure
function, a decision rule, or an invariant you can state in Lean. The Lean
kernel is the judge. The agent can write the proof. It cannot make the kernel
accept a wrong one.

Do not use a Lean gate for goals that Lean cannot state, such as "the deploy
works" or "the endpoint returns 200".

### Layout

```text
Claims.lean      each claim as a named Prop: def Claim.x : Prop := ...
Check.lean       example : Claim.x := x, then #print axioms x
Proofs/          the proofs. The only files the loop writes.
lakefile.toml    [[lean_lib]] Claims, and Proofs with globs = ["Proofs.+"]
lean-toolchain   the pinned Lean version
lean-gate.lock   sha256 of Claims.lean, Check.lean, lakefile.toml, lean-toolchain
```

Create the lock before you lock the contract. The lock is required.

```sh
shasum -a 256 Claims.lean Check.lean lakefile.toml lean-toolchain > lean-gate.lock
```

### Contract

- **Scope** is `Proofs/` and `.lake/`. Keep every pinned file and
  `lean-gate.lock` outside the scope. The loop can then not weaken a claim.
- **Gate** is `sh <skill-dir>/lean-gate.sh <project>` exits 0. Every
  `def Claim.<name> : Prop` in `Claims.lean` is a required theorem `<name>`.
- **Proof** is the gate output. It lists the axioms of each theorem.

### What lean-gate.sh checks

1. `lean-gate.lock` exists, and all four pinned files match it. A missing
   lock fails.
2. No file in `Proofs/` contains `set_option`. An option such as
   `debug.skipKernelTC` can turn off the kernel check.
3. `Check.lean` has `example : Claim.<name> := <name>` and
   `#print axioms <name>` for every claim. A skipped claim fails.
4. `lake build Claims Proofs` succeeds.
5. `Check.lean` type-checks. A weakened statement fails here.
6. `#print axioms` for each theorem shows only `propext`, `Classical.choice`,
   and `Quot.sound`.

Check 6 catches `sorry`, a hidden `sorryAx`, an added `axiom`, and
`native_decide`. Do not grep for `sorry` or `axiom`. A grep misses a hidden
`sorryAx` and `native_decide`.

`lean-gate.test.sh` runs the gate on sixteen fixtures: three honest projects
and thirteen cheats. Run it after you change `lean-gate.sh`.

### Tips

- A claim wrapped as `def Claim.x : Prop` is opaque to `decide` and `simp`.
  Start the proof with `unfold Claim.x` or `intro`.
- Read the Lean error after each failed build. It is the feedback for the next
  attempt.
- Report **proven** for the Lean model only. Report **linked** only when a
  differential test shows that the real code agrees with the Lean definitions.

## What the gate does not do

It constrains tool calls, not judgment. It can force a contract to exist and a
driver to run before children spawn. It cannot make the contract good or the
verification real. The protocol's verify-it-yourself and honesty rules still rest
on you.
