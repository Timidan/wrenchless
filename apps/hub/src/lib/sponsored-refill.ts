import {
  SponsoredClaimChallengeSchema,
  SponsoredClaimResultSchema,
  SponsorErrorResponseSchema,
  jsonValueSchema,
  signRefillClaim,
  type SponsoredClaimChallenge,
  type SponsoredClaimIntent,
  type SponsoredClaimResult,
} from "@wrenchless/canary-core";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";

export type SubmitSponsoredRefillClaimInput = Omit<
  SponsoredClaimIntent,
  "schemaVersion"
> & {
  sponsorUrl: string;
  claimPrivateKey: string;
  fetcher?: typeof fetch;
};

function endpoint(sponsorUrl: string, pathname: string): string {
  const base = sponsorUrl.endsWith("/") ? sponsorUrl : `${sponsorUrl}/`;
  return new URL(pathname.replace(/^\//, ""), base).toString();
}

async function responseJson(response: Response) {
  const body = jsonValueSchema.parse(await response.json());
  if (!response.ok) {
    const errorResponse = SponsorErrorResponseSchema.safeParse(body);
    const code = errorResponse.success
      ? errorResponse.data.error
      : "sponsor_request_failed";
    const reason =
      errorResponse.success && errorResponse.data.reason !== undefined
        ? ` (${errorResponse.data.reason})`
        : "";
    throw new Error(`sponsored claim failed: ${code}${reason}`);
  }
  return body;
}

function assertChallengeMatchesIntent(
  challenge: SponsoredClaimChallenge,
  intent: SponsoredClaimIntent,
): void {
  if (BigInt(challenge.authorization.chainId) !== BigInt(MAINNET_CHAIN_ID)) {
    throw new Error("sponsor challenge is not for Starknet mainnet");
  }
  const feltFields = [
    [challenge.intent.helperAddress, intent.helperAddress, "helper"],
    [challenge.intent.recipient, intent.recipient, "recipient"],
    [challenge.intent.stateId, intent.stateId, "state id"],
    [challenge.intent.nonce, intent.nonce, "nonce"],
    [challenge.intent.tokenAddress, intent.tokenAddress, "token"],
    [challenge.intent.claimPublicKey, intent.claimPublicKey, "claim public key"],
  ] as const;
  for (const [actual, expected, label] of feltFields) {
    if (BigInt(actual) !== BigInt(expected)) {
      throw new Error(`sponsor changed the refill ${label}`);
    }
  }
  if (
    challenge.intent.expiry !== intent.expiry ||
    challenge.intent.amountFri !== intent.amountFri
  ) {
    throw new Error("sponsor changed the refill amount or expiry");
  }
  if (Date.parse(challenge.expiresAt) <= Date.now()) {
    throw new Error("sponsored claim challenge expired before signing");
  }
}

export async function submitSponsoredRefillClaim(
  input: SubmitSponsoredRefillClaimInput,
): Promise<SponsoredClaimResult> {
  const fetcher = input.fetcher ?? fetch;
  const intent: SponsoredClaimIntent = {
    schemaVersion: "wrenchless.sponsored-claim-intent.v1",
    helperAddress: input.helperAddress,
    recipient: input.recipient,
    stateId: input.stateId,
    nonce: input.nonce,
    expiry: input.expiry,
    tokenAddress: input.tokenAddress,
    amountFri: input.amountFri,
    claimPublicKey: input.claimPublicKey,
  };
  const prepareResponse = await fetcher(
    endpoint(input.sponsorUrl, "/v1/refill-claims"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intent),
    },
  );
  const challenge = SponsoredClaimChallengeSchema.parse(
    await responseJson(prepareResponse),
  );
  assertChallengeMatchesIntent(challenge, intent);

  const signature = signRefillClaim(
    input.claimPrivateKey,
    challenge.authorization,
  );
  const submitResponse = await fetcher(
    endpoint(
      input.sponsorUrl,
      `/v1/refill-claims/${challenge.claimId}/submit`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature }),
    },
  );
  const result = SponsoredClaimResultSchema.parse(
    await responseJson(submitResponse),
  );
  if (
    result.claimId !== challenge.claimId ||
    BigInt(result.noteId) !== BigInt(challenge.authorization.noteId)
  ) {
    throw new Error("sponsor returned a different claim result");
  }
  return result;
}
