import type { AgentProvider, AgentProviderSendInput, AgentProviderResult } from '../core/ChatEngine.js';

export interface EvabotProviderOptions {
  readonly apiUrl?: string;
  readonly stub?: boolean;
  readonly systemInstruction?: string;
}

export class EvabotProvider implements AgentProvider {
  readonly id = 'evabot';
  readonly name = 'EvaBot Corporate Chat';
  private readonly apiUrl?: string;
  private readonly stub: boolean;
  private readonly systemInstruction?: string;

  constructor(opts: EvabotProviderOptions = {}) {
    this.apiUrl = opts.apiUrl;
    this.stub = opts.stub ?? !this.apiUrl;
    this.systemInstruction = opts.systemInstruction;
  }

  async send(input: AgentProviderSendInput): Promise<AgentProviderResult> {
    if (this.stub || !this.apiUrl) {
      return { content: this.stubReply(input.text) };
    }
    const resp = await fetch(`${this.apiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: input.text,
        sessionId: input.sessionId,
        history: input.history,
        systemInstruction: this.systemInstruction,
      }),
    });
    if (!resp.ok) throw new Error(`EvaBot API error: ${resp.status} ${resp.statusText}`);
    const data = (await resp.json()) as { reply?: string; content?: string };
    return { content: (data.reply ?? data.content) ?? 'No response from EvaBot API.' };
  }

  private stubReply(text: string): string {
    return (
      `Eva (stub): received "${text}". ` +
      '— EvaLine corporate assistant, Chernomorsk plant. ' +
      'Ask me about consilium for multi-LLM deliberation.'
    );
  }
}