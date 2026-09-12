import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandParser } from '../dist/index.js';

test('plain line is not a command', () => {
  const parser = new CommandParser();
  const result = parser.parse('hello eva');
  assert.equal(result.isCommand, false);
  assert.equal(result.raw, 'hello eva');
  assert.equal(result.command, undefined);
  assert.equal(result.args, undefined);
});

test('command token is extracted', () => {
  const parser = new CommandParser();
  const result = parser.parse('/help');
  assert.equal(result.isCommand, true);
  assert.equal(result.command, 'help');
  assert.equal(result.args, undefined);
});

test('args are extracted after command', () => {
  const parser = new CommandParser();
  const result = parser.parse('/mode solo');
  assert.equal(result.isCommand, true);
  assert.equal(result.command, 'mode');
  assert.equal(result.args, 'solo');
});

test('/consilium preserves the full prompt args', () => {
  const parser = new CommandParser();
  const result = parser.parse('  /consilium What is a multi-agent system?  ');
  assert.equal(result.isCommand, true);
  assert.equal(result.command, 'consilium');
  assert.equal(result.args, 'What is a multi-agent system?');
});

test('aliases map to canonical commands regardless of leading slash', () => {
  const parser = new CommandParser({ aliases: { m: 'mode', con: 'consilium', '/h': '/help' } });
  assert.equal(parser.parse('/m solo').command, 'mode');
  assert.equal(parser.parse('/con fleet').command, 'consilium');
  assert.equal(parser.parse('/h').command, 'help');
});

test('empty string is not a command', () => {
  const parser = new CommandParser();
  assert.equal(parser.parse('').isCommand, false);
  assert.equal(parser.parse('/').isCommand, false);
});