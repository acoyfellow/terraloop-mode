---
name: terraloop-tickets
description: Start a never-ending Terraloop that liquidates the user's Jira tickets. Treats the weekly board as a state machine, moves each ticket to its next state with proof, drives the ticket's MRs to green, and falls back to a steady check for new work. Use for ticket liquidator, work my board, Ticket Terraloop, /skill:terraloop-tickets, or keep my Jira moving.
---

# Ticket Terraloop

The loop keeps the user's board moving. Each ticket is in one state. Each state has one next action. The loop never ends by itself: only the user stops it, with `/terraloop-off`.

```text
/skill:terraloop-tickets [extra JQL or ticket keys]
```

Sibling of `terraloop-reviews`. That loop reviews other people's MRs. This one drives the user's own tickets and MRs.

## The gate

`gate.sh` reads the live board on every run. It never trusts an earlier result.

```bash
nohup bash <skill-dir>/gate.sh > ~/cloudflare/.context/tickets/gate.out 2>&1 &
```

- Source: `assignee = currentUser() AND statusCategory != Done` through `cfi --json jira query`.
- MRs: the user's GitLab MRs and GitHub PRs (`gh`, `author:@me`) whose title, branch or description name the key. A merged GitHub PR counts as not released, so its ticket waits in `WAIT` until the user confirms the release.
- Released: the merge commit is an ancestor of `origin/main` in `~/cloudflare/cloudflare-agent`.
- Parked: keys in `~/cloudflare/.context/tickets/parked.txt`, one per line. The user decides what goes there.
- Asked: `~/cloudflare/.context/tickets/asked.txt`, one line per key: `KEY  # reason`. Any reason makes the row `HUMAN`, so the loop stops asking. A reason that starts with `DECIDED` makes it a `DECIDED` work row: the loop acts on the user's answer. Keep one line per key; the gate reads only the first.
- Output: `STATE KEY STATUS MRS NEXT SUMMARY`, then `SUMMARY work=N`. Exit 0 only when `work=0`.

## The state machine

| Jira status | Condition | State | Next action | Ask first? |
|---|---|---|---|---|
| To Do / Backlog | an MR is open | `MOVE` | Move to In Progress (21) | no |
| To Do / Backlog | untouched 30+ days | `STALE` | Ask: plan, park or close | yes |
| To Do / Backlog | otherwise | `TRIAGE` | Write a plan in `plans/<key>.md`, then ask to start | yes, to start |
| In Progress | an MR has conflicts, open threads, a red pipeline or is draft | `MR_WORK` | Fix it (rules below) | no |
| In Progress | all open MRs green | `MOVE` | Move to In Review (61) | no |
| In Progress | MRs merged, none open | `MOVE` | Move to Awaiting Release (71) | no |
| In Progress | no MR | `BUILD` | Build it, open an MR | yes, scope first |
| In Review | an MR is not green | `MR_WORK` | Fix it | no |
| In Review | MR green, needs approvals | `HUMAN` | Ask who reviews | yes |
| In Review | MRs merged | `MOVE` | Move to Awaiting Release (71) | no |
| Awaiting Release | merge commit on `main` | `MOVE` | Close (31) with the release proof | no |
| Awaiting Release | not on `main` yet | `WAIT` | Nothing | - |
| Blocked / unknown | - | `HUMAN` | Report it | yes |
| parked | - | `PARKED` | Nothing | - |
| asked, no answer | - | `HUMAN` | Nothing until the user answers | - |
| asked, `DECIDED` | - | `DECIDED` | Do the decided step, then rewrite the line | no, already decided |

Work states: `MOVE`, `MR_WORK`, `BUILD`, `TRIAGE`, `STALE`, `DECIDED`. Quiet states: `HUMAN`, `WAIT`, `PARKED`, `ok`.

## MR_WORK rules

- Rebase on conflicts. Never `--no-verify`.
- Each review thread: check the claim, then fix it or push back with proof, then reply and resolve.
- Red pipeline: read the failed job log, fix the cause if it is from this MR.
- Undraft only when green: pipeline success, no conflicts, 0 open threads.
- A new test must fail on the old code and pass with the fix. Record both runs.
- Run the narrowest type check and tests, then the full suite under `nohup`, before each push.

## Moving a ticket

1. `cfi jira transition <KEY> <id> --dry-run`, check the payload.
2. Run it with `--confirm` only for rows marked "no" in the table, or after the user says go.
3. Add one comment with the proof: MR link, merge commit, or release commit. Same dry-run, confirm steps.
4. Re-read the ticket and record the new status in the receipt.

## Never

- Merge an MR, close an MR, or close a ticket that is not `Awaiting Release` with a release proof, without the user's go.
- Message, tag or @mention anyone. Thread replies on the user's own MRs are allowed, except where the user has named a person to avoid.
- Request reviewers. Ask the user who.
- Edit parked tickets or move a ticket backwards.

## Contract

1. `terraloop_control action=arm`. North star: "Keep the user's Jira board moving: every ticket in its next state, with proof."
2. Run the gate once. List every repo that its MRs and PRs live in, including GitHub repos. The scope is fixed at lock time; a repo left out cannot be changed later without `/terraloop-off` and a new lock.
3. Show the contract: JQL, parked list, asked list, allowed actions, gate command, and scope: `~/cloudflare/.context/tickets`, every repo from step 2, and their worktrees. Wait for go.
4. `terraloop_control action=lock` with the gate as proof and `merge: never`.
5. Create one `loops_task` driver.

### Known gate limits

- Once the loop reaches its stop gate, the gate blocks `git push` and can block every shell command, even with override grants left (20 per loop). Push and run full suites while the loop is driving. If the loop is gated and a push is needed, ask the user for `/terraloop-off` and a new lock.
- Hooks may block a command that names `gate.sh` with no time limit. Run it as `perl -e 'alarm 110; exec @ARGV' bash <skill-dir>/gate.sh` or under `nohup`.

## Dry run

Before the first lock, and after any change to `gate.sh`, run the gate twice with no writes:

1. Run the gate twice, a few seconds apart, into two files.
2. Both runs must exit with the same code, and the `STATE KEY` columns must match.
3. Check by hand: each `HUMAN` row has a reason, each `DECIDED` row has an action, and no ticket shows `none` when it has a PR.
4. Report the table to the user. Lock only after they say go.

## Driver tick

1. If `terraloop_control action=status` shows `off`, delete the driver and stop.
2. If `gate.out` is older than the last tick, start the gate again under `nohup`.
3. Take the first work row. Do one bounded step for it. Slow steps (tests, full suites) run under `nohup`; collect them next tick.
4. Batch every ask-first row into one message to the user. Send it once per new row, not every tick.
5. Write `~/cloudflare/.context/tickets/state.md`: per ticket, state, last action, receipt path.
6. Receipts go in `~/cloudflare/.context/tickets/receipts/<KEY>-<UTC time>.md`.

## Speed

| Mode | Interval | When |
|---|---|---|
| Work | `5m` | any work row, or a job in flight |
| Idle | `30m` | `work=0` and nothing in flight |

Idle is not done. The loop keeps checking for new tickets and new review threads until the user turns it off. On work to idle, run `terraloop_control action=gate` and send one short summary.
