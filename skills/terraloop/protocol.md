# Terraloop Protocol (project-agnostic)

The shared operating protocol for any terraloop. A project's own loop contract
(its goal, paths, PASS criteria) lives in that project's file and says
"Follow .context/TERRALOOP.md". This file is generic: it never names a project.

## What a terraloop is

A driver loop (a recurring prompt, or a parent agent) that advances bounded work
toward a defined goal by spawning child agents, verifying their output, and
iterating until a clear stop gate is met. The driver does not do the deep work
inline when it can delegate; it orchestrates, verifies, consolidates, re-steers.

## Required tools (a terraloop needs BOTH)

A terraloop is built from two concrete pi tools. Without them, this is just prose.
The `terraloop-mode` extension enforces that both are actually used: spawning
without a locked contract, or spawning without a driver loop, is blocked at the
tool call rather than left to the agent's discretion.

1. **`terrarium` MCP** — spawns and manages the child agents. Core actions:
   - `terrarium_spawn` — start one bounded child (background=true to detach; the
     Pi extension auto-subscribes and surfaces the terminal completion callback).
   - `terrarium_spawn_batch` — fan out many children under one group with a join
     strategy (all / allSettled / race / any / quorum).
   - `terrarium_status` — poll runs in the caller's lineage scope.
   - `terrarium_read` — read the tail of a child's run log (or its mre log).
   - `terrarium_cancel` — reap a stalled/hung/runaway child (SIGTERM its group).
   - `terrarium_callbacks` / `terrarium_group` / `terrarium_doctor` — durable
     callback plumbing, group roll-ups, and diagnostics.
   Children are spawned with an explicit `agent` (e.g. `pi -p --no-session`),
   `readOnly` for digs, `background`, `timeoutMs`, `needsAttentionAfterMs`,
   `maxDepth`, and a `channel`.

   Do not add `-ne` (`--no-extensions`) when the model provider comes from an
   extension. `-ne` disables extension discovery, so the provider is no longer
   registered and every child dies in about one second with
   `Unknown provider "<name>"`. Example: `opencode.cloudflare.dev` is supplied
   by the `opencode-cloudflare` extension, so `pi -ne -p --provider
   opencode.cloudflare.dev` always fails. Use plain `pi -p --no-session`. If
   project-local extensions truly collide, disable the specific extension
   instead of all of them.

2. **`/loop` pi extension (`loops_task`)** — the recurring DRIVER. It re-injects
   a prompt on an interval while the session is open and idle, so the parent
   keeps reaping/verifying/advancing without a human re-prompting each tick.
   - `loops_task action=create` with `interval` (e.g. 30s, 2m, 2h, 1d), `prompt`
     (the full driver instructions incl. the stop gate + the child run IDs),
     `maxRuns`, `expiresIn`.
   - `loops_task action=list | delete | clear` — inspect or stop the driver.
   - DELETE the loop the moment its terminal/stop condition is met (the driver
     prompt must say so), so it does not spin against a satisfied or human-gated
     gate.

Pattern: `loops_task` create the driver -> each tick the driver `terrarium_status`
the children, `terrarium_read`/`terrarium_cancel` as needed, verifies, spawns the
next `terrarium_spawn`(_batch), and on the stop gate calls `loops_task delete`.
Do not sleep or poll inline; ride the terrarium completion callbacks between ticks.

3. **`terraloop_control`** — the gate's own tool: `arm` the mode with a north star
   when the user asks for a loop, `lock` the contract, `override` a block with a
   recorded reason, `gate` when the stop condition is met, `status` to read the
   current phase. It cannot release the mode; only the user can, with
   `/terraloop-off`.

## Core rules

1. Define the goal as something FALSIFIABLE or BINARY before starting. "Done"
   must be checkable, not a vibe.
2. Prefer PARALLEL over sequential. Before running one thing, ask what can run at
   the same time. Independent work spawns concurrently.
3. Work BACKWARD from the goal when the goal is a destination: name the end
   state, then the smallest step that unlocks the next, then run them.
4. The driver rides callbacks; it does not sleep or poll inline. Each tick
   reaps finished children, verifies, and advances ONE step.
