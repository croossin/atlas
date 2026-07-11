import { chromium, Browser, Page } from 'playwright';
import type { Flow, FlowResult, FlowStep, JourneyFrame, ScriptAction, StepResult } from './types.js';
import { runAgentStep } from './agent.js';
import { captureFrame, pushFrame, targetBox } from './journey.js';

const STEP_TIMEOUT = 10_000;

function stepTitle(step: FlowStep): string {
  if (step.do === 'agent') {
    const firstLine = step.goal.trim().split('\n')[0];
    return `agent: ${firstLine.length > 90 ? firstLine.slice(0, 90) + '…' : firstLine}`;
  }
  const s = step as ScriptAction & Record<string, unknown>;
  const args = ['path', 'role', 'name', 'text', 'label', 'selector', 'value', 'ms', 'note']
    .filter((k) => s[k] !== undefined)
    .map((k) => `${k}="${s[k]}"`)
    .join(' ');
  return `${step.do} ${args}`.trim();
}

async function execScript(page: Page, step: ScriptAction, frames: JourneyFrame[]): Promise<string | undefined> {
  switch (step.do) {
    case 'goto':
      await page.goto(step.path, { waitUntil: 'load' });
      pushFrame(frames, await captureFrame(page, `goto ${step.path}`, 'script'));
      return `at ${page.url()}`;
    case 'click': {
      const loc = step.selector
        ? page.locator(step.selector).first()
        : step.role && step.name
          ? page.getByRole(step.role as never, { name: step.name }).first()
          : step.text
            ? page.getByText(step.text).first()
            : undefined;
      if (!loc) throw new Error('click requires selector, role+name, or text');
      // Frame is captured pre-click with the target highlighted — the click often
      // navigates, so the next frame shows the outcome.
      pushFrame(
        frames,
        await captureFrame(page, `click ${step.name ?? step.text ?? step.selector}`, 'script', await targetBox(page, loc))
      );
      await loc.click({ timeout: STEP_TIMEOUT });
      await page.waitForLoadState('load');
      return;
    }
    case 'fill': {
      const loc = (step.selector ? page.locator(step.selector) : page.getByLabel(step.label!)).first();
      await loc.fill(step.value, { timeout: STEP_TIMEOUT });
      pushFrame(
        frames,
        await captureFrame(page, `fill "${step.label ?? step.selector}" → ${step.value}`, 'script', await targetBox(page, loc))
      );
      return;
    }
    case 'select': {
      const loc = page.getByLabel(step.label).first();
      await loc.selectOption({ label: step.value }, { timeout: STEP_TIMEOUT });
      pushFrame(
        frames,
        await captureFrame(page, `select "${step.label}" → ${step.value}`, 'script', await targetBox(page, loc))
      );
      return;
    }
    case 'expect_text': {
      const loc = step.selector ? page.locator(step.selector) : page.locator('body');
      const content = (await loc.first().textContent({ timeout: STEP_TIMEOUT })) ?? '';
      if (!content.includes(step.text)) {
        throw new Error(`Expected text "${step.text}" not found${step.selector ? ` in ${step.selector}` : ' on page'}.`);
      }
      return `found "${step.text}"`;
    }
    case 'expect_not_text': {
      const content = (await page.locator('body').textContent()) ?? '';
      if (content.includes(step.text)) throw new Error(`Text "${step.text}" should NOT be present but was found.`);
      return;
    }
    case 'screenshot':
      pushFrame(frames, await captureFrame(page, step.note ?? 'screenshot', 'script'));
      return step.note;
    case 'wait':
      await page.waitForTimeout(step.ms);
      return;
  }
}

async function capture(page: Page): Promise<string | undefined> {
  try {
    const buf = await page.screenshot({ fullPage: false });
    return buf.toString('base64');
  } catch {
    return undefined;
  }
}

export interface RunnerOptions {
  baseUrl: string;
  agentModel?: string;
  agentMaxTurns?: number;
  log: (line: string) => void;
}

export async function runFlows(flows: Flow[], opts: RunnerOptions): Promise<FlowResult[]> {
  const browser: Browser = await chromium.launch({ headless: true });
  const results: FlowResult[] = [];

  try {
    for (const flow of flows) {
      opts.log(`\n▶ Flow: ${flow.name} (${flow.id})`);
      const flowStart = Date.now();
      // Fresh context per flow — isolated cookies/storage, same seeded backend.
      const context = await browser.newContext({ baseURL: opts.baseUrl, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const steps: StepResult[] = [];
      let failed = false;

      for (let i = 0; i < flow.steps.length; i++) {
        const step = flow.steps[i];
        const title = stepTitle(step);
        const start = Date.now();

        if (failed) {
          steps.push({ index: i, kind: step.do === 'agent' ? 'agent' : 'script', title, status: 'skipped', durationMs: 0 });
          continue;
        }

        if (step.do === 'agent') {
          opts.log(`  ${i + 1}. ${title}`);
          const result = await runAgentStep(page, step, {
            model: opts.agentModel,
            maxTurns: step.maxTurns ?? opts.agentMaxTurns ?? 40,
            log: (l) => opts.log(`     ${l}`),
          });
          const screenshot = await capture(page);
          const status = result.verdict?.status === 'pass' ? 'pass' : 'fail';
          const finalFrame = await captureFrame(
            page,
            result.verdict ? `verdict: ${result.verdict.summary}` : 'agent finished',
            'agent'
          );
          if (finalFrame) result.frames.push(finalFrame);
          steps.push({
            index: i,
            kind: 'agent',
            title,
            status,
            detail: result.verdict?.summary ?? result.error,
            durationMs: Date.now() - start,
            screenshot,
            transcript: result.transcript,
            verdict: result.verdict,
            costUsd: result.costUsd,
            frames: result.frames,
          });
          if (status === 'fail') failed = true;
          opts.log(`     ${status === 'pass' ? '✓ PASS' : '✗ FAIL'} — ${result.verdict?.summary ?? result.error ?? ''}`);
        } else {
          const frames: JourneyFrame[] = [];
          try {
            const detail = await execScript(page, step, frames);
            const screenshot = step.do === 'screenshot' ? await capture(page) : undefined;
            steps.push({
              index: i,
              kind: 'script',
              title,
              status: 'pass',
              detail,
              durationMs: Date.now() - start,
              screenshot,
              frames: frames.length ? frames : undefined,
            });
            opts.log(`  ${i + 1}. ✓ ${title}`);
          } catch (err) {
            const screenshot = await capture(page);
            pushFrame(frames, await captureFrame(page, `FAILED: ${title}`, 'script'));
            steps.push({
              index: i,
              kind: 'script',
              title,
              status: 'fail',
              detail: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - start,
              screenshot,
              frames: frames.length ? frames : undefined,
            });
            failed = true;
            opts.log(`  ${i + 1}. ✗ ${title} — ${err instanceof Error ? err.message : err}`);
          }
        }
      }

      await context.close();
      results.push({ flow, status: failed ? 'fail' : 'pass', durationMs: Date.now() - flowStart, steps });
      opts.log(`  Flow ${failed ? '✗ FAILED' : '✓ PASSED'} in ${((Date.now() - flowStart) / 1000).toFixed(1)}s`);
    }
  } finally {
    await browser.close();
  }
  return results;
}
