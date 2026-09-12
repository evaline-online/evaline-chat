import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAT_VERSION } from '../version.js';
import type { ChatEngine } from '../core/ChatEngine.js';
import { parseMemberSpec } from '../core/rooms.js';

const MAX_BODY_BYTES = 1024 * 1024;
const PUBLIC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const STATIC_FILES: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'application/javascript; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8',
};

interface ChatBody {
  sessionId?: string;
  message?: string;
}

interface ConsiliumBody {
  message?: string;
  mode?: string;
  rounds?: number;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body_too_large'));
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res: ServerResponse, name: string): void {
  const contentType = STATIC_FILES[name];
  if (!contentType || name.includes('..') || name.includes('/')) {
    sendJson(res, 404, { error: `Not found` });
    return;
  }
  try {
    const content = readFileSync(join(PUBLIC_ROOT, name), 'utf-8');
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(content);
  } catch {
    sendJson(res, 404, { error: `Not found` });
  }
}

function isKnownApiPath(path: string): boolean {
  return (
    path === '/api/chat' ||
    path === '/api/consilium' ||
    path === '/api/health' ||
    path === '/api/plugins' ||
    path === '/api/rooms' ||
    /^\/api\/rooms\/[^/]+$/.test(path) ||
    /^\/api\/rooms\/[^/]+\/members$/.test(path) ||
    /^\/api\/rooms\/[^/]+\/members\/[^/]+$/.test(path) ||
    /^\/api\/rooms\/[^/]+\/messages$/.test(path)
  );
}

