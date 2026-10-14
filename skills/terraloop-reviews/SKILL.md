---
name: terraloop-reviews
description: Start a reusable Terraloop for GitLab merge-request reviews. Use when the user invokes Review Terraloop, asks to review an MR queue continuously, or wants bounded review work with exact-SHA evidence, runnable repros, short educational notes, verified GitLab actions, and explicit human-blocker handling.
---

# Review Terraloop

A review loop keeps the user's review queue empty. Each review is proven, reproducible, and teaches the reader why. The queue is live: the gate discovers it on every run.

```text
/skill:terraloop-reviews <projects, filters, or extra MRs>
```

## Two gates

| Script | Question | Passes when |
|---|---|---|
| `gate.sh --queue …` | Is the queue empty? | No `OWED`, `STALE`, `ASKED`, or `UNBLOCKED` MR |
| `recipe-gate.sh <project> <iid> [--dry-run]` | Was this one review done right? | All recipe gates pass (below) |

Queue states:

| State | Meaning | Action |
|---|---|---|
| `OWED` | No review yet | Full recipe |
| `STALE` | New push since the review | Re-review the interdiff (`git range-diff` for rebases) |
| `ASKED` | Same head, but since the last review a person re-requested review, @mentioned the user, or replied in the user's thread | Read the ask, answer it, re-review if needed |
| `UNBLOCKED` | The last note withheld approval for other people's threads, and none are open now | Re-check the head, then approve |
| `HUMAN` | Matches `--human-title` | Report it, never approve it |
| `ok reviewed` / `ok blocked` | Done at this head | None |

`FAIL notes-read` counts as owed; rerun the gate. A note that withholds approval says `review-waiting-on: <usernames>` so `UNBLOCKED` can find it.

A head-only gate misses a re-review request made without a push. Example: Kylie asked in a chat channel for re-reviews of cf-build-bench !106, !107, and !113 at unchanged heads. The old gate said `ok reviewed` for all three. `ASKED` and `UNBLOCKED` close the GitLab half of that gap.

```bash
bash <skill-dir>/gate.sh --queue \
  --project <group/project> [--project ...] \
  --skip-title '(ship|conversation) digest' \
  --human-title '^(Release |\[ucascade\])'
```

Run the queue gate with `nohup` and a result file. It can take minutes.

## The recipe: one review

Evidence lives in `$REVIEW_RECIPE_DIR/<iid>/` (default `/tmp/rv/recipe/<iid>/`). For a long loop, set `REVIEW_RECIPE_DIR` outside `/tmp`: a reboot clears `/tmp`, and with it the `gate-final.out` proof. Each step writes one file. `recipe-gate.sh` checks the files, not your narration.

| # | Step | File | Gate checks |
|---|---|---|---|
| 1 | **Freshness.** Save the MR JSON. | `mr.json` | head equals live head, MR open |
| 2 | **Pass 1 (parent).** Read every thread, the ticket, and the diff from `diff_refs.base_sha`. Run the narrowest type check and tests at head. Name the risky lines. | `p1.md` with `reviewed-sha:` and `tests:` | names the head, has tests |
| 3 | **Runtime proof.** Probe each behavior claim by running code. | `probe/` | (input to repro) |
| 4 | **Blast radius.** List callers of the changed code. Prove the one fact that makes it safe. | `blast.md` | names the head |
| 5 | **Pass 2 (adversary).** Different model, read-only. Give it head, base, topic, and the threads to skip. Not your verdict. | `p2.out` | has `VERDICT:` |
| 6 | **Reconcile.** Rerun every pass-2 claim. A problem that also exists at the old head is a should-fix, not a blocker. | `reconcile.md` | names the head |
| 7 | **Convergence.** One fresh model that has not seen pass 2's verdict, told what is already covered. | `p3.out` | has `VERDICT:` |
| 8 | **Repro.** Each finding gets an isolated test that fails at head and passes with a fix you tested. | `teach/repro.test.ts`, `teach/repro.env` | `REPRO_CMD` fails at head |
| 9 | **Lesson.** Write the note (format below). | `note.md` | ≤ 25 visible lines, a visual, a `Run it` command, SHA footer |
| 10 | **Post and verify.** Re-fetch head, post, read back, write receipt, push. | `note-id.txt`, `receipt.md` | note with `reviewed-sha:<head>` exists, receipt exists |

Run `recipe-gate.sh … --dry-run` before posting. Run it without `--dry-run` after.

`repro.env` sets `REPRO_CWD` (a worktree at the head) and `REPRO_CMD`. Keep the worktree until the final gate run passes, then remove it.

## Lesson format (the education layer)

Short beats complete. Depth goes in `<details>`. Visible part:

1. **Verdict** in 1-2 sentences.
2. Each finding: a heading, **what is wrong** in ≤ 3 sentences, **one visual** (Mermaid that GitLab renders, or an uploaded screenshot or video), and **Run it**: the one command.

Folded in `<details>`:

- **Why**: ≤ 3 steps, each with a permalink `https://<gitlab>/<project>/-/blob/<full sha>/<path>#L<n>`.
- **Repro** code and the **fix you tested**.
- **Alternatives**: a table of option, trade-off, pick.
- **What else I checked**: tests, blast radius, pass 2 and convergence models and results, threads not repeated.

An approval with no findings still gets a 2-3 line "how I convinced myself" summary.

Pick the visual by finding type: logic or security bug, repro plus walk-through; data or state flow, Mermaid diagram; UI, screenshot or `unsurf` video; performance, a timing at realistic size; design gap, a scenario walk-through.

Humor is optional. Use it only when it does one of three jobs: it makes the point stick, it softens a hard verdict for the author, or it shows the mechanism from a new angle. One line at most, aimed at the code and never at the person, and the fact stays exact. If it does none of these jobs, leave it out.

## Models and cost

| Job | Model |
|---|---|
| Queue reads, thread summaries, triage | cheapest available |
| Pass 1, reconcile, final verdict | the driver |
| Pass 2 | a different strong model; the strongest for auth, secrets, money |
| Convergence | a third model, different vendor if possible |

**Parallel first.** Prefer Terrarium children (`terrarium_spawn` with `background: true`) for pass 2 and convergence: they run in cloud sandboxes, so 6 MRs in flight do not load the laptop. Fall back to local `pi -p --no-session --provider <p> --model <m> < prompt > out` under `nohup` when Terrarium returns `Unauthorized` or cannot reach the GitLab host, and say which runner each pass used in the note. Never put the prompt on argv. If a model refuses with a cybersecurity flag, reword as a correctness review against a written specification and retry once. If it returns 404 or a spending limit, fall back and say so in the note.

## Rules

- Never merge, push, rebase, or edit a colleague's branch. Reviews are notes, discussions, approve, and unapprove only.
- Never approve with a proven blocker, or while a person has an unresolved blocking thread, or on a `HUMAN` MR.
- Never approve, or say "approval stands", while the head pipeline is `failed`. Read the failing job log first. If the failure comes from this MR, it is a blocker. If it comes from a stack parent, withdraw and point at the parent. `recipe-gate.sh` checks this (`ci`).
- A re-review runs the tests the change can break, not only the tests the new commit touched. A changed shared type or table list breaks distant fixtures.
- Re-fetch head and state immediately before posting. If the head moved, the review is `STALE`; redo it.
- After approving, read the approvals list again.
- Do not repeat bot or colleague findings. Refer to them.
- Put inline findings on changed lines. If GitLab returns 400 `line_code`, keep the finding in the note.
- Write notes in ASD-STE100 Simplified Technical English and follow the user's writing guide if one exists (for example `coey.dev/WRITING-GUIDE.md`): open on the finding, name the mechanism, bound each claim, no `→` arrows, no slop words, bold for scanning only. `recipe-gate.sh` checks the mechanical part (`style`).

## Contract

1. `terraloop_control action=arm`. North star: "Keep the user's review queue empty with recipe-gated, educational reviews."
2. Show the contract: projects, filters, allowed actions, duration, both gate commands. Put every reviewed repo, the recipe dir, and the receipts dir in Scope from the start. Wait for go.
3. `terraloop_control action=lock`. The proof is the queue gate.
4. Create one `loops_task` driver after lock, so `/terraloop-off` stops it.

## Driver tick

1. If `terraloop_control action=status` shows `off`, delete the driver and stop.
2. If the last queue-gate result is older than the last tick, start it again with `nohup`.
3. Backup check: read the team review channel named in the contract for re-review asks since the last tick. Treat each linked MR as `ASKED`, even when the gate says `ok`. If no tool can read that channel, say so in the contract and ask the user to forward asks; do not claim coverage.
4. Collect finished children. For each MR at step 10, re-fetch and post. Several posts per tick is normal.
5. Fill free slots (up to 6 MRs in flight, PARALLEL FIRST): run steps 1-4 for the next `OWED`, `STALE`, `ASKED`, or `UNBLOCKED` MRs, then launch their pass-2 children together.
6. Cancel a child whose output has not grown in 10 minutes and relaunch it once.
7. Update `$REVIEW_RECIPE_DIR/state.md`: per MR, head, step, child models, note ID.

A tick returns in about 2 minutes. Slow work runs under `nohup`.

## Speed and stopping

| Mode | Interval | When |
|---|---|---|
| Work | `5m` | Any `OWED` or `STALE`, a child in flight, or a post pending |
| Idle | `10m` | A fresh queue gate exits 0 and nothing is in flight |

Switch with `loops_task action=edit`. On work to idle, run `terraloop_control action=gate` and send one round summary.

The loop ends only when the user stops it, `/terraloop-off` runs, or the contract's duration expires. On a stop, delete the driver in the same turn and report what is still owed.

## Notifications and blockers

- Each posted review: push `job.complete`, title `Reviewed !<iid>`, 1-3 lines, MR URL in the body.
- Each blocker (moved head, auth failure, human-only decision, dying children): push `job.needs_input` once, with 2-4 options. Mark the MR `BLOCKED` in `state.md` and keep working on the others.
- If the push tool is missing, search the tool list before declaring it unavailable.

## Receipt

`receipt.md` fields: `VERDICT`, `HEAD`, `NOTE`, `APPROVALS`, `TYPECHECK`, `TESTS`, `SECOND_PASS`, and `HUMAN` when it applies. Copy it to the receipts dir named in the contract.

## Planned, not installed

`~/cloudflare/review-broker` is a credential broker that would make merging impossible for the reviewer. It is not installed. Do not assume it. Reviews run on the user's token under the rules above.
