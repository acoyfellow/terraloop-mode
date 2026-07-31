import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type Phase = "off" | "armed" | "driving" | "gated";

export type Contract = {
  goal: string;
  gate: string;
  scope: readonly string[];
  proof: string;
};

export type OverrideGrant = {
  reason: string;
  grantedAt: string;
  remainingCalls: number;
};

export const overrideBudget = 5;

export type LoopState = {
  phase: Phase;
  contract: Contract | null;
  driverLoopId: string | null;
  spawnedRunIds: readonly string[];
  override: OverrideGrant | null;
  overrideGrantsUsed: number;
  inlineMutations: number;
  delegatedSpawns: number;
  updatedAt: string;
};

export const stateDirectory = join(homedir(), ".terrarium");
export const stateRootDirectory = join(stateDirectory, "terraloop-state");
export const auditPath = join(stateDirectory, "terraloop-audit.jsonl");

export function statePathForSession(sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  if (safeSessionId.length === 0) throw new Error("Pi session id is required");
  return join(stateRootDirectory, `${safeSessionId}.json`);
}

export function initialState(): LoopState {
  return {
    phase: "off",
    contract: null,
    driverLoopId: null,
    spawnedRunIds: [],
    override: null,
    overrideGrantsUsed: 0,
    inlineMutations: 0,
    delegatedSpawns: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function readState(path: string): LoopState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LoopState>;
    const phase: Phase = parsed.phase === "armed" || parsed.phase === "driving" || parsed.phase === "gated" ? parsed.phase : "off";
    return {
      phase,
      contract: parsed.contract ?? null,
      driverLoopId: parsed.driverLoopId ?? null,
      spawnedRunIds: parsed.spawnedRunIds ?? [],
      override: parsed.override ?? null,
      overrideGrantsUsed: parsed.overrideGrantsUsed ?? 0,
      inlineMutations: parsed.inlineMutations ?? 0,
      delegatedSpawns: parsed.delegatedSpawns ?? 0,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return initialState();
  }
}

export function writeState(next: LoopState, path: string): LoopState {
  const stamped = { ...next, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(stamped, null, 2)}\n`);
  return stamped;
}

export function recordAudit(entry: Record<string, unknown>, path = auditPath) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    return;
  }
}

export function contractIsComplete(contract: Contract | null): contract is Contract {
  if (!contract) return false;
  return contract.goal.trim().length > 0 && contract.gate.trim().length > 0 && contract.scope.length > 0 && contract.proof.trim().length > 0;
}

export function describeState(state: LoopState): string {
  if (state.phase === "off") return "terraloop: off";
  const parts = [`terraloop: ${state.phase}`];
  if (state.contract) parts.push(`goal=${state.contract.goal}`, `gate=${state.contract.gate}`, `scope=${state.contract.scope.join(",")}`, `proof=${state.contract.proof}`);
  parts.push(`driver=${state.driverLoopId ?? "none"}`);
  if (state.spawnedRunIds.length > 0) parts.push(`children=${state.spawnedRunIds.length}`);
  parts.push(`delegated=${state.delegatedSpawns} inline=${state.inlineMutations}`);
  parts.push(`overrideGrants=${state.overrideGrantsUsed}/${overrideBudget}`);
  if (state.override) parts.push(`activeOverride(${state.override.remainingCalls} left)=${state.override.reason}`);
  return parts.join(" | ");
}
