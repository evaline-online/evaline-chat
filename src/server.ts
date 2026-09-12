import { createChatEngine } from './index.js';
import { startServer } from './server/http.js';

const port = Number(process.env.PORT ?? 3005);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Invalid PORT "${process.env.PORT}". Using 3005.`);
}

const engine = await createChatEngine({ historyFile: process.env.HISTORY_FILE ?? './data/chat.jsonl' });
startServer(engine, port);