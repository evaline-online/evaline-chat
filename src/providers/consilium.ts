import { ConsiliumEngine, StubLlmClient } from 'evaline-consilium';
import type { ConsiliumMode, ConsiliumResult, LlmClient } from 'evaline-consilium';
import type { AgentProvider, AgentProviderSendInput, AgentProviderResult } from '../core/ChatEngine.js';

export interface ConsiliumProviderOptions {
  readonly engine?: ConsiliumEngine;
  readonly defaultMode?: ConsiliumMode;
  readonly llm?: LlmClient;
  readonly paidModels?: string[];
  readonly freeModels?: string[];
  readonly onProgress?: (event: unknown) => void;
}

export interface ConsiliumRunInput {
  readonly text: string;
  readonly rounds?: number;
  readonly history?: readonly unknown[];
}

export class ConsiliumProvider implements AgentProvider {
  readonly id = 'consilium';
  readonly name = 'EvaLine Consilium Engine';
  private readonly engine: ConsiliumEngine;
  private readonly onProgress?: (event: unknown) => void;
  private defaultMode: ConsiliumMode;

  constructor(opts: ConsiliumProviderOptions = {}) {
    const deps = {
      llm: opts.llm ?? new StubLlmClient(),
      paidModels: opts.paidModels,
      freeModels: opts.freeModels,
    };
    this.engine = opts.engine ?? new ConsiliumEngine(deps);
    this.defaultMode = opts.defaultMode ?? 'chat';
    this.onProgress = opts.onProgress;
  }

  getMode(): ConsiliumMode {
    return this.defaultMode;
  }

  setMode(mode: string): void {
    const candidate = this.defaultMode;
    this.defaultMode = (['chat', 'dialog', 'interview', 'consilium', 'solo', 'broadcast', 'dialogue'] as const).includes(
      mode as ConsiliumMode
    )
      ? (mode as ConsiliumMode)
      : candidate;
  }

  async run(input: ConsiliumRunInput): Promise<ConsiliumResult> {
    return this.engine.run({
      mode: this.defaultMode,
      prompt: input.text,
      rounds: input.rounds ?? 2,
      useKnowledgeBase: true,
      onProgress: this.onProgress
        ? (event) => this.onProgress!(event)
        : undefined,
    });
  }

  async send(input: AgentProviderSendInput): Promise<AgentProviderResult> {
    const result = await this.run({ text: input.text });
    const fallback = result.turns.at(-1)?.content;
    return {
      content: result.synthesis ?? fallback ?? 'No synthesis produced.',
      mode: result.mode,
      turns: result.turns,
      costSummary: result.costSummary,
    };
  }
}