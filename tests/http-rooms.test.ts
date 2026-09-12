import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createChatEngine, createHttpServer } from '../dist/index.js';
import type { ChatEngine } from '../dist/index.js';

async function listen(engine: ChatEngine, t: { after(fn: () => unknown): void }): Promise<string> {
  const server: Server = createHttpServer(engine);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${port}`;
}

test('HTTP room endpoints work end to end', async (t) => {
  const engine = await createChatEngine({});
  const base = await listen(engine, t);

  const created = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'group', name: 'dev', members: ['Sarah', 'bot:evabot'] }),
  }).then((r) => r.json());
  assert.equal(created.room.kind, 'group');
  assert.equal(created.room.name, 'dev');
  assert.equal(created.room.members.length, 2);
  const roomId = created.room.id;

  const list = await fetch(`${base}/api/rooms`).then((r) => r.json());
  assert.ok(list.rooms.some((r) => r.id === roomId));

  const got = await fetch(`${base}/api/rooms/${roomId}`).then((r) => r.json());
  assert.equal(got.room.id, roomId);

  const added = await fetch(`${base}/api/rooms/${roomId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec: 'bot:consilium' }),
  }).then((r) => r.json());
  assert.equal(added.member.providerId, 'consilium');

  const sent = await fetch(`${base}/api/rooms/${roomId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Sarah', text: 'hello all' }),
  }).then((r) => r.json());
  assert.equal(sent.messages.length, 3);
  assert.equal(sent.replies.length, 2);
  assert.equal(sent.messages[0]!.from.name, 'Sarah');
  assert.equal(sent.messages[0]!.text, 'hello all');

  const after = await fetch(`${base}/api/rooms/${roomId}/messages?after=${sent.messages[0]!.seq}`).then((r) => r.json());
  assert.equal(after.messages.length, 2);
  assert.ok(after.messages.every((m) => m.seq > sent.messages[0]!.seq));

  const delMember = await fetch(`${base}/api/rooms/${roomId}/members/${added.member.id}`, { method: 'DELETE' }).then((r) => r.json());
  assert.deepEqual(delMember, { ok: true });

  const delRoom = await fetch(`${base}/api/rooms/${roomId}`, { method: 'DELETE' }).then((r) => r.json());
  assert.deepEqual(delRoom, { ok: true });

  const missing = await fetch(`${base}/api/rooms/${roomId}`);
  assert.equal(missing.status, 404);
});

test('HTTP serves static frontend files and guards paths', async (t) => {
  const engine = await createChatEngine({});
  const base = await listen(engine, t);

  const root = await fetch(`${base}/`);
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type') ?? '', /text\/html/);

  const app = await fetch(`${base}/app.js`);
  assert.equal(app.status, 200);
  assert.match(app.headers.get('content-type') ?? '', /javascript/);

  const css = await fetch(`${base}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /text\/css/);

  const traversal = await fetch(`${base}/%2e%2e/package.json`);
  assert.equal(traversal.status, 404);

  const unknown = await fetch(`${base}/nope.js`);
  assert.equal(unknown.status, 404);

  const methodNotAllowed = await fetch(`${base}/api/rooms`, { method: 'DELETE' });
  assert.equal(methodNotAllowed.status, 405);

  const staticMethod = await fetch(`${base}/app.js`, { method: 'POST' });
  assert.equal(staticMethod.status, 405);
});