import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EvabotProvider,
  ConsiliumProvider,
  StubLlmClient,
  ConsiliumEngine,
  createChatEngine,
  ChatSession,
} from '../dist/index.js';

test('EvabotProvider stub returns a deterministic corporate reply', async () => {
  const provider = new EvabotProvider({ stub: true });
  const result = await provider.send({ sessionId: 's', text: 'hello', history: [] });
  assert.match(result.content, /EvaLine/);
  assert.match(result.content, /Chernomorsk/);
  assert.match(result.content, /consilium/);
  assert.match(result.content, /hello/);

  const again = await provider.send({ sessionId: 's', text: 'hello', history: [] });
  assert.equal(again.content, result.content);
});

test('EvabotProvider without apiUrl defaults to stub', async () => {
  const provider = new EvabotProvider();
  const result = await provider.send({ sessionId: 's', text: 'hi', history: [] });
  assert.match(result.content, /EvaLine/);
});

test('ConsiliumProvider runs the engine via StubLlmClient and returns synthesis + turns', async () => {
  const provider = new ConsiliumProvider();
  const result = await provider.send({ sessionId: 's', text: 'hello consilium', history: [] });
  assert.equal(result.mode, 'chat');
  assert.ok(result.turns && result.turns.length > 0);
  assert.ok(typeof result.content === 'string' && result.content.length > 0);
  const head = result.turns![0]!;
  assert.ok(typeof head.name === 'string');
  assert.ok(typeof head.model === 'string');
  assert.ok(head.content.length > 0);
});

test('ConsiliumProvider honours defaultMode and injected llm', async () => {
  const provider = new ConsiliumProvider({
    llm: new StubLlmClient(),
    defaultMode: 'consilium',
  });
  const result = await provider.send({ sessionId: 's', text: 'decide the roadmap', history: [] });
  assert.equal(result.mode, 'consilium');
  assert.ok(result.turns && result.turns.length >= 2);
});

test('ConsiliumProvider accepts an injected engine instance', async () => {
  const engine = new ConsiliumEngine({ llm: new StubLlmClient() });
  const provider = new ConsiliumProvider({ engine });
  const result = await provider.send({ sessionId: 's', text: 'summarize', history: [] });
  assert.ok(result.turns && result.turns.length > 0);
});

test('ConsiliumProvider setMode switches the engine mode', async () => {
  const provider = new ConsiliumProvider();
  provider.setMode('interview');
  const result = await provider.send({ sessionId: 's', text: 'interview the CFO', history: [] });
  assert.equal(result.mode, 'interview');
});

test('ChatSession is a thin session holder with a history reference', () => {
  const session = new ChatSession('abc', { displayName: 'Test' });
  assert.equal(session.sessionId, 'abc');
  assert.equal(session.displayName, 'Test');
  assert.ok(session.createdAt > 0);
  session.history.add('abc', { role: 'user', content: 'x' });
  assert.equal(session.history.list('abc').length, 1);
});

test('createChatEngine defaults to the evabot provider', async () => {
  const engine = await createChatEngine({});
  const reply = await engine.send('meta', 'ping');
  assert.equal(reply.provider, 'evabot');
});