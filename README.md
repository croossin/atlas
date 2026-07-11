# Atlas

**An agentic QA pipeline: give it a build, get back a verified verdict.**

Atlas attacks the "30 minutes to build, 2 days to verify" problem. It takes a build,
provisions an ephemeral environment, seeds it with a realistic mock book of business,
and then runs *hybrid* test flows against the live UI: deterministic Playwright steps
cover the known ground fast, and AI agent steps do what a human QA does — traverse the
product, recompute the numbers, and judge whether the workflow actually worked.

```
┌───────────┐   ┌──────────┐   ┌─────────────────────────┐   ┌──────────┐
│ PROVISION │ → │   SEED   │ → │          TEST           │ → │  REPORT  │
│ ephemeral │   │ mock book│   │ scripted steps (fast) + │   │ HTML +   │
│ env, fresh│   │ of biz   │   │ agent steps (judgment)  │   │ JSON +   │
│ DB, port  │   │ via API  │   │ over one live browser   │   │ exit code│
└───────────┘   └──────────┘   └─────────────────────────┘   └──────────┘
```

## What makes it different from an integration suite

A scripted test asserts what you told it to assert. An Atlas agent step gets a *goal*
("process a $730 endorsement and verify it was billed pro-rata for the remaining term")
and a browser. It reads the page, does the math from the policy's own dates, and fails
with **expected-vs-actual evidence and a root-cause hypothesis** — e.g.:

> *"Endorsement proration is inverted: the app billed $660.00 (730 × elapsed 330/365
> days) instead of the expected $70.00 (730 × remaining 35/365 days) — a $590.00
> discrepancy. 660 ÷ 730 = 330/365, and 330 is exactly the number of elapsed days, so
> the app computed the pro-rata factor from days elapsed rather than days remaining."*

That is a bug a confirmation-message assertion can never catch, found the way a senior
QA would find it — and it's exactly the class of defect that costs manual QA days.

## Repo layout

| Path | What it is |
|---|---|
| `atlas/` | The pipeline CLI (TypeScript). Product-agnostic: point it at any web app with a start command, a health endpoint, and a seed API. |
| `demo-app/` | **Meridian AMS** — a deliberately Epic-shaped insurance agency management demo app (clients → policies → endorsements/renewals → invoices/receipts → activities) used as the showcase target. Supports injected regressions via `ATLAS_BUG`. |
| `flows/` | Test flows in YAML. Steps are either scripted (`goto`/`click`/`fill`/`select`/`expect_text`) or `agent:` goals in plain English. |
| `atlas.yaml` | Pipeline config: target command, health check, seed endpoint, agent settings. |
| `atlas-runs/` | One folder per run: `report.html` (self-contained, screenshots inline) + `results.json`. |

## Quick start

```bash
cd demo-app && npm install && cd ..
cd atlas && npm install && npx playwright install chromium

# Full suite against a clean build — everything passes
npm run atlas -- run --config ../atlas.yaml

# Same suite against a build with a planted regression — Atlas catches and diagnoses it
npm run atlas -- run --config ../atlas.yaml --env ATLAS_BUG=endorsement-prorate

# One flow, open the report when done
npm run atlas -- run --config ../atlas.yaml --flow endorsement --open
```

Agent steps run on the Claude Agent SDK using your local Claude Code login — no API
key needed. Exit code is non-zero when any flow fails, so `atlas run` drops straight
into CI as a quality gate.

Planted regressions available in the demo app (`--env ATLAS_BUG=...`, comma-separable):
`endorsement-prorate` (proration factor inverted), `stale-balance` (receipts ignored in
displayed balance), `missing-activity` (endorsement skips its workflow activity).

## Writing a flow

```yaml
id: endorsement
name: Endorsement — mid-term premium change is pro-rated correctly
steps:
  - do: goto            # deterministic steps: fast, repeatable, cheap
    path: /clients
  - do: click
    role: link
    name: Harbor Point Logistics
  - do: agent           # agent step: judgment
    goal: |
      Process an endorsement with an annualized premium change of $730.00.
      The app must bill it pro-rata for the REMAINING days of the term —
      compute the expected amount yourself from the policy dates and verify
      the ENDT transaction matches. Fail with expected vs actual otherwise.
```

Rule of thumb: script the *arrange*, let the agent do the *act + assert* wherever the
assertion requires judgment (math, cross-page consistency, "did the workflow actually
complete").

## How agent steps work

Each agent step hands the flow's live Playwright page to a Claude agent through five
sandboxed browser tools (`snapshot` — accessibility tree, `goto`, `click`, `fill`,
`select`). The agent can't touch files, shell, or network — only the app under test.
It must finish with a structured verdict (`pass`/`fail` + summary + reasoning +
evidence), which lands in the report alongside the full tool-call transcript, per-step
screenshots, and agent spend.

## Mapping to Applied Epic

Atlas's core is product-agnostic; Meridian AMS exists so the demo speaks Epic's
language (accounts, policies with terms, transaction codes like NEWB/ENDT/RENB,
agency vs. direct bill, activities as the workflow backbone). In a real Epic
deployment the stages map to existing Applied surfaces:

- **Provision** → Epic's existing multi-database model (demo/training databases are
  already selectable at login).
- **Seed** → the Applied Dev Center REST APIs (clients/policies/contacts) and Epic's
  import utilities.
- **Test** → Epic Browser is a standard web UI; Applied already hires SDETs on
  Playwright, so the deterministic layer speaks their in-house dialect. Agent steps
  ride on top of the same browser session.
- **Report** → per-PR quality gate in CI, with the HTML report as the reviewable
  artifact QA signs off on.

## Roadmap

- **Diff-aware flow selection/generation**: read the PR change set and generate or
  prioritize targeted flows for what changed.
- Parallel flow execution (each flow already runs in an isolated browser context).
- Flow recorder: capture a manual QA session once, replay it as the scripted skeleton.
- Seed adapters (Applied Dev Center API, CSV import) and environment adapters
  (docker-compose, k8s namespace) behind the same config.
