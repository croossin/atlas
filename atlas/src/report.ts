import fs from 'node:fs';
import path from 'node:path';
import type { RunResult } from './types.js';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function writeReport(run: RunResult, outDir: string): { htmlPath: string; jsonPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(run, null, 2));

  const passed = run.flows.filter((f) => f.status === 'pass').length;
  const failed = run.flows.length - passed;
  const totalCost = run.flows
    .flatMap((f) => f.steps)
    .reduce((sum, s) => sum + (s.costUsd ?? 0), 0);

  const flowsHtml = run.flows
    .map((f) => {
      const stepsHtml = f.steps
        .map((s) => {
          const icon = s.status === 'pass' ? '✓' : s.status === 'fail' ? '✗' : '○';
          const verdictHtml = s.verdict
            ? `<div class="verdict verdict-${s.verdict.status}">
                 <div class="verdict-summary">${esc(s.verdict.summary)}</div>
                 <div class="verdict-reasoning">${esc(s.verdict.reasoning)}</div>
                 ${s.verdict.evidence?.length ? `<ul>${s.verdict.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
               </div>`
            : '';
          const transcriptHtml = s.transcript?.length
            ? `<details class="transcript"><summary>Agent transcript (${s.transcript.length} entries${
                s.costUsd ? `, $${s.costUsd.toFixed(4)}` : ''
              })</summary>
               ${s.transcript
                 .map((t) =>
                   t.kind === 'tool'
                     ? `<div class="t-tool">→ ${esc(t.text)}</div>`
                     : `<div class="t-thought">${esc(t.text)}</div>`
                 )
                 .join('')}
               </details>`
            : '';
          const shotHtml = s.screenshot
            ? `<details class="shot"><summary>Screenshot</summary><img src="data:image/png;base64,${s.screenshot}" alt="screenshot"></details>`
            : '';
          return `<div class="step step-${s.status}">
            <div class="step-head">
              <span class="step-icon">${icon}</span>
              <span class="step-title">${esc(s.title)}</span>
              <span class="step-meta">${s.kind === 'agent' ? '🤖 agent · ' : ''}${(s.durationMs / 1000).toFixed(1)}s</span>
            </div>
            ${s.detail && !s.verdict ? `<div class="step-detail">${esc(s.detail)}</div>` : ''}
            ${verdictHtml}${transcriptHtml}${shotHtml}
          </div>`;
        })
        .join('');
      return `<section class="flow flow-${f.status}">
        <div class="flow-head">
          <h2>${f.status === 'pass' ? '✓' : '✗'} ${esc(f.flow.name)}</h2>
          <span class="flow-meta">${esc(f.flow.id)} · ${(f.durationMs / 1000).toFixed(1)}s</span>
        </div>
        ${f.flow.description ? `<p class="flow-desc">${esc(f.flow.description)}</p>` : ''}
        ${stepsHtml}
      </section>`;
    })
    .join('');

  const injected = Object.entries(run.injectedEnv)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atlas Run — ${esc(run.target)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; padding: 32px; font-size: 14px; }
.wrap { max-width: 980px; margin: 0 auto; }
header { margin-bottom: 24px; }
h1 { font-size: 24px; margin-bottom: 4px; } h1 span { color: #38bdf8; }
.sub { color: #94a3b8; font-size: 13px; }
.pill-row { display: flex; gap: 10px; margin: 18px 0; flex-wrap: wrap; }
.pill { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 10px 18px; }
.pill b { font-size: 20px; display: block; }
.pill-pass b { color: #4ade80; } .pill-fail b { color: #f87171; }
.flow { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 18px 20px; margin-bottom: 18px; }
.flow-pass { border-left: 4px solid #4ade80; } .flow-fail { border-left: 4px solid #f87171; }
.flow-head { display: flex; align-items: baseline; gap: 12px; }
.flow-head h2 { font-size: 16px; }
.flow-pass h2 { color: #4ade80; } .flow-fail h2 { color: #f87171; }
.flow-meta, .step-meta { color: #64748b; font-size: 12px; margin-left: auto; }
.flow-desc { color: #94a3b8; margin: 6px 0 10px; font-size: 13px; }
.step { border-top: 1px solid #293548; padding: 8px 4px; }
.step-head { display: flex; gap: 10px; align-items: baseline; }
.step-icon { width: 16px; }
.step-pass .step-icon { color: #4ade80; } .step-fail .step-icon { color: #f87171; } .step-skipped { opacity: 0.45; }
.step-title { font-family: ui-monospace, monospace; font-size: 12.5px; }
.step-detail { color: #fca5a5; font-size: 12.5px; margin: 4px 0 0 26px; }
.step-pass .step-detail { color: #86efac; }
.verdict { margin: 8px 0 4px 26px; padding: 10px 14px; border-radius: 8px; font-size: 13px; }
.verdict-pass { background: #052e16; border: 1px solid #166534; }
.verdict-fail { background: #450a0a; border: 1px solid #991b1b; }
.verdict-summary { font-weight: 700; margin-bottom: 6px; }
.verdict-reasoning { color: #cbd5e1; white-space: pre-wrap; }
.verdict ul { margin: 8px 0 0 18px; color: #cbd5e1; }
details { margin: 6px 0 0 26px; font-size: 12.5px; }
summary { cursor: pointer; color: #7dd3fc; }
.transcript { background: #0b1220; border-radius: 8px; padding: 8px 12px; }
.t-tool { font-family: ui-monospace, monospace; color: #7dd3fc; padding: 2px 0; }
.t-thought { color: #cbd5e1; padding: 4px 0; white-space: pre-wrap; }
.shot img { max-width: 100%; border-radius: 8px; border: 1px solid #334155; margin-top: 8px; }
footer { color: #475569; font-size: 12px; margin-top: 28px; }
</style></head><body><div class="wrap">
<header>
  <h1>Atlas<span> QA Report</span></h1>
  <div class="sub">Target: <b>${esc(run.target)}</b> at ${esc(run.baseUrl)} · ${esc(run.startedAt)} · ${(
    run.durationMs / 1000
  ).toFixed(1)}s total${injected ? ` · injected: <b>${esc(injected)}</b>` : ''}</div>
  <div class="pill-row">
    <div class="pill pill-pass"><b>${passed}</b>flows passed</div>
    <div class="pill pill-fail"><b>${failed}</b>flows failed</div>
    <div class="pill"><b>${run.flows.reduce((n, f) => n + f.steps.length, 0)}</b>steps</div>
    ${totalCost ? `<div class="pill"><b>$${totalCost.toFixed(3)}</b>agent spend</div>` : ''}
  </div>
</header>
${flowsHtml}
<footer>Generated by Atlas — provision → seed → test → report.</footer>
</div></body></html>`;

  const htmlPath = path.join(outDir, 'report.html');
  fs.writeFileSync(htmlPath, html);
  return { htmlPath, jsonPath };
}
