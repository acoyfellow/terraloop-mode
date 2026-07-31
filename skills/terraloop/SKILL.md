---
name: terraloop
description: Run or operate inside a terraloop — a driver loop that advances bounded work toward a goal by spawning child agents, verifying their output, and iterating to a hard stop gate. Load this when the user asks for a terraloop, a driver loop, or a long autonomous run that stops at a stated condition; when the gate is already armed (phase armed, driving, or gated); when a tool call is blocked with a terraloop reason; or when a project file points at its own loop contract and says to follow it.
metadata:
  short-description: Lock a contract, run a driver, and verify to the terraloop stop gate
---

# Terraloop

A **north star** becomes a self-driving loop: a driver (`loops_task`) spawns
bounded children (`terrarium`), verifies every result, re-steers, and stops at a
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
| `driving` | inline `edit`/`write`/mutating `bash`; any path outside the locked scope |
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
- **Scope** — absolute paths in play. Inline writes outside these are blocked.
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

### 3. `driving` — orchestrate, never do the work inline

Spawn bounded children with `terrarium`, parallel where independent, working
backward from the goal. Each tick: reap finished children, verify every claim
yourself, consolidate, advance one step. Ride completion callbacks; never sleep
or poll inline.

Inline mutation is blocked here on purpose. When a child stalls the same way
twice, the protocol says to do that piece directly — that is what the override is
for:

```
terraloop_control action=override reason="<12+ chars, why inline is required>" calls=1
```

Grants are bounded, expire when consumed, and are recorded to
`~/.terrarium/terraloop-audit.jsonl`. Use it honestly rather than to route around
a block you find inconvenient.

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

## What the gate does not do

It constrains tool calls, not judgment. It can force a contract to exist and a
driver to run before children spawn. It cannot make the contract good or the
verification real. The protocol's verify-it-yourself and honesty rules still rest
on you.
