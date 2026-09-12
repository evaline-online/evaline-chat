export type ChatRole = 'user' | 'assistant' | 'system';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly dependencies?: string[];
  readonly enabled: boolean;
  readonly category: string;
}

export interface PluginHealthResult {
  readonly status: string;
  readonly message?: string;
}

export type RouteHandler = (params: {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly query?: Record<string, string>;
  readonly params?: Record<string, string>;
}) => Promise<unknown> | unknown;

export type CommandHandler = (args: string) => Promise<string> | string;

export interface PluginStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  all(): Record<string, unknown>;
}

export interface PluginEventBus {
  on(event: string, handler: (...args: unknown[]) => void | Promise<void>): () => void;
  off(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;
  emit(event: string, ...args: unknown[]): Promise<void>;
  clear(): void;
}

export class MemoryEventBus implements PluginEventBus {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void | Promise<void>>>();

  on(event: string, handler: (...args: unknown[]) => void | Promise<void>): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: (...args: unknown[]) => void | Promise<void>): void {
    this.listeners.get(event)?.delete(handler);
  }

  async emit(event: string, ...args: unknown[]): Promise<void> {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const handler of bucket) {
      handler(...args);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export class PluginLogger {
  private readonly name: string;

  constructor(name = 'plugin') {
    this.name = name;
  }

  debug(message: string, ...args: unknown[]): void {
    console.debug(`[${this.name}] ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.info(`[${this.name}] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[${this.name}] ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[${this.name}] ${message}`, ...args);
  }
}

export interface PluginContext {
  readonly config: Record<string, unknown>;
  readonly logger: PluginLogger;
  readonly eventBus: PluginEventBus;
  registerRoute(method: string, path: string, handler: RouteHandler): void;
  registerCommand(command: string, handler: CommandHandler, help?: string): void;
  getStorage(name: string): PluginStorage;
}

export class PluginError extends Error {
  readonly code: string;

  constructor(message: string, code = 'PLUGIN_ERROR') {
    super(message);
    this.name = 'PluginError';
    this.code = code;
  }
}

export interface Plugin {
  readonly manifest: PluginManifest;
  initialize(ctx: PluginContext): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck?(): Promise<PluginHealthResult>;
}
