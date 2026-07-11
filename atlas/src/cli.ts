#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { AtlasConfig, Flow, RunResult } from './types.js';
import { provision } from './provision.js';
import { seedTarget } from './seed.js';
import { runFlows } from './runner.js';
import { writeReport } from './report.js';

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function parseArgs(argv: string[]) {
  const args = { config: 'atlas.yaml', flow: undefined as string | undefined, env: {} as Record<string, string>, open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--flow') args.flow = argv[++i];
    else if (a === '--open') args.open = true;
    else if (a === '--env') {
      const [k, ...rest] = argv[++i].split('=');
      args.env[k] = rest.join('=');
    } else if (a === 'run') {
      /* subcommand, ignore */
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function loadFlows(flowsDir: string, only?: string): Flow[] {
  const files = fs
    .readdirSync(flowsDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();
  const flows = files.map((f) => YAML.parse(fs.readFileSync(path.join(flowsDir, f), 'utf8')) as Flow);
  return only ? flows.filter((f) => f.id === only) : flows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const configDir = path.dirname(configPath);
  const configYaml = fs.readFileSync(configPath, 'utf8');
  const config = YAML.parse(configYaml) as AtlasConfig;

  let commit: string | undefined;
  try {
    const { execSync } = await import('node:child_process');
    const opts = { cwd: configDir, stdio: ['ignore', 'pipe', 'ignore'] as ('ignore' | 'pipe')[] };
    const branch =
      process.env.GITHUB_HEAD_REF || execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
    const sha = execSync('git rev-parse --short HEAD', opts).toString().trim();
    commit = `${branch} @ ${sha}`;
  } catch {
    /* not a git checkout — omit */
  }

  const flowsDir = path.resolve(configDir, config.flows);
  const flows = loadFlows(flowsDir, args.flow);
  if (flows.length === 0) {
    console.error(`No flows found in ${flowsDir}${args.flow ? ` matching id "${args.flow}"` : ''}`);
    process.exit(2);
  }

  const injectedEnv = { ...(config.target.env ?? {}), ...args.env };
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  console.log(c.bold('\n◆ Atlas QA pipeline'));
  console.log(`  Target: ${config.target.name}`);
  if (Object.keys(injectedEnv).length) console.log(`  Env:    ${Object.entries(injectedEnv).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  Flows:  ${flows.map((f) => f.id).join(', ')}`);

  // 1. Provision — ephemeral environment on a free port
  process.stdout.write(c.cyan('\n[1/4] Provisioning environment… '));
  const target = await provision({
    command: config.target.command,
    cwd: path.resolve(configDir, config.target.cwd),
    health: config.target.health,
    env: injectedEnv,
  });
  console.log(c.green(`up at ${target.baseUrl}`));

  let run: RunResult;
  try {
    // 2. Seed — deterministic mock book of business
    let seedSummary: unknown;
    if (config.seed) {
      process.stdout.write(c.cyan('[2/4] Seeding mock data… '));
      seedSummary = await seedTarget(target.baseUrl, config.seed.endpoint);
      console.log(c.green(`done ${c.dim(JSON.stringify(seedSummary))}`));
    } else {
      console.log(c.dim('[2/4] No seed configured — skipping'));
    }

    // 3. Test — hybrid deterministic + agent flows
    console.log(c.cyan('[3/4] Running flows…'));
    const flowResults = await runFlows(flows, {
      baseUrl: target.baseUrl,
      agentModel: config.agent?.model,
      agentMaxTurns: config.agent?.maxTurns,
      log: (line) => console.log(line),
    });

    run = {
      target: config.target.name,
      baseUrl: target.baseUrl,
      startedAt,
      durationMs: Date.now() - t0,
      injectedEnv,
      seedSummary,
      configYaml,
      commit,
      flows: flowResults,
    };
  } finally {
    await target.stop();
  }

  // 4. Report
  const runDir = path.resolve(configDir, 'atlas-runs', startedAt.replace(/[:.]/g, '-'));
  const { htmlPath } = writeReport(run, runDir);

  const passed = run.flows.filter((f) => f.status === 'pass').length;
  const failed = run.flows.length - passed;
  console.log(c.cyan('\n[4/4] Report'));
  console.log(`  ${c.green(`${passed} passed`)} · ${failed > 0 ? c.red(`${failed} failed`) : '0 failed'}`);
  for (const f of run.flows) {
    const mark = f.status === 'pass' ? c.green('✓') : c.red('✗');
    console.log(`  ${mark} ${f.flow.name}`);
    const failedStep = f.steps.find((s) => s.status === 'fail');
    if (failedStep) console.log(`     ${c.red('└')} ${failedStep.verdict?.summary ?? failedStep.detail ?? failedStep.title}`);
  }
  console.log(`\n  Report: ${c.bold(htmlPath)}\n`);

  if (args.open) {
    const { spawn } = await import('node:child_process');
    spawn('open', [htmlPath], { detached: true, stdio: 'ignore' }).unref();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(c.red(`\nAtlas run failed: ${err instanceof Error ? err.message : err}`));
  process.exit(1);
});
