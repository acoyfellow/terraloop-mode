import { expect, test } from "bun:test";
import { outOfScopeShellWrite, shellWriteTargets } from "../gate.ts";

const home = "/Users/example";
const scope = ["/work/lean/Proofs", "/work/lean/.lake"];
const bash = (command: string) => ({ command });

test("the redirect that escaped scope on 2026-09-27 is now blocked", () => {
  expect(outOfScopeShellWrite(bash('echo "" >> /work/lean/Claims.lean'), scope, home)).toBe("/work/lean/Claims.lean");
});

test("redirects, write verbs, and in-place edits outside scope are blocked", () => {
  expect(outOfScopeShellWrite(bash("printf x > /work/lean/Check.lean"), scope, home)).toBe("/work/lean/Check.lean");
  expect(outOfScopeShellWrite(bash("cp a.lean /work/lean/lakefile.toml"), scope, home)).toBe("/work/lean/lakefile.toml");
  expect(outOfScopeShellWrite(bash("sed -i '' 's/a/b/' /work/lean/Claims.lean"), scope, home)).toBe("/work/lean/Claims.lean");
  expect(outOfScopeShellWrite(bash("cd /tmp && rm -f /work/lean/lean-gate.lock"), scope, home)).toBe("/work/lean/lean-gate.lock");
  expect(outOfScopeShellWrite(bash("echo hi > ~/notes.txt"), scope, home)).toBe("/Users/example/notes.txt");
});

test("writes inside scope and non-writing commands pass", () => {
  expect(outOfScopeShellWrite(bash("printf x > /work/lean/Proofs/Rules.lean"), scope, home)).toBeNull();
  expect(outOfScopeShellWrite(bash("lake build 2>/dev/null"), scope, home)).toBeNull();
  expect(outOfScopeShellWrite(bash("grep -n foo /work/lean/Claims.lean"), scope, home)).toBeNull();
  expect(outOfScopeShellWrite(bash("sed -n 1,5p /work/lean/Claims.lean"), scope, home)).toBeNull();
});

test("relative targets are not resolved, so the gate does not guess", () => {
  expect(shellWriteTargets("echo x > out.txt", home)).toEqual([]);
});
