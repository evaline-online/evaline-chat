import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatEngine, HistoryStore, parseMemberSpec } from '../dist/index.js';

function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'evaline-chat-history-'));
  return join(dir, 'chat.jsonl');
}

function cleanup(file: string): void {
  rmSync(join(file, '..'), { recursive: true, force: true });
}

test('JSONL persistence round-trips rooms, messages and the seq watermark', () => {
  const file = tmpFile();
  const human = parseMemberSpec('Sarah');
  const bot = parseMemberSpec('bot:evabot');

  const store = new HistoryStore({ filePath: file });
  const room = {
    id: 'room_abc',
    kind: 'group' as const,
    name: 'g1',
    members: [human, bot],
    createdAt: 1,
    lastActivityAt: 1,
  };
  store.upsertRoom(room);
  const m1 = store.addMessage('room_abc', human, 'hello');
  const m2 = store.addMessage('room_abc', bot, 'hi Sarah');
  assert.equal(m1.seq, 1);
  assert.equal(m2.seq, 2);
  assert.equal(store.count('room_abc'), 2);

  const reloaded = new HistoryStore({ filePath: file });
  assert.equal(reloaded.allRooms().length, 1);
  assert.equal(reloaded.allRooms()[0]!.name, 'g1');
  assert.equal(reloaded.allRooms()[0]!.members.length, 2);

  const msgs = reloaded.messages('room_abc');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.text, 'hello');
  assert.equal(msgs[0]!.from.name, 'Sarah');
  assert.equal(msgs[1]!.seq, 2);

  const m3 = reloaded.addMessage('room_abc', human, 'again');
  assert.equal(m3.seq, 3);
  assert.equal(reloaded.messages('room_abc', { after: 2 }).length, 1);

  reloaded.resetRooms();
  assert.equal(reloaded.allRooms().length, 0);
  assert.equal(reloaded.messages('room_abc').length, 0);
  assert.equal(reloaded.count('room_abc'), 0);

  cleanup(file);
});

test('engine round-trips rooms and messages through a file-backed store', async () => {
  const file = tmpFile();
  const engine = await createChatEngine({ historyFile: file });
  const room = engine.createRoom({
    kind: 'group',
    name: 'persist',
    members: [parseMemberSpec('human:Oleg'), parseMemberSpec('bot:evabot')],
  });
  await engine.send(room.id, { from: 'Oleg', text: 'hello from the past' });
  assert.equal(engine.history.count(room.id), 2);

  const engine2 = await createChatEngine({ historyFile: file });
  const restored = engine2.listRooms().find((r) => r.name === 'persist');
  assert.ok(restored);
  assert.ok(restored!.members.some((m) => m.name === 'Oleg'));
  assert.ok(restored!.members.some((m) => m.kind === 'bot' && m.providerId === 'evabot'));

  const msgs = engine2.messages(restored!.id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.text, 'hello from the past');
  assert.deepEqual(
    msgs.map((m) => m.seq),
    [1, 2]
  );

  const reply = await engine2.send(restored!.id, { from: 'Oleg', text: 'again' });
  assert.equal(engine2.history.count(restored!.id), 4);
  assert.ok(reply.messages.every((m) => m.seq >= 3));

  cleanup(file);
});

test('autosave=false buffers lines until flush()', () => {
  const file = tmpFile();
  const human = parseMemberSpec('Pasha');
  const store = new HistoryStore({ filePath: file, autosave: false });
  store.upsertRoom({
    id: 'r1',
    kind: 'private' as const,
    members: [human],
    createdAt: 1,
    lastActivityAt: 1,
  });
  store.addMessage('r1', human, 'buffered');
  assert.ok(store.count('r1') >= 0);

  store.flush();
  const reloaded = new HistoryStore({ filePath: file });
  assert.equal(reloaded.messages('r1').length, 1);
  assert.equal(reloaded.messages('r1')[0]!.text, 'buffered');

  cleanup(file);
});