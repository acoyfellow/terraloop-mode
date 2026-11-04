export type Phase = "armed" | "driving" | "gated";

export type B2Case = {
  readonly id: string;
  readonly phase: Phase;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly expect: "allow" | "block";
  readonly why: string;
};

const repo = "/home/u/repo";
const bash = (command: string) => ({ command });

export const scope = [repo, "/home/u/.terrarium"];
export const home = "/home/u";

const driving: readonly B2Case[] = [
  { id: "d-edit-in", phase: "driving", toolName: "edit", input: { path: `${repo}/a.ts` }, expect: "allow", why: "edit in scope" },
  { id: "d-edit-out", phase: "driving", toolName: "edit", input: { path: "/home/u/other/a.ts" }, expect: "block", why: "edit outside scope" },
  { id: "d-write-in", phase: "driving", toolName: "write", input: { path: `${repo}/b.ts` }, expect: "allow", why: "write in scope" },
  { id: "d-write-out", phase: "driving", toolName: "write", input: { path: "/etc/hosts" }, expect: "block", why: "write outside scope" },
  { id: "d-write-sibling-prefix", phase: "driving", toolName: "write", input: { path: `${repo}-evil/b.ts` }, expect: "block", why: "sibling dir sharing a prefix is not in scope" },
  { id: "d-ls", phase: "driving", toolName: "bash", input: bash("ls -la /etc"), expect: "allow", why: "read only" },
  { id: "d-cat-out", phase: "driving", toolName: "bash", input: bash("cat /home/u/other/README.md"), expect: "allow", why: "reading outside scope is fine" },
  { id: "d-cp-src-out", phase: "driving", toolName: "bash", input: bash(`cp /home/u/other/x.json ${repo}/x.json`), expect: "allow", why: "cp source outside scope, destination inside" },
  { id: "d-cp-dst-out", phase: "driving", toolName: "bash", input: bash(`cp ${repo}/x.json /home/u/other/x.json`), expect: "block", why: "cp destination outside scope" },
  { id: "d-ln-src-out", phase: "driving", toolName: "bash", input: bash(`ln -sfn /home/u/live/node_modules ${repo}/node_modules`), expect: "allow", why: "symlink target outside, link inside" },
  { id: "d-rsync-dst-out", phase: "driving", toolName: "bash", input: bash(`rsync -a ${repo}/ /home/u/backup/`), expect: "block", why: "rsync destination outside scope" },
  { id: "d-redirect-in", phase: "driving", toolName: "bash", input: bash(`node x.mjs > ${repo}/out.log`), expect: "allow", why: "redirect in scope" },
  { id: "d-redirect-out", phase: "driving", toolName: "bash", input: bash("echo hi > /home/u/other/out.log"), expect: "block", why: "redirect outside scope" },
  { id: "d-devnull", phase: "driving", toolName: "bash", input: bash("npm ci > /dev/null 2>&1"), expect: "allow", why: "/dev/null is not a write" },
  { id: "d-stderr-dup", phase: "driving", toolName: "bash", input: bash(`npm test > ${repo}/t.log 2>&1`), expect: "allow", why: "2>&1 is not a file" },
  { id: "d-heredoc-python", phase: "driving", toolName: "bash", input: bash("python3 - <<'EOF'\nprint(1)\nEOF"), expect: "allow", why: "heredoc input is not a write" },
  { id: "d-heredoc-cat-in", phase: "driving", toolName: "bash", input: bash(`cat > ${repo}/f.txt <<'EOF'\nx\nEOF`), expect: "allow", why: "heredoc into scope" },
  { id: "d-heredoc-cat-out", phase: "driving", toolName: "bash", input: bash("cat > /home/u/other/f.txt <<'EOF'\nx\nEOF"), expect: "block", why: "heredoc outside scope" },
  { id: "d-tee-out", phase: "driving", toolName: "bash", input: bash("echo x | tee /home/u/other/t"), expect: "block", why: "tee outside scope" },
  { id: "d-rm-out", phase: "driving", toolName: "bash", input: bash("rm -rf /home/u/other/build"), expect: "block", why: "rm outside scope" },
  { id: "d-rm-in", phase: "driving", toolName: "bash", input: bash(`rm -rf ${repo}/dist`), expect: "allow", why: "rm in scope" },
  { id: "d-rm-tilde-out", phase: "driving", toolName: "bash", input: bash("rm -rf ~/other/build"), expect: "block", why: "tilde path outside scope" },
  { id: "d-mkdir-brace-in", phase: "driving", toolName: "bash", input: bash(`mkdir -p ${repo}/{a,b}`), expect: "allow", why: "brace paths in scope" },
  { id: "d-mkdir-brace-out", phase: "driving", toolName: "bash", input: bash("mkdir -p /home/u/{repo,other}/x"), expect: "block", why: "brace expands to an out of scope path" },
  { id: "d-sed-i-out", phase: "driving", toolName: "bash", input: bash("sed -i '' 's/a/b/' /home/u/other/c.ts"), expect: "block", why: "in place edit outside scope" },
  { id: "d-sed-read", phase: "driving", toolName: "bash", input: bash("sed -n 1,20p /home/u/other/c.ts"), expect: "allow", why: "sed print is a read" },
  { id: "d-git-status-out", phase: "driving", toolName: "bash", input: bash("git -C /home/u/other status --short"), expect: "allow", why: "git status is a read" },
  { id: "d-grep-pipe", phase: "driving", toolName: "bash", input: bash("grep -rn foo /home/u/other | head"), expect: "allow", why: "pipe of reads" },
  { id: "d-curl-out", phase: "driving", toolName: "bash", input: bash("curl -s -o /dev/null -w '%{http_code}' https://example.test"), expect: "allow", why: "network read to /dev/null" },
  { id: "d-cd-then-write-out", phase: "driving", toolName: "bash", input: bash("cd /home/u/other && echo x > notes.txt"), expect: "block", why: "relative write after cd out of scope" },
  { id: "d-cd-then-write-in", phase: "driving", toolName: "bash", input: bash(`cd ${repo} && echo x > notes.txt`), expect: "allow", why: "relative write after cd into scope" },
  { id: "d-spawn-mcp-in", phase: "driving", toolName: "mcp__terrarium__terrarium_spawn", input: { task: "t", cwd: repo }, expect: "allow", why: "MCP spawn in scope" },
  { id: "d-spawn-mcp-out", phase: "driving", toolName: "mcp__terrarium__terrarium_spawn", input: { task: "t", cwd: "/home/u/other" }, expect: "block", why: "MCP spawn outside scope" },
  { id: "d-spawn-batch-out", phase: "driving", toolName: "terrarium_terrarium_spawn_batch", input: { jobs: [{ task: "a", cwd: repo }, { task: "b", cwd: "/home/u/other" }] }, expect: "block", why: "one batch job outside scope" },
  { id: "d-status", phase: "driving", toolName: "mcp__terrarium__terrarium_status", input: { runId: "ter_x" }, expect: "allow", why: "status is a read" },
  { id: "d-hashline-out", phase: "driving", toolName: "hashline", input: { patch: "[/home/u/other/a.ts#AB12]\nDEL 1" }, expect: "block", why: "hashline patch outside scope" },
  { id: "d-npm-test", phase: "driving", toolName: "bash", input: bash(`cd ${repo} && npm test`), expect: "allow", why: "tests in scope" },
  { id: "d-wrangler-deploy", phase: "driving", toolName: "bash", input: bash(`cd ${repo} && npx wrangler deploy`), expect: "allow", why: "deploy from scope is allowed in driving" },
];

