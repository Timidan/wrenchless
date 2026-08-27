import { jsonValueSchema, type JsonValue } from "@wrenchless/canary-core";
import { z } from "zod";

export type TravelSafeV3RelayArtifact = {
  schemaVersion: "wrenchless.travel-safe-relay.v3";
  chainId: "SN_MAIN";
  operation: "FUND" | "TOP_UP";
  poolAddress: string;
  helperAddress: string;
  stateId: string;
  tokenAddress: string;
  amountBaseUnits: string;
  createdAt: string;
  call: {
    contractAddress: string;
    entrypoint: "apply_actions";
    calldata: string[];
  };
  proof: string;
  proofFacts: string[];
} & (
  | {
      operation: "FUND";
      claimCommitment: string;
      deviceCommitment: string;
      recoveryCommitment: string;
      dailyAmountBaseUnits: string;
      firstReleaseAt: string;
      returnAt: string;
    }
  | {
      operation: "TOP_UP";
      nonce: string;
      devicePublicKey: string;
      signatureR: string;
      signatureS: string;
    }
);

const estimateSchema = z.object({
  status: z.literal("estimated"),
  summary: z.object({
    operation: z.enum(["FUND", "TOP_UP"]),
    poolFeeFri: z.string().regex(/^[1-9][0-9]*$/),
    estimatedTransactionFeeFri: z.string().regex(/^[1-9][0-9]*$/),
    maxTransactionFeeFri: z.string().regex(/^[1-9][0-9]*$/),
    maxSpendFri: z.string().regex(/^[1-9][0-9]*$/),
    proofExpiresAtBlock: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
  }),
});
const submissionSchema = z.object({
  status: z.literal("submitted"),
  transactionHash: z.string().regex(/^0x[0-9a-f]+$/),
});
const errorSchema = z.object({ error: z.string() });

export type TravelSafeV3RelayEstimate = z.infer<typeof estimateSchema>;
export type TravelSafeV3RelaySubmission = z.infer<typeof submissionSchema>;

export class TravelSafeV3SponsorError extends Error {
  constructor(
    message: string,
    readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = "TravelSafeV3SponsorError";
  }
}

function route(
  sponsorUrl: string,
  operation: "FUND" | "TOP_UP",
  estimate: boolean,
): string {
  const base = sponsorUrl.endsWith("/") ? sponsorUrl : `${sponsorUrl}/`;
  const name = operation === "FUND" ? "fund" : "top-up";
  return new URL(`v3/${name}${estimate ? "/estimate" : ""}`, base).toString();
}

function message(code: string): string {
  if (code === "travel_safe_cost_changed") return "Cost changed. Prepare again.";
  if (code === "relay_busy") return "Another action is confirming. Try shortly.";
  if (code === "daily_fund_budget_exhausted") return "Private actions are paused today.";
  if (code === "rate_limited") return "Too many attempts. Try later.";
  if (code === "travel_safe_v3_disabled" || code === "sponsor_unavailable") {
    return "Private parking is temporarily unavailable.";
  }
  return "This action could not be prepared.";
}

async function readBody(response: Response): Promise<JsonValue> {
  try {
    return jsonValueSchema.parse(await response.json());
  } catch {
    throw new TravelSafeV3SponsorError("The service response was unreadable.", true);
  }
}

export async function estimateTravelSafeV3Relay(input: {
  sponsorUrl: string;
  artifact: TravelSafeV3RelayArtifact;
  fetcher?: typeof fetch;
}): Promise<TravelSafeV3RelayEstimate> {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(
      route(input.sponsorUrl, input.artifact.operation, true),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.artifact),
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch {
    throw new TravelSafeV3SponsorError("Could not prepare the cost.", false);
  }
  const body = await readBody(response);
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    throw new TravelSafeV3SponsorError(
      error.success ? message(error.data.error) : "Could not prepare the cost.",
      false,
    );
  }
  return estimateSchema.parse(body);
}

export async function submitTravelSafeV3Relay(input: {
  sponsorUrl: string;
  artifact: TravelSafeV3RelayArtifact;
  acceptedMaxSpendFri: string;
  fetcher?: typeof fetch;
}): Promise<TravelSafeV3RelaySubmission> {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(
      route(input.sponsorUrl, input.artifact.operation, false),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact: input.artifact,
          acceptedMaxSpendFri: input.acceptedMaxSpendFri,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch {
    throw new TravelSafeV3SponsorError(
      "The action may still be landing. Checking the chain.",
      true,
    );
  }
  const body = await readBody(response);
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    const ambiguous =
      error.success &&
      error.data.error === "travel_safe_submission_uncertain";
    throw new TravelSafeV3SponsorError(
      ambiguous
        ? "The action may still be landing. Checking the chain."
        : error.success
          ? message(error.data.error)
          : "The action was not sent.",
      ambiguous,
    );
  }
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    throw new TravelSafeV3SponsorError(
      "The action may still be landing. Checking the chain.",
      true,
    );
  }
  return parsed.data;
}
