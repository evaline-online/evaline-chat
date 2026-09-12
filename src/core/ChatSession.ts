import { HistoryStore } from './HistoryStore.js';

export interface ChatSessionOptions {
  readonly displayName?: string;
  readonly history?: HistoryStore;
}

export class ChatSession {
  readonly sessionId: string;
  readonly displayName?: string;
  readonly createdAt: number;
  readonly history: HistoryStore;

  constructor(sessionId: string, opts: ChatSessionOptions = {}) {
    this.sessionId = sessionId;
    this.displayName = opts.displayName;
    this.createdAt = Date.now();
    this.history = opts.history ?? new HistoryStore();
  }
}