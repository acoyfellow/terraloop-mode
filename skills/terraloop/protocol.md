# Terraloop Protocol (project-agnostic)

The shared operating protocol for any terraloop. A project's own loop contract
(its goal, paths, PASS criteria) lives in that project's file and says
"Follow .context/TERRALOOP.md". This file is generic: it never names a project.

## What a terraloop is

A **parent-driven** loop toward a falsifiable gate. The parent is the default
implementer. Terrarium is a lever the parent picks up for a named reason, not
the default place work happens.

The driver (`loops_task`) is a **long safety net**. It re-injects a prompt only
when the session is **idle**. Speed comes from the **current turn** and from
**Terrarium completion callbacks**, not from waiting for the next heartbeat.

If this turn still has in-scope work, do it now. Ending the turn so the
heartbeat can continue is a protocol violation: that is a dead spot.

If you cannot name a lever in one line, do the work in the parent. A child
without a lever is wasted tokens and extra failure modes.

## Capability narrowing (non-negotiable)

A child must not receive a wider capability than the parent has in this session.

- Locked **scope** applies to the parent **and** to every child. A spawn whose
  `cwd` (or any batch job `cwd`) sits outside the locked scope is a protocol
  violation and must be refused.
- Do not spawn a child to edit a path the parent was just blocked from writing.
  That is scope laundering. Out of scope → stop and ask, `/terraloop-off`, or
  re-lock a contract that names the path.
- Do not raise `maxDepth`, `allowSpawn`, or write isolation beyond what the
  parent is allowed. Children inherit a subset, never a superset.
- An override grant is a rare exception (out of scope, or work after the stop
  gate). It is not a license to delegate an out-of-scope write. Ordinary
  in-scope parent edits do not use override.

The gate is not a suggestion. Sidestepping it with a child is the failure this
rule exists to prevent.

## When to use Terrarium (levers)

Spawn only when at least one lever is true. Write that lever in the child task.

| Lever | Use when | Example |
| --- | --- | --- |
| **Parallel** | Two or more independent jobs can run at the same time | Three read-only audits of different trees |
| **Isolate** | A writer must not touch the parent working tree | `isolation: "worktree"` for a refactor |
| **Bound** | Long or risky work you may cancel, with a receipt | `timeoutMs` plus `taskProof` |
| **Context** | A huge read-only dig that would bloat the parent | `readOnly: true`, `profile: "minimal"` |
| **Proof** | An external fact the parent must not take from chat | Child runs tests; parent reruns the same command |

No lever → no spawn. Edit in the parent. Do not take an override for ordinary
in-scope work.

## Antipatterns (protocol violations)

- **Scope laundering.** Parent blocked on a path → spawn a child with `cwd` on
  that path. Children inherit the locked scope.
- **One-line via child.** A single local edit. That is 2–4× tokens. Parent edits.
- **Twin spawn.** `spawn` / `spawn_batch` RPC timed out → assume nothing started
  → spawn the same jobs again. Recover IDs. Never resubmit the same job set.
- **List to check one child.** `terrarium_status({ limit, sinceMs, verbose })`
  instead of `{ runId }`.
- **Shared-cwd writers.** `isolation: "none"` when more than one child can write.
- **Hook-fail respawn.** Log is only the Terrarium banner plus a
  session-start / prompt-submit hook failure → spawn again. Cancel once; same
  stall → parent does the work.
- **Exit 143 as a result.** Leftover `Cancelled` callbacks are SIGTERM corpses,
  not research.
- **Yielding to the heartbeat.** Ending the turn while in-scope work remains,
  so `loops_task` can continue later. The heartbeat only runs when the session
  is idle. That wait is a dead spot. Exhaust the turn.
- **Heartbeat during cancel.** A 30s / 2m driver still firing while you reap.
- **`-ne` on Pi** when the model provider comes from an extension.
- **Trusting `ok: true`, `status: running`** when the log has no model output.
- **Granting a child more than the parent has.** Wider cwd, higher depth, or
  spawn rights the parent lacks.

## Required tools (a terraloop needs BOTH)

A terraloop is built from two concrete pi tools. Without them, this is just prose.
The `terraloop-mode` extension enforces that both are actually used: spawning
without a locked contract, or spawning without a driver loop, is blocked at the
tool call rather than left to the agent's discretion.

1. **`terrarium` MCP** — optional lever for bounded children. Core actions:
   - `terrarium_spawn` — start one bounded child (`background: true` to detach;
     the Pi extension auto-subscribes and surfaces the terminal completion
     callback). Name the lever in the task.
   - `terrarium_spawn_batch` — fan out independent jobs under one group with a
     join strategy (all / allSettled / race / any / quorum). Same lever rule
     per job. Prefer `isolation: "copy"` or `"worktree"` for writers.
   - `terrarium_status` — check one known child with
     `terrarium_status({ runId })`. List-mode (no `runId`, or
     `limit` / `sinceMs` / `verbose`) is expensive and, when cloud is
     configured, hits the remote index. Do not use list-mode to inspect a child
     you already have an ID for.
   - `terrarium_read` — read the tail of a child's run log (or its mre log).
   - `terrarium_cancel` — reap a stalled/hung/runaway child (SIGTERM its group).
   - `terrarium_callbacks` / `terrarium_group` / `terrarium_doctor` — durable
     callback plumbing, group roll-ups, and diagnostics.
   Children are spawned with an explicit `agent` (e.g. `pi -p --no-session`),
   `readOnly` for digs, `background`, `timeoutMs`, `needsAttentionAfterMs`,
   `maxDepth`, and a `channel`. `cwd` must stay inside the locked scope.

   Do not add `-ne` (`--no-extensions`) when the model provider comes from an
   extension. Disabling extensions makes an extension-provided provider
   unavailable. Use plain `pi -p --no-session`. If project-local extensions
   truly collide, disable the specific extension instead of all of them.

