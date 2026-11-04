import { expect, test } from "bun:test";
import { classifyTool, codemodeOutOfScope, outOfScopeSpawnPath } from "../gate.ts";

const scope = ["/home/u/repo"];
const home = "/home/u";

test("a tool the gate does not know is treated as mutating", () => {
  expect(classifyTool("mcp__other__write_file", { path: "/home/u/other/x" })).toBe("mutate");
  expect(classifyTool("some_new_tool", {})).toBe("mutate");
  expect(classifyTool("codemode", { code: "return 1" })).toBe("mutate");
});

test("known read tools stay reads", () => {
  expect(classifyTool("read", { path: "/home/u/other/a.ts" })).toBe("read");
  expect(classifyTool("grep", {})).toBe("read");
  expect(classifyTool("mcp__terrarium__terrarium_status", {})).toBe("read");
  expect(classifyTool("mcp__terrarium__terrarium_read", {})).toBe("read");
  expect(classifyTool("mcp__my_ax__my-ax_desk_get", {})).toBe("read");
});

test("a spawn with no cwd cannot be proven in scope, so it is out of scope", () => {
  expect(outOfScopeSpawnPath({ task: "cd /home/u/other && rm -rf ." }, scope)).not.toBeNull();
  expect(outOfScopeSpawnPath({ task: "t", cwd: "/home/u/repo" }, scope)).toBeNull();
  expect(outOfScopeSpawnPath({ jobs: [{ task: "a", cwd: "/home/u/repo" }, { task: "b" }] }, scope)).not.toBeNull();
});

test("codemode is checked for nested writes outside scope", () => {
  expect(codemodeOutOfScope({ code: "await tools.write({path:'/home/u/other/x',content:'y'})" }, scope, home)).not.toBeNull();
  expect(codemodeOutOfScope({ code: "await tools.bash({command:'rm -rf /home/u/other'})" }, scope, home)).not.toBeNull();
  expect(codemodeOutOfScope({ code: "await tools.write({path:'/home/u/repo/x',content:'y'})" }, scope, home)).toBeNull();
  expect(codemodeOutOfScope({ code: "const r = await tools.read({path:'/home/u/other/a'}); return r" }, scope, home)).toBeNull();
});
