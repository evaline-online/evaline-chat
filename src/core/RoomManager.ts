import type { Room, RoomKind, RoomMember } from './rooms.js';
import { newId } from './rooms.js';

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  create(opts: { kind: RoomKind; name?: string; ownerId?: string; members?: RoomMember[] }): Room {
    const room: Room = {
      id: newId('room'),
      kind: opts.kind,
      name: opts.name,
      ownerId: opts.ownerId,
      members: opts.members ? [...opts.members] : [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.rooms.set(room.id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  list(): Room[] {
    return [...this.rooms.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  addMember(roomId: string, member: RoomMember): RoomMember {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room "${roomId}" not found`);
    if (room.kind === 'private' && room.members.length >= 2) {
      throw new Error('Private room allows at most 2 members');
    }
    if (room.members.some((m) => m.id === member.id)) {
      throw new Error(`Member "${member.id}" is already in room "${roomId}"`);
    }
    room.members.push(member);
    return member;
  }

  removeMember(roomId: string, memberId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room "${roomId}" not found`);
    const idx = room.members.findIndex((m) => m.id === memberId);
    if (idx === -1) throw new Error(`Member "${memberId}" not found in room "${roomId}"`);
    room.members.splice(idx, 1);
  }

  deleteRoom(id: string): void {
    if (!this.rooms.has(id)) throw new Error(`Room "${id}" not found`);
    this.rooms.delete(id);
  }

  touch(id: string): void {
    const room = this.rooms.get(id);
    if (room) room.lastActivityAt = Date.now();
  }

  hasMember(roomId: string, memberId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.members.some((m) => m.id === memberId);
  }

  restore(room: Room): void {
    if (!this.rooms.has(room.id)) this.rooms.set(room.id, room);
  }
}
