---
name: terraloop-reviews
description: Start a reusable Terraloop for GitLab merge-request reviews. Use when the user invokes Review Terraloop, asks to review an MR queue continuously, or wants bounded review work with exact-SHA evidence, verified GitLab actions, and explicit human-blocker handling.
---

# Review Terraloop

This skill creates a review-specific Terraloop. It is a reusable operating contract, not a fixed queue or project workflow.

## Invocation

Native Pi invocation:

```text
/skill:terraloop-reviews <review target or queue instructions>
```

Skill names use lowercase letters, numbers, and hyphens, so `/terraloop:reviews` is not the native Pi skill-command spelling.

## North star

Arm Terraloop with a one-line purpose equivalent to:

> Process the requested GitLab merge-request reviews and stop when every owed review has a verified verdict or an explicit human-blocker receipt.

Call `terraloop_control` with `action=arm` before beginning autonomous review work. Do not arm a loop merely to answer a question about this skill.

## Contract on-ramp

After arming, draft and show a short contract, then wait for the user's confirmation before locking it:

- Goal: every requested or eligible MR has a current, evidence-backed review outcome.
- Gate: `bash <skill-dir>/gate.sh <group/project!iid>...` exits 0.
- Scope: only the named GitLab projects, MRs, branches, files, receipts, and review artifacts.
- Proof: the gate output. It reads each MR from the GitLab API as the current user.

`gate.sh` passes an MR only when the current user has one of these on it:

- an approval,
- a note that contains `reviewed-sha: <current head sha>`,
- a note that contains `review-blocked: <reason>`.

End every posted review summary with `reviewed-sha: <head sha>`. If the head moves, the old line no longer matches and the gate fails. Post `review-blocked:` only for a real human blocker. The gate fails closed when `glab` is missing, is not authenticated, or cannot read an MR.
- Policy: comments-only, approval, request-changes, merge, and branch mutation must be stated explicitly; never infer authorization.

The contract is intentionally stable while the queue, project, and review depth remain user-supplied.

## Driver

After the user confirms the contract:

1. Lock it with `terraloop_control action=lock`.
2. Create a `loops_task` driver containing the goal, gate, scope, proof, active child IDs, and an instruction to delete itself when the gate is met.
3. Do the next cheap review step in the parent.
4. Use Terrarium only when a named lever applies: parallel independent audits, isolated writing, bounded risky work, large read-only context, or independent proof.
5. On child completion, check the known run by ID, read its output, and independently verify its claims before advancing.

The parent remains the default worker. Never spawn merely to avoid doing a small review step directly.

## Review invariants

For every MR:

- Re-fetch the MR immediately before review actions.
- Bind every finding and verdict to the exact current head SHA.
- Inspect the relevant diff from the recorded base SHA.
- Post each finding as an inline discussion on the changed line that demonstrates the issue. Use a general MR note only when the issue is outside the diff or GitLab cannot accept a valid position, and state that limitation.
- Check security, correctness, performance, documentation, compatibility, and applicable Codex or repository rules.
- Run the narrowest meaningful tests and type checks, then record the exact commands and results.
- Post only actions authorized by the user. Use the sanctioned GitLab MCP path first and use an approved fallback only when authorized.
- Verify posted notes, discussion state, verdict state, URLs, authorship, positions, and SHA through the API.
- Never describe a dry-run, prepared comment, local verdict, or chat claim as a completed GitLab action.
- Do not approve an MR with unresolved blocking findings.
- Do not merge, push, modify a colleague's branch, or alter source files unless the contract explicitly permits it.

## Queue ownership

Before reviewing a queue, identify whether the current reviewer is actually assigned or otherwise owes an action. Exclude self-authored MRs and MRs already peer-approved when the user's policy says to exclude them. Inspect existing notes, discussions, reviewers, approvals, pipeline state, and current head SHA so colleague work is not duplicated.

A colleague's review is evidence of prior work, not automatic authorization to approve or close a finding. Report whether an action remains owed and why.

## Blockers and notifications

Stop immediately on expired authentication, missing credentials, unavailable GitLab access, ambiguous authorization, human-only decisions, SHA movement during review, or unproven external evidence. Do not retry a known authorization failure pointlessly.

Notify the owner through the sanctioned My AX notification path as soon as a blocker is established. Include the MR URL, project, IID, exact SHA if known, attempted action, blocker receipt, and the next human decision required. Notify again only after an action is actually registered and API-verified.

## Stop

When the gate is proven:

1. Mark it with `terraloop_control action=gate`.
2. Delete the driver immediately with `loops_task action=delete`.
3. Report each MR's exact reviewed SHA, findings, GitLab note or verdict IDs and URLs, validation evidence, colleague activity, and any remaining external blockers.

Never spin after the gate is met or against a boundary only a human can clear. Only the user can leave Terraloop mode with `/terraloop-off`.
