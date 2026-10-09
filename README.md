# terraloop-mode

A [Pi](https://github.com/earendil-works/pi) extension that turns an agent
orchestration protocol into a tool-call gate. The agent cannot spawn a child,
edit outside the locked scope, or declare the work finished until the protocol
step that permits it has happened.

## The Failure This Removes

A terraloop is a short protocol: lock a falsifiable contract, start a recurring
driver, spawn bounded child agents, verify their output yourself, stop at a
binary gate.

As a skill, the protocol is prose. The agent decides every turn whether to
follow it. In practice it skipped the contract, did the work inline, and
reported that the work was done. Stronger wording did not change this. The
instruction and the decision to follow it lived in the same place.

Pi's `tool_call` hook can block a call and return a reason. The model cannot
argue with that return value. This extension moves the ordering of the protocol
into that hook. A skipped step becomes a blocked tool call with a recorded
reason.

## Quick Start

```sh
pi install git:github.com/acoyfellow/terraloop-mode@main
```

Ask for a loop in plain language:

```
Run a terraloop to get every open MR to zero must-fix objections.
```

The agent arms the gate by calling `terraloop_control action=arm` with a
`northStar`. The gate then holds it to this order:

1. Draft Goal, Gate, Scope, and Proof. Wait for your one-word go.
2. Lock the contract.
3. Create the driver loop.
4. Do in-scope work in the parent. Spawn a child only for a named reason.
5. Call `action=gate`. The tool runs the proof command. Exit 0 ends the loop.

`/terraloop` arms the gate from the command line. `/terraloop-off` leaves the
mode. Only the user can run it.

## Arming And Releasing

Either side can start a loop. Only the user can end one.

```
/terraloop <optional north star>   arm the gate
/terraloop-status                  show phase, contract, override, settle ticks
/terraloop-off                     leave terraloop mode
```

The agent-facing tool has an `arm` action and no `release` action. The audit
log records `via: agent-tool` or `via: slash-command` for every arm.

The extension does not match prompt wording. A phrase such as "go hard on this"
does not arm anything. A tool call arms the gate. `tests/arming.test.ts` asserts
both facts.

Release has no tool action because a stuck agent that clears its own contract is
the failure the gate exists to prevent.

## What Each Phase Blocks

| Phase | Entered by | Blocked |
| --- | --- | --- |
| `off` | default | nothing |
| `armed` | `/terraloop`, or `action=arm` with a north star | terrarium spawns, inline mutation, and driver creation until the contract is complete |
| `driving` | `loops_task create` with a locked contract | writes to any path outside the locked scope, and any spawn whose `cwd` is outside it |
| `gated` | `action=gate`, after the proof command exits 0 | new driver loops and further inline mutation |

Read-only tools are never blocked. `gated` still allows spawns so a loop at its
gate can finish verifying instead of deadlocking.

Four rules are mechanical:

1. No child spawns before a contract with goal, gate, scope, and proof exists.
2. No child spawns without a driver loop.
3. While driving, the parent is the default worker. A child cannot receive a
   wider `cwd` than the locked scope.
4. The gate is not self-certified. `action=gate` runs the contract's proof
   command. A non-zero exit refuses the gate.

## Settle Ticks

`loops_task` re-injects the driver prompt on an interval, and only while Pi is
idle. Before this change, every driving turn ended the same way: the agent
settled, Pi went idle, and the loop waited out the rest of the interval. The
heartbeat was doing the job of a callback.

Pi emits `agent_settled` once it will not retry, compact, or continue on its
own. While the phase is `driving`, the extension handles that event by
delivering the driver prompt again as a follow-up message. The interval driver
remains as the recovery path.

A settle tick is delivered only when all of these are true:

- the phase is `driving`, the contract is complete, and the driver id and prompt
  were captured when `loops_task create` ran;
- Pi is idle and no follow-up is already queued;
- the run that just settled made at least one tool call;
- fewer than 100 settle ticks have fired in this loop.

A turn that settles without a tool call does not fire a tick. That case belongs
to the heartbeat, so a loop cannot spin on a model that only talks. `loops_task
delete` or `clear` drops the captured driver and stops settle ticks. Every
delivery and every skip is appended to the audit log as `settle-tick-delivered`
or `settle-tick-skipped` with a reason.

```sh
bun run prove:settle
```

The proof launches a headless `pi -p --no-session` with a harness extension
that seeds a `driving` state for the new session. The first prompt asks for one
`bash` call. The proof then checks:

- two agent runs happened;
- exactly one `settle-tick-delivered` was recorded for that session;
- the model answered the tick with `TERRALOOP_TICK_OK` in the second run;
- the second run was skipped with `no tool calls`;
- the persisted `settleTicks` is `1`.

Field data from one operator's machine, `~/.terrarium/terraloop-audit.jsonl`,
2026-09-08 through 2026-09-11: 142 settle ticks delivered across 10 sessions,
311 skipped. The skip reasons were `no driver loop is recorded` (119), `settled
run made no tool calls` (92), `phase is armed` (60), `phase is gated` (31), and
`no driver prompt was captured` (9). No skip reason fell outside the decision
table in `settle.ts`.

`src/turn-exhaustion.ts` and `features/turn-exhaustion.feature` describe the
protocol side of the same problem: while an in-scope step remains, the agent
finishes it in the current turn instead of yielding to the heartbeat. The settle
tick covers the case where the agent yields anyway.

## Override

`driving` already allows in-scope parent work. Override exists for two
exceptions: a path the contract omitted, and work after the stop gate.

```
terraloop_control action=override reason="must edit a path the contract omitted" calls=2
```

The reason must be at least 12 characters. One grant covers at most 8
mutations. A loop gets 20 grants. The 21st request is refused.

An earlier gate taxed every parent edit. That spent the budget on normal work
and pushed jobs into Terrarium that belonged in the parent. The current gate
does not tax in-scope edits.

`action=status` reports `delegated=N inline=N overrideGrants=N/20` while the
loop runs.

## Reaching The Gate

When the agent believes the work is done it calls `action=gate`. The tool
extracts one runnable command from the contract's `proof` field and runs it.
Exit 0 moves the phase to `gated` and stores the command, output, and time as
`gateReceipt`. Any other exit refuses the gate and the loop continues.

A proof that does not reduce to one runnable command is refused. The string
`bun test >= 77 pass` is rejected on purpose: a shell reads `>=` as a redirect,
writes a file named `=`, and exits 0.

An earlier build let the agent declare its own gate met. A loop mid-flight
self-certified and locked itself down. Verification is now the tool's job.

### Evidence screen (advisory)

A proof can exit 0 and still not show the gate. Examples: a script that prints
`PASS` for a check whose detail shows a failure, or a proof that prints nothing.
When the [odds](https://github.com/acoyfellow/odds) extension is installed, the
gate also asks `odds/clef` one yes/no question: does the raw output show the
gate condition holds?

- Self-reported fields (`pass`, `ok`, `verdict`, `name`, `claim`, ...) and
  `PASS`/`FAIL` line prefixes are removed first. Clef judges the raw evidence,
  not the proof's own verdict.
- At p >= 0.8 the screen says the output supports the gate. Below 0.8 it prints
  a warning. The result is stored as `gateReceipt.evidenceScreen`.
- It is advisory. The exit code still decides the gate. A missing model, a
  missing token, or a classifier error skips the screen. It never blocks the
  gate and never passes a failing proof.

Measured in odds receipts 005 and 007: with labels kept, Clef accepted a forged
`pass: true` receipt at 0.93. With labels removed, it accepted both real
receipts (0.91 and 0.93) and rejected all four forgeries (0.07 or lower), with
identical scores over three runs. That is six planted cases, not a benchmark.

## State

Phase, contract, driver id, driver prompt, settle tick count, gate receipt, and
override live in `~/.terrarium/terraloop-state/<session-id>.json`. State on disk
survives context compaction. Session-keyed files let several Pi sessions run
independent loops at the same time.

`/terraloop-off` clears the active phase, contract, and driver. It keeps
`lastCompletedLoop`: the completed contract, the exact proof command, bounded
proof output, child run ids, counters, and release time. A review can read that
record without trusting chat history.

A missing or corrupt state file reads as `off`. A damaged file cannot wedge
another session.

Every allow, block, override, arm, release, gate, and settle tick is appended to
`~/.terrarium/terraloop-audit.jsonl` with the `sessionId`.

## Install

```sh
pi install git:github.com/acoyfellow/terraloop-mode@main
```

The package ships the gate extension and the protocol skill it enforces, so the
agent has text to follow when a call is blocked.

To work on the source:

```sh
git clone https://github.com/acoyfellow/terraloop-mode.git
cd terraloop-mode
bun install
ln -s "$PWD" ~/.pi/agent/extensions/terraloop-mode
```

Start a new Pi session or run `/reload`, then run `/terraloop-status`. The gate
is inert until you arm it.

If you install with `pi install`, Pi checks out the pinned commit and resets the
package directory on each reload. A local commit that is not pushed and not
pinned in `~/.pi/agent/settings.json` is discarded on the next reload. This
happened to the settle tick commit once on 2026-09-11 and was recovered from the
reflog. Push, then move the pin.

## Develop

```sh
bun run check
```

`bun run check` runs `tsc --noEmit` and the test suite: 76 tests across eight
files as of `e700531`. The suite covers phase transitions, tool classification
for read-only and mutating shell, scope containment, override consumption, disk
round-trip, settle tick decisions, turn-exhaustion decisions, and malformed
input. A negative control asserts that a permissive gate fails the scenarios the
real gate blocks, so a gate that stopped enforcing would not still look green.

The gate was also exercised against separate `pi` processes with the phase set
to `armed`:

| Probe | Result |
| --- | --- |
| "write this file, just do it" | blocked; file never created |
| "arm a loop, then write this file" | armed itself, then blocked its own write |
| "spawn a terrarium child, do it now" | blocked; contract demanded first |
| lock a contract, then write | still blocked; no driver loop existed |
| override with a reason, then write | allowed once; budget consumed |

## Limits

This gate constrains tool calls. It does not constrain judgment. It can force a
contract and a driver to exist before a child spawns. It cannot make the
contract good or the proof meaningful.

It is not a security boundary. An agent with shell access can edit the state
file or this extension. See [SECURITY.md](SECURITY.md).

Tool names are matched literally. If `terrarium` or `loops_task` renames a tool,
the gate stops recognizing it. `tests/tool-names.test.ts` pins the spawn tool
names so a rename fails the suite.

The mutating-shell classifier is a pattern list. It catches ordinary mutation
commands and redirects. It does not parse shell.

Settle ticks depend on the driver prompt being captured at `loops_task create`.
A driver created by an older version of this extension has no captured prompt,
so that loop runs on the heartbeat only.

## Requirements

- Pi >= 0.82
- [Bun](https://bun.sh) for development
- For a live loop: the `terrarium` MCP server for children, and a `loops_task`
  provider for the driver. The gate loads without them and has nothing to gate.

## Layout

```
extension.ts                Pi wiring: slash commands, tool, tool_call gate, agent_settled hook
gate.ts                     classifies each tool call and decides allow or block
state.ts                    per-session phase, contract, driver, and receipt on disk
proof.ts                    extracts and runs the contract's proof command
settle.ts                   decides whether a settled turn delivers the next driver tick
src/turn-exhaustion.ts      protocol decision table for staying in the current turn
features/                   Gherkin for the turn-exhaustion paths
scripts/                    headless pi proofs, including prove-settle-tick.mjs
skills/terraloop/           the protocol the gate enforces, plus the Lean gate
skills/terraloop-review/    adversarial review of the last loop
skills/terraloop-reviews/   GitLab merge-request review loop with an API gate
skills/terraloop-factory/   GitHub issue-to-PR loop with a PR and test gate
tests/                      phase transitions, classification, settle, negative control
```

## Versioning

Releases are date tags such as `2026.8.14`. `pi install` pins a git ref, so the
tag shows how stale a pin is. The `package.json` version stays `0.0.1`.

## License

MIT
