import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatEngine,
  ChatEngine,
  PluginManager,
  ProviderPlugin,
  EvabotProvider,
  createHttpServer,
} from '../dist/index.js';

test('createChatEngine registers both providers as plugins', async () => {
  const engine = await createChatEngine({});
  assert.ok(engine instanceof ChatEngine);
  assert.equal(engine.pluginManager.list().length, 2);
  assert.ok(engine.getProvider('evabot'));
  assert.ok(engine.getProvider('consilium'));
});

test('send returns an assistant reply from evabot and writes history', async () => {
  const engine = await createChatEngine({});
  const reply = await engine.send('s1', 'hello eva');
  assert.equal(reply.role, 'assistant');
  assert.equal(reply.provider, 'evabot');
  assert.match(reply.content, /Eva/);
  assert.match(reply.content, /Chernomorsk/);
  assert.match(reply.content, /consilium/);
  assert.ok(Number.isFinite(reply.ms));

  const history = engine.history.list('s1');
  assert.equal(history.length, 2);
  assert.equal(history[0]!.role, 'user');
  assert.equal(history[0]!.content, 'hello eva');
  assert.equal(history[1]!.role, 'assistant');
});

test('/help lists the builtin commands', async () => {
  const engine = await createChatEngine({});
  const reply = await engine.send('s', '/help');
  assert.match(reply.content, /\/mode/);
  assert.match(reply.content, /\/consilium/);
  assert.match(reply.content, /\/plugins/);
  assert.match(reply.content, /\/history/);
});

test('/plugins lists registered plugins', async () => {
  const engine = await createChatEngine({});
  const reply = await engine.send('s', '/plugins');
  assert.match(reply.content, /evabot/);
  assert.match(reply.content, /consilium/);
});

test('/history and /clear manage session storage', async () => {
  const engine = await createChatEngine({});
  await engine.send('s2', 'first');
  await engine.send('s2', 'second');

  const hist = await engine.send('s2', '/history');
  assert.match(hist.content, /first/);
  assert.match(hist.content, /second/);

  const cleared = await engine.send('s2', '/clear');
  assert.match(cleared.content, /Cleared/);

  const after = await engine.send('s2', '/history');
  assert.match(after.content, /No history/);
});

test('/mode switches consilium mode and routing', async () => {
  const engine = await createChatEngine({});
  const r = await engine.send('s', '/mode solo');
  assert.match(r.content, /solo/);

  const current = await engine.send('s', '/mode');
  assert.match(current.content, /solo/);

  const back = await engine.send('s', '/mode evabot');
  assert.match(back.content, /evabot/);
});

test('/consilium delegates to the consilium provider with turns', async () => {
  const engine = await createChatEngine({});
  const reply = await engine.send('s', '/consilium What is EvaLine?');
  assert.equal(reply.provider, 'consilium');
  assert.equal(reply.mode, 'chat');
  assert.ok(reply.content.length > 0);
  assert.ok(reply.turns && reply.turns.length > 0);
});

test('unknown command is reported', async () => {
  const engine = await createChatEngine({});
  const reply = await engine.send('s', '/bogus');
  assert.match(reply.content, /Unknown command/);
});

test('PluginManager rejects duplicate plugin ids', async () => {
  const pm = new PluginManager();
  await pm.register(new ProviderPlugin(new EvabotProvider({ stub: true })));
  await assert.rejects(
    () => pm.register(new ProviderPlugin(new EvabotProvider({ stub: true }))),
    /Duplicate plugin id/
  );
});

test('HTTP server serves health, plugins, chat and consilium', async (t) => {
  const engine = await createChatEngine({});
  const server = createHttpServer(engine);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.status, 'ok');
  assert.equal(health.plugins.length, 2);
  assert.equal(health.version, '0.1.0');

  const plugins = await fetch(`${base}/api/plugins`).then((r) => r.json());
  assert.equal(plugins.plugins.length, 2);

  const chatResp = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'http1', message: 'hi' }),
  });
  const chat = await chatResp.json();
  assert.equal(chatResp.status, 200);
  assert.equal(chat.sessionId, 'http1');
  assert.equal(chat.reply.provider, 'evabot');
  assert.match(chat.reply.content, /Eva/);

  const conResp = await fetch(`${base}/api/consilium`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'analyze the fleet' }),
  });
  const con = await conResp.json();
  assert.equal(conResp.status, 200);
  assert.ok(con.reply.length > 0);
  assert.ok(Array.isArray(con.turns));
  assert.ok(con.turns.length > 0);

  const notFound = await fetch(`${base}/api/nope`);
  assert.equal(notFound.status, 404);

  const postNotFound = await fetch(`${base}/api/nope`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(postNotFound.status, 404);

  const methodNotAllowed = await fetch(`${base}/api/health`, { method: 'DELETE' });
  assert.equal(methodNotAllowed.status, 405);
});