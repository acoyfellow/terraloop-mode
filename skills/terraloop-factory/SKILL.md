---
name: terraloop-factory
description: Start a reusable Factory Owner Terraloop for acoyfellow/my-ax. Use when the user invokes Factory Terraloop, factory owner loop, drain the my-ax issue queue, or wants bounded issue-to-verified-PR work with real GitHub, CI, deploy, and factory-job evidence. Supports a dry-run mode that reads state and reports without mutating anything.
---

# Factory Owner Terraloop

This skill turns the parent Pi session into the owner-side operator of the My AX factory. The factory itself is the My AX recurring job that fans out `Issue #<n>:` chats from the Sandbox. This loop supervises it, lands issues as verified PRs, and keeps the job safe.

## Invocation

```text
/skill:terraloop-factory <queue or target instructions>
/skill:terraloop-factory dry-run
```

`dry-run` means: read everything, draft the contract, classify the queue, report through My AX, and stop. Do not arm, lock, spawn, push, comment, label, deploy, or unpause.

## Facts to load first

- Public repo: `/Users/jcoeyman/cloudflare/my-ax` (`acoyfellow/my-ax`). Private deploy wrapper: `/Users/jcoeyman/cloudflare/my-ax-private`.
- Factory job: My AX recurring job `cdc85c19`, cockpit session `94557a5c-2715-4dbe-969e-eea9e5d75183`. Sidecar cron stays off.
- Employee deploy: `cd /Users/jcoeyman/cloudflare/my-ax-private && MYAX_REF=main SKIP_CONTAINER_ROLLOUT=1 SKIP_SECRETS=1 bash ./deploy-employee.sh`. Retry the whole command on a flaky fetch. Never `SKIP_INSTALL=1`.
- My AX runtime: Worker → `UserAgent` DO → per-session `MyAgent` Think facets. Containers (`Sandbox`, `NamedComputer`) are tools. `MachineHost` relays to the owner's Mac.
- Owner reach: My AX MCP `notify_owner`, `desk_upsert`, `ask_owner`, `my_ax_check_in`.

## North star

Arm with:

> Drain the owner-approved my-ax issue queue into CI-green, owner-reviewable PRs or explicit human-blocker receipts, keeping the factory job paused unless the owner unpauses it.

Arm only when the user asks to run the loop. Never for a question about the skill.

## Contract on-ramp

After arming, show this contract with the live queue filled in and wait for **go**:

- Goal: every in-scope open issue is either a CI-green PR with `Closes #<n>` and a regression test that fails without the fix, or closed as stale with evidence, or labeled `triage:needs-human` with a reason posted.
- Gate: `bash <skill-dir>/gate.sh <issue numbers>` exits 0. For each open issue it requires an open PR whose body says `Closes #<n>` for that exact number, that changes at least one test file and one non-test file, and whose checks are green. It fails closed when `gh` is missing or not authenticated. It cannot prove that the test fails without the fix, so keep the red and green outputs in the PR body.
- Scope: the two repo paths above, the listed issue numbers, their `bot/issue-<n>` branches, and PRs opened by this loop.
- Proof: per issue the PR URL, head SHA, `gh pr checks` result, test command and output, and the regression-test name.
- Policy: may branch, commit, push, open PRs, and comment on in-scope issues. Never merge, never force-push someone else's branch, never deploy, never unpause the factory job, never touch `machine.*` or cmux from inside My AX. Merge and deploy need the owner to name the PR in this session.

The proof is a command that measures live state. Never accept a receipt the loop wrote itself.

## Driver

1. `terraloop_control action=lock` with the contract.
2. `loops_task` driver every 10m, max 36 runs, carrying goal, gate, scope, active run IDs, and "delete yourself when gate.sh exits 0 or every remaining issue is blocked".
3. The parent takes the cheapest next issue itself.
4. Use Terrarium only for independent issues in parallel (`isolation: worktree`), with `taskProof` set to `gh pr view <branch> --json state -q .state` plus the narrow test.
5. On child completion, re-read the PR, rerun the test locally, and check that the diff matches the issue before counting it.

## Per-issue invariants

- Re-read the issue and comments. Reproduce or cite the exact failing path before editing.
- Branch `bot/issue-<n>` from fresh `origin/main`.
- Add or change a regression test that fails before the fix. Run it red, then green, and keep both outputs.
- Run `npx tsc --noEmit -p .` and the touched test files. No new source comments (pre-commit hook enforces this). Never use `--no-verify`.
- Public-clean: no employee hosts. Tests use `example.com`.
- PR body: `Closes #<n>`, root cause, test name, commands run.
- Wait for `gh pr checks` to pass. On red CI, fix at most twice, then block.
- Chore-only or empty diffs do not count.

## Queue rules

- Default queue: open issues labeled `bug` without `triage:needs-human` and without `needs-owner-video`.
- Skip issues that already have an open PR unless it is stale or red.
- Draft-labeled issues need a reproduction first. If none is possible, label them needs-human with the reason.

## Factory job safety

- Read the job's pause state at the start and at every tick. If it is unpaused and the owner did not do that in this session, stop and notify.
- A factory dry-run is one inject into the cockpit with the tool log saved. It fails closed on any `machine.*` or cmux call. Do it only when the contract names it.

## Blockers and notifications

Stop and `notify_owner` on expired auth (gh, wrangler, My AX), SHA movement mid-review, red CI after two fixes, an ambiguous issue, or a human-only decision. Include the issue URL, branch, SHA, the attempted step, the blocker receipt, and the decision you need. Put multi-issue status on the desk with `desk_upsert`.

## Stop

When gate.sh exits 0: `terraloop_control action=gate`, delete the driver, `notify_owner` with a short summary, and report per issue the PR URL, SHA, checks, and test name. Only the user can leave with `/terraloop-off`.