export function createHttpServer(engine: ChatEngine): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = (req.method ?? 'GET').toUpperCase();
      const path = url.pathname;

      if (method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
      }

      if (method === 'POST' && path === '/api/chat') {
        const body = (await readBody(req)) as ChatBody | undefined;
        const message = body?.message;
        if (!message) {
          sendJson(res, 400, { error: 'message is required' });
          return;
        }
        const sessionId = body?.sessionId ?? 'default';
        const reply = await engine.send(sessionId, message);
        sendJson(res, 200, { sessionId: reply.sessionId, reply });
        return;
      }

      if (method === 'POST' && path === '/api/consilium') {
        const body = (await readBody(req)) as ConsiliumBody | undefined;
        const message = body?.message;
        if (!message) {
          sendJson(res, 400, { error: 'message is required' });
          return;
        }
        const provider = engine.getProvider('consilium');
        if (!provider) {
          sendJson(res, 503, { error: 'consilium provider is not registered' });
          return;
        }
        if (body?.mode) {
          const original = provider.setMode ? (provider as { getMode?: () => string }).getMode?.() : undefined;
          provider.setMode?.(body.mode);
          try {
            const result = await provider.send({ sessionId: 'consilium', text: message, history: [] });
            sendJson(res, 200, {
              reply: result.content,
              mode: result.mode,
              turns: result.turns ?? [],
              costSummary: result.costSummary ?? null,
            });
          } finally {
            if (original && provider.setMode) provider.setMode(original);
          }
          return;
        }
        const result = await provider.send({ sessionId: 'consilium', text: message, history: [] });
        sendJson(res, 200, {
          reply: result.content,
          mode: result.mode,
          turns: result.turns ?? [],
          costSummary: result.costSummary ?? null,
        });
        return;
      }

      if (method === 'GET' && path === '/api/health') {
        sendJson(res, 200, {
          status: 'ok',
          plugins: engine.pluginManager.list(),
          version: CHAT_VERSION,
        });
        return;
      }

      if (method === 'GET' && path === '/api/plugins') {
        sendJson(res, 200, { plugins: engine.pluginManager.list() });
        return;
      }

      if (method === 'GET' && path === '/api/rooms') {
        sendJson(res, 200, { rooms: engine.listRooms() });
        return;
      }

      if (method === 'POST' && path === '/api/rooms') {
        const body = (await readBody(req)) as { kind?: string; name?: string; members?: string[] } | undefined;
        const kind = body?.kind === 'group' ? 'group' : 'private';
        const members = (body?.members ?? [])
          .filter((m): m is string => typeof m === 'string')
          .map((m) => parseMemberSpec(m));
        try {
          const room = engine.createRoom({ kind, name: body?.name, members });
          sendJson(res, 201, { room });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      const roomById = path.match(/^\/api\/rooms\/([^/]+)$/);
      const roomMembers = path.match(/^\/api\/rooms\/([^/]+)\/members$/);
      const roomMember = path.match(/^\/api\/rooms\/([^/]+)\/members\/([^/]+)$/);
      const roomMessages = path.match(/^\/api\/rooms\/([^/]+)\/messages$/);

      if (roomById && method === 'GET') {
        const room = engine.rooms.get(roomById[1]!);
        if (!room) {
          sendJson(res, 404, { error: `Room "${roomById[1]}" not found` });
          return;
        }
        sendJson(res, 200, { room });
        return;
      }

      if (roomById && method === 'DELETE') {
        if (!engine.rooms.get(roomById[1]!)) {
          sendJson(res, 404, { error: `Room "${roomById[1]}" not found` });
          return;
        }
        engine.deleteRoom(roomById[1]!);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (roomMembers && method === 'POST') {
        const roomId = roomMembers[1]!;
        if (!engine.rooms.get(roomId)) {
          sendJson(res, 404, { error: `Room "${roomId}" not found` });
          return;
        }
        const body = (await readBody(req)) as { spec?: string } | undefined;
        const spec = body?.spec;
        if (!spec) {
          sendJson(res, 400, { error: 'spec is required' });
          return;
        }
        try {
          const member = engine.addMember(roomId, spec);
          sendJson(res, 201, { member });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (roomMember && method === 'DELETE') {
        const roomId = roomMember[1]!;
        const memberId = roomMember[2]!;
        if (!engine.rooms.get(roomId)) {
          sendJson(res, 404, { error: `Room "${roomId}" not found` });
          return;
        }
        try {
          engine.removeMember(roomId, memberId);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (roomMessages && method === 'POST') {
        const roomId = roomMessages[1]!;
        if (!engine.rooms.get(roomId)) {
          sendJson(res, 404, { error: `Room "${roomId}" not found` });
          return;
        }
        const body = (await readBody(req)) as { from?: string; text?: string } | undefined;
        const text = body?.text;
        if (!text) {
          sendJson(res, 400, { error: 'text is required' });
          return;
        }
        const result = await engine.send(roomId, { from: body?.from, text });
        sendJson(res, 200, { messages: result.messages, replies: result.replies });
        return;
      }

      if (roomMessages && method === 'GET') {
        const roomId = roomMessages[1]!;
        const after = Number(url.searchParams.get('after') ?? 0);
        const messages = engine.messages(roomId, Number.isFinite(after) && after > 0 ? { after } : undefined);
        sendJson(res, 200, { messages });
        return;
      }

      const isStaticPath = path === '/' || path === '/index.html' || path === '/app.js' || path === '/styles.css';
      if (isStaticPath) {
        if (method !== 'GET') {
          sendJson(res, 405, { error: `Method ${method} not allowed`, allowed: ['GET', 'OPTIONS'] });
          return;
        }
        const file = path === '/' ? 'index.html' : path.replace(/^\//, '');
        serveStatic(res, file);
        return;
      }

      if (isKnownApiPath(path)) {
        sendJson(res, 405, { error: `Method ${method} not allowed`, allowed: ['GET', 'POST', 'DELETE', 'OPTIONS'] });
        return;
      }

      sendJson(res, 404, { error: `Not found: ${method} ${path}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, message === 'body_too_large' ? 413 : 500, { error: message });
    }
  });
}

export function startServer(engine: ChatEngine, port = 3005): Server {
  const server = createHttpServer(engine);
  server.listen(port, () => {
    console.log(`[evaline-chat] HTTP server listening on http://localhost:${port}`);
  });
  return server;
}