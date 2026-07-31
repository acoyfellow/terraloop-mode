# Security

## What this is not

terraloop-mode is a **workflow gate, not a security boundary.**

It blocks tool calls inside a Pi session so an orchestration protocol is followed
mechanically instead of from memory. It assumes the agent is cooperative but
forgetful or over-eager. It does not defend against an adversarial agent.

Anything with shell access can trivially defeat it:

- edit the session state file under `~/.terrarium/terraloop-state/`
- edit or delete this extension
- run Pi without the extension loaded
- perform work through a tool the classifier does not model

Do not use it as a containment mechanism, a permission system, or a substitute
for sandboxing untrusted code.

## What it does provide

- The protocol's ordering is enforced rather than remembered, so a compacted or
  distracted session cannot silently skip the contract or the driver loop.
- Bypasses are explicit and recorded. Inline work during a loop requires an
  override with a stated reason, and every grant, consumption, refusal, and block
  is appended to `~/.terrarium/terraloop-audit.jsonl`.
- Scope is checked. Writes outside the contract's declared paths are refused, so
  a loop pointed at one repository does not quietly edit another.

## Data written to disk

The extension writes only to `~/.terrarium/`:

| Path | Contents |
| --- | --- |
| `terraloop-state/<sessionId>.json` | phase, contract, driver id, child run ids, counters |
| `terraloop-audit.jsonl` | one JSON record per gate decision |

The contract is whatever the operator locked, so treat these files as session
content. Do not commit them, and do not paste them into public issues without
reading them first: a goal or proof string can contain internal hostnames, paths,
or ticket identifiers.

The extension makes no network requests and reads no credentials.

## Executing the proof command

`terraloop_control action=gate` runs a command extracted from the contract's
`proof` field in order to verify the stop gate. This means **locking a contract
grants execution of that string.** Two consequences:

- Only lock contracts whose proof command you would run yourself.
- The extractor refuses candidates containing prose assertion markers (`>=`,
  `==`, `pass`, `must`, and similar), because a string like
  `bun test >= 77 pass` would otherwise be interpreted by the shell as a
  redirect and could exit zero without proving anything.

If a proof cannot be reduced to one runnable command, the gate refuses rather
than guessing.

## Reporting

Open an issue at
<https://github.com/acoyfellow/terraloop-mode/issues>. There is no private
disclosure channel; this is a local developer tool with no service component and
no deployed surface.
