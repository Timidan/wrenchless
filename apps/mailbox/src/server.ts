import { timingSafeEqual, webcrypto } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  HeartbeatEnvelopeSchema,
  heartbeatEnvelopeSigningBytes,
  jsonValueSchema,
  type JsonValue,
  type HeartbeatEnvelope,
} from "@wrenchless/canary-core";
import { ZodError, z } from "zod";

import {
  MailboxStore,
  MailboxStoreError,
  type MailboxEnrollment,
} from "./store.js";

const MAX_BODY_BYTES = 4_096;
const RATE_WINDOW_MILLISECONDS = 60 * 60 * 1_000;
// Guardian enrollment polls every three seconds while its QR is open: 1,200
// authenticated reads per hour. Keep a small margin above that so leaving the
// screen open cannot make a later, valid response unreadable.
const MAX_RECEIVES_PER_MAILBOX_HOUR = 1_440;

type MailboxServerOptions = {
  allowedOrigin: string | undefined;
  requireHttps: boolean;
  trustProxy?: boolean;
};

type RateBucket = {
  count: number;
  resetsAt: number;
};

type MailboxResponse =
  | MailboxEnrollment
  | { status: string }
  | { error: string }
  | { messageId: string; status: string }
  | {
      envelopes: HeartbeatEnvelope[];
      senderEncryptionPublicKey: string | null;
    };

const senderBindingSchema = z
  .object({
    senderSigningPublicKey: z.string().regex(/^04[0-9a-f]{128}$/),
    senderEncryptionPublicKey: z.string().regex(/^04[0-9a-f]{128}$/),
  })
  .strict();

class RateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  allow(key: string, maximum: number, now = Date.now()): boolean {
    for (const [storedKey, bucket] of this.buckets) {
      if (bucket.resetsAt <= now) this.buckets.delete(storedKey);
    }
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetsAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetsAt: now + RATE_WINDOW_MILLISECONDS,
      });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= maximum;
  }
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'");
  response.setHeader("Cross-Origin-Resource-Policy", "same-site");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: MailboxResponse,
): void {
  setSecurityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function remoteAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const address = first?.split(",", 1)[0]?.trim();
    if (address) return address;
  }
  return request.socket.remoteAddress ?? "unknown";
}

function bearerCapability(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    return null;
  }
  const capability = authorization.slice("Bearer ".length);
  return /^[0-9a-f]{64}$/.test(capability) ? capability : null;
}

function sameSecret(first: string, second: string): boolean {
  const firstBytes = Buffer.from(first);
  const secondBytes = Buffer.from(second);
  return (
    firstBytes.length === secondBytes.length &&
    timingSafeEqual(firstBytes, secondBytes)
  );
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigin: string | undefined,
): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return true;
  }
  if (allowedOrigin === undefined || !sameSecret(origin, allowedOrigin)) {
    sendJson(response, 403, { error: "origin_not_allowed" });
    return false;
  }
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Vary", "Origin");
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<JsonValue> {
  const contentType = request.headers["content-type"];
  if (contentType?.split(";", 1)[0] !== "application/json") {
    throw new Error("unsupported_media_type");
  }
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_BODY_BYTES) {
    throw new Error("body_too_large");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > MAX_BODY_BYTES) {
      throw new Error("body_too_large");
    }
    chunks.push(bytes);
  }
  if (received === 0) {
    throw new Error("empty_body");
  }
  return jsonValueSchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
}

async function readEnvelopeBody(
  request: IncomingMessage,
): Promise<HeartbeatEnvelope> {
  return HeartbeatEnvelopeSchema.parse(await readJsonBody(request));
}

