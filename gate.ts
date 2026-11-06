import { contractIsComplete, type LoopState } from "./state.ts";
import { isCredentialPath } from "./credentials.ts";

export type GateDecision = { allowed: true } | { allowed: false; reason: string };

export type ToolIntent = "spawn" | "driver-create" | "driver-delete" | "mutate" | "read" | "terraloop-control";

const spawnTools = new Set([
  "terrarium_terrarium_spawn",
  "terrarium_terrarium_spawn_batch",
  "mcp__terrarium__terrarium_spawn",
  "mcp__terrarium__terrarium_spawn_batch",
  "mcp__terrarium__terrarium_loop_start",
]);
const mutationTools = new Set(["edit", "write", "hashline"]);
const controlTools = new Set(["terraloop_control"]);

const mutatingShell =
  /(^|[\s;&|(])(rm|mv|cp|install|mkdir|touch|tee|truncate|chmod|chown|ln|sed\s+-i|perl\s+-i|patch|npm|pnpm|yarn|bun|cargo|go|make|wrangler|alchemy|docker|kubectl|terraform)\b|>>?\s*\S/;

export function classifyTool(toolName: string, input: unknown): ToolIntent {
  if (controlTools.has(toolName)) return "terraloop-control";
  if (spawnTools.has(toolName)) return "spawn";
  if (toolName === "loops_task") {
    const action = (input as { action?: unknown } | null)?.action;
    if (action === "create") return "driver-create";
    if (action === "delete" || action === "clear") return "driver-delete";
    return "read";
  }
  if (mutationTools.has(toolName)) return "mutate";
  if (toolName === "bash") {
    const command = (input as { command?: unknown } | null)?.command;
    return typeof command === "string" && mutatingShell.test(command) ? "mutate" : "read";
  }
  return isKnownReadTool(toolName) ? "read" : "mutate";
}

const readTools = new Set(["read", "grep", "find", "ls", "glob", "browser", "browser_inspect", "gitlab_mr_get", "gitlab_mr_comments", "gitlab_open_mrs", "jira_search", "jira_get_issue", "mcp", "pantry"]);
const readToolSuffix = new RegExp("(_status|_read|_get|_list|_search|_describe|_check_in|_comments|_reports|_open_mrs|_get_issue)$");

function isKnownReadTool(toolName: string): boolean {
  return readTools.has(toolName) || readToolSuffix.test(toolName);
}

export function pathIsInScope(path: string, scope: readonly string[]): boolean {
  return scope.some((entry) => path.startsWith(entry));
}

const shellWriteVerbs = /^(rm|mv|cp|install|mkdir|touch|tee|truncate|chmod|chown|ln|patch)$/;
const shellInPlaceEdit = /^(sed|perl)$/;

function expandHome(token: string, home: string): string {
  return token.startsWith("~/") ? `${home}/${token.slice(2)}` : token;
}

function stripQuotes(token: string): string {
  return token.replace(/^['"]|['"]$/g, "");
}

export function shellWriteTargets(command: string, home: string): string[] {
  const targets: string[] = [];
  for (const match of command.matchAll(/>>?\s*([^\s;&|]+)/g)) {
    targets.push(expandHome(stripQuotes(match[1] ?? ""), home));
  }
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).map(stripQuotes).filter((word) => word.length > 0);
    const verb = words[0] ?? "";
    const inPlace = shellInPlaceEdit.test(verb) && words.some((word) => /^-[a-zA-Z]*i/.test(word));
    if (!shellWriteVerbs.test(verb) && !inPlace) continue;
    for (const word of words.slice(1)) {
      if (word.startsWith("-")) continue;
      const path = expandHome(word, home);
      if (path.startsWith("/")) targets.push(path);
    }
  }
  return targets.filter((path) => path.startsWith("/") && path !== "/dev/null" && !path.startsWith("/dev/fd/"));
}

export function outOfScopeShellWrite(input: unknown, scope: readonly string[], home: string): string | null {
  const command = (input as { command?: unknown } | null)?.command;
  if (typeof command !== "string") return null;
  for (const path of shellWriteTargets(command, home)) {
    if (!pathIsInScope(path, scope)) return path;
  }
  return null;
}

export function spawnTargetPaths(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const record = input as { cwd?: unknown; jobs?: unknown };
  const paths: string[] = [];
  if (typeof record.cwd === "string" && record.cwd.length > 0) paths.push(record.cwd);
  if (Array.isArray(record.jobs)) {
    for (const job of record.jobs) {
      if (!job || typeof job !== "object") continue;
      const cwd = (job as { cwd?: unknown }).cwd;
      if (typeof cwd === "string" && cwd.length > 0) paths.push(cwd);
    }
  }
  return paths;
}

function spawnJobsWithoutCwd(input: unknown): number {
  if (!input || typeof input !== "object") return 0;
  const record = input as { cwd?: unknown; jobs?: unknown };
  if (Array.isArray(record.jobs)) return record.jobs.filter((job) => !job || typeof job !== "object" || typeof (job as { cwd?: unknown }).cwd !== "string").length;
  return typeof record.cwd === "string" && record.cwd.length > 0 ? 0 : 1;
}

export function outOfScopeSpawnPath(input: unknown, scope: readonly string[]): string | null {
  if (spawnJobsWithoutCwd(input) > 0) return "a spawn with no cwd";
  for (const path of spawnTargetPaths(input)) {
    if (!pathIsInScope(path, scope)) return path;
  }
  return null;
}

export function evaluate(state: LoopState, intent: ToolIntent): GateDecision {
  if (intent === "terraloop-control" || intent === "read") return { allowed: true };

  if (state.phase === "off") return { allowed: true };

  if (state.phase === "armed") {
    if (intent === "spawn") {
      return {
        allowed: false,
        reason:
          "terraloop is armed but no contract is locked. Call terraloop_lock with goal, gate, scope, and proof, then create the driver loop. Spawning before the contract is locked is the failure this gate exists to prevent.",
      };
    }
    if (intent === "driver-create") {
      return contractIsComplete(state.contract)
        ? { allowed: true }
        : {
            allowed: false,
            reason: "terraloop is armed but the contract is incomplete. Call terraloop_lock with goal, gate, scope, and proof before creating the driver loop.",
          };
    }
    if (intent === "mutate") {
      return {
        allowed: false,
        reason: "terraloop is armed. Lock the contract and create the driver loop before doing any work. Use terraloop_override with a reason if inline work is genuinely required.",
      };
    }
  }

  if (state.phase === "driving") {
    if (intent === "spawn" || intent === "driver-create" || intent === "driver-delete" || intent === "mutate") {
      return { allowed: true };
    }
  }

  if (state.phase === "gated") {
    if (intent === "driver-create") {
      return { allowed: false, reason: "terraloop reached its stop gate. Delete the existing driver loop and report before creating another." };
    }
    if (intent === "mutate") {
      return {
        allowed: false,
        reason: "terraloop reached its stop gate. Finish verifying and reporting rather than making further inline changes, or call terraloop_control action=override with a reason.",
      };
    }
  }

  return { allowed: true };
}

export function consumeOverride(state: LoopState): LoopState {
  if (!state.override) return state;
  const remainingCalls = state.override.remainingCalls - 1;
  const counted = { ...state, inlineMutations: state.inlineMutations + 1 };
  return remainingCalls <= 0 ? { ...counted, override: null } : { ...counted, override: { ...state.override, remainingCalls } };
}

export type OverrideRequest = { granted: true; state: LoopState; calls: number } | { granted: false; reason: string };

export function requestOverride(state: LoopState, reason: string, requestedCalls: number, budget: number): OverrideRequest {
  const trimmed = reason.trim();
  if (trimmed.length < 12) return { granted: false, reason: "supply a reason of at least 12 characters describing why inline work is required" };
  if (state.overrideGrantsUsed >= budget) {
    return {
      granted: false,
      reason: `override budget exhausted (${state.overrideGrantsUsed}/${budget} grants used this loop). Delegate this work to a terrarium child, or ask the user to reset with /terraloop-off and re-arm.`,
    };
  }
  const calls = Math.max(1, Math.min(requestedCalls, 8));
  return {
    granted: true,
    calls,
    state: {
      ...state,
      override: { reason: trimmed, grantedAt: new Date().toISOString(), remainingCalls: calls },
      overrideGrantsUsed: state.overrideGrantsUsed + 1,
    },
  };
}

const readOnlyVerbs = new Set(["cat", "head", "tail", "less", "grep", "rg", "wc", "ls", "stat", "jq", "diff", "file", "sha256sum", "shasum", "md5"]);

function protectedPath(path: string, home: string, gateRoot: string): boolean {
  if (path.startsWith(`${home}/.terrarium/terraloop-state`)) return true;
  if (path === `${home}/.terrarium/terraloop-audit.jsonl`) return true;
  if (!path.startsWith(`${gateRoot}/`)) return false;
  const relative = path.slice(gateRoot.length + 1);
  return !relative.startsWith("skills/") && !relative.endsWith(".md");
}

function pathTokens(text: string, home: string): string[] {
  return [...text.matchAll(/(~\/|\/)[^\s'"`;&|()<>]+/g)].map((match) => expandHome(match[0], home));
}

function segmentVerb(segment: string): string {
  return segment.trim().split(/\s+/)[0] ?? "";
}

export function protectedTarget(toolName: string, input: unknown, home: string, gateRoot: string): string | null {
  const record = (input ?? {}) as { path?: unknown; command?: unknown };
  if (toolName !== "bash") {
    return typeof record.path === "string" && protectedPath(expandHome(record.path, home), home, gateRoot) ? record.path : null;
  }
  if (typeof record.command !== "string") return null;
  for (const path of shellWriteTargets(record.command, home)) {
    if (protectedPath(path, home, gateRoot)) return path;
  }
  for (const segment of record.command.split(/&&|\|\||[;|\n]/)) {
    const touched = pathTokens(segment, home).find((path) => protectedPath(path, home, gateRoot));
    if (touched && !readOnlyVerbs.has(segmentVerb(segment))) return touched;
  }
  return null;
}

export function credentialAccess(input: unknown, home: string): string | null {
  const record = (input ?? {}) as { command?: unknown; path?: unknown };
  if (typeof record.path === "string" && isCredentialPath(expandHome(record.path, home))) return record.path;
  if (typeof record.command !== "string") return null;
  return pathTokens(record.command, home).find(isCredentialPath) ?? null;
}

const interpreterOneLiner = new RegExp("(^|[\\s;&|(])(node|bun|deno|python3?|perl|ruby|php)\\s+(-e|-c|-E|--eval|-r)\\b");
const interpreterWriteCall = new RegExp("writeFile|appendFile|createWriteStream|rmSync|unlink|rename|mkdirSync|open\\([^)]*['\"][wa]|shutil|os\\.remove|os\\.rename|>\\s*\\S");
const pipedToShell = new RegExp("\\|\\s*(sudo\\s+)?(sh|bash|zsh|dash|ksh|python3?|node|perl)\\b(\\s|$)");
const evalCall = new RegExp("(^|[\\s;&|(])(eval|source|\\.)\\s");
const decodeCall = new RegExp("base64\\s+(-d|--decode|-D)|xxd\\s+-r|openssl\\s+(enc|base64)\\s.*-d");
const variableWriteTarget = new RegExp("(^|[\\s;&|(])(rm|mv|cp|tee|truncate|chmod|chown|ln|install|mkdir|touch|rsync|dd)\\b[^;&|\\n]*\\$\\{?[A-Za-z_]|>>?\\s*\\$\\{?[A-Za-z_]");

export function opaqueShellWrite(input: unknown, scope: readonly string[], home: string): string | null {
  const command = (input as { command?: unknown } | null)?.command;
  if (typeof command !== "string") return null;
  if (pipedToShell.test(command)) return "a command piped into a shell or interpreter";
  if (evalCall.test(command)) return "eval or source of a built command";
  if (decodeCall.test(command) && new RegExp("\\|").test(command)) return "a decoded payload";
  if (variableWriteTarget.test(command)) return "a write whose target is a shell variable";
  if (interpreterOneLiner.test(command) && interpreterWriteCall.test(command)) {
    const outside = pathTokens(command, home).find((path) => !pathIsInScope(path, scope));
    if (outside) return outside;
    if (pathTokens(command, home).length === 0) return "an interpreter write with no visible path";
  }
  return null;
}

const schedulerCommand = new RegExp("^(?:sudo\\s+)?(crontab\\s+(?!-l\\b)\\S|launchctl\\s+(load|bootstrap|submit|enable)\\b|systemctl\\s+(--user\\s+)?(enable|start|link)\\b|at\\s+(now|\\d)|atq\\b|batch\\b)");

export function blankQuotedText(command: string): string {
  let out = "";
  let quote: string | null = null;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if (char === "\\" && quote === '"' && index + 1 < command.length) {
        out += "  ";
        index++;
      } else if (char === quote) {
        quote = null;
        out += char;
      } else {
        out += char === "\n" ? "\n" : " ";
      }
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
      out += char;
    } else {
      out += char;
    }
  }
  return out;
}

const nestedShellScript = new RegExp("(?:^|[\\s;&|(])(?:sudo\\s+)?(?:ba|z|da|k)?sh\\s+(?:-\\w+\\s+)*-\\w*c\\s+(['\"])((?:(?!\\1).)*)\\1", "g");

export function runsScheduler(command: string, depth = 0): boolean {
  if (depth < 3) {
    for (const match of command.matchAll(nestedShellScript)) {
      if (runsScheduler(match[2] ?? "", depth + 1)) return true;
    }
  }
  return blankQuotedText(command)
    .split(/&&|\|\||[;|\n&(){}]/)
    .map((segment) => segment.trim())
    .some((segment) => schedulerCommand.test(segment));
}
const hooksPathConfig = new RegExp("git\\s+config\\b[^;&|\\n]*core\\.hooksPath");
const shellStartupFile = new RegExp("/\\.(zshrc|zprofile|zshenv|bashrc|bash_profile|profile|login)$");

function isPersistencePath(path: string): boolean {
  if (path.includes("/Library/LaunchAgents/") || path.includes("/Library/LaunchDaemons/")) return true;
  if (path.includes("/.git/hooks/")) return true;
  if (path.includes("/.config/systemd/") || path.includes("/.config/autostart/")) return true;
  return shellStartupFile.test(path);
}

export function persistenceTarget(toolName: string, input: unknown, home: string): string | null {
  const record = (input ?? {}) as { command?: unknown; path?: unknown };
  if (toolName !== "bash") {
    return typeof record.path === "string" && isPersistencePath(expandHome(record.path, home)) ? record.path : null;
  }
  if (typeof record.command !== "string") return null;
  if (runsScheduler(record.command)) return "a scheduler that runs work outside the session";
  if (hooksPathConfig.test(record.command)) return "git core.hooksPath";
  return shellWriteTargets(record.command, home).find(isPersistencePath) ?? null;
}

const codemodeWriteCall = new RegExp("tools\\.(write|edit|hashline)\\(\\s*\\{[^}]*path\\s*:\\s*['\"`]([^'\"`]+)", "g");
const codemodeBashCall = new RegExp("tools\\.bash\\(\\s*\\{[^}]*command\\s*:\\s*(['\"`])((?:(?!\\1).)*)\\1", "g");

export function codemodeOutOfScope(input: unknown, scope: readonly string[], home: string): string | null {
  const code = (input as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return null;
  for (const match of code.matchAll(codemodeWriteCall)) {
    const path = expandHome(match[2] ?? "", home);
    if (!pathIsInScope(path, scope)) return path;
  }
  for (const match of code.matchAll(codemodeBashCall)) {
    const nested = { command: match[2] ?? "" };
    const target = outOfScopeShellWrite(nested, scope, home) ?? opaqueShellWrite(nested, scope, home) ?? credentialAccess(nested, home);
    if (target) return target;
  }
  return null;
}
