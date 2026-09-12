import { randomUUID } from 'node:crypto';

export type RoomKind = 'private' | 'group';
export type MemberKind = 'human' | 'bot';

export interface RoomMember {
  readonly id: string;
  readonly name: string;
  readonly kind: MemberKind;
  readonly providerId?: 'evabot' | 'consilium';
}

export interface Room {
  readonly id: string;
  readonly kind: RoomKind;
  readonly name?: string;
  readonly ownerId?: string;
  readonly members: RoomMember[];
  readonly createdAt: number;
  lastActivityAt: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly seq: number;
  readonly roomId: string;
  readonly from: RoomMember;
  readonly text: string;
  readonly ts: number;
}

let counter = 0;

export function newId(prefix = 'r'): string {
  try {
    return `${prefix}_${randomUUID().slice(0, 12)}`;
  } catch {
    return `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;
  }
}

export function parseMemberSpec(spec: string): RoomMember {
  const trimmed = spec.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    return { id: `human_${newId('m')}`, name: trimmed, kind: 'human' };
  }
  const prefix = trimmed.slice(0, colonIdx).toLowerCase();
  const value = trimmed.slice(colonIdx + 1);
  if (prefix === 'bot') {
    const providerId = (value === 'evabot' || value === 'consilium') ? value : undefined;
    const name = providerId ? providerId : value;
    return { id: `bot_${name}_${newId('m')}`, name, kind: 'bot', providerId };
  }
  if (prefix === 'human') {
    return { id: `human_${newId('m')}`, name: value, kind: 'human' };
  }
  return { id: `human_${newId('m')}`, name: trimmed, kind: 'human' };
}
