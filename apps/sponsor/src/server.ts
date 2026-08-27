import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHmac, randomBytes } from "node:crypto";

import { jsonValueSchema, type JsonValue } from "@wrenchless/canary-core";
import { z, ZodError } from "zod";

import type {
  RefillFundUnavailableReason,
  SponsorUnavailableReason,
} from "./availability.js";
import {
  RefillFundRelayError,
  type RefillFundRelay,
  type RefillFundEstimate,
  type RefillFundSubmission,
} from "./fund-relay.js";
import {
  RecoveryLookupDeniedError,
  type RecoveryChallenge,
  type RecoveryLocator,
  type RecoveryLookupService,
} from "./recovery-index.js";
import {
  TravelSafeV3RelayError,
  type TravelSafeV3Estimate,
  type TravelSafeV3Relay,
  type TravelSafeV3Submission,
} from "./travel-safe-v3-relay.js";

const MAX_FUND_BODY_BYTES = 8 * 1_024 * 1_024;
const MAX_RECOVERY_BODY_BYTES = 16 * 1_024;
const RATE_WINDOW_MILLISECONDS = 60 * 60 * 1_000;

const fundSubmissionSchema = z
  .object({
    artifact: jsonValueSchema,
    acceptedMaxSpendFri: z
      .string()
      .regex(/^[1-9][0-9]*$/, "expected a positive canonical decimal integer"),
  })
  .strict();
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const recoveryFeltSchema = z
  .string()
  .regex(/^0x[0-9a-f]+$/i)
  .refine((value) => BigInt(value) < STARK_FIELD_PRIME);
const recoveryAccountSchema = recoveryFeltSchema.refine(
  (value) => BigInt(value) !== 0n,
);

type SponsorServerOptions = {
  allowedOrigin: string;
  fundUnavailableReason: () => Promise<
    RefillFundUnavailableReason | undefined
  >;
  requireHttps: boolean;
  trustProxy: boolean;
  travelSafeV3Relay?: Pick<TravelSafeV3Relay, "ready" | "estimate" | "submit">;
};

type SponsorFundRelay = Pick<
  RefillFundRelay,
  "canFundOneMaximumTransaction" | "estimate" | "submit"
>;

type RateBucket = { count: number; resetsAt: number };

function remoteAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const address = first?.split(",", 1)[0]?.trim();
    if (address) return address;
  }
  return request.socket.remoteAddress ?? "unknown";
}

class RateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  allow(key: string, maximum: number, now = Date.now()): boolean {
    for (const [storedKey, bucket] of this.buckets) {
      if (bucket.resetsAt <= now) this.buckets.delete(storedKey);
    }
    const bucket = this.buckets.get(key);
    if (bucket === undefined) {
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

type SponsorResponse =
  | RefillFundSubmission
  | RefillFundEstimate
  | TravelSafeV3Estimate
  | TravelSafeV3Submission
  | RecoveryChallenge
  | RecoveryLocator
  | { error: string; reason?: SponsorUnavailableReason }
  | { status: "ok" | "ready" };

type PublicError = {
  status: number;
  code: string;
};

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'");
  response.setHeader("Cross-Origin-Resource-Policy", "same-site");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function sendJson(response: ServerResponse, status: number, body: SponsorResponse): void {
  setSecurityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigin: string,
): boolean {
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== allowedOrigin) {
    sendJson(response, 403, { error: "origin_not_allowed" });
    return false;
  }
  if (origin !== undefined) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Vary", "Origin");
  }
  return true;
}

async function readJsonBody(
  request: IncomingMessage,
  maximumBytes = MAX_FUND_BODY_BYTES,
): Promise<JsonValue> {
  if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
    throw new Error("unsupported_media_type");
  }
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength > maximumBytes) {
    throw new Error("body_too_large");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > maximumBytes) throw new Error("body_too_large");
    chunks.push(bytes);
  }
  if (received === 0) throw new Error("empty_body");
  return jsonValueSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

function publicError(error: Error): PublicError {
  if (error instanceof RecoveryLookupDeniedError) {
    return { status: 401, code: "recovery_not_approved" };
  }
  if (error instanceof RefillFundRelayError) {
    if (error.code === "relay_busy") return { status: 409, code: error.code };
    if (error.code === "active_safe_exists") {
      return { status: 409, code: error.code };
    }
    if (error.code === "recovery_not_approved") {
      return { status: 422, code: error.code };
    }
    if (error.code === "fund_cost_changed") {
      return { status: 409, code: error.code };
    }
    if (
      error.code === "fund_broadcast_disabled" ||
      error.code === "daily_fund_budget_exhausted"
    ) {
      return { status: 503, code: error.code };
    }
    return { status: 422, code: error.code };
  }
  if (error instanceof TravelSafeV3RelayError) {
    if (error.code === "relay_busy" || error.code === "travel_safe_cost_changed") {
      return { status: 409, code: error.code };
    }
    if (
      error.code === "travel_safe_v3_disabled" ||
      error.code === "daily_fund_budget_exhausted"
    ) {
      return { status: 503, code: error.code };
    }
    return { status: 422, code: error.code };
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return { status: 400, code: "invalid_request" };
  }
  if (["body_too_large", "empty_body", "unsupported_media_type"].includes(error.message)) {
    return {
      status:
        error.message === "body_too_large"
          ? 413
          : error.message === "unsupported_media_type"
            ? 415
            : 400,
      code: error.message,
    };
  }
  return { status: 503, code: "sponsor_unavailable" };
}

