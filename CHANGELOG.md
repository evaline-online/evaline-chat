# Changelog

All notable changes to evaline-chat will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- [ ] Wired conversational UI on top of the rooms API
- [ ] Streaming replies into rooms
- [ ] More AgentProvider implementations beyond evabot / consilium

---

## [0.1.0] - 2026-09-12

### Added
- **Enterprise chat-engine host** with a plugin system for attaching agents.
- **Plugin architecture** (`src/contract.ts`): `Plugin` / `PluginManifest` / `PluginContext` / `PluginEventBus` declarations — structurally identical to `evaline-consilium`'s so its `ConsiliumPlugin` drops in as-is. Plugins get a config bag, logger, event bus, route and command registration, and isolated per-plugin storage.
- **`PluginManager`**: register/unregister/list, rejects duplicate ids, tracks initialization, reports per-plugin health.
- **Two out-of-the-box providers**:
  - `evabot` — corporate chat provider (EvaLine, Chernomorsk plant), deterministic in-process stub with optional remote `apiUrl` adapter
  - `consilium` — the `evaline-consilium` multi-LLM deliberation engine (solo, broadcast, dialogue, consilium, interview, chat), driven through a `StubLlmClient` so it runs offline with zero API keys
- **Room-based chat**: `private` (max 2 members) and `group` (unlimited) rooms that mix human and bot members (`bot:evabot`, `bot:consilium`, `human:Oleg`, or bare names); every bot member replies per message in registration order.
- **Persistent JSONL history** per room with a global monotonic `seq` watermark (`{type:'room'}`, `{type:'msg'}`, `{type:'seq'}`), auto-restored on restart; `HISTORY_FILE` env var / `historyFile` engine option, in-memory for tests.
- **CLI**: `/new private`, `/new group NAME`, `/rooms`, `/join`, `/room`, `/invite`, `/leave`, `/history`, `/clear`, plus legacy `/mode`, `/consilium`, `/plugins`, `/help`.
- **HTTP API**: `/api/chat`, `/api/consilium`, `/api/health`, `/api/plugins`, full rooms CRUD (`/api/rooms*`), served from `node dist/server.js` on port 8080.
- **Legacy API**: `send(sessionId, text)` still routes through an on-demand private default room (You + evabot).
- **Browser UI shell** in `public/` (`index.html`, `app.js`, `styles.css`) served by the HTTP server.
- **Public API surface**: `createChatEngine`, `ChatEngine`, `RoomManager`, `parseMemberSpec`, `CommandParser`, `PluginManager`, `HistoryStore`, `ChatSession`, `EvabotProvider`, `ConsiliumProvider`, `createHttpServer`, `startServer`, `CHAT_VERSION`.
- Strict TypeScript (`tsc`), `node:test` suite, zero runtime dependencies beyond the linked `evaline-consilium`.

---

**Format:** [Keep a Changelog](https://keepachangelog.com/)  
**Versioning:** [Semantic Versioning](https://semver.org/)  
**Status:** Active development