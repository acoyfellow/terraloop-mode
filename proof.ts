import { spawnSync } from "node:child_process";

export type ProofOutcome =
  | { verified: true; command: string; output: string }
  | { verified: false; command: string; exitCode: number; output: string }
  | { verified: false; command: null; reason: string };

export type CommandRunner = (command: string) => { exitCode: number; stdout: string; stderr: string };

const defaultRunner: CommandRunner = (command) => {
  const result = spawnSync("/bin/sh", ["-c", command], { encoding: "buffer" });
  return {
    exitCode: result.status ?? 1,
    stdout: Buffer.from(result.stdout ?? []).toString(),
    stderr: Buffer.from(result.stderr ?? []).toString(),
  };
};

const scriptPath = /^(\.{1,2}\/|\/|~\/)\S/;
const commandWord = /^[a-z0-9][a-z0-9._+-]*(\s|$)/;
const proseWords = new Set(["cd", "the", "a", "an", "all", "tests", "test", "it", "this", "that", "every", "each", "no", "when", "if", "after", "before", "once", "user", "gate", "proof"]);

function commandStart(line: string): boolean {
  if (scriptPath.test(line)) return true;
  if (!commandWord.test(line)) return false;
  const [first, second] = line.split(/\s+/);
  if (first === "test" && second?.startsWith("-")) return true;
  return !proseWords.has(first as string);
}
const proseMarkers = /(>=|<=|\bpass\b|\bfail\b|\bmust\b|\bshould\b|\bshows\b|\bvia\b|==)/i;
const leadingDirectoryChange = /^cd\s+(?:'[^']*'|"[^"]*"|[^\s&|;]+)\s*&&\s*/;

function withoutDirectoryChanges(line: string): string {
  let remainder = line;
  while (leadingDirectoryChange.test(remainder)) {
    remainder = remainder.replace(leadingDirectoryChange, "");
  }
  return remainder;
}

export function firstRunnableCommand(proof: string): string | null {
  for (const rawLine of proof.split(/[;\n]/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (!commandStart(withoutDirectoryChanges(line))) continue;
    if (proseMarkers.test(line)) return null;
    return line;
  }
  return null;
}

const unrunnableReason = "the contract's proof has no runnable command, so the gate cannot be verified mechanically";

export function proofProblem(proof: string): string | null {
  return firstRunnableCommand(proof) === null ? unrunnableReason : null;
}

export function verifyProof(proof: string, runner: CommandRunner = defaultRunner): ProofOutcome {
  const command = firstRunnableCommand(proof);
  if (!command) {
    return { verified: false, command: null, reason: unrunnableReason };
  }
  const result = runner(command);
  const output = `${result.stdout}${result.stderr}`.trim().slice(-4000);
  return result.exitCode === 0 ? { verified: true, command, output } : { verified: false, command, exitCode: result.exitCode, output };
}
