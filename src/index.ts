import { ConsiliumEngine, StubLlmClient } from 'evaline-consilium';
import type { LlmClient } from 'evaline-consilium';
import { CHAT_VERSION } from './version.js';
import { ChatEngine } from './core/ChatEngine.js';
import type {
  ChatEngineOptions,
  AgentProvider,
  AgentProviderResult,
  AgentProviderSendInput,
  ChatReply,
  RoomSendResult,
  DefaultProvider,
  Locale,
} from './core/ChatEngine.js';
import { ChatSession } from './core/ChatSession.js';
import { CommandParser } from './core/CommandParser.js';
import { HistoryStore } from './core/HistoryStore.js';
import type { HistoryMessage, ChatMessageDraft, HistoryStoreOptions } from './core/HistoryStore.js';
import { PluginManager } from './core/PluginManager.js';
import type { PluginHealth } from './core/PluginManager.js';
import { ProviderPlugin } from './core/ProviderPlugin.js';
import { RoomManager } from './core/RoomManager.js';
import type { Room, RoomKind, RoomMember, MemberKind, ChatMessage } from './core/rooms.js';
import { newId, parseMemberSpec } from './core/rooms.js';
import { EvabotProvider } from './providers/evabot.js';
import { ConsiliumProvider } from './providers/consilium.js';
import { createHttpServer, startServer } from './server/http.js';

export type {
  Plugin,
  PluginManifest,
  PluginContext,
  PluginError,
  PluginEventBus,
  PluginHealthResult,
  PluginStorage,
  RouteHandler,
  CommandHandler,
  ChatRole,
  HttpMethod,
} from './contract.js';
export { PluginLogger, MemoryEventBus } from './contract.js';

export { ChatEngine, CommandParser, PluginManager, HistoryStore, ChatSession, RoomManager, EvabotProvider, ConsiliumProvider, ProviderPlugin, createHttpServer, startServer, CHAT_VERSION };
export { newId, parseMemberSpec };
export type {
  ChatEngineOptions,
  AgentProvider,
  AgentProviderResult,
  AgentProviderSendInput,
  ChatReply,
  RoomSendResult,
  DefaultProvider,
  Locale,
  Room,
  RoomKind,
  RoomMember,
  MemberKind,
  ChatMessage,
  HistoryMessage,
  ChatMessageDraft,
  HistoryStoreOptions,
  PluginHealth,
};

export interface CreateChatEngineOptions {
  readonly plugins?: ChatEngineOptions['plugins'];
  readonly defaultProvider?: DefaultProvider;
  readonly history?: HistoryStore;
  readonly historyFile?: string;
  readonly locale?: Locale;
  readonly onProgress?: (event: unknown) => void;
}

export { ConsiliumEngine, StubLlmClient };
export type { LlmClient };

export async function createChatEngine(opts: CreateChatEngineOptions = {}): Promise<ChatEngine> {
  const history = opts.history ?? (opts.historyFile ? new HistoryStore({ filePath: opts.historyFile }) : new HistoryStore());

  const evabot = new EvabotProvider({ stub: true });
  const consilium = new ConsiliumProvider({ llm: new StubLlmClient() });

  const engine = new ChatEngine({
    plugins: [new ProviderPlugin(evabot), new ProviderPlugin(consilium), ...(opts.plugins ?? [])],
    defaultProvider: opts.defaultProvider ?? 'evabot',
    history,
    locale: opts.locale,
    onProgress: opts.onProgress,
  });

  await engine.initialize();
  return engine;
}