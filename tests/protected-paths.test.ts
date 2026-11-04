import { expect, test } from "bun:test";
import { protectedTarget } from "../gate.ts";

const home = "/home/u";
const gateRoot = "/home/u/.pi/agent/git/github.com/acoyfellow/terraloop-mode";

test("the gate's own state and audit log are never writable by the agent", () => {
  expect(protectedTarget("write", { path: `${home}/.terrarium/terraloop-state/s1.json` }, home, gateRoot)).not.toBeNull();
  expect(protectedTarget("edit", { path: `${home}/.terrarium/terraloop-audit.jsonl` }, home, gateRoot)).not.toBeNull();
  expect(protectedTarget("bash", { command: `echo x > ${home}/.terrarium/terraloop-state/s1.json` }, home, gateRoot)).not.toBeNull();
  expect(protectedTarget("bash", { command: `: > ${home}/.terrarium/terraloop-audit.jsonl` }, home, gateRoot)).not.toBeNull();
});

test("a shell command that names gate state with a write verb or interpreter is blocked", () => {
  const python = `python3 -c "import json;p='${home}/.terrarium/terraloop-state/s1.json';json.dump({},open(p,'w'))"`;
  expect(protectedTarget("bash", { command: python }, home, gateRoot)).not.toBeNull();
});

test("the gate source, proof scripts, and extension are not writable by the agent", () => {
  expect(protectedTarget("edit", { path: `${gateRoot}/gate.ts` }, home, gateRoot)).not.toBeNull();
  expect(protectedTarget("write", { path: `${gateRoot}/bench/run.ts` }, home, gateRoot)).not.toBeNull();
  expect(protectedTarget("bash", { command: `sed -i '' 's/a/b/' ${gateRoot}/gate.ts` }, home, gateRoot)).not.toBeNull();
  expect(protectedTarget("bash", { command: `mv ${gateRoot}/extension.ts ${gateRoot}/extension.off` }, home, gateRoot)).not.toBeNull();
});

test("reading enforcement files and editing docs stays allowed", () => {
  expect(protectedTarget("bash", { command: `cat ${home}/.terrarium/terraloop-state/s1.json` }, home, gateRoot)).toBeNull();
  expect(protectedTarget("bash", { command: `tail -5 ${home}/.terrarium/terraloop-audit.jsonl` }, home, gateRoot)).toBeNull();
  expect(protectedTarget("edit", { path: `${gateRoot}/skills/terraloop-climb/SKILL.md` }, home, gateRoot)).toBeNull();
  expect(protectedTarget("edit", { path: "/home/u/repo/a.ts" }, home, gateRoot)).toBeNull();
});
