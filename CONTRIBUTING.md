# Contributing

## Setup

```sh
bun install
bun run check
```

`bun run check` is the whole gate: `tsc --noEmit` plus the test suite. It must be
green before a pull request.

## The one rule for changes to the gate

Every blocking behavior needs a test that fails when the block is removed.

The suite includes a negative control: a permissive gate must fail the scenarios
the real gate blocks. Without it, a gate that silently stopped enforcing would
still look green. If you add a phase, an intent, or a new blocked tool, extend
that control too.

## Tool names are load-bearing

`gate.ts` matches tool names literally. If Pi, terrarium, or the loop extension
renames a tool, the gate stops recognizing it and enforcement disappears while
still appearing installed.

`tests/tool-names.test.ts` pins the names that must classify as spawns and driver
operations. Update it deliberately, never to make a failure go away.

## Testing against a live session

Unit tests prove the gate function in isolation. They do not prove a model cannot
talk past it. For changes to blocking behavior, also exercise a real session:

```sh
pi -e ./extension.ts -p --no-session "…a prompt that should be blocked…"
```

Set a phase first by writing a state file under
`~/.terrarium/terraloop-state/<sessionId>.json`, and restore it afterward. Do not
leave a stale contract behind; another session's loop is not yours to clear.

## Style

- No source comments. Names, types, and small functions carry the intent.
- Biome defaults: 2-space indent, double quotes in this project, semicolons.
- Keep modules single-purpose: `state.ts` persists, `gate.ts` decides,
  `proof.ts` verifies, `extension.ts` wires them to Pi.

## Scope

This project stays small. It enforces the ordering of an orchestration protocol.
It is not a policy engine, a permission system, or a sandbox. Proposals that turn
it into one belong in a different repository.