5. Spawn bounded children for deep work. Give each child one clear objective,
   its PASS criteria, and the safety rules. Read-only digs are read-only; builds
   commit; only the gate step deploys.
6. The driver does not edit, write, or run mutating shell inline while driving.
   That is enforced. When a piece genuinely must be done inline (a child that
   stalls the same way twice), take a bounded `terraloop_control action=override`
   with a real reason instead of trying to slip past the gate.

## Verify-it-yourself (non-negotiable)

A child's "done" is a claim, not proof. The driver re-checks every result:
re-read the receipt, re-run the test, curl the live endpoint, grep for the thing
that must/must-not be present. A terminal callback means a run finished, not that
it succeeded. Reject demos-as-proof. If you cannot verify it, it is not done.

## Honesty bar

- A demo is not proof; a receipt is. Separate PROVEN (with evidence) from CLAIMED.
- Never fabricate a number, metric, curve, output, or result. If a model,
  service, or harness is unreachable, run the part that is real and SAY which
  part was not. A labeled partial is acceptable; an invented result is not.
- Do not let copy/docs/claims outrun the evidence. Downgrade the claim or get
  the evidence.

## Review to zero (when a quality bar applies)

After a build, run an adversarial review (a "Dane"/red-team pass, or domain
critics) that tries to PROVE the work is wrong/overclaimed/insecure/ugly. Each
objection is a work item. Targeted fix round for EXACTLY the objections, then
re-review. Advance ONLY on zero must-fix objections across all required axes.

## Handling flaky / stalled / runaway children

- A child that runs `find /` or similar runaway: KILL it (pkill the pattern) and
  respawn leaner with explicit paths.
- A child stalled at spawn (supervisor alive, no worker process, log/mre frozen
  and zero output past the attention threshold): `terrarium_cancel` it and respawn
  (often `pi -ne` to dodge a project-local extension collision). Confirm death via
  `terrarium_status` + process check + a frozen/0-byte mre log before reaping.
- If a child stalls the SAME way twice: stop delegating that piece and do it
  directly. The spawn layer can be flaky; bounded edits/verification are runnable
  inline by the driver (the driver still owns verification either way).
- A child hung WITH work done: `terrarium_cancel`, then verify and integrate what
  landed (`terrarium_read` the log; re-check the receipt/files).
- A terminal completion callback is a notification that a run finished, NOT proof
  it succeeded — always confirm with the run's receipt/output (verify-it-yourself).

## Consolidate and re-steer (parent of parallel children)

When children finish, do not just collect — synthesize: what did the SET teach?
Did earlier results change the next experiment's question? Re-steer: if a child's
PASS criteria were wrong or a result reveals a sharper question, REWRITE it and
re-run. Spawn FOLLOW-ON children when there is a clear next step. The loop is
allowed to grow new work it discovers.

## Receipts and state

- Each unit of work leaves a machine-verifiable receipt or finding a skeptic can
  re-run or inspect: real inputs, real outputs, the metric, an honest note on
  limits. Deposit receipts in the project's workspace, not in a deployable repo.
- Keep a status record (what's proven, what's next) updated each iteration.

## Stop gate

Define it up front and honor it. Typical gates: "every required axis is
review-zero and shipped," or "every open question is answered-with-a-receipt or
explicitly blocked on a named unreachable dependency, and the goal is clearly
achievable." Stop when the gate is met — do not spin a loop against a boundary
only a human can clear; surface it and stop. Delete the driver loop on stop and
report: what's proven, what's the clear path forward, what each follow-on tests.

## Safety (always)

- Never commit or print secrets/tokens/credentials. Keep workspace context
  (.context), local secrets (.dev.vars), and guardrail artifacts (.guardrail) out
  of deployable/public repos.
- Respect deploy guardrails; never bypass them. Verify auth still gates after a
  deploy. Clean up any test data from shared/live state.
- Additive over destructive (additive migrations, no data loss). Reuse one
  canonical implementation; do not fork logic. Lean on existing primitives.
- No `find /`. Keep children bounded and scoped.