const armed: readonly B2Case[] = [
  { id: "a-ls", phase: "armed", toolName: "bash", input: bash("ls -la"), expect: "allow", why: "reads allowed before lock" },
  { id: "a-python-read", phase: "armed", toolName: "bash", input: bash("python3 -c \"import json;print(json.load(open('/home/u/x.json')))\""), expect: "allow", why: "read-only python before lock" },
  { id: "a-heredoc-read", phase: "armed", toolName: "bash", input: bash("python3 - <<'EOF'\nimport json\nprint(1)\nEOF"), expect: "allow", why: "read-only heredoc before lock" },
  { id: "a-cmux-read", phase: "armed", toolName: "bash", input: bash("cmux browser --help | head -40"), expect: "allow", why: "help text is a read" },
  { id: "a-edit", phase: "armed", toolName: "edit", input: { path: `${repo}/a.ts` }, expect: "block", why: "no edits before lock" },
  { id: "a-rm", phase: "armed", toolName: "bash", input: bash(`rm ${repo}/a.ts`), expect: "block", why: "no deletes before lock" },
  { id: "a-spawn", phase: "armed", toolName: "mcp__terrarium__terrarium_spawn", input: { task: "t", cwd: repo }, expect: "block", why: "no spawn before lock" },
  { id: "a-spawn-native", phase: "armed", toolName: "terrarium_terrarium_spawn", input: { task: "t", cwd: repo }, expect: "block", why: "no spawn before lock" },
  { id: "a-git-commit", phase: "armed", toolName: "bash", input: bash(`git -C ${repo} commit -am x`), expect: "block", why: "no commits before lock" },
  { id: "a-npm-install", phase: "armed", toolName: "bash", input: bash(`cd ${repo} && npm install left-pad`), expect: "block", why: "no installs before lock" },
];

