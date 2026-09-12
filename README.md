# evaline-chat

Enterprise chat-engine **host** with a plugin system for attaching agents.
It bundles two providers out of the box:

- **evabot** — corporate chat provider (EvaLine, Chernomorsk plant), with a
  deterministic in-process stub and an optional remote `apiUrl` adapter.
- **consilium** — the [`evaline-consilium`](../evaline-consilium) multi-LLM
  deliberation engine (solo, broadcast, dialogue, consilium, interview, chat),
  driven through a `StubLlmClient` so it is always runnable offline.

This release adds **room-based chat**: private and group rooms that mix humans
and LLM bots, with compact persistent JSONL history per room and a browser UI
shell served over the HTTP API.

## Plugin architecture

```
                          ┌────────────────────────────────────────────┐
                          │                 ChatEngine                 │
                          │  rooms / routing / commands / providers    │
                          └───────▲───────────────────────────▲────────┘
                                  │  initialize(ctx)          │  send()
              ┌───────────────────┴───────────┐    ┌──────────┴───────────────────┐
              │         PluginManager         │    │        AgentProvider        │
              │  register/unregister/list     │    │  { id, name, send(input) }  │
              └───────────────────▲───────────┘    └──────────▲──────────────────┘
                                  │                            │
                    ┌─────────────┴──────────┐   ┌──────────────┴─────────────┐
                    │  ProviderPlugin(evabot)│   │ ProviderPlugin(consilium) │
                    └────────────────────────┘   └──────────────▲─────────────┘
                                                      ConsiliumProvider
                                                      ───────────────
                                                      ConsiliumEngine.run({
                                                        mode, prompt, rounds: 2,
                                                        useKnowledgeBase: true })
```

