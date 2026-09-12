import type { ConsiliumTurn } from 'evaline-consilium';
import {
  MemoryEventBus,
  PluginError,
  PluginLogger,
} from '../contract.js';
import type {
  Plugin,
  PluginContext,
  PluginEventBus,
  RouteHandler,
  CommandHandler,
  PluginStorage,
} from '../contract.js';
import { CommandParser } from './CommandParser.js';
import { HistoryStore } from './HistoryStore.js';
import type { HistoryMessage } from './HistoryStore.js';
import { PluginManager } from './PluginManager.js';
import { ProviderPlugin } from './ProviderPlugin.js';
import { RoomManager } from './RoomManager.js';
import type { ChatMessage, Room, RoomMember } from './rooms.js';
import { newId, parseMemberSpec } from './rooms.js';

export type DefaultProvider = 'evabot' | 'consilium';
export type Locale = 'uk' | 'en' | 'ru';

const CONSILIUM_MODES = ['chat', 'dialog', 'interview', 'consilium', 'solo', 'broadcast', 'dialogue'] as const;

export interface AgentProviderSendInput {
  readonly sessionId: string;
  readonly text: string;
  readonly history: HistoryMessage[];
}

export interface AgentProviderResult {
  readonly content: string;
  readonly mode?: string;
  readonly turns?: ConsiliumTurn[];
  readonly costSummary?: unknown;
}

export interface AgentProvider {
  readonly id: string;
  readonly name: string;
  send(input: AgentProviderSendInput): Promise<AgentProviderResult>;
  setMode?(mode: string): void;
}

export interface ChatReply {
  readonly sessionId: string;
  readonly role: 'assistant';
  readonly content: string;
  readonly provider: string;
  readonly mode?: string;
  readonly turns?: ConsiliumTurn[];
  readonly costSummary?: unknown;
  readonly ms: number;
}

export interface RoomSendResult {
  readonly messages: ChatMessage[];
  readonly replies: ChatReply[];
}

export interface ChatEngineOptions {
  readonly plugins?: Plugin[];
  readonly defaultProvider?: DefaultProvider;
  readonly pluginManager?: PluginManager;
  readonly history?: HistoryStore;
  readonly onProgress?: (event: unknown) => void;
  readonly locale?: Locale;
}

class InMemoryStorage implements PluginStorage {
  private readonly map = new Map<string, unknown>();

  get(key: string): unknown {
    return this.map.get(key);
  }
  set(key: string, value: unknown): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
  all(): Record<string, unknown> {
    return Object.fromEntries(this.map);
  }
}

export class ChatEngine {
  readonly pluginManager: PluginManager;
  readonly history: HistoryStore;
  readonly rooms: RoomManager;
  private readonly parser: CommandParser;
  private readonly onProgress?: (event: unknown) => void;
  private readonly locale: Locale;
  private readonly defaultProvider: DefaultProvider;
  private activeProviderId: string;
  private consiliumMode: string = 'chat';
  private readonly logger: PluginLogger;
  private readonly eventBus: PluginEventBus;
  private readonly routeRegistry = new Map<string, RouteHandler>();
  private readonly commandRegistry = new Map<string, { handler: CommandHandler; help?: string }>();
  private readonly providers = new Map<string, AgentProvider>();
  private readonly storage = new Map<string, PluginStorage>();
  private readonly initialPlugins: Plugin[];
  private readonly legacyRooms = new Map<string, string>();
  private initialized = false;

