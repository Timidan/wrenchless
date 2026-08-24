import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createMailboxServer } from "./server.js";
import { MailboxStore } from "./store.js";

const databasePath = resolve(
  process.env.WRENCHLESS_MAILBOX_DB ?? ".data/mailbox.sqlite",
);
const port = Number(process.env.PORT ?? "8787");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}
const production = process.env.NODE_ENV === "production";
const allowedOrigin =
  process.env.WRENCHLESS_MAILBOX_ORIGIN ??
  (production ? undefined : "http://localhost:5174");
if (allowedOrigin === undefined) {
  throw new Error("WRENCHLESS_MAILBOX_ORIGIN is required in production");
}

mkdirSync(dirname(databasePath), { recursive: true });
const store = new MailboxStore(databasePath);
const server = createMailboxServer(store, {
  allowedOrigin,
  requireHttps: production,
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Wrenchless mailbox listening on 127.0.0.1:${port}\n`);
});

function shutDown(): void {
  server.close(() => {
    store.close();
    process.exitCode = 0;
  });
}

process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);