function mailboxPath(pathname: string): {
  mailboxId: string;
  collection: "envelopes" | "sender";
} | null {
  const match = /^\/v1\/mailboxes\/([0-9a-f]{32})\/(envelopes|sender)$/.exec(
    pathname,
  );
  if (match?.[1] === undefined) {
    return null;
  }
  const collection = match[2];
  if (collection !== "envelopes" && collection !== "sender") return null;
  return { mailboxId: match[1], collection };
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function validEnvelopeSignature(
  envelope: HeartbeatEnvelope,
  publicKey: string,
  signature: string | undefined,
): Promise<boolean> {
  if (signature === undefined || !/^[0-9a-f]{128}$/.test(signature)) {
    return false;
  }
  const key = await webcrypto.subtle.importKey(
    "raw",
    hexToBytes(publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return webcrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    hexToBytes(signature),
    heartbeatEnvelopeSigningBytes(envelope),
  );
}

export function createMailboxServer(
  store: MailboxStore,
  options: MailboxServerOptions,
): Server {
  const rates = new RateLimiter();
  const trustProxy = options.trustProxy === true;

  return createServer(async (request, response) => {
    try {
      if (!applyCors(request, response, options.allowedOrigin)) {
        return;
      }
      if (
        options.requireHttps &&
        request.headers["x-forwarded-proto"] !== "https"
      ) {
        sendJson(response, 400, { error: "https_required" });
        return;
      }

      const url = new URL(request.url ?? "/", "http://mailbox.local");
      if (request.method === "OPTIONS") {
        setSecurityHeaders(response);
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        response.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type, X-Wrenchless-Signature",
        );
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/mailboxes") {
        if (!rates.allow(`create:${remoteAddress(request, trustProxy)}`, 10)) {
          response.setHeader("Retry-After", "3600");
          sendJson(response, 429, { error: "rate_limited" });
          return;
        }
        sendJson(response, 201, store.createMailbox());
        return;
      }

      const path = mailboxPath(url.pathname);
      if (path === null) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      if (request.method === "PUT" && path.collection === "sender") {
        const capability = bearerCapability(request);
        if (capability === null) {
          sendJson(response, 401, { error: "unauthorized" });
          return;
        }
        const body = senderBindingSchema.parse(await readJsonBody(request));
        store.bindSender(
          path.mailboxId,
          capability,
          body.senderSigningPublicKey,
          body.senderEncryptionPublicKey,
        );
        sendJson(response, 200, { status: "bound" });
        return;
      }

      if (request.method === "POST" && path.collection === "envelopes") {
        if (!rates.allow(`send:${remoteAddress(request, trustProxy)}`, 240)) {
          response.setHeader("Retry-After", "3600");
          sendJson(response, 429, { error: "rate_limited" });
          return;
        }
        const envelope = await readEnvelopeBody(request);
        const senderKeys = store.senderKeys(path.mailboxId);
        const valid = await validEnvelopeSignature(
          envelope,
          senderKeys.signingPublicKey,
          Array.isArray(request.headers["x-wrenchless-signature"])
            ? request.headers["x-wrenchless-signature"][0]
            : request.headers["x-wrenchless-signature"],
        );
        if (!valid) {
          sendJson(response, 401, { error: "invalid_signature" });
          return;
        }
        const result = store.storeEnvelope(path.mailboxId, envelope);
        sendJson(response, result === "stored" ? 201 : 200, {
          messageId: envelope.messageId,
          status: "stored",
        });
        return;
      }

      if (request.method === "GET" && path.collection === "envelopes") {
        const capability = bearerCapability(request);
        if (capability === null) {
          sendJson(response, 401, { error: "unauthorized" });
          return;
        }
        if (
          !rates.allow(
            `receive:${path.mailboxId}:${remoteAddress(request, trustProxy)}`,
            MAX_RECEIVES_PER_MAILBOX_HOUR,
          )
        ) {
          response.setHeader("Retry-After", "3600");
          sendJson(response, 429, { error: "rate_limited" });
          return;
        }
        const envelopes = store.listEnvelopes(path.mailboxId, capability);
        let senderEncryptionPublicKey: string | null = null;
        try {
          senderEncryptionPublicKey = store.senderKeys(
            path.mailboxId,
          ).encryptionPublicKey;
        } catch (error) {
          if (
            !(error instanceof MailboxStoreError) ||
            error.code !== "sender_not_bound"
          ) {
            throw error;
          }
        }
        sendJson(response, 200, {
          envelopes,
          senderEncryptionPublicKey,
        });
        return;
      }

      sendJson(response, 405, { error: "method_not_allowed" });
    } catch (error) {
      if (
        error instanceof MailboxStoreError &&
        error.code === "unauthorized"
      ) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      if (error instanceof MailboxStoreError) {
        const status =
          error.code === "mailbox_full"
            ? 429
            : error.code === "invalid_retention"
              ? 422
              : 409;
        sendJson(response, status, { error: error.code });
        return;
      }
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 422, { error: "invalid_request" });
        return;
      }
      if (error instanceof Error && error.message === "unsupported_media_type") {
        sendJson(response, 415, { error: error.message });
        return;
      }
      if (error instanceof Error && error.message === "body_too_large") {
        sendJson(response, 413, { error: error.message });
        return;
      }
      if (error instanceof Error && error.message === "empty_body") {
        sendJson(response, 400, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: "server_error" });
    }
  });
}