export function createSponsorServer(
  fundRelay: SponsorFundRelay,
  recoveryLookup: RecoveryLookupService,
  options: SponsorServerOptions,
): Server {
  const rates = new RateLimiter();
  const rateKey = randomBytes(32);
  const rateBucket = (scope: string, request: IncomingMessage): string =>
    createHmac("sha256", rateKey)
      .update(scope)
      .update("\0")
      .update(remoteAddress(request, options.trustProxy))
      .digest("hex");
  return createServer(async (request, response) => {
    try {
      if (!applyCors(request, response, options.allowedOrigin)) return;
      if (options.requireHttps && request.headers["x-forwarded-proto"] !== "https") {
        sendJson(response, 400, { error: "https_required" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://sponsor.local");
      if (request.method === "OPTIONS") {
        setSecurityHeaders(response);
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type");
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/readyz") {
        const fundUnavailableReason = await options.fundUnavailableReason();
        const ready =
          fundUnavailableReason === undefined &&
          (await fundRelay.canFundOneMaximumTransaction());
        if (ready) {
          sendJson(response, 200, { status: "ready" });
        } else {
          response.setHeader("Retry-After", "300");
          sendJson(response, 503, {
            error: "sponsor_unavailable",
            reason:
              fundUnavailableReason ??
              "daily_fund_budget_exhausted",
          });
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/v3/readyz") {
        const ready =
          options.travelSafeV3Relay !== undefined &&
          (await options.travelSafeV3Relay.ready());
        if (ready) {
          sendJson(response, 200, { status: "ready" });
        } else {
          response.setHeader("Retry-After", "300");
          sendJson(response, 503, { error: "sponsor_unavailable" });
        }
        return;
      }
      const travelSafeRoute =
        url.pathname === "/v3/fund" || url.pathname === "/v3/fund/estimate"
          ? ("FUND" as const)
          : url.pathname === "/v3/top-up" ||
              url.pathname === "/v3/top-up/estimate"
            ? ("TOP_UP" as const)
            : null;
      if (request.method === "POST" && travelSafeRoute !== null) {
        if (options.travelSafeV3Relay === undefined) {
          sendJson(response, 503, { error: "travel_safe_v3_disabled" });
          return;
        }
        const estimating = url.pathname.endsWith("/estimate");
        if (
          !rates.allow(
            rateBucket(
              `${travelSafeRoute.toLowerCase()}-${estimating ? "estimate" : "submit"}`,
              request,
            ),
            6,
          )
        ) {
          response.setHeader("Retry-After", "3600");
          sendJson(response, 429, { error: "rate_limited" });
          return;
        }
        if (estimating) {
          const estimate = await options.travelSafeV3Relay.estimate(
            await readJsonBody(request),
            travelSafeRoute,
          );
          sendJson(response, 200, estimate);
          return;
        }
        const body = fundSubmissionSchema.parse(await readJsonBody(request));
        const submission = await options.travelSafeV3Relay.submit(
          body.artifact,
          BigInt(body.acceptedMaxSpendFri),
          travelSafeRoute,
        );
        sendJson(response, 202, submission);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/refill-funds") {
        const fundUnavailableReason = await options.fundUnavailableReason();
        if (fundUnavailableReason !== undefined) {
          response.setHeader("Retry-After", "300");
          sendJson(response, 503, {
            error: "sponsor_unavailable",
            reason: fundUnavailableReason,
          });
          return;
        }
        if (
          !rates.allow(
            rateBucket("fund", request),
            6,
          )
        ) {
          response.setHeader("Retry-After", "3600");
          sendJson(response, 429, { error: "rate_limited" });
          return;
        }
        const body = fundSubmissionSchema.parse(await readJsonBody(request));
        const submission = await fundRelay.submit(
          body.artifact,
          BigInt(body.acceptedMaxSpendFri),
        );
        sendJson(response, submission.status === "finalized" ? 201 : 202, submission);
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/refill-funds/estimate"
      ) {
        const fundUnavailableReason = await options.fundUnavailableReason();
        if (fundUnavailableReason !== undefined) {
          response.setHeader("Retry-After", "300");
          sendJson(response, 503, {
            error: "sponsor_unavailable",
            reason: fundUnavailableReason,
          });
          return;
        }
        if (!rates.allow(rateBucket("fund-estimate", request), 6)) {
          response.setHeader("Retry-After", "3600");
          sendJson(response, 429, { error: "rate_limited" });
          return;
        }
        const estimate: RefillFundEstimate = await fundRelay.estimate(
          await readJsonBody(request),
        );
        sendJson(response, 200, estimate);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/recovery/challenge") {
        if (
          !rates.allow(
            rateBucket("recovery-challenge", request),
            12,
          )
        ) {
          response.setHeader("Retry-After", "3600");
          sendJson(response, 429, { error: "rate_limited" });
          return;
        }
        const body = z
          .object({ account: recoveryAccountSchema })
          .strict()
          .parse(await readJsonBody(request, MAX_RECOVERY_BODY_BYTES));
        sendJson(response, 200, recoveryLookup.createChallenge(body.account));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/recovery/lookup") {
        if (
          !rates.allow(
            rateBucket("recovery-lookup", request),
            6,
          )
        ) {
          response.setHeader("Retry-After", "3600");
          sendJson(response, 429, { error: "rate_limited" });
          return;
        }
        const body = z
          .object({
            account: recoveryAccountSchema,
            token: z.string().min(1).max(4_096),
            signature: z.array(recoveryFeltSchema).min(1).max(64),
          })
          .strict()
          .parse(await readJsonBody(request, MAX_RECOVERY_BODY_BYTES));
        const locator = await recoveryLookup.lookup(body);
        if (locator === null) {
          sendJson(response, 404, { error: "recovery_not_found" });
          return;
        }
        sendJson(response, 200, locator);
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("unexpected sponsor error");
      const responseError = publicError(error);
      if (responseError.status === 503) response.setHeader("Retry-After", "300");
      sendJson(response, responseError.status, { error: responseError.code });
    }
  });
}
