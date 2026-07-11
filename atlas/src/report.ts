import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentVerdict, FlowResult, JourneyFrame, RunResult, StepResult } from './types.js';

const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'report.template.html');

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function fmtDur(ms: number): string {
  if (ms < 100) return '0.0s';
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms - m * 60_000) / 1000)}s`;
}

// Design evidence rows are typed: Expected / Actual / Observed.
function evidenceType(text: string): 'exp' | 'act' | 'ok' {
  if (/^expected\b/i.test(text)) return 'exp';
  if (/^actual\b/i.test(text)) return 'act';
  return 'ok';
}

interface ShotMap {
  [key: string]: string;
}

function buildData(run: RunResult) {
  const shots: ShotMap = {};
  let shotSeq = 0;
  const addShot = (b64: string, mime: 'png' | 'jpeg'): string => {
    const key = `s${shotSeq++}`;
    shots[key] = `data:image/${mime};base64,${b64}`;
    return key;
  };

  const flows = run.flows.map((f: FlowResult) => {
    const steps = f.steps.map((s: StepResult) => {
      const st = s.status === 'skipped' ? 'skip' : s.status;
      if (s.kind === 'agent') {
        const flowStep = f.flow.steps[s.index] as { goal?: string } | undefined;
        const goal = (flowStep?.goal ?? s.title).trim();
        const verdict = s.verdict as AgentVerdict | undefined;
        return {
          k: 'a',
          st,
          d: s.status === 'skipped' ? '—' : fmtDur(s.durationMs),
          goal: esc(goal).replace(/\n/g, '<br>'),
          verdict: verdict
            ? {
                st: verdict.status,
                summary: esc(verdict.summary),
                reasoning: esc(verdict.reasoning),
                evidence: (verdict.evidence ?? []).map((e) => ({ t: evidenceType(e), x: esc(e) })),
              }
            : {
                st: 'fail',
                summary: esc(s.detail ?? 'Agent produced no verdict.'),
                reasoning: '',
                evidence: [],
              },
          transcript: (s.transcript ?? []).map((t) => ({ t: t.kind === 'tool' ? 'call' : 'think', c: esc(t.text) })),
          shot: s.screenshot ? addShot(s.screenshot, 'png') : undefined,
        };
      }
      return {
        k: 's',
        st,
        a: s.title,
        d: s.status === 'skipped' ? '—' : fmtDur(s.durationMs),
        note: s.detail,
        shot: s.screenshot ? addShot(s.screenshot, 'png') : undefined,
      };
    });

    const allFrames = f.steps.flatMap((s: StepResult) =>
      (s.frames ?? []).map((fr: JourneyFrame) => ({ frame: fr, stepFailed: s.status === 'fail' }))
    );
    const frames = allFrames.map(({ frame, stepFailed }, i) => ({
      shot: addShot(frame.screenshot, 'jpeg'),
      kind: frame.kind === 'agent' ? 'a' : 's',
      cap: frame.caption,
      hl: frame.target
        ? {
            x: +frame.target.x.toFixed(2),
            y: +frame.target.y.toFixed(2),
            w: +frame.target.w.toFixed(2),
            h: +frame.target.h.toFixed(2),
          }
        : undefined,
      fail: stepFailed && i === allFrames.length - 1 ? true : undefined,
    }));

    return {
      id: f.flow.id,
      status: f.status,
      name: f.flow.name,
      duration: fmtDur(f.durationMs),
      desc: f.flow.description?.trim() ?? '',
      steps,
      frames,
    };
  });

  const totalCost = run.flows.flatMap((f) => f.steps).reduce((sum, s) => sum + (s.costUsd ?? 0), 0);

  const runData = {
    app: run.target,
    baseUrl: run.baseUrl,
    timestamp: run.startedAt.replace('T', ' ').slice(0, 16) + ' UTC',
    duration: fmtDur(run.durationMs),
    runId: `atlas_${run.startedAt.replace(/[-:TZ.]/g, '').slice(0, 14)}`,
    commit: run.commit ?? '',
    injectedBug: Object.entries(run.injectedEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join(' '),
    agentSpend: totalCost ? `$${totalCost.toFixed(2)}` : '',
    config: run.configYaml ?? '',
    flows,
  };

  return { shots, runData };
}

// Header button + overlay showing the atlas.yaml this run executed with.
// Injected separately from the design's renderer so design re-imports stay clean.
const CONFIG_VIEWER = `
<style>
.cfgbtn{margin-left:auto;display:inline-flex;align-items:center;gap:7px;background:var(--panel-2);
  color:var(--sub);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:12px;
  font-family:var(--mono);cursor:pointer;flex:none}
