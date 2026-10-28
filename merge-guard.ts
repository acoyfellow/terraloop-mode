export type MergeMode = "never" | "gate";

export type MergeAction = { kind: "merge"; provider: "github" | "gitlab" | "git"; detail: string };

const defaultBranches = new Set(["main", "master", "trunk", "production", "release"]);
const envAssignment = /^[A-Za-z_][A-Za-z0-9_]*=/;
const shellWrappers = new Set(["bash", "sh", "zsh", "dash"]);
const transparentPrefixes = new Set(["env", "command", "exec", "nohup", "time", "sudo"]);

export function parseMergeMode(value: unknown): MergeMode {
  return value === "gate" ? "gate" : "never";
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of segment) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function splitSegments(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/).map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

function stripPrefixes(tokens: string[]): string[] {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] as string;
    if (envAssignment.test(token) || transparentPrefixes.has(token)) {
      index += 1;
      continue;
    }
    break;
  }
  return tokens.slice(index);
}

function wrappedCommand(tokens: string[]): string | null {
  const [verb, flag, body] = tokens;
  if (verb && shellWrappers.has(verb) && flag === "-c" && typeof body === "string") return body;
  return null;
}

function subcommandWords(tokens: string[], valueFlags: ReadonlySet<string>): string[] {
  const words: string[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (valueFlags.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    words.push(token);
  }
  return words;
}

const mergePathPattern = new RegExp("/(?:pulls|merge_requests)/[^\\s/]+/merge(?:\\b|$)");
const headsPrefix = "refs/heads/";

function stripHeadsPrefix(ref: string): string {
  return ref.startsWith(headsPrefix) ? ref.slice(headsPrefix.length) : ref;
}

function apiWritesMerge(tokens: string[]): boolean {
  const joined = tokens.join(" ");
  const method = joined.match(/(?:-X|--method|--request)[\s=]+([A-Za-z]+)/)?.[1]?.toUpperCase();
  const mergeEndpoint = mergePathPattern.test(joined) || joined.includes("merge_trains/merge_requests/");
  if (mergeEndpoint && method !== undefined && method !== "GET") return true;
  return /enablePullRequestAutoMerge|mergePullRequest|enqueuePullRequest/.test(joined);
}

const ghValueFlags = new Set(["-R", "--repo", "--hostname"]);
const glabValueFlags = new Set(["-R", "--repo"]);

function ghMerge(tokens: string[]): MergeAction | null {
  const words = subcommandWords(tokens, ghValueFlags);
  if (words[0] === "pr" && words[1] === "merge") return { kind: "merge", provider: "github", detail: "gh pr merge" };
  if (words[0] === "api" && apiWritesMerge(tokens)) return { kind: "merge", provider: "github", detail: "GitHub merge API" };
  return null;
}

function glabMerge(tokens: string[]): MergeAction | null {
  const words = subcommandWords(tokens, glabValueFlags);
  if (words[0] === "mr" && (words[1] === "merge" || words[1] === "accept")) return { kind: "merge", provider: "gitlab", detail: "glab mr merge" };
  if (words[0] === "api" && apiWritesMerge(tokens)) return { kind: "merge", provider: "gitlab", detail: "GitLab merge API" };
  return null;
}

function curlMerge(tokens: string[]): MergeAction | null {
  if (!apiWritesMerge(tokens)) return null;
  const joined = tokens.join(" ");
  return { kind: "merge", provider: joined.includes("merge_requests") ? "gitlab" : "github", detail: "merge API over curl" };
}

function pushTargetsDefaultBranch(refspec: string): boolean {
  const destination = refspec.includes(":") ? refspec.slice(refspec.lastIndexOf(":") + 1) : refspec;
  const branch = stripHeadsPrefix(destination.replace(/^\+/, ""));
  return defaultBranches.has(branch);
}

const gitValueFlags = new Set(["-C", "-c", "--git-dir", "--work-tree"]);
const pushValueFlags = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

function gitMerge(tokens: string[]): MergeAction | null {
  let index = 1;
  while (index < tokens.length && (tokens[index] as string).startsWith("-")) {
    index += gitValueFlags.has(tokens[index] as string) ? 2 : 1;
  }
  if (tokens[index] !== "push") return null;
  const rest = tokens.slice(index + 1);
  const positional: string[] = [];
  for (let cursor = 0; cursor < rest.length; cursor += 1) {
    const token = rest[cursor] as string;
    const optionValue = token.startsWith("--push-option=") ? token.slice("--push-option=".length) : pushValueFlags.has(token) && (token === "-o" || token === "--push-option") ? rest[cursor + 1] : null;
    if (optionValue && /^merge_request\.(merge_when_pipeline_succeeds|auto_merge)/.test(optionValue)) {
      return { kind: "merge", provider: "gitlab", detail: "git push with a GitLab auto-merge option" };
    }
    if (pushValueFlags.has(token)) {
      cursor += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    positional.push(token);
  }
  const refspecs = positional.slice(1);
  if (refspecs.some(pushTargetsDefaultBranch)) return { kind: "merge", provider: "git", detail: "git push to a default branch" };
  return null;
}

function segmentMerge(segment: string, depth: number): MergeAction | null {
  const tokens = stripPrefixes(tokenize(segment));
  const inner = wrappedCommand(tokens);
  if (inner !== null && depth < 3) return findMergeAction(inner, depth + 1);
  const verb = tokens[0];
  if (verb === "gh") return ghMerge(tokens);
  if (verb === "glab") return glabMerge(tokens);
  if (verb === "curl") return curlMerge(tokens);
  if (verb === "git") return gitMerge(tokens);
  return null;
}

export function findMergeAction(command: string, depth = 0): MergeAction | null {
  for (const segment of splitSegments(command)) {
    const action = segmentMerge(segment, depth);
    if (action) return action;
  }
  return null;
}

export type MergeDecision = { allowed: true } | { allowed: false; reason: string };

export function evaluateMerge(phase: string, mode: MergeMode, action: MergeAction | null): MergeDecision {
  if (!action || phase === "off") return { allowed: true };
  if (mode === "gate" && phase === "gated") return { allowed: true };
  const native = action.provider === "gitlab" ? "GitLab MR" : action.provider === "github" ? "GitHub PR" : "default branch";
  const why =
    mode === "never"
      ? "this loop's contract is merge: never (full stop). Leave the change open and ready for the user to merge."
      : "this loop's contract is merge: gate. Merging is allowed only after action=gate verifies the proof.";
  return { allowed: false, reason: `terraloop merge blocked (${native}, ${action.detail}): ${why}` };
}
