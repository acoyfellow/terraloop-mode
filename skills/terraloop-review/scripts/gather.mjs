#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const root = join(homedir(), ".terrarium");
const stateDir = join(root, "terraloop-state");
const auditPath = join(root, "terraloop-audit.jsonl");

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function safeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
}

function loadState(sessionId) {
  const path = join(stateDir, `${safeSessionId(sessionId)}.json`);
  return { path, sessionId, state: JSON.parse(readFileSync(path, "utf8")) };
}

function auditFor(sessionId, limit = 100) {
  let lines = [];
  try {
    lines = readFileSync(auditPath, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const matched = [];
  for (let i = lines.length - 1; i >= 0 && matched.length < limit; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (row.sessionId === sessionId) matched.push(row);
    } catch {}
  }
  return matched.reverse();
}

const requested = argValue("--session");
const currentSession = process.env.PI_SESSION_ID?.trim() || null;
const sessionId = requested || currentSession;

if (!sessionId) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        reason: "no Pi session identity; run inside the Pi bash tool or pass --session <id>",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const chosen = { path: join(stateDir, `${safeSessionId(sessionId)}.json`), id: sessionId };

let loaded;
try {
  loaded = loadState(chosen.id);
} catch (error) {
  console.log(
    JSON.stringify(
      { ok: false, reason: error instanceof Error ? error.message : String(error), sessionId: chosen.id },
      null,
      2,
    ),
  );
  process.exit(1);
}

const { state } = loaded;
const audit = auditFor(loaded.sessionId);
const latestGate = [...audit].reverse().find((row) => row.event === "gate-reached") ?? null;
const legacyCompletedLoop =
  state.phase === "off" && !state.lastCompletedLoop && latestGate?.contract
    ? {
        contract: latestGate.contract,
        gateReceipt: latestGate.gateReceipt ?? {
          command: latestGate.command ?? null,
          exitCode: 0,
          output: null,
          verifiedAt: latestGate.at,
          source: "audit-fallback",
        },
        completedAt: latestGate.at,
        releasedAt:
          audit.find((row) => row.event === "release" && row.at >= latestGate.at)?.at ?? null,
      }
    : null;
const completedLoop = state.lastCompletedLoop ?? legacyCompletedLoop;
const contract = state.contract ?? completedLoop?.contract ?? null;
const contractSource = state.contract
  ? "active"
  : state.lastCompletedLoop
    ? "completed-state"
    : legacyCompletedLoop
      ? "audit-fallback"
      : null;
const events = {};
for (const row of audit) {
  events[row.event] = (events[row.event] ?? 0) + 1;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      sessionId: loaded.sessionId,
      statePath: loaded.path,
      phase: state.phase,
      contract,
      contractSource,
      lastCompletedLoop: completedLoop,
      driverLoopId: state.driverLoopId,
      spawnedRunIds: state.spawnedRunIds ?? [],
      overrideGrantsUsed: state.overrideGrantsUsed ?? 0,
      inlineMutations: state.inlineMutations ?? 0,
      delegatedSpawns: state.delegatedSpawns ?? 0,
      updatedAt: state.updatedAt,
      auditEvents: events,
      recentAudit: audit.slice(-12),
    },
    null,
    2,
  ),
);