2. **`/loop` pi extension (`loops_task`)** — the recurring DRIVER. It re-injects
   a prompt on an interval **only while the session is open and idle**. It is
   not the fast path. The fast path is: finish this turn, and ride Terrarium
   completion callbacks that wake the session immediately.
   - `loops_task action=create` with `interval` (e.g. 30s, 2m, 2h, 1d), `prompt`
     (the full driver instructions incl. the stop gate + the child run IDs),
     `maxRuns`, `expiresIn`.
   - `loops_task action=list | delete | clear` — inspect or stop the driver.
   - DELETE the loop the moment its terminal/stop condition is met (the driver
     prompt must say so), so it does not spin against a satisfied or human-gated
     gate.

Pattern: `loops_task` create the driver. **This turn** does the next cheap
in-scope step until the turn is exhausted. If a completion callback arrives,
`terrarium_status({ runId })` + `terrarium_read`, verify, then the next step —
still in this turn if work remains. The heartbeat only covers the case that the
session actually went idle with nothing left to do. On the stop gate,
`loops_task delete`. Do not list recent runs or pass `verbose` unless `pid` or
`logPath` is required. Do not sleep or poll inline.

> **Terrarium usage**
>
> - Spawn only with a named lever, `background: true`, and ride completion
>   callbacks.
> - Local-shaped `ter_YYYY...` IDs stay local; cloud-shaped IDs go to the edge.
> - Cloud is the default when a URL and token exist. Use local only with
>   `TERRARIUM_ALLOW_LOCAL=1` **and** a filesystem/process-dependent task; there
>   is no silent fallback.
> - `Failed to call tool: Request timed out` plus an Expected-parameters dump is
>   an MCP RPC deadline, not bad arguments. Do not retry the same list call.
>   A timed-out `terrarium_spawn` or `terrarium_spawn_batch` RPC is also not
>   evidence that nothing launched: children may already be running. Recover
>   known IDs with by-ID status; if no IDs are known, make one narrow list-mode
>   recovery request filtered by that invocation's `channel` and `sinceMs`, with
>   no `verbose`. Never submit the same jobs again. Duplicate writers are a
>   protocol violation.
> - If by-ID status times out, the MCP server is stuck: use `terrarium_doctor` /
>   `terrarium_cancel`; do not widen the request to list-mode.

3. **`terraloop_control`** — the gate's own tool: `arm` the mode with a north star
   when the user asks for a loop, `lock` the contract, `override` a block with a
   recorded reason, `gate` when the stop condition is met, `status` to read the
   current phase. It cannot release the mode; only the user can, with
   `/terraloop-off`.

## Core rules

1. Define the goal as something FALSIFIABLE or BINARY before starting. "Done"
   must be checkable, not a vibe.
2. The parent is the default worker. Spawn only when a lever is named.
3. Prefer PARALLEL over sequential **when a Parallel lever exists**. Independent
   work may spawn concurrently; a single edit must not.
4. Work BACKWARD from the goal when the goal is a destination: name the end
   state, then the smallest step that unlocks the next, then run them.
5. The current turn is the fast path. Ride Terrarium completion callbacks;
   do not sleep or poll inline. Do not end the turn while an in-scope next
   step exists. The heartbeat is only the idle safety net. Each callback or
   exhausted-turn tick reaps, verifies, then does the next parent step or one
   justified spawn.
6. Any child that can write must use `isolation: "copy"` or
   `isolation: "worktree"`; `isolation: "none"` in a shared cwd is forbidden
   whenever more than one child can write. `cwd` must be inside locked scope.
7. Small in-scope parent edits happen in the parent. Do not spawn a child to
   escape a scope block. Override is only for a genuine exception.

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
  do not immediately respawn the same shape.
- Before cancelling a stalled child or beginning any cancellation sequence, pause
  or delete the heartbeat/driver loop. Do not leave a 30s or 2m driver firing
  while cancellation is in progress.
- For a spawn stall, wait through the attention window. If the log contains only
  the Terrarium banner plus a session-start/prompt-submit hook failure, with
  no model output, cancel that child once. If the same hook-fail stall recurs for
  that piece, stop delegating it and perform the bounded work in the parent with
  `terraloop_control action=override`; do not launch a third wave.
- After a cancellation, callbacks reporting `Cancelled` with exit 143 are
  SIGTERM corpses, not research results. Ignore leftover cancellation callbacks;
  do not treat them as new work.
- A child hung WITH work done: `terrarium_cancel`, then verify and integrate what
  landed (`terrarium_read` the log; re-check the receipt/files).
- A terminal completion callback is a notification that a run finished, NOT proof
  it succeeded — always confirm with the run's receipt/output (verify-it-yourself).

## Consolidate and re-steer

When children finish, do not just collect — synthesize: what did the SET teach?
Did earlier results change the next experiment's question? Re-steer. Spawn a
follow-on child only if a lever still applies. The loop may grow new work it
discovers; it may not grow a child to dodge the fence.

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
- No `find /`. Keep children bounded and inside the locked scope.
