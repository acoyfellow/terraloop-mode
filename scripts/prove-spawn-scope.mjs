import { outOfScopeSpawnPath } from "../gate.ts";

const lockedScope = [process.cwd()];
const blockedCwd = "/tmp/terraloop-out-of-scope-proof";
const refusedCwd = outOfScopeSpawnPath({ cwd: blockedCwd }, lockedScope);

if (refusedCwd !== blockedCwd) {
  throw new Error(`expected ${blockedCwd} to be refused outside ${lockedScope.join(", ")}, received ${String(refusedCwd)}`);
}

console.log(`scope fence verified: ${refusedCwd} is outside ${lockedScope[0]}`);
