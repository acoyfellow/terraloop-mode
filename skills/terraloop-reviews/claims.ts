import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { askOdds } from "/Users/jcoeyman/.pi/agent/extensions/odds-pi/src/client.ts";
import { readConfig, readToken } from "/Users/jcoeyman/.pi/agent/extensions/odds-pi/src/credentials.ts";

type Verdict = "supported" | "contradicted" | "unclear";
type ClaimResult = { claim: string; numbers: string[]; method: "code" | "clef"; verdict: Verdict; detail: string };

const CLAIRIC_MODEL = "@cf/cloudflare/clairic";
const CLEF_THRESHOLD = 0.5;
const EVIDENCE_FILES = ["p1.md", "blast.md", "reconcile.md", "p2.out", "p3.out"];
const NUMBER = /\d+(?:[.,]\d+)*%?/g;

const dir = process.argv[2];
if (!dir) {
  console.error("usage: bun claims.ts <recipe-dir>");
  process.exit(2);
}

const config = readConfig();
const token = readToken();
const gateway = { accountId: config.accountId, gateway: config.gateway, token, timeoutMs: 30_000 };

const readEvidence = (): string =>
  EVIDENCE_FILES.filter((file) => existsSync(`${dir}/${file}`))
    .map((file) => `## ${file}\n${readFileSync(`${dir}/${file}`, "utf8")}`)
    .join("\n\n");

const checkedSection = (note: string): string => {
  const details = note.match(/<details><summary>What (?:else )?I checked<\/summary>([\s\S]*?)<\/details>/);
  return details?.[1] ?? "";
};

const claimLines = (note: string): string[] =>
  checkedSection(note)
    .split("\n")
    .map((line) => line.replace(/^\s*-\s+/, "").replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/`[^`]*`/g, "").replace(/\b[0-9a-f]{7,40}\b/g, "").trim())
    .filter((line) => /\d/.test(line) && !line.startsWith("http"));

const normalize = (value: string): string => value.replace(/,/g, "").replace(/\.0+$/, "");

const numbersIn = (text: string): string[] => (text.match(NUMBER) ?? []).map(normalize);

const clairicNumbers = async (claim: string, number: string, evidence: string): Promise<string[]> => {
  const response = await fetch(`https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gateway}/workers-ai/${CLAIRIC_MODEL}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      state: evidence,
      fields: {
        n: { type: "list", items: "text", instructions: `Every number in the evidence that measures the same thing as the number ${number} in this claim: ${claim}` },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json()) as { success?: boolean; result?: { answers?: { n?: { value?: unknown } } } };
  if (!body.success) throw new Error(`clairic HTTP ${response.status}`);
  const value = body.result?.answers?.n?.value;
  const items = Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
  return items.map((item) => numbersIn(item)[0]).filter((item): item is string => item !== undefined);
};

const clefSupports = async (claim: string, evidence: string): Promise<number | null> => {
  const result = await askOdds(gateway, "clef", {
    state: { claim, evidence },
    questions: { supported: { type: "bool", instructions: "Does the evidence state the exact facts and numbers in the claim? Answer false if any number differs." } },
  });
  return result.ok && result.answers.supported.type === "bool" ? result.answers.supported.probability : null;
};

const checkClaim = async (claim: string, evidence: string): Promise<ClaimResult> => {
  const numbers = numbersIn(claim);
  const unconfirmed: string[] = [];
  for (const number of numbers) {
    const found = await clairicNumbers(claim, number, evidence);
    if (found.length === 0) {
      unconfirmed.push(number);
      continue;
    }
    if (!found.includes(number)) {
      return { claim, numbers, method: "code", verdict: "contradicted", detail: `claim says ${number}, evidence says ${[...new Set(found)].join("/")}` };
    }
  }
  if (numbers.length > 0 && unconfirmed.length === 0) return { claim, numbers, method: "code", verdict: "supported", detail: "clairic matched every number" };
  const probability = await clefSupports(claim, evidence);
  if (probability === null) return { claim, numbers, method: "clef", verdict: "unclear", detail: "clef error" };
  return { claim, numbers, method: "clef", verdict: probability >= CLEF_THRESHOLD ? "supported" : "contradicted", detail: `p=${probability.toFixed(3)}` };
};

const note = readFileSync(`${dir}/note.md`, "utf8");
const evidence = readEvidence();
const claims = claimLines(note);
const results: ClaimResult[] = [];
for (const claim of claims) results.push(await checkClaim(claim, evidence));

writeFileSync(`${dir}/claims.json`, JSON.stringify({ checked: results.length, results }, null, 1));
const bad = results.filter((result) => result.verdict !== "supported");
for (const result of bad) console.log(`${result.verdict}: ${result.claim} (${result.method}: ${result.detail})`);
console.log(`claims=${results.length} bad=${bad.length}`);
process.exit(bad.length === 0 ? 0 : 1);
