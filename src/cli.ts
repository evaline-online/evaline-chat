import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createChatEngine } from './index.js';
import type { ChatEngine } from './core/ChatEngine.js';
import type { Room } from './core/rooms.js';
import { parseMemberSpec } from './core/rooms.js';

const GREETING = `EvaLine Chat CLI v0.1.0
Type a message, or /new, /rooms, /join, /invite, /leave, /room, /help, /quit.`;

async function handleCliCommand(engine: ChatEngine, line: string, state: { activeId?: string }): Promise<boolean> {
  const spaceIdx = line.indexOf(' ');
  const cmd = (spaceIdx === -1 ? line.slice(1) : line.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case 'new': {
      const tokens = args.split(/\s+/).filter(Boolean);
      const kind = tokens[0];
      if (kind === 'private') {
        const room = engine.createRoom({
          kind: 'private',
          name: tokens.slice(1).join(' ') || undefined,
          members: [parseMemberSpec('human:You')],
        });
        state.activeId = room.id;
        console.log(`Created private room ${room.id}.`);
      } else if (kind === 'group') {
        const name = tokens.slice(1).join(' ') || 'group';
        const room = engine.createRoom({ kind: 'group', name, members: [parseMemberSpec('human:You')] });
        state.activeId = room.id;
        console.log(`Created group room ${room.id} "${name}".`);
      } else {
        console.log('Usage: /new private | /new group NAME');
      }
      return true;
    }
    case 'rooms': {
      const rooms = engine.listRooms();
      if (!rooms.length) {
        console.log('No rooms yet.');
        return true;
      }
      for (const room of rooms) {
        const mark = room.id === state.activeId ? '*' : ' ';
        const members = room.members.map((m) => `${m.kind}:${m.name}`).join(', ');
        console.log(`${mark} ${room.kind.padEnd(7)} ${room.id}  ${room.name ?? ''}  [${members}]`);
      }
      return true;
    }
    case 'join': {
      if (!args) {
        console.log('Usage: /join <room id>');
        return true;
      }
      const room = engine.listRooms().find((r) => r.id === args || r.id.startsWith(args));
      if (!room) {
        console.log(`No room matches "${args}".`);
        return true;
      }
      state.activeId = room.id;
      console.log(`Now in ${room.name ?? room.id}.`);
      return true;
    }
    case 'invite': {
      if (!state.activeId) {
        console.log('No active room.');
        return true;
      }
      if (!args) {
        console.log('Usage: /invite <spec>  (bot:evabot | bot:consilium | human:Name)');
        return true;
      }
      try {
        const member = engine.addMember(state.activeId, args);
        console.log(`Added ${member.kind}:${member.name} (${member.id}).`);
      } catch (err) {
        console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return true;
    }
    case 'leave': {
      if (!state.activeId) {
        console.log('No active room.');
        return true;
      }
      const room = engine.rooms.get(state.activeId)!;
      const you = room.members.find((m) => m.kind === 'human' && m.name === 'You');
      if (you) {
        try {
          engine.removeMember(state.activeId, you.id);
        } catch {
          void 0;
        }
      }
      state.activeId = undefined;
      console.log(`Left ${room.name ?? room.id}.`);
      return true;
    }
    case 'room': {
      if (!args) {
        console.log('Usage: /room <name|id>');
        return true;
      }
      const found = engine.listRooms().find((r) => r.name === args || r.id === args || r.id.startsWith(args));
      if (!found) {
        console.log(`No room named "${args}".`);
        return true;
      }
      state.activeId = found.id;
      console.log(`Switched to ${found.name ?? found.id}.`);
      return true;
    }
    case 'history': {
      if (state.activeId && engine.rooms.get(state.activeId)) {
        const messages = engine.messages(state.activeId);
        if (!messages.length) {
          console.log('No messages in this room.');
          return true;
        }
        for (const m of messages) {
          console.log(`[${m.from.kind === 'bot' ? 'bot' : m.from.name}] ${m.text}`);
        }
        return true;
      }
      return false;
    }
    case 'clear': {
      if (state.activeId && engine.rooms.get(state.activeId)) {
        engine.history.clearMessages(state.activeId);
        console.log("Cleared this room's history.");
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

async function processLine(engine: ChatEngine, text: string, state: { activeId?: string }): Promise<void> {
  if (!text.trim()) return;
  if (text === '/quit') {
    console.log('Goodbye.');
    process.exit(0);
  }

  if (text.startsWith('/')) {
    const handled = await handleCliCommand(engine, text, state);
    if (!handled) {
      try {
        const reply = await engine.send('cli', text);
        console.log(`\n${reply.provider}> ${reply.content}`);
      } catch (err) {
        console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return;
  }

  try {
    let room: Room | undefined = state.activeId ? engine.rooms.get(state.activeId) : undefined;
    if (!room) {
      room = engine.createRoom({
        kind: 'private',
        name: 'default',
        members: [parseMemberSpec('human:You'), parseMemberSpec('bot:evabot')],
      });
      state.activeId = room.id;
    }
    const result = await engine.send(room.id, { text });
    for (const message of result.messages) {
      if (message.from.kind !== 'bot') continue;
      console.log(`[bot:${message.from.name}] ${message.text}`);
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function run(): Promise<void> {
  const engine: ChatEngine = await createChatEngine({ historyFile: './data/chat.jsonl' });
  const state: { activeId?: string } = {};
  state.activeId = engine.listRooms().find((r) => r.name === 'default')?.id;

  console.log(GREETING);

  if (input.isTTY) {
    const rl = createInterface({ input, output, terminal: true });
    while (true) {
      const active = state.activeId ? engine.rooms.get(state.activeId) : undefined;
      const prompt = active ? `[${active.name ?? active.id}] you> ` : 'you> ';
      let line: string;
      try {
        line = await rl.question(prompt);
      } catch {
        rl.close();
        break;
      }
      await processLine(engine, line.trim(), state);
    }
    return;
  }

  const rl = createInterface({ input, output, terminal: false });
  for await (const line of rl) {
    await processLine(engine, line.trim(), state);
  }
}

run();