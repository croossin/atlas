export interface AtlasConfig {
  target: {
    name: string;
    command: string;
    cwd: string;
    health: string;
    env?: Record<string, string>;
  };
  seed?: {
    endpoint: string;
    dataset?: string;
  };
  flows: string; // glob-ish dir or file list root
  agent?: {
    model?: string;
    maxTurns?: number;
  };
}

export type ScriptAction =
  | { do: 'goto'; path: string }
  | { do: 'click'; role?: string; name?: string; text?: string; selector?: string }
  | { do: 'fill'; label?: string; selector?: string; value: string }
  | { do: 'select'; label: string; value: string }
  | { do: 'expect_text'; text: string; selector?: string }
  | { do: 'expect_not_text'; text: string }
  | { do: 'screenshot'; note?: string }
  | { do: 'wait'; ms: number };

export type AgentAction = { do: 'agent'; goal: string; maxTurns?: number };

export type FlowStep = ScriptAction | AgentAction;

export interface Flow {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  steps: FlowStep[];
}

export interface AgentVerdict {
  status: 'pass' | 'fail';
  summary: string;
  reasoning: string;
  evidence: string[];
}

export interface TranscriptEntry {
  kind: 'thought' | 'tool';
  text: string;
}

// Highlight box for the element an action interacted with, as percentages of the
// viewport — lets the report overlay a marker that scales with the rendered image.
export interface JourneyTarget {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface JourneyFrame {
  caption: string;
  kind: 'script' | 'agent';
  url: string;
  screenshot: string; // base64 jpeg
  target?: JourneyTarget;
}

export interface StepResult {
  index: number;
  kind: 'script' | 'agent';
  title: string;
  status: 'pass' | 'fail' | 'skipped';
  detail?: string;
  durationMs: number;
  screenshot?: string; // base64 png
  transcript?: TranscriptEntry[];
  verdict?: AgentVerdict;
  costUsd?: number;
  frames?: JourneyFrame[];
}

export interface FlowResult {
  flow: Flow;
  status: 'pass' | 'fail';
  durationMs: number;
  steps: StepResult[];
}

export interface RunResult {
  target: string;
  baseUrl: string;
  startedAt: string;
  durationMs: number;
  injectedEnv: Record<string, string>;
  seedSummary?: unknown;
  configYaml?: string; // raw atlas.yaml this run executed with
  commit?: string; // "branch @ shortsha" when running in a git checkout
  flows: FlowResult[];
}
