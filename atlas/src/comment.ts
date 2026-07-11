#!/usr/bin/env tsx
// Renders a run's results.json as GitHub-flavored markdown for a PR comment.
// Usage: tsx src/comment.ts <results.json> [reportUrl]

import fs from 'node:fs';
import type { RunResult } from './types.js';

const [resultsPath, reportUrl] = process.argv.slice(2);
if (!resultsPath) {
  console.error('usage: comment.ts <results.json> [reportUrl]');
  process.exit(2);
}

const run = JSON.parse(fs.readFileSync(resultsPath, 'utf8')) as RunResult;
const passed = run.flows.filter((f) => f.status === 'pass').length;
const failed = run.flows.length - passed;
const totalCost = run.flows.flatMap((f) => f.steps).reduce((s, x) => s + (x.costUsd ?? 0), 0);
const agentSteps = run.flows.flatMap((f) => f.steps).filter((s) => s.kind === 'agent').length;

const lines: string[] = [];
lines.push('<!-- atlas-report -->');
lines.push(`## ${failed > 0 ? '🔴' : '🟢'} Atlas QA — ${passed} passed, ${failed} failed`);
lines.push('');
lines.push(
  `**Target:** ${run.target} · **Duration:** ${(run.durationMs / 1000).toFixed(0)}s · ` +
    `**Agent steps:** ${agentSteps}${totalCost ? ` ($${totalCost.toFixed(2)})` : ''}`
);
lines.push('');
lines.push('| Flow | Status | Duration | Steps |');
lines.push('|---|---|---|---|');
for (const f of run.flows) {
  const icon = f.status === 'pass' ? '✅' : '❌';
  const stepSummary = `${f.steps.filter((s) => s.status === 'pass').length}/${f.steps.length} passed`;
  lines.push(`| ${f.flow.name} | ${icon} ${f.status} | ${(f.durationMs / 1000).toFixed(1)}s | ${stepSummary} |`);
}
lines.push('');

for (const f of run.flows.filter((x) => x.status === 'fail')) {
  const failedStep = f.steps.find((s) => s.status === 'fail');
  lines.push(`### ❌ ${f.flow.name}`);
  if (failedStep?.verdict) {
    lines.push(`> **Agent verdict:** ${failedStep.verdict.summary}`);
    lines.push('>');
    for (const e of failedStep.verdict.evidence.slice(0, 5)) lines.push(`> - ${e}`);
    lines.push('');
    lines.push('<details><summary>Agent reasoning</summary>');
    lines.push('');
    lines.push(failedStep.verdict.reasoning);
    lines.push('');
    lines.push('</details>');
  } else if (failedStep) {
    lines.push(`> **Failed step:** \`${failedStep.title}\``);
    if (failedStep.detail) lines.push(`> ${failedStep.detail}`);
  }
  lines.push('');
}

if (reportUrl) {
  lines.push(`📊 **[View the full report →](${reportUrl})** (step timelines, agent transcripts, screenshots, user journey frames)`);
  lines.push('');
}
lines.push('<sub>Atlas — provision → seed → test → report. Agent steps verify business rules the way a human QA would.</sub>');

console.log(lines.join('\n'));
