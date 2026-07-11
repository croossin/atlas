import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Page } from 'playwright';
import type { AgentAction, AgentVerdict, JourneyFrame, TranscriptEntry } from './types.js';
import { captureFrame, pushFrame, targetBox } from './journey.js';

const ACTION_TIMEOUT = 8_000;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pass', 'fail'] },
    summary: { type: 'string', description: 'One-sentence verdict a QA lead can read at a glance.' },
    reasoning: { type: 'string', description: 'How you verified it: steps taken, values observed, math performed.' },
    evidence: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete observations backing the verdict (values seen on specific pages, expected vs actual).',
    },
  },
  required: ['status', 'summary', 'reasoning', 'evidence'],
  additionalProperties: false,
} as const;

async function snapshot(page: Page): Promise<string> {
  const aria = await page.locator('body').ariaSnapshot();
  return `URL: ${page.url()}\nTITLE: ${await page.title()}\n\nPAGE (accessibility tree):\n${aria}`;
}

function browserTools(page: Page, frames: JourneyFrame[]) {
  return [
    tool(
      'snapshot',
      'Read the current page: URL, title, and full accessibility tree (headings, tables, forms, buttons, links, values). Call this after every action to see the result.',
      {},
      async () => ({ content: [{ type: 'text' as const, text: await snapshot(page) }] })
    ),
    tool(
      'goto',
      'Navigate to a path on the app under test (e.g. "/clients").',
      { path: z.string().describe('Absolute path starting with /') },
      async (args) => {
        await page.goto(args.path, { waitUntil: 'load' });
        pushFrame(frames, await captureFrame(page, `goto ${args.path}`, 'agent'));
        return { content: [{ type: 'text' as const, text: await snapshot(page) }] };
      }
    ),
    tool(
      'click',
      'Click an element identified by its ARIA role and accessible name (as shown in the snapshot), e.g. role="button" name="Create Client" or role="link" name="Acme Trucking".',
      {
        role: z.string().describe('ARIA role: button, link, etc.'),
        name: z.string().describe('Accessible name (exact or distinctive substring)'),
      },
      async (args) => {
        const loc = page.getByRole(args.role as never, { name: args.name }).first();
        pushFrame(frames, await captureFrame(page, `click ${args.role} "${args.name}"`, 'agent', await targetBox(page, loc)));
        await loc.click({ timeout: ACTION_TIMEOUT });
        await page.waitForLoadState('load');
        return { content: [{ type: 'text' as const, text: await snapshot(page) }] };
      }
    ),
    tool(
      'fill',
      'Type a value into a form field identified by its label text.',
      { label: z.string(), value: z.string() },
      async (args) => {
        const loc = page.getByLabel(args.label).first();
        await loc.fill(args.value, { timeout: ACTION_TIMEOUT });
        pushFrame(frames, await captureFrame(page, `fill "${args.label}" → ${args.value}`, 'agent', await targetBox(page, loc)));
        return { content: [{ type: 'text' as const, text: `Filled "${args.label}" with "${args.value}".` }] };
      }
    ),
    tool(
      'select',
      'Choose an option in a dropdown identified by its label text.',
      { label: z.string(), option: z.string() },
      async (args) => {
        const loc = page.getByLabel(args.label).first();
        await loc.selectOption({ label: args.option }, { timeout: ACTION_TIMEOUT });
        pushFrame(frames, await captureFrame(page, `select "${args.label}" → ${args.option}`, 'agent', await targetBox(page, loc)));
        return { content: [{ type: 'text' as const, text: `Selected "${args.option}" in "${args.label}".` }] };
      }
    ),
  ];
}

export interface AgentStepResult {
  verdict?: AgentVerdict;
  transcript: TranscriptEntry[];
  frames: JourneyFrame[];
  costUsd?: number;
  error?: string;
}

export async function runAgentStep(
  page: Page,
  step: AgentAction,
  opts: { model?: string; maxTurns: number; log: (line: string) => void }
): Promise<AgentStepResult> {
  const frames: JourneyFrame[] = [];
  const server = createSdkMcpServer({ name: 'browser', version: '1.0.0', tools: browserTools(page, frames) });
  const transcript: TranscriptEntry[] = [];
  const todayStr = new Date().toISOString().slice(0, 10);

  const systemPrompt = [
    'You are Atlas, a meticulous senior QA engineer verifying an insurance agency management system.',
    'You interact with the live application ONLY through the browser tools provided (snapshot, goto, click, fill, select).',
    'Method: snapshot first to see where you are; act step by step; snapshot after actions to verify effects.',
    'Be skeptical — do not trust confirmation messages alone. Verify underlying data: recompute expected values (premiums, prorations, balances) from what the page shows and compare against actuals to the cent.',
    `Today's date is ${todayStr}. Pro-rata calculations count days between dates.`,
    'Small rounding differences (a few cents, or ±1 day of proration) are acceptable; discrepancies beyond that are defects.',
    'When done, your final structured output is the test verdict. Fail with concrete expected-vs-actual evidence; pass only when every check in the goal held.',
  ].join('\n');

  try {
    let verdict: AgentVerdict | undefined;
    let costUsd: number | undefined;
    let resultError: string | undefined;

    for await (const message of query({
      prompt: `TEST GOAL:\n${step.goal}`,
      options: {
        systemPrompt,
        ...(opts.model ? { model: opts.model } : {}),
        maxTurns: opts.maxTurns,
        mcpServers: { browser: server },
        allowedTools: ['mcp__browser__*'],
        permissionMode: 'bypassPermissions',
        outputFormat: { type: 'json_schema', schema: VERDICT_SCHEMA },
      },
    })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            transcript.push({ kind: 'thought', text: block.text.trim() });
          } else if (block.type === 'tool_use') {
            const input = JSON.stringify(block.input);
            const name = block.name.replace('mcp__browser__', '');
            transcript.push({ kind: 'tool', text: `${name}(${input === '{}' ? '' : input})` });
            opts.log(`⋯ ${name}${input === '{}' ? '()' : `(${input.length > 80 ? input.slice(0, 80) + '…' : input})`}`);
          }
        }
      } else if (message.type === 'result') {
        const r = message as {
          subtype: string;
          structured_output?: AgentVerdict;
          total_cost_usd?: number;
          result?: string;
        };
        costUsd = r.total_cost_usd;
        if (r.subtype === 'success' && r.structured_output) {
          verdict = r.structured_output;
        } else {
          resultError = `Agent ended without a valid verdict (${r.subtype}).`;
        }
      }
    }

    if (!verdict) {
      return { transcript, frames, costUsd, error: resultError ?? 'Agent produced no verdict.' };
    }
    return { verdict, transcript, frames, costUsd };
  } catch (err) {
    return { transcript, frames, error: `Agent step crashed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
