import { contractIsComplete, type LoopState } from "./state.ts";

export type GateDecision = { allowed: true } | { allowed: false; reason: string };

export type ToolIntent = "spawn" | "driver-create" | "driver-delete" | "mutate" | "read" | "terraloop-control";

const spawnTools = new Set(["terrarium_terrarium_spawn", "terrarium_terrarium_spawn_batch"]);
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
  return "read";
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

export function outOfScopeSpawnPath(input: unknown, scope: readonly string[]): string | null {
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
