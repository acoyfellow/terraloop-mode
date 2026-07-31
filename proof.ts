export type ProofOutcome =
  | { verified: true; command: string; output: string }
  | { verified: false; command: string; exitCode: number; output: string }
  | { verified: false; command: null; reason: string };

export type CommandRunner = (command: string) => { exitCode: number; stdout: string; stderr: string };

const defaultRunner: CommandRunner = (command) => {
  const result = Bun.spawnSync({ cmd: ["/bin/sh", "-c", command], stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: Buffer.from(result.stdout).toString(),
    stderr: Buffer.from(result.stderr).toString(),
  };
};

const commandStart = /^(bun|npx|npm|pnpm|yarn|node|curl|grep|cat|sh|bash|python3?|cargo|go|make)\b/;
const proseMarkers = /(>=|<=|\bpass\b|\bfail\b|\bmust\b|\bshould\b|\bshows\b|\bvia\b|==)/i;

export function firstRunnableCommand(proof: string): string | null {
  for (const rawLine of proof.split(/[;\n]/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (!commandStart.test(line)) continue;
    if (proseMarkers.test(line)) return null;
    return line;
  }
  return null;
}

export function verifyProof(proof: string, runner: CommandRunner = defaultRunner): ProofOutcome {
  const command = firstRunnableCommand(proof);
  if (!command) {
    return { verified: false, command: null, reason: "the contract's proof has no runnable command, so the gate cannot be verified mechanically" };
  }
  const result = runner(command);
  const output = `${result.stdout}${result.stderr}`.trim().slice(-4000);
  return result.exitCode === 0 ? { verified: true, command, output } : { verified: false, command, exitCode: result.exitCode, output };
}
