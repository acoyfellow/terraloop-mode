---
name: terraloop-reviews
description: Start a reusable Terraloop for GitLab merge-request reviews. Use when the user invokes Review Terraloop, asks to review an MR queue continuously, or wants bounded review work with exact-SHA evidence, verified GitLab actions, and explicit human-blocker handling.
---

# Review Terraloop

A review loop keeps the user's review queue empty. The queue is live. It is never a list that was written down at the start.

## Invocation

```text
/skill:terraloop-reviews <projects, filters, or extra MRs>
```

`/terraloop:reviews` is not a Pi skill command. Use the form above.

## The rule that matters most

**The gate discovers the queue each time it runs.** New MRs, new pushes to reviewed MRs, and MRs added by the user all count. The loop is done only when the live queue is empty. A fixed list of MRs is only a starting point.

Failure this rule prevents: a loop locked on 12 MRs reported "done" while new MRs (for example !776) sat unreviewed.

## Gate

```bash
bash <skill-dir>/gate.sh --queue \
  --project <group/project> [--project ...] \
  --skip-title '<regex>' --skip-author '<regex>' \
  --human-title '<regex>' \
  [<group/project!iid> ...]
```

The gate finds:

- open, non-draft MRs where the user is a reviewer or assignee, and
- every open, non-draft MR in each `--project`, and
- each extra `group/project!iid` the user names.

It leaves out the user's own MRs and MRs that match the skip filters.

Each MR gets one state:

| State | Meaning |
|---|---|
| `ok reviewed` | The user has a note with `reviewed-sha: <current head>`. |
| `ok blocked` | The user has a `review-blocked:` note that names the current head. |
| `STALE` | The user reviewed or approved an older head. A new push happened. Review again. |
| `OWED` | No review from the user. |
| `HUMAN` | Matches `--human-title` (releases, auto-merge MRs). Report it. Do not approve it. |

The gate exits 0 only when there are no `OWED` or `STALE` lines. An approval alone does not pass after a new push, because approvals do not show the head they were given on.

Default filters for the AX team:

```bash
--project cloudflare/ai-agents/cloudflare-agent --project cloudflare/ai-agents/clankd \
--skip-title '(ship|conversation) digest' \
--human-title '^(Release |\[ucascade\])'
```

Drafts are skipped. Review a draft only when the user names it.

The gate can take minutes on a large queue. Run it with `nohup` and a result file. Do not run it in the foreground of a tick.

## Contract

1. Arm with `terraloop_control action=arm`. North star: "Keep the user's GitLab review queue empty, with two-pass, SHA-bound verdicts."
2. Show a short contract: projects, filters, extra MRs, allowed actions (comment, approve, request changes), and the gate command above. Wait for the user to confirm.
3. Lock it with `terraloop_control action=lock`. The proof is the gate command.

Never merge, push, change a colleague's branch, or approve a release unless the contract says so.

## Tier 1: run through the review broker

Reviews run as tier 1. The reviewer runs as the macOS user `reviewer`, with `REVIEW_TIER=1`, `GLAB_CONFIG_DIR=$HOME/.config/review-broker-glab`, and `GITLAB_HOST=127.0.0.1:8443`. glab talks only to the local broker (`~/cloudflare/review-broker`). The broker allows reads, notes, discussions, resolve, approve, and unapprove. It rejects merge, auto-merge, rebase, repository writes, and GraphQL mutations with 403, and it alerts the owner.

A 403 from the broker is final. Report it to the owner. Do not try another path, such as curl, a browser, a script, or a different token. If the session has a real GitLab token, stop and tell the owner. That is a setup fault.

## Parallel first

**This is the default mindset. Write "PARALLEL FIRST" in every contract and driver prompt.** MRs are independent. Work them in parallel. Do not walk the queue one MR at a time. On the first tick, start pass 2 for every independent owed MR at once.

- Keep up to **6 MRs in flight** at once. Every in-flight MR has its own background pass-2 child.
- Launch new pass-2 children together with `terrarium_spawn_batch` (`background=true`, strategy `allSettled`). Use one job per MR, and give each job its own `model`.
- Run tests for several MRs at the same time, each under `nohup` with its own result file.
- The parent does pass 1 for the next MRs while their children run. Each first pass stays short: diff, threads, the risky lines.
- A stacked chain (for example slices 1/9 to 9/9) still runs in parallel. Diff each slice from its own `diff_refs.base_sha`.
- Batch independent GitLab reads (MR, notes, approvals) in one `codemode` call with `Promise.allSettled`.

## Driver tick

Create one `loops_task` driver. It never stops by itself (see "Never stop: change the speed"). Each tick:

1. Read the last gate result file. If it is older than the last tick, start the gate again with `nohup`.
2. Collect finished pass-2 children. Rerun their claims and post every MR that is ready. Several posts in one tick is normal.
3. Fill the free in-flight slots: do a quick pass 1 on the next `OWED` or `STALE` MRs, then launch their pass-2 children in one batch.
4. Cancel any child whose log has not grown for 10 minutes, file `terrarium_report_failure`, and relaunch it.
5. Update the state file with, for each MR: head SHA, stage, run IDs, and note IDs.

A tick returns in about 2 minutes. Run slow work (tests, installs, the gate) with `nohup` and a result file.

## Never stop: change the speed

The review loop does not end when the queue is empty. Only the user ends it: by saying so, by `/terraloop-off`, or by deleting the driver. "Loop off" from the user stops the timer, not the reviews. If MRs are still owed, ask with `ask_owner` before you drop them.