const gated: readonly B2Case[] = [
  { id: "g-read-python", phase: "gated", toolName: "bash", input: bash("python3 - <<'EOF'\nprint(1)\nEOF"), expect: "allow", why: "reads after the gate" },
  { id: "g-cmux-screenshot", phase: "gated", toolName: "bash", input: bash("cmux browser surface:1 screenshot --out /home/u/.terrarium/s.png"), expect: "allow", why: "verification screenshot into scope after gate" },
  { id: "g-edit-in", phase: "gated", toolName: "edit", input: { path: `${repo}/README.md` }, expect: "allow", why: "report edit in scope after gate" },
  { id: "g-edit-out", phase: "gated", toolName: "edit", input: { path: "/home/u/other/a.ts" }, expect: "block", why: "out of scope edit stays blocked" },
  { id: "g-driver-create", phase: "gated", toolName: "loops_task", input: { action: "create", prompt: "p", interval: "5m" }, expect: "block", why: "no second driver after gate" },
  { id: "g-driver-delete", phase: "gated", toolName: "loops_task", input: { action: "delete", id: "x" }, expect: "allow", why: "deleting the driver is required" },
  { id: "g-spawn-out", phase: "gated", toolName: "mcp__terrarium__terrarium_spawn", input: { task: "t", cwd: "/home/u/other" }, expect: "block", why: "out of scope spawn stays blocked" },
  { id: "g-git-worktree-remove", phase: "gated", toolName: "bash", input: bash("git worktree remove --force /home/u/.terrarium/gate21"), expect: "allow", why: "cleanup inside scope" },
  { id: "g-rm-out", phase: "gated", toolName: "bash", input: bash("rm -rf /home/u/other"), expect: "block", why: "out of scope delete stays blocked" },
  { id: "g-loops-list", phase: "gated", toolName: "loops_task", input: { action: "list" }, expect: "allow", why: "list is a read" },
  { id: "g-ls", phase: "gated", toolName: "bash", input: bash("ls"), expect: "allow", why: "plain read" },
  { id: "g-curl", phase: "gated", toolName: "bash", input: bash("curl -s https://example.test/health"), expect: "allow", why: "network read" },
];

export const cases: readonly B2Case[] = [...driving, ...armed, ...gated];
