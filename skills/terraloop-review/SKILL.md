---
name: terraloop-review
description: Adversarial review of the last terraloop. Use when the user asks how the terraloop did, /terraloop-review, /skill:terraloop-review, review the loop, look for mistakes, optimizations, whether to continue, or what we missed. Do not start a new loop. Always end with one best next step.
---

# Terraloop review

Review the last terraloop as an adversary. Do not celebrate the gate. Ask whether the gate was the right thing, whether the proof actually proved it, and whether the work is worth another loop.

Do not edit product files. Do not lock, arm, or spawn. Do not start the next terraloop unless the user says go.

## Load facts first

1. Call `terraloop_control action=status`.
2. Run the gather script:

```sh
node <skill-dir>/scripts/gather.mjs
```

If the user names a session, pass `--session <id>`. Otherwise the script must use `PI_SESSION_ID` from the current Pi bash tool. Never select the newest state file across sessions. If neither identity exists, stop and ask for the session ID.

3. Re-read the locked Goal, Gate, Scope, and Proof from `contract`. After release, use `lastCompletedLoop.contract`. Treat `contractSource: audit-fallback` as legacy evidence and say that the original gate output may be unavailable. Do not trust chat memory.
4. If the phase is `gated` or the user says the loop finished, re-run the contract `proof` yourself. A stored "gate verified" line is a claim.
5. Inspect the actual diff inside Scope. `git status` and `git diff` on those paths. Read the files the loop said it wrote.
6. If the proof command is missing, fails, or was run from the wrong cwd, that is a finding, not a footnote.

If gather finds no active, completed-state, or legacy audit contract, say so and stop after naming what evidence is missing. Do not invent a loop.

## Attack these questions

Answer each. Cite a file, command, or receipt. "Seems fine" is not an answer.

- **Gate honesty.** Did the proof command measure the Goal, or a proxy that is easier to pass?
- **Scoreboard leak.** Did the work still treat averages, ranks, or LLM-judge vibes as the result?
- **Fail-closed.** What happens when evidence is empty, a token is missing, or cwd is wrong? Did it fail closed?
- **Lean gate.** If the gate was `lean-gate.sh`: was `lean-gate.lock` present before the lock? Were `Claims.lean`, `Check.lean`, `lakefile.toml`, and `lean-toolchain` outside Scope? Did the report say **proven** for the model only, and **linked** only with a differential test? Re-run `lean-gate.test.sh` if the gate script changed.
- **Scope accidents.** Did the parent need an override because Scope omitted the real cwd? Did a child get blocked and the parent do the work anyway?
- **Protocol waste.** Twin spawn, list-mode status, shared-cwd writers, override used as the default editor, driver left running after the gate.
- **Unshipped surface.** `--out`, host graders, examples, UI, or docs that still describe the old object.
- **Continue?** Another loop is justified only if a new Goal is falsifiable and the last proof left a sharp leftover. Otherwise stop.

Separate **PROVEN** (you re-ran it) from **CLAIMED** (the agent said so).

## Reply shape

Use short sentences. One idea per sentence.

### What happened
Phase, Goal, Gate, Scope, proof exit. One paragraph.

### Proven
Bullets you re-checked.

### Claimed
Bullets you did not re-check, or that the proof does not cover.

### Mistakes
What was wrong, cheap, or dishonest. Include false passes.

### Optimizations
What the next loop should do less of. Overrides, scope shape, proof cwd, driver interval.

### Missed
Surfaces the Goal implied and the loop did not touch.

### Continue?
`yes` or `no`, then one sentence why.

### Next step
**Always last. Always exactly one.** Not a list. Creativity is required here: name the highest-leverage follow-on, even if it is not "another terraloop." Prefer a planted case, a fail-closed test, a narrower Goal, or deleting a leftover. Write it as a ready-to-lock Goal + Gate if another loop is the move. Write it as a single command or file change if a loop would be theater.
