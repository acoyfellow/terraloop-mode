export const SELF_REPORTED_KEYS = new Set([
  "pass",
  "passed",
  "ok",
  "verdict",
  "success",
  "status_label",
  "claim",
  "name",
]);

const SELF_REPORTED_PREFIXES = ["PASS", "FAIL", "OK", "✓", "✗", "✔", "✘"];
const SELF_REPORTED_LINE = new RegExp(`^\\s*(${SELF_REPORTED_PREFIXES.join("|")})(?=[\\s:-])[:\\s-]*`, "gim");
const ACCEPT_THRESHOLD = 0.8;

export interface ClassifierLike {
  classify(
    model: unknown,
    context: { state: Record<string, unknown>; questions: Record<string, unknown> },
  ): Promise<{
    stopReason: "stop" | "error" | "aborted";
    errorMessage?: string;
    answers: Record<string, { type: string; probability?: number }>;
  }>;
  getModelOfType(type: "classifier", provider: string, modelId: string): unknown;
}

export type EvidenceScreen =
  | { status: "skipped"; reason: string }
  | { status: "supported"; probability: number; model: string }
  | { status: "doubtful"; probability: number; model: string }
  | { status: "error"; reason: string };

export function stripSelfReported(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSelfReported);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SELF_REPORTED_KEYS.has(key))
        .map(([key, inner]) => [key, stripSelfReported(inner)]),
    );
  }
  return value;
}

export function labelBlindEvidence(output: string): unknown {
  try {
    return stripSelfReported(JSON.parse(output));
  } catch {
    return output.replace(SELF_REPORTED_LINE, "");
  }
}

export async function screenEvidence(
  models: ClassifierLike | undefined,
  gate: string,
  proofOutput: string,
  modelRef: { provider: string; id: string } = { provider: "odds", id: "clef" },
): Promise<EvidenceScreen> {
  if (!models) return { status: "skipped", reason: "no model runtime" };
  const model = models.getModelOfType("classifier", modelRef.provider, modelRef.id);
  if (!model) return { status: "skipped", reason: `${modelRef.provider}/${modelRef.id} is not installed` };
  try {
    const result = await models.classify(model, {
      state: { gate, evidence: labelBlindEvidence(proofOutput) },
      questions: {
        proves_gate: {
          type: "bool",
          instructions:
            "Read the gate and the raw evidence. Does the raw evidence itself show the gate condition holds? Missing, empty, failing, or contradictory evidence means no.",
          criteria: { true: "Evidence shows the gate holds", false: "Evidence does not show the gate holds" },
        },
      },
    });
    const probability = result.answers.proves_gate?.probability;
    if (result.stopReason !== "stop" || typeof probability !== "number") {
      return { status: "error", reason: result.errorMessage ?? "classifier returned no answer" };
    }
    const label = `${modelRef.provider}/${modelRef.id}`;
    return probability >= ACCEPT_THRESHOLD
      ? { status: "supported", probability, model: label }
      : { status: "doubtful", probability, model: label };
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
}

export function describeScreen(screen: EvidenceScreen): string {
  switch (screen.status) {
    case "supported":
      return `Evidence screen (${screen.model}, advisory): output supports the gate, p=${screen.probability.toFixed(2)}.`;
    case "doubtful":
      return `Evidence screen (${screen.model}, advisory): WARNING, the proof exited 0 but its output does not clearly show the gate holds (p=${screen.probability.toFixed(2)}). Read the output before you report success.`;
    case "error":
      return `Evidence screen: not run (${screen.reason}).`;
    case "skipped":
      return "";
  }
}
