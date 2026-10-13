---
name: terraloop-rank
description: Run one manual iteration of the rank agentic SEO loop for a site on Cloudflare. Use when the user says rank iterate, run an SEO experiment, measure experiment NNN, or /skill:terraloop-rank. Each iteration is research, hypothesis, act (push to main), measure, record, with recipe-gated evidence in the public rank ledger. Never schedule it.
---

# Rank Terraloop

`rank` is an agentic SEO loop on Cloudflare. One iteration tests one change to the site and records
the result in a public ledger, win or loss. A person starts every iteration. Nothing runs on a
schedule.

```text
/skill:terraloop-rank <site> [experiment id]
```

Repo: `~/cloudflare/rank` (github.com/acoyfellow/rank). The ledger lives in
`experiments/<id>/` inside that repo, so every experiment is public and versioned.

## Two gates

| Script | Question | Passes when |
|---|---|---|
| `gate.sh` | Is the ledger honest? | No experiment is past its window without a verdict |
| `recipe-gate.sh <id> [--dry-run]` | Was this one experiment done right? | All recipe gates pass (below) |

```bash
bash <skill-dir>/gate.sh
bash <skill-dir>/recipe-gate.sh 002 --dry-run
```

Both read `RANK_REPO` (default `~/cloudflare/rank`).

## The recipe: one experiment

Each step writes one file in `experiments/<id>/`. The gate checks the files, not your narration.

| # | Step | File | Gate checks |
|---|---|---|---|
| 1 | **Research.** Run `bun run iterate research`. It reads traffic, crawler visits, and AI Search results for the site, and Web Search ranks when credits exist. Read the output. Name the gap. | `research.md` | has `## Gap` and cites at least one data source |
| 2 | **Hypothesis.** One change. One metric. A target. A control group of pages you will not touch. A window of at least 14 days. | `experiment.json` | has `hypothesis`, `metric`, `target`, `control`, `windowDays >= 14` |
| 3 | **Act.** Make exactly one change to the site. Push it to main. Record the full commit SHA. | `experiment.json` `commit` | the commit exists in the site repo |
| 4 | **Baseline.** Freeze the metric for the window before the commit, for treated and control pages. | `baseline.json` | per-page rows, written before the commit date |
| 5 | **Measure.** After the window closes, run `bun run iterate measure <id>`. It reads the same metric for the same length after the commit. | `after.json` | per-page rows, window length equals baseline |
| 6 | **Verdict.** `bun run iterate verdict <id>` recomputes the effect from the per-page files. Treated change minus control change, against the noise band. | `verdict.json` | the recomputed numbers match; verdict is `proven`, `disproven`, or `inconclusive` |
| 7 | **Record.** Update `status.json` (move the claim), push, confirm the public dashboard shows it. | `receipt.md` | names the commit and the verdict |

Steps 1-4 happen in the first session. Steps 5-7 happen in a later session, after the window
closes. An open experiment between those sessions is normal.

## Rules

- One change per experiment. If you change two things, you learn nothing.
- Never edit the metric, the baseline, or the control group after step 4.
- The control group must be pages with no change in the window.
- A loss is a valid result. Record `disproven` with the numbers. Do not weaken the claim.
- If the treated metric drops by more than the noise band, revert the commit and record it.
- At most one open experiment per page group.
- Public files contain totals only. No IPs, emails, user agents, or query strings. Round counts
  under 5.
- Push to main is allowed for the site and for rank. Ask before you turn on any product that bills.
- Never add a cron, alarm, or schedule for this loop. The user starts every iteration.

## Data sources

| Source | Gives |
|---|---|
| GraphQL zone analytics | requests and page views by path, verified bot category |
| Our request log (Basin Pipelines to R2) | referrer host by path, which the free plan's analytics hides |
| Workers analytics | requests and errors for the site Worker |
| AI Search over the site | content gaps and internal link targets |
| Browser Run crawl | broken links, missing titles, orphan pages |
| Web Search API | rank of the site for target queries (needs AI Gateway credits) |

## Contract

1. `terraloop_control action=arm`. North star: "Run rank experiment <id> on <site> to a recorded,
   recipe-gated result."
2. Show the contract: the site, the experiment id, the step you will reach this session, and both
   gate commands. Scope is the rank repo and the site repo. Wait for go.
3. `terraloop_control action=lock`. The proof is `recipe-gate.sh <id> --dry-run` for a session that
   stops at step 4, and `recipe-gate.sh <id>` for a session that reaches step 7.
4. Create one `loops_task` driver after lock, so `/terraloop-off` stops it. Delete it when the
   session's gate passes. The driver lives for one session only.

## Receipt

`receipt.md` fields: `EXPERIMENT`, `COMMIT`, `METRIC`, `TREATED_DELTA`, `CONTROL_DELTA`,
`NOISE_BAND`, `VERDICT`, `DASHBOARD`.

Experiment 001 (cross-links on `/prompts/*`, commit `0726bb2`) is the worked example.
