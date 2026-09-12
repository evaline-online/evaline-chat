import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatEngine,
  RoomManager,
  parseMemberSpec,
  newId,
} from '../dist/index.js';

test('parseMemberSpec handles bot, human and bare name forms', () => {
  const botEva = parseMemberSpec('bot:evabot');
  assert.equal(botEva.kind, 'bot');
  assert.equal(botEva.providerId, 'evabot');
  assert.equal(botEva.name, 'evabot');

  const botCon = parseMemberSpec('bot:consilium');
  assert.equal(botCon.kind, 'bot');
  assert.equal(botCon.providerId, 'consilium');

  const human = parseMemberSpec('human:Oleg');
  assert.equal(human.kind, 'human');
  assert.equal(human.name, 'Oleg');

  const bare = parseMemberSpec('Sarah');
  assert.equal(bare.kind, 'human');
  assert.equal(bare.name, 'Sarah');
});

test('newId produces unique prefixed ids', () => {
  const a = newId('room');
  const b = newId('room');
  assert.match(a, /^room_/);
  assert.notEqual(a, b);
});

test('RoomManager enforces the private-room 2-member cap', () => {
  const rm = new RoomManager();
  const room = rm.create({ kind: 'private' });
  rm.addMember(room.id, { id: 'h1', name: 'A', kind: 'human' });
  rm.addMember(room.id, { id: 'b1', name: 'B', kind: 'bot', providerId: 'evabot' });
  assert.throws(
    () => rm.addMember(room.id, { id: 'h2', name: 'C', kind: 'human' }),
    /Private room allows at most 2 members/
  );
  assert.equal(room.members.length, 2);
});

test('RoomManager rejects duplicate members and supports remove/delete/list ordering', async () => {
  const rm = new RoomManager();
  const room = rm.create({ kind: 'group', name: 'g' });
  rm.addMember(room.id, { id: 'h1', name: 'A', kind: 'human' });
  assert.throws(() => rm.addMember(room.id, { id: 'h1', name: 'A', kind: 'human' }), /already in room/);

  const r1 = rm.create({ kind: 'private' });
  await new Promise((r) => setTimeout(r, 5));
  const r2 = rm.create({ kind: 'group', name: 'active' });
  rm.touch(r1.id);
  await new Promise((r) => setTimeout(r, 5));
  rm.touch(r2.id);
  assert.equal(rm.list()[0]!.id, r2.id);

  rm.removeMember(room.id, 'h1');
  assert.equal(room.members.length, 0);
  assert.equal(rm.hasMember(room.id, 'h1'), false);

  rm.deleteRoom(r1.id);
  assert.equal(rm.get(r1.id), undefined);
});

test('engine creates a group room where every bot replies sequentially', async () => {
  const engine = await createChatEngine({});
  const room = engine.createRoom({
    kind: 'group',
    name: 'war room',
    members: [parseMemberSpec('Sarah'), parseMemberSpec('bot:evabot'), parseMemberSpec('bot:consilium')],
  });
  const result = await engine.send(room.id, { text: 'status?' });
  assert.equal(result.messages.length, 3);
  assert.equal(result.replies.length, 2);

  const humanMsg = result.messages[0]!;
  assert.equal(humanMsg.from.name, 'Sarah');
  assert.equal(humanMsg.from.kind, 'human');
  assert.equal(humanMsg.text, 'status?');

  const bots = result.messages.slice(1);
  assert.deepEqual(
    bots.map((m) => m.from.providerId),
    ['evabot', 'consilium']
  );
  assert.ok(result.replies.every((r) => r.role === 'assistant'));
});

test('private room auto-fills the sender when a slot is free', async () => {
  const engine = await createChatEngine({});
  const room = engine.createRoom({
    kind: 'private',
    members: [{ id: 'b_ev', name: 'evabot', kind: 'bot', providerId: 'evabot' }],
  });
  const result = await engine.send(room.id, { text: 'hi' });
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0]!.from.name, 'You');
  assert.equal(result.messages[0]!.from.kind, 'human');
});

test('room send resolves sender by name and messages after=seq returns only newer', async () => {
  const engine = await createChatEngine({});
  const room = engine.createRoom({
    kind: 'group',
    members: [parseMemberSpec('Sarah'), parseMemberSpec('bot:evabot')],
  });
  const r1 = await engine.send(room.id, { from: 'Sarah', text: 'one' });
  const r2 = await engine.send(room.id, { from: 'Sarah', text: 'two' });
  assert.equal(r1.messages.length, 2);
  assert.equal(r2.messages.length, 2);

  const all = engine.messages(room.id);
  assert.equal(all.length, 4);
  assert.deepEqual(
    all.map((m) => m.seq),
    [1, 2, 3, 4]
  );
  assert.equal(engine.history.count(room.id), 4);

  const after2 = engine.messages(room.id, { after: 2 });
  assert.equal(after2.length, 2);
  assert.ok(after2.every((m) => m.seq > 2));

  const afterLast = engine.messages(room.id, { after: 4 });
  assert.equal(afterLast.length, 0);
});

test('engine.addMember rejects an unknown bot provider', async () => {
  const engine = await createChatEngine({});
  const room = engine.createRoom({ kind: 'group' });
  assert.throws(() => engine.addMember(room.id, 'bot:nope'), /not registered/);
});

test('removeMember and deleteRoom clean up the engine', async () => {
  const engine = await createChatEngine({});
  const members = [parseMemberSpec('human:Egor'), parseMemberSpec('bot:consilium')];
  const room = engine.createRoom({ kind: 'group', members });
  assert.equal(room.members.length, 2);

  engine.removeMember(room.id, members[0]!.id);
  assert.equal(room.members.length, 1);

  await engine.send(room.id, { text: 'bye' });
  engine.deleteRoom(room.id);
  assert.equal(engine.rooms.get(room.id), undefined);
  assert.equal(engine.messages(room.id).length, 0);
});

test('legacy send(sessionId, text) routes through a private default room', async () => {
  const engine = await createChatEngine({});
  const reply = await engine.send('legacy1', 'ping');
  assert.equal(reply.provider, 'evabot');

  const matches = engine.listRooms().filter((r) => r.name === 'legacy1');
  assert.equal(matches.length, 1);
  const room = matches[0]!;
  assert.equal(room.kind, 'private');
  assert.equal(room.members.length, 2);
  assert.ok(room.members.some((m) => m.kind === 'human' && m.name === 'You'));
  assert.ok(room.members.some((m) => m.kind === 'bot' && m.providerId === 'evabot'));
});