  constructor(opts: ChatEngineOptions = {}) {
    this.pluginManager = opts.pluginManager ?? new PluginManager();
    this.history = opts.history ?? new HistoryStore();
    this.rooms = new RoomManager();
    this.onProgress = opts.onProgress;
    this.locale = opts.locale ?? 'en';
    this.defaultProvider = opts.defaultProvider ?? 'evabot';
    this.activeProviderId = this.defaultProvider;
    this.logger = new PluginLogger('evaline-chat');
    this.eventBus = new MemoryEventBus();
    this.initialPlugins = opts.plugins ?? [];
    this.parser = new CommandParser({
      aliases: {
        h: 'help',
        c: 'clear',
        his: 'history',
        hist: 'history',
        m: 'mode',
        mod: 'mode',
        con: 'consilium',
        p: 'plugins',
      },
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const plugin of this.initialPlugins) {
      if (!this.pluginManager.get(plugin.manifest.id)) {
        await this.pluginManager.register(plugin);
      }
    }

    const ctx: PluginContext = {
      config: {},
      logger: this.logger,
      eventBus: this.eventBus,
      registerRoute: (method: string, path: string, handler: RouteHandler) => {
        this.routeRegistry.set(`${method.toUpperCase()} ${path}`, handler);
      },
      registerCommand: (command: string, handler: CommandHandler, help?: string) => {
        this.commandRegistry.set(command.replace(/^\/+/, '').toLowerCase(), { handler, help });
      },
      getStorage: (name: string): PluginStorage => {
        let store = this.storage.get(name);
        if (!store) {
          store = new InMemoryStorage();
          this.storage.set(name, store);
        }
        return store;
      },
    };

    await this.pluginManager.initializeAll(ctx);

    for (const manifest of this.pluginManager.list()) {
      const plugin = this.pluginManager.get(manifest.id)!;
      if (plugin instanceof ProviderPlugin) {
        this.providers.set(plugin.provider.id, plugin.provider);
      }
      this.adoptRoutesAndCommands(plugin);
    }

    if (!this.providers.has(this.activeProviderId)) {
      const first = this.providers.values().next().value as AgentProvider | undefined;
      this.activeProviderId = first ? first.id : 'evabot';
    }

    for (const room of this.history.allRooms()) {
      this.rooms.restore(room);
    }

    this.initialized = true;
  }

  async send(sessionId: string, text: string): Promise<ChatReply>;
  async send(roomId: string, input: { readonly from?: string; readonly text: string }): Promise<RoomSendResult>;
  async send(
    sessionOrRoomId: string,
    arg: string | { readonly from?: string; readonly text: string }
  ): Promise<ChatReply | RoomSendResult> {
    if (!this.initialized) throw new PluginError('ChatEngine not initialized — call initialize() first', 'NOT_READY');
    if (typeof arg === 'string') {
      return this.sendLegacy(sessionOrRoomId, arg);
    }
    return this.sendToRoom(sessionOrRoomId, arg);
  }

  getProvider(id: string): AgentProvider | undefined {
    return this.providers.get(id);
  }

  listProviders(): AgentProvider[] {
    return [...this.providers.values()];
  }

  registerAgentProvider(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
  }

  activeProviderFor(providerId?: string): AgentProvider | undefined {
    if (providerId) return this.providers.get(providerId);
    return this.providers.get(this.activeProviderId);
  }

  createRoom(opts: { kind: Room['kind']; name?: string; ownerId?: string; members?: RoomMember[] }): Room {
    for (const member of opts.members ?? []) {
      this.assertBotProvider(member);
    }
    const room = this.rooms.create(opts);
    this.history.upsertRoom(room);
    return room;
  }

  listRooms(): Room[] {
    return this.rooms.list();
  }

  addMember(roomId: string, spec: string | RoomMember): RoomMember {
    const room = this.rooms.get(roomId);
    if (!room) throw new PluginError(`Room "${roomId}" not found`, 'NO_ROOM');
    const member = typeof spec === 'string' ? parseMemberSpec(spec) : spec;
    this.assertBotProvider(member);
    this.rooms.addMember(roomId, member);
    this.history.upsertRoom(room);
    return member;
  }

  private assertBotProvider(member: RoomMember): void {
    if (member.kind === 'bot') {
      const providerId = member.providerId ?? member.name;
      if (!this.providers.has(providerId)) {
        throw new PluginError(`Bot provider "${providerId}" is not registered`, 'NO_PROVIDER');
      }
    }
  }

  removeMember(roomId: string, memberId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new PluginError(`Room "${roomId}" not found`, 'NO_ROOM');
    this.rooms.removeMember(roomId, memberId);
    this.history.upsertRoom(room);
  }

  deleteRoom(roomId: string): void {
    this.rooms.deleteRoom(roomId);
    this.history.deleteRoom(roomId);
    for (const [sessionId, rid] of this.legacyRooms) {
      if (rid === roomId) this.legacyRooms.delete(sessionId);
    }
  }

  messages(roomId: string, opts?: { after?: number }): ChatMessage[] {
    return this.history.messages(roomId, opts);
  }

  handleRoute(method: string, path: string, body?: unknown): Promise<unknown> | unknown {
    const key = `${method.toUpperCase()} ${path}`;
    const handler = this.routeRegistry.get(key);
    if (!handler) throw new PluginError(`No route registered for ${key}`, 'NO_ROUTE');
    return handler({ method, path, body });
  }

  private async sendToRoom(roomId: string, input: { readonly from?: string; readonly text: string }): Promise<RoomSendResult> {
    const room = this.rooms.get(roomId);
    if (!room) throw new PluginError(`Room "${roomId}" not found`, 'NO_ROOM');
    const sender = this.resolveRoomSender(room, input.from);
    const humanMessage = this.history.addMessage(roomId, sender, input.text);
    this.emitProgress({ type: 'room.send_start', roomId });

    const botMessages: ChatMessage[] = [];
    const replies: ChatReply[] = [];
    const bots = room.members.filter((m) => m.kind === 'bot' && m.id !== sender.id);

    for (const bot of bots) {
      const provider = this.activeProviderFor(bot.providerId);
      if (!provider) continue;
      const started = Date.now();
      this.emitProgress({ type: 'bot.send_start', roomId, provider: provider.id });
      const result = await provider.send({
        sessionId: roomId,
        text: input.text,
        history: this.buildProviderHistory(roomId),
      });
      const ms = Date.now() - started;
      const botMessage = this.history.addMessage(roomId, bot, result.content);
      botMessages.push(botMessage);
      replies.push({
        sessionId: roomId,
        role: 'assistant',
        content: result.content,
        provider: bot.providerId ?? provider.id,
        mode: result.mode,
        turns: result.turns,
        costSummary: result.costSummary,
        ms,
      });
    }

    this.rooms.touch(roomId);
    this.history.upsertRoom(room);
    this.emitProgress({ type: 'room.send_complete', roomId, botCount: botMessages.length });
    return { messages: [humanMessage, ...botMessages], replies };
  }

  private resolveRoomSender(room: Room, from?: string): RoomMember {
    if (from) {
      const byId = room.members.find((m) => m.id === from);
      if (byId) return byId;
      const byName = room.members.find((m) => m.name.toLowerCase() === from.toLowerCase());
      if (byName) return byName;
    }
    const existingHuman = room.members.find((m) => m.kind === 'human');
    if (existingHuman) return existingHuman;
    const you: RoomMember = { id: `human_you_${newId('m')}`, name: 'You', kind: 'human' };
    room.members.push(you);
    this.history.upsertRoom(room);
    return you;
  }

  private buildProviderHistory(roomId: string): HistoryMessage[] {
    return this.history.messages(roomId).map((m) => ({
      id: m.id,
      sessionId: m.roomId,
      role: m.from.kind === 'bot' ? 'assistant' : 'user',
      content: m.text,
      ts: m.ts,
    }));
  }

  // Legacy send(sessionId, text): routes to a private default room named after
  // the sessionId, auto-filled with "You" and the evabot stub provider.
  private async sendLegacy(sessionId: string, text: string): Promise<ChatReply> {
    const parsed = this.parser.parse(text);
    if (parsed.isCommand) {
      return this.handleCommand(sessionId, parsed);
    }
    const room = this.ensureLegacyRoom(sessionId);
    const human = room.members.find((m) => m.kind === 'human')!;
    const result = await this.send(room.id, { from: human.id, text });
    for (const message of result.messages) {
      this.history.add(sessionId, {
        role: message.from.kind === 'bot' ? 'assistant' : 'user',
        content: message.text,
        model: message.from.providerId,
      });
    }
    const reply = result.replies[0];
    const botMessage = result.messages.find((m) => m.from.kind === 'bot');
    return {
      sessionId,
      role: 'assistant',
      content: botMessage?.text ?? '',
      provider: botMessage?.from.providerId ?? this.activeProviderId,
      mode: reply?.mode,
      turns: reply?.turns,
      costSummary: reply?.costSummary,
      ms: reply?.ms ?? 0,
    };
  }

  private ensureLegacyRoom(sessionId: string): Room {
    const existingId = this.legacyRooms.get(sessionId);
    const existing = existingId ? this.rooms.get(existingId) : undefined;
    if (existing) return existing;
    const you: RoomMember = { id: `human_you_${sessionId}`, name: 'You', kind: 'human' };
    const bot: RoomMember = { id: `bot_evabot_${sessionId}`, name: 'evabot', kind: 'bot', providerId: 'evabot' };
    const room = this.rooms.create({ kind: 'private', name: sessionId, members: [you, bot] });
    this.legacyRooms.set(sessionId, room.id);
    this.history.upsertRoom(room);
    return room;
  }

  private adoptRoutesAndCommands(plugin: Plugin): void {
    const candidate = plugin as unknown as {
      routes?: Array<{ method?: string; path?: string; handler?: unknown }>;
      commands?: Array<{ cmd?: string; handler?: unknown; help?: string }>;
    };
    for (const route of candidate.routes ?? []) {
      if (typeof route.path === 'string' && typeof route.handler === 'function') {
        const method = typeof route.method === 'string' && route.method ? route.method.toUpperCase() : 'GET';
        this.routeRegistry.set(`${method} ${route.path}`, route.handler as RouteHandler);
      }
    }
    for (const cmd of candidate.commands ?? []) {
      if (typeof cmd.cmd === 'string' && cmd.cmd && typeof cmd.handler === 'function') {
        this.commandRegistry.set(cmd.cmd.replace(/^\/+/, '').toLowerCase(), {
          handler: cmd.handler as CommandHandler,
          help: cmd.help,
        });
      }
    }
  }

  private async handleCommand(sessionId: string, parsed: { command?: string; args?: string }): Promise<ChatReply> {
    const started = Date.now();
    const command = parsed.command!;
    const args = parsed.args ?? '';

    switch (command) {
      case 'help':
        return this.builtinReply(sessionId, this.buildHelpText(), 'system', started);
      case 'clear':
        this.history.clear(sessionId);
        return this.builtinReply(sessionId, 'Cleared history for this session.', 'system', started);
      case 'history':
        return this.builtinReply(sessionId, this.buildHistory(sessionId), 'system', started);
      case 'mode':
        return this.builtinReply(sessionId, this.handleMode(args), 'system', started);
      case 'consilium': {
        const prompt = args.trim();
        if (!prompt) {
          return this.builtinReply(sessionId, 'Usage: /consilium <prompt>', 'system', started);
        }
        const provider = this.providers.get('consilium');
        if (!provider) {
          return this.builtinReply(sessionId, 'Consilium provider is not registered.', 'system', started);
        }
        this.history.add(sessionId, { role: 'user', content: `/consilium ${prompt}` });
        const t0 = Date.now();
        this.emitProgress({ type: 'chat.send_start', provider: 'consilium', sessionId });
        const result = await provider.send({
          sessionId,
          text: prompt,
          history: this.history.list(sessionId),
        });
        const ms = Date.now() - t0;
        this.history.add(sessionId, { role: 'assistant', content: result.content });
        this.emitProgress({ type: 'chat.send_complete', provider: 'consilium', sessionId, ms });
        return {
          sessionId,
          role: 'assistant',
          content: result.content,
          provider: 'consilium',
          mode: result.mode,
          turns: result.turns,
          costSummary: result.costSummary,
          ms,
        };
      }
      case 'plugins':
        return this.builtinReply(sessionId, this.buildPluginsText(), 'system', started);
      default: {
        const entry = this.commandRegistry.get(command);
        if (entry) {
          const output = await entry.handler(args);
          return this.builtinReply(sessionId, String(output), 'system', started);
        }
        return this.builtinReply(sessionId, `Unknown command "/${command}". Type /help for available commands.`, 'system', started);
      }
    }
  }

  private builtinReply(sessionId: string, content: string, provider: string, started: number): ChatReply {
    return {
      sessionId,
      role: 'assistant',
      content,
      provider,
      ms: Date.now() - started,
    };
  }

  private handleMode(args: string): string {
    const consilium = this.providers.get('consilium');
    if (!consilium) return 'Consilium provider is not registered.';

    if (!args) {
      return `Active provider: ${this.activeProviderId}\nConsilium mode: ${this.consiliumMode}\n\nUsage: /mode <${CONSILIUM_MODES.join('|')}>`;
    }
    const m = args.trim().toLowerCase();
    if (m === 'evabot') {
      this.activeProviderId = 'evabot';
      return 'Switched to evabot provider.';
    }
    if (!(CONSILIUM_MODES as readonly string[]).includes(m)) {
      return `Unknown mode "${m}". Allowed: ${CONSILIUM_MODES.join(', ')}`;
    }
    this.consiliumMode = m;
    consilium.setMode?.(m);
    this.activeProviderId = 'consilium';
    return `Mode set to ${m} (consilium provider active).`;
  }

  private buildHistory(sessionId: string): string {
    const messages = this.history.list(sessionId);
    if (!messages.length) return 'No history for this session.';
    const lines = messages.map((m) => `[${m.role}] ${m.content}`);
    return lines.join('\n');
  }

  private buildHelpText(): string {
    const lines: string[] = [];
    const header: Record<Locale, string> = {
      en: 'EvaLine Chat — available commands',
      uk: 'EvaLine Chat — доступні команди',
      ru: 'EvaLine Chat — доступные команды',
    };
    lines.push(header[this.locale] ?? header.en);
    lines.push('');
    lines.push('/help              Show this help');
    lines.push('/clear             Clear session history');
    lines.push('/history           Show session history');
    lines.push('/mode <mode>       Switch chat mode');
    lines.push('/consilium <text>  Ask the consilium deliberation engine');
    lines.push('/plugins           List registered plugins');
    lines.push('/new private       Create a private room');
    lines.push('/new group NAME    Create a group room');
    lines.push('/rooms             List rooms');
    lines.push('/join <id>         Join a room by id');
    lines.push('/invite <spec>     Add a member (bot:evabot|bot:consilium|human:Name)');
    lines.push('/leave             Leave the active room');
    lines.push('/room <name>       Switch active room by name');
    for (const [cmd, entry] of this.commandRegistry) {
      lines.push(`/${cmd}${entry.help ? `   ${entry.help}` : ''}`);
    }
    lines.push('');
    lines.push(`Registered providers: ${this.listProviders().map((p) => p.id).join(', ')}`);
    return lines.join('\n');
  }

  private buildPluginsText(): string {
    const manifests = this.pluginManager.list();
    if (!manifests.length) return 'No plugins registered.';
    return manifests
      .map((m) => `${m.id} — ${m.name} (v${m.version}, ${m.enabled ? 'enabled' : 'disabled'}, ${m.category})`)
      .join('\n');
  }

  private emitProgress(event: unknown): void {
    this.onProgress?.(event);
    this.eventBus.emit('chat.progress', event);
  }
}