Every agent is a **plugin** (`src/contract.ts` declares the `Plugin` /
`PluginManifest` / `PluginContext` / `PluginEventBus` contract, structurally
identical to `evaline-consilium`'s so its `ConsiliumPlugin` drops in as-is).
Plugins get a context with a config bag, a logger, an event bus, route and
command registration, and isolated per-plugin storage. The `PluginManager`
rejects duplicate ids, tracks initialization, and reports per-plugin health.

Providers implement the small `AgentProvider` interface and are surfaced to the
engine through the `ProviderPlugin` adapter. Plain messages are routed by the
engine through the active provider, while `/mode` and `/consilium` steer the
deliberation engine.

## Rooms & members model

- **Rooms** are `private` (at most 2 members) or `group` (unlimited members).
  A room mixes **human** members and **bot** members.
- **Bots** are declared by member spec and matched to a registered
  `AgentProvider` by `providerId` (`bot:evabot`, `bot:consilium`). Sending a
  message to a room triggers every bot member to reply, in registration order.
- **Member specs** (`parseMemberSpec`): `bot:evabot`, `human:Oleg`, or a bare
  name (`Sarah`) which is interpreted as a human member.
- **History**: messages are stored per room with a global monotonic `seq`.
  Rooms, messages and the seq watermark persist to a single JSONL file
  (one JSON object per line — `{type:'room', room}`, `{type:'msg', ...ChatMessage}`,
  `{type:'seq', max}`), so a restart restores the rooms and history automatically.
  The server/CLI default to `./data/chat.jsonl`; override via
  `HISTORY_FILE` env var or the `historyFile` engine option (omitted for
  in-memory use in tests).
- **Legacy API**: `send(sessionId, text)` still works — it routes through an
  on-demand private default room (You + evabot) so older callers keep working.

## Quickstart

```bash
cd /home/evabot/Desktop/evaline-chat
npm install          # links ../evaline-consilium (needs its dist/)
npm run build        # tsc -p tsconfig.json (strict)
npm test             # build + node --experimental-strip-types --test tests/*
npm start            # node dist/server.js — HTTP server on :8080 (PORT env overrides)
node dist/cli.js     # interactive CLI (greet, /mode, /consilium, /rooms, /quit)
```

Start the HTTP server:

```bash
node -e "import('./dist/index.js').then(async m => { const e = await m.createChatEngine({}); m.startServer(e, 8080); })"
```

## CLI commands

| Command            | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `/new private`     | Create a private room (max 2 members)                           |
| `/new group NAME`  | Create a group room named NAME                                  |
| `/rooms`           | List rooms (most recent activity first)                         |
| `/join <id>`       | Open a room by id                                               |
| `/room <name\|id>` | Open a room by name or id                                       |
| `/invite <spec>`   | Add a member (`bot:evabot`, `human:Oleg`, or bare name)        |
| `/leave`           | Close the active room                                           |
| `/history`         | Show recent messages of the active room                         |
| `/clear`           | Clear messages of the active room                               |
| `/mode`, `/consilium`, `/plugins`, `/help` | Existing engine controls (legacy session form) |

Typing a bare message sends it into the active room (a default private room is
created on first message if none is open).

## API endpoints

| Method | Path                               | Body                  | Description                                                    |
| ------ | ---------------------------------- | --------------------- | -------------------------------------------------------------- |
| POST   | `/api/chat`                        | `{ sessionId?, message }` | Chat via the active provider → `{ sessionId, reply }`      |
| POST   | `/api/consilium`                   | `{ message, mode? }`  | Consilium deliberations → `{ reply, mode, turns, costSummary }` |
| GET    | `/api/health`                      | —                     | `{ status: 'ok', plugins, version }`                           |
| GET    | `/api/plugins`                     | —                     | `{ plugins: PluginManifest[] }`                                |
| POST   | `/api/rooms`                       | `{ kind, name?, members? }` | Create a room → `{ room }` (members parsed via `parseMemberSpec`) |
| GET    | `/api/rooms`                       | —                     | `{ rooms }` (most recent activity first)                       |
| GET    | `/api/rooms/:id`                   | —                     | `{ room }`                                                     |
| DELETE | `/api/rooms/:id`                   | —                     | `{ ok: true }`                                                 |
| POST   | `/api/rooms/:id/members`           | `{ spec }`            | Add a member → `{ member }`                                    |
| DELETE | `/api/rooms/:id/members/:memberId` | —                     | `{ ok: true }`                                                 |
| POST   | `/api/rooms/:id/messages`          | `{ from?, text }`     | Send to room → `{ messages, replies }`                         |
| GET    | `/api/rooms/:id/messages?after=N`  | —                     | `{ messages }` (seq greater than `after`)                      |
| GET    | `/` , `/app.js`, `/styles.css`     | —                     | Browser UI shell served from `public/`                         |

All responses are JSON with `Access-Control-Allow-Origin: *`. Unknown paths
return `404`, unsupported methods `405`, bodies over 1 MB `413`.

## Browser UI

The frontend lives in `public/` (`index.html`, `app.js`, `styles.css`) and is
served directly by the HTTP server at `/`. The current build is a static shell
that documents the room API; the conversational UI is wired separately against
the endpoints above.

## Public API

```ts
createChatEngine(opts?) => Promise<ChatEngine>
  // opts: { plugins?, defaultProvider?, history?, historyFile?, locale?, onProgress? }
ChatEngine        // rooms, RoomManager, createRoom/listRooms/addMember/removeMember/
                  // deleteRoom/messages, send(roomId, {from?, text}) → RoomSendResult,
                  // legacy send(sessionId, text) → ChatReply
RoomManager       // create / get / list / addMember / removeMember / deleteRoom / touch
parseMemberSpec   // 'bot:evabot' | 'human:Oleg' | 'Sarah' → RoomMember
CommandParser     // parse(line) → { isCommand, command?, args?, raw }
PluginManager     // register / unregister / list / get / initializeAll / health
HistoryStore      // room store (upsertRoom/addMessage/messages/count) + legacy session
                  // add/list/clear + JSONL persistence (filePath, autosave, flush, save)
ChatSession       // thin session holder (sessionId, displayName, history)
EvabotProvider    // AgentProvider, stub or ${apiUrl}/api/chat
ConsiliumProvider // AgentProvider wrapping a ConsiliumEngine
createHttpServer(engine) / startServer(engine, port?)
CHAT_VERSION      // '0.1.0'
```

License: UNLICENSED.