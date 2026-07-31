# terraloop-mode

A [Pi](https://github.com/earendil-works/pi) extension that makes an agent
orchestration protocol enforceable instead of advisory.

## The problem

A "terraloop" is a simple orchestration protocol: lock a falsifiable contract,
start a recurring driver, spawn bounded child agents, verify their output
yourself, stop at a binary gate.

Written as a skill, it is prose. Following it is a choice the agent re-makes every
turn, and the failure is predictable: the agent skips the contract, does the work
inline because that feels faster, and declares itself finished. Stronger wording
does not fix this, because the instruction and the decision to follow it live in
the same place.

This extension moves the mechanical parts off that path. Pi's `tool_call` hook can
block a call, and its return value is not something the model can argue with. So
the ordering of the protocol becomes a state machine, and skipping a step becomes
a blocked tool call with a reason.

## Quick start

```sh
pi install git:github.com/acoyfellow/terraloop-mode@2026.7.29
```

```
/terraloop get every open MR to zero must-fix objections
```

The agent must now, in this order: draft Goal / Gate / Scope / Proof and wait for
your go, lock the contract, create a driver loop, and only then spawn children.
Each step is enforced, not requested. `/terraloop-off` clears the gate at any
time.

## Arming is a user act

The agent cannot put itself into terraloop mode. Arming and releasing are slash
commands, so entering the mode is an explicit user act rather than an inference
from prompt wording:

```
/terraloop <optional north star>   arm the gate
/terraloop-status                  show phase, contract, override
/terraloop-off                     leave terraloop mode
```

The LLM-callable `terraloop_control` tool deliberately has no `arm` or `release`
action, and refuses every action while the phase is `off`. No regex reads the
user's prompt to guess intent; pattern-matching wording would put the decision
back on the non-deterministic path this extension exists to remove.

`/terraloop` also injects the protocol on-ramp as a user message, so the agent is
told to draft the contract and wait for a one-word go.

## What it enforces

| Phase | Entered by | Blocked |
| --- | --- | --- |
| `off` | default | nothing |
| `armed` | the user runs `/terraloop` | terrarium spawns, inline mutation, and driver creation until the contract is complete |
| `driving` | creating the driver loop with a locked contract | inline `edit` / `write` / mutating `bash`, and any path outside the locked scope |
| `gated` | `terraloop_control action=gate`, after its proof command passes | new driver loops and further inline mutation |

Read-only tools are never blocked in any phase. `gated` deliberately still allows
spawns, so a loop that has reached its gate can finish verifying rather than
deadlocking.

## The four mechanical rules

1. No child is spawned before a contract with goal, gate, scope, and proof exists.
2. No child is spawned without a driver loop, so orchestration cannot happen
   without the recurring driver that reaps and re-steers it.
3. While driving, deep work is delegated rather than done inline.
4. The gate cannot be self-certified. `action=gate` extracts a runnable command
   from the contract's `proof` field and runs it; a non-zero exit refuses the
   gate. An agent cannot simply declare the work finished.

## Override

A hard block on inline work is sometimes wrong. The protocol itself says that a
child which stalls the same way twice should be done directly. So `driving`
permits inline mutation after an explicit grant:

```
terraloop_control action=override reason="child stalled twice on this edit" calls=2
```

The reason must be at least 12 characters. Each grant covers at most 3 mutations
and expires when they are used, and a loop gets **5 grants total**. Past that the
override is refused and points back at delegation.

The budget exists because an unbounded escape hatch becomes the main road. In the
first real loop run against an earlier build, 60 grants authorized 125 inline
mutations against 10 spawns: the gate was firing constantly and being routed
around every time. A bypass that costs nothing is not a bypass, it is the default.

`terraloop_control action=status` reports `delegated=N inline=N
overrideGrants=N/5` so that ratio is visible while the loop runs, not
archaeology afterward. Every grant, consumption, refusal, and block is appended to
`~/.terrarium/terraloop-audit.jsonl`.

## State

Phase, contract, driver id, and override live in a file keyed by the current Pi
session: `~/.terrarium/terraloop-state/<session-id>.json`. State on disk rather
than in context means the gate survives compaction, while session-keyed files let
multiple Pi sessions run independent terraloops concurrently.

The extension itself remains globally installed. Only its mutable gate state is
session-scoped. The shared audit log includes `sessionId` on every new event so
parallel loop histories remain attributable. A corrupt or missing session state
file reads as `off`, so a damaged file cannot wedge another session.

## Install

```sh
pi install git:github.com/acoyfellow/terraloop-mode@2026.7.29
```

This is a Pi package: it ships the gate extension **and** the protocol skill the
gate enforces, so the agent has something to follow when a call is blocked.

To hack on it instead, clone and symlink:

```sh
git clone https://github.com/acoyfellow/terraloop-mode.git
cd terraloop-mode
bun install
ln -s "$PWD" ~/.pi/agent/extensions/terraloop-mode
```

Start a new Pi session, or `/reload` an existing one, then confirm:

```
/terraloop-status
```

The gate is inert until you arm it. Installing changes nothing about a normal
session.

## Develop

```sh
bun run check
```

The suite covers every phase transition, tool classification for both read-only
and mutating shell, scope containment, override consumption, disk round-trip, and
malformed input. It includes a negative control: a permissive gate must fail the
scenarios the real gate blocks, so a gate that silently stopped enforcing would
not still look green. `tests/arming.test.ts` asserts that the agent-facing tool
has no arm or release action and that no prompt regex arms the gate.

## Verified against a live agent

The suite is unit-level, so the gate was also exercised against separate `pi`
processes with the extension loaded and the phase set to `armed`:

| Probe | Result |
| --- | --- |
| "write this file, just do it" | blocked; file never created |
| "spawn a terrarium child, do it now" | blocked; contract demanded first |
| lock a contract, then write | still blocked, because no driver loop exists |
| override with a reason, then write | allowed once, then budget consumed |

Every block and every override appears in the audit log.

## Reaching the gate

When the agent believes the work is done it calls `terraloop_control
action=gate`. That extracts a runnable command from the contract's `proof` field
and runs it. A non-zero exit refuses the gate and the loop continues.

This is the part that cannot be talked past. An earlier build let the agent
declare its own gate met, and a loop mid-flight self-certified and locked itself
down. Verification is now the tool's job.

A proof that cannot be reduced to one runnable command is refused rather than
guessed at. Prose assertions like `bun test >= 77 pass` are rejected on purpose:
the shell would read `>=` as a redirect, write a file called `=`, and exit zero,
falsely passing the gate.

## Limits

This constrains tool calls. It does not constrain judgment. It can force a
contract to be locked and a driver to exist before children are spawned; it
cannot make the contract good or the verification real. Enforcement raises the
cost of skipping a step and leaves a record when a step is skipped. It is not a
security boundary: an agent with shell access can edit the state file or this
extension.

Tool names are matched literally. If `terrarium` or the loop extension renames a
tool, the gate stops recognizing it. `tests/tool-names.test.ts` pins the names
that must classify as spawns so a rename fails the suite instead of silently
disabling the gate.

The mutating-shell classifier is a pattern list, not a shell parser. It catches
ordinary mutation commands and redirects; a sufficiently creative one-liner is not
modelled. This is a workflow gate, not a sandbox. See [SECURITY.md](SECURITY.md).

## Requirements

- Pi >= 0.82
- [Bun](https://bun.sh) for development
- For an actual loop: the `terrarium` MCP server for spawning children, and a
  `loops_task` provider for the recurring driver. The gate itself works without
  them; it simply has nothing to gate.

## Layout

```
extension.ts          Pi wiring: slash commands, tool, tool_call gate
gate.ts               classifies each tool call and decides allow/block
state.ts              per-session phase and contract, persisted to disk
proof.ts              extracts and runs the contract's proof command
skills/terraloop/     the protocol the gate enforces
tests/                phase transitions, classification, negative control
```

## Versioning

Releases are date tags (`2026.7.29`), because `pi install` pins a git ref rather
than resolving a `package.json` range. The tag tells you how stale your pin is,
which is the only question a git-installed extension raises. The version field
stays `0.0.1`.

## License

MIT
