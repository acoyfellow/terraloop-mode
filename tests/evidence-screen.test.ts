import { describe, expect, test } from "bun:test";
import { labelBlindEvidence, screenEvidence, stripSelfReported, type ClassifierLike } from "../evidence-screen.ts";

function fakeModels(probability: number | undefined, seen: unknown[] = []): ClassifierLike {
  return {
    getModelOfType: (_type, provider, id) => (provider === "odds" && id === "clef" ? { id } : undefined),
    classify: async (_model, context) => {
      seen.push(context.state);
      if (probability === undefined) {
        return { stopReason: "error" as const, errorMessage: "gateway 401", answers: {} as Record<string, { type: string; probability?: number }> };
      }
      return { stopReason: "stop" as const, answers: { proves_gate: { type: "bool", probability } } };
    },
  };
}

describe("label-blind evidence", () => {
  test("strips self-reported verdict fields at every depth", () => {
    expect(
      stripSelfReported([{ name: "auth", pass: true, detail: { status: 200, ok: true, verdict: "pass" } }]),
    ).toEqual([{ detail: { status: 200 } }]);
  });

  test("strips PASS/FAIL prefixes from plain-text proof output", () => {
    expect(labelBlindEvidence("PASS gateway rejects anon\nFAIL docs 200")).toBe("gateway rejects anon\ndocs 200");
  });
});

describe("screenEvidence", () => {
  test("is skipped when odds/clef is not installed", async () => {
    const models: ClassifierLike = { ...fakeModels(0.9), getModelOfType: () => undefined };
    expect(await screenEvidence(models, "gate", "out")).toEqual({ status: "skipped", reason: "odds/clef is not installed" });
    expect(await screenEvidence(undefined, "gate", "out")).toEqual({ status: "skipped", reason: "no model runtime" });
  });

  test("never sends the self-reported label to the classifier", async () => {
    const seen: unknown[] = [];
    await screenEvidence(fakeModels(0.9, seen), "anon is rejected", JSON.stringify({ pass: true, detail: { status: 200 } }));
    expect(JSON.stringify(seen[0])).not.toContain("pass");
    expect(seen[0]).toEqual({ gate: "anon is rejected", evidence: { detail: { status: 200 } } });
  });

  test("marks supported and doubtful around the 0.8 threshold", async () => {
    expect((await screenEvidence(fakeModels(0.91), "g", "o")).status).toBe("supported");
    expect((await screenEvidence(fakeModels(0.07), "g", "o")).status).toBe("doubtful");
  });

  test("reports classifier errors without throwing", async () => {
    expect(await screenEvidence(fakeModels(undefined), "g", "o")).toEqual({ status: "error", reason: "gateway 401" });
  });
});