.cfgbtn:hover{color:var(--ink);border-color:var(--agent-line)}
.cfgbtn .dot{width:6px;height:6px;border-radius:50%;background:var(--agent);flex:none}
#cfgov{position:fixed;inset:0;z-index:60;display:none;background:rgba(6,7,9,.72);backdrop-filter:blur(6px)}
#cfgov.on{display:flex;align-items:center;justify-content:center}
.cfgpanel{width:min(720px,90vw);max-height:82vh;display:flex;flex-direction:column;
  background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;
  box-shadow:0 30px 80px rgba(0,0,0,.5)}
.cfghead{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line-soft)}
.cfghead .t{font-family:var(--mono);font-size:13px;color:var(--ink)}
.cfghead .s{font-size:12px;color:var(--faint)}
.cfghead button{margin-left:auto;background:var(--raise);color:var(--sub);border:1px solid var(--line);
  border-radius:7px;padding:5px 12px;font-size:12px;cursor:pointer}
.cfghead button:hover{color:var(--ink)}
.cfgbody{overflow:auto;padding:18px 22px}
.cfgbody pre{margin:0;font-family:var(--mono);font-size:12.5px;line-height:1.75;color:var(--ink)}
.cfgbody .c{color:var(--faintest)} .cfgbody .k{color:var(--agent)} .cfgbody .v{color:var(--sub)}
</style>
<script>
(function(){
  if(!RUN.config) return;
  var bar=document.querySelector('.hbar');
  var btn=document.createElement('button');
  btn.className='cfgbtn';
  btn.innerHTML='<span class="dot"></span>atlas.yaml';
  btn.title='View the pipeline config this run executed with';
  bar.appendChild(btn);
  var hl=RUN.config.split('\\n').map(function(line){
    var e=line.replace(/&/g,'&amp;').replace(/</g,'&lt;');
    if(/^\\s*#/.test(e)) return '<span class="c">'+e+'</span>';
    return e.replace(/^(\\s*[\\w.-]+:)/,'<span class="k">$1</span>')
            .replace(/(#.*)$/,'<span class="c">$1</span>');
  }).join('\\n');
  var ov=document.createElement('div');
  ov.id='cfgov';
  ov.innerHTML='<div class="cfgpanel"><div class="cfghead"><span class="t">atlas.yaml</span>'+
    '<span class="s">pipeline configuration for this run</span><button id="cfgx">✕ close</button></div>'+
    '<div class="cfgbody"><pre>'+hl+'</pre></div></div>';
  document.body.appendChild(ov);
  btn.addEventListener('click',function(){ov.classList.add('on');});
  document.getElementById('cfgx').addEventListener('click',function(){ov.classList.remove('on');});
  ov.addEventListener('click',function(e){if(e.target===ov)ov.classList.remove('on');});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')ov.classList.remove('on');});
})();
</script>`;

export function writeReport(run: RunResult, outDir: string): { htmlPath: string; jsonPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(run, null, 2));

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const { shots, runData } = buildData(run);
  // "</" must not appear literally inside the inline script.
  const dataJs = `const SHOTS=${JSON.stringify(shots).replace(/<\//g, '<\\/')};\nconst RUN=${JSON.stringify(runData).replace(/<\//g, '<\\/')};`;

  const html = template.replace('/*__ATLAS_DATA__*/', dataJs).replace('</body>', `${CONFIG_VIEWER}\n</body>`);

  const htmlPath = path.join(outDir, 'report.html');
  fs.writeFileSync(htmlPath, html);
  return { htmlPath, jsonPath };
}
