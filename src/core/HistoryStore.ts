import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChatRole } from '../contract.js';
import type { ChatMessage, Room, RoomMember } from './rooms.js';
import { newId } from './rooms.js';

export interface HistoryMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly ts: number;
  readonly model?: string;
}

export interface ChatMessageDraft {
  readonly role: ChatRole;
  readonly content: string;
  readonly model?: string;
}

export interface HistoryStoreOptions {
  readonly filePath?: string;
  readonly autosave?: boolean;
}

interface RoomLine {
  readonly type: 'room';
  readonly room: Room;
}

type MsgLine = { readonly type: 'msg' } & ChatMessage;

interface SeqLine {
  readonly type: 'seq';
  readonly max: number;
}

type Line = RoomLine | MsgLine | SeqLine;

export class HistoryStore {
  private readonly rooms = new Map<string, Room>();
  private readonly roomMessages = new Map<string, ChatMessage[]>();
  private readonly sessions = new Map<string, HistoryMessage[]>();
  private readonly filePath?: string;
  private readonly autosave: boolean;
  private readonly pending: string[] = [];
  private currentSeq = 0;

  constructor(opts: HistoryStoreOptions = {}) {
    this.filePath = opts.filePath;
    this.autosave = opts.autosave ?? true;
    if (this.filePath) {
      this.load();
    }
  }

  upsertRoom(room: Room): void {
    this.rooms.set(room.id, room);
    this.persistLine({ type: 'room', room });
  }

  allRooms(): Room[] {
    return [...this.rooms.values()];
  }

  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
    this.roomMessages.delete(roomId);
    this.rewriteFile();
  }

  clearMessages(roomId: string): void {
    this.roomMessages.delete(roomId);
    this.rewriteFile();
  }

  resetRooms(): void {
    this.rooms.clear();
    this.roomMessages.clear();
    this.currentSeq = 0;
    this.pending.length = 0;
  }

  addMessage(roomId: string, from: RoomMember, text: string): ChatMessage {
    const message: ChatMessage = {
      id: newId('msg'),
      seq: ++this.currentSeq,
      roomId,
      from: { ...from },
      text,
      ts: Date.now(),
    };
    const bucket = this.messageBucket(roomId);
    bucket.push(message);
    this.persistLine({ type: 'msg', ...message });
    return message;
  }

  messages(roomId: string, opts?: { after?: number }): ChatMessage[] {
    const bucket = this.roomMessages.get(roomId) ?? [];
    if (opts?.after === undefined || opts.after < 0) return [...bucket];
    return bucket.filter((m) => m.seq > (opts.after ?? 0));
  }

  count(roomId: string): number {
    return (this.roomMessages.get(roomId) ?? []).length;
  }

  add(sessionId: string, draft: ChatMessageDraft): HistoryMessage {
    const message: HistoryMessage = {
      id: newId('msg'),
      sessionId,
      role: draft.role,
      content: draft.content,
      ts: Date.now(),
      model: draft.model,
    };
    let bucket = this.sessions.get(sessionId);
    if (!bucket) {
      bucket = [];
      this.sessions.set(sessionId, bucket);
    }
    bucket.push(message);
    return message;
  }

  list(sessionId: string, limit?: number): HistoryMessage[] {
    const bucket = this.sessions.get(sessionId) ?? [];
    if (limit === undefined || limit <= 0) return [...bucket];
    return bucket.slice(-limit);
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  flush(): void {
    if (!this.filePath || !this.pending.length) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, this.pending.join('\n') + '\n', 'utf-8');
    this.pending.length = 0;
  }

  save(): void {
    if (!this.filePath) throw new Error('HistoryStore has no filePath configured');
    this.rewriteFile();
  }

  private messageBucket(roomId: string): ChatMessage[] {
    let bucket = this.roomMessages.get(roomId);
    if (!bucket) {
      bucket = [];
      this.roomMessages.set(roomId, bucket);
    }
    return bucket;
  }

  private persistLine(line: Line): void {
    this.pending.push(JSON.stringify(line));
    if (this.autosave) this.flush();
  }

  private rewriteFile(): void {
    if (!this.filePath) return;
    const lines: string[] = [];
    for (const room of this.rooms.values()) {
      lines.push(JSON.stringify({ type: 'room', room }));
    }
    for (const bucket of this.roomMessages.values()) {
      for (const message of bucket) {
        lines.push(JSON.stringify({ type: 'msg', ...message }));
      }
    }
    lines.push(JSON.stringify({ type: 'seq', max: this.currentSeq }));
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, lines.join('\n') + '\n', 'utf-8');
    this.pending.length = 0;
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    const raw = readFileSync(this.filePath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const type = (entry as { type?: unknown }).type;
      if (type === 'room') {
        const room = (entry as RoomLine).room;
        this.rooms.set(room.id, room);
      } else if (type === 'msg') {
        const { type: _type, ...message } = entry as MsgLine;
        void _type;
        this.messageBucket(message.roomId).push(message);
        this.currentSeq = Math.max(this.currentSeq, message.seq);
      } else if (type === 'seq') {
        const max = (entry as SeqLine).max;
        if (typeof max === 'number') this.currentSeq = Math.max(this.currentSeq, max);
      }
    }
  }
}