The driver has two speeds. It changes its own interval with `loops_task action=edit` (the edit keeps the same driver running).

| Mode | Interval | When |
|---|---|---|
| **Work** | `5m` | The gate shows any `OWED` or `STALE` MR, or a pass-2 child is in flight, or a post is pending. |
| **Idle** | `10m` | A fresh gate run (started after the last post) exits 0, and nothing is in flight. |

- **Work to idle.** A fresh gate run exits 0 and no child is in flight. Run `terraloop_control action=gate`. Send one `job.complete` push with the round summary: every MR with its head SHA, verdict, note ID, and second-pass model, plus all `HUMAN` MRs and open blockers. Then edit the driver to `10m`. Do not delete it.
- **Idle tick.** Run the gate only (in the background, result file). Do nothing else. Send no push when nothing changed.
- **Idle to work.** The gate shows an `OWED` or `STALE` MR. Edit the driver to `5m` in the same tick, and start pass 2 for every owed MR at once (Parallel first). Do not wait for the next tick.
- "Truly nothing to do" means: the gate exits 0, no child is running, no post is waiting, and no blocker reply is waiting. If any one is false, stay in work mode.
- Record the mode and the interval in the state file every tick.

If the user says the queue is not done, believe it. Run the gate again, find the gap, fix the gate filters, and continue.

## Two passes before any post

1. **Pass 1, parent (`claude-opus-5-5`).** Read every existing thread first. Diff from the MR's `diff_refs.base_sha`. Run the narrowest type check and tests with `nohup`. Probe the changed logic.
2. **Pass 2, background child, read-only, different model.** Use `gpt-6-astra` for auth, credentials, secrets, sandboxing, or leaks. Use `claude-fable-5-1` for all other work. Always pass `model` and `startupWatchdogMs=900000`. Give the child the head and base SHA, the topic, and the list of existing threads, so it does not repeat them. Do not give it pass 1's verdict. Each finding needs BLOCK, NIT, or QUESTION, file:line at the head, and a command. The child ends with a line that starts with `VERDICT:`.
3. **Reconcile.** Rerun every pass-2 claim yourself. Fix wrong line numbers before citing.
   - A proven BLOCK blocks. Redo the work, then run a new pass 2. After 2 rounds, post a `HUMAN:` receipt with both positions. Do not approve.
   - A BLOCK you disprove becomes a question or a nit.
   - A problem that also exists at the old head is a nit, not a blocker.
   - For design docs, gaps are comments, not blocks.
4. Never post before pass 2 finishes.

When you read child logs, match `^VERDICT` only, because the task text is echoed into the log. If a child dies at startup, relaunch it once. If it dies again, run `pi -p --no-session --provider <provider> --model <model> "$(cat prompt)" > out` under `nohup`.

The pantry recipe `review_loop` (v2 or later) can make the next-step decision. Use it when pantry is reachable.

## Posting

- Re-fetch the MR immediately before you post. The state must be `opened` and the SHA must be unchanged.
- Every finding links to `https://<gitlab>/<project>/-/blob/<full head sha>/<path>#L<n>`.
- Every claim includes a command that someone can rerun.
- Put each finding inline on the changed line. If the line is outside the diff, GitLab returns 400 `line_code`. Then put it in the summary note with a permalink.
- Do not repeat bot or colleague findings. Refer to them.
- End every summary note with `reviewed-sha: <full head sha>`, or `review-blocked: <reason> <full head sha>`.
- Do not approve with an open, proven blocker.
- After you approve, read the approvals list again. A refused approval is not an approval.
- If local tests cannot run, say so, and cite the head pipeline status.
- Write a receipt to `~/cloudflare/.context/reviews/<project>-mr-<iid>-receipt.md` with `VERDICT`, `HEAD`, `NOTE`, `APPROVALS`, `TYPECHECK`, `TESTS`, and `SECOND_PASS`. Add `HUMAN` when it applies.

## Push notifications

Send a My AX push with `mcp__my_ax__notify_owner` for every event below. Do not wait for the end of the loop.

- **Each posted review** (approve, changes requested, should-fix, or marker): `kind: "job.complete"`. Title: `Approved !<iid>` or `Changes requested !<iid>`. Body: 1-3 lines with the main finding and the MR URL. `href` takes only same-origin links, so put the GitLab URL in the body.
- **Each blocker** (a proven BLOCK, a moved SHA, auth failure, children dying, or a human-only MR): `kind: "job.needs_input"`. Say what is blocked and the next step.
- If several MRs post in one tick, one push can list them all.

## Blockers: ask through My AX, keep the loop alive

A blocker pauses one MR, not the loop. Blockers are: expired auth, missing credentials, GitLab access failures, unclear authorization, human-only decisions, and a SHA that moves during review. Do not retry a known auth failure.

1. Ask the owner with `mcp__my_ax__ask_owner`. Pass this session's `sessionId` (from `PI_SESSION_ID`), a short question, and 2 to 4 options, for example `["Fixed, continue", "Skip this MR", "Stop the loop"]`. The answer comes back into this session.
2. Mark the MR `BLOCKED <reason>` in the state file, and keep working on every other MR.
3. When the answer arrives, act on it in the next turn, then switch to work mode if there is work.
4. Ask once per blocker. Do not ask again while the question is still open.

If the blocker stops every MR (for example, expired auth), stay alive in idle mode (`10m`) and wait for the answer. Do not delete the driver.

## Writing

Use ASD-STE100 Simplified Technical English in notes and reports. Use short sentences and plain words. When the user asks for status, give counts and links first.
