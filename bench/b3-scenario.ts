export type B3Turn = {
  readonly id: string;
  readonly toolCalls: number;
  readonly progressCalls: number;
  readonly newEvidence: boolean;
  readonly childCallback: boolean;
};

const turn = (id: string, toolCalls: number, newEvidence: boolean, childCallback = false): B3Turn => ({
  id,
  toolCalls,
  progressCalls: newEvidence && !childCallback ? toolCalls : 0,
  newEvidence,
  childCallback,
});

export const scenario: readonly B3Turn[] = [
  turn("lock-and-start-job", 6, true),
  turn("check-job-still-running", 1, false),
  turn("check-job-again", 1, false),
  turn("reply-no-change", 0, false),
  turn("check-log-tail", 1, false),
  turn("child-callback-arrives", 0, true, true),
  turn("read-result-and-commit", 4, true),
  turn("start-gate-in-background", 2, true),
  turn("poll-gate-log", 1, false),
  turn("poll-gate-log-again", 1, false),
  turn("poll-gate-log-third", 1, false),
  turn("gate-log-finished", 2, true),
  turn("refresh-receipts-background", 2, true),
  turn("poll-receipt-log", 1, false),
  turn("poll-receipt-log-again", 1, false),
  turn("receipts-done-commit", 3, true),
  turn("report-and-delete-driver", 2, true),
];
