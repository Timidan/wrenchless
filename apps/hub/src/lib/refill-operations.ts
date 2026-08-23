import { computeRefillClaimCommitment } from "@wrenchless/canary-core";

import { computeCoverExposure, type CoverExposure } from "./cover-exposure.js";
import {
  submitReadyRefillRefund,
  submitSponsoredReadyRefillClaim,
  type ReadyRefillWallet,
} from "./ready-refill.js";
import { readRefillChainState } from "./refill-state.js";
import {
  createRefillReleaseNonce,
  readCoverRefillTicket,
  readVaultRefillTicket,
} from "./refill-ticket.js";

function readStoredRefillState(
  helperAddress: string,
  stateId: string,
  fetcher: typeof fetch | undefined,
) {
  const request: Parameters<typeof readRefillChainState>[0] = {
    helperAddress,
    stateId,
  };
  if (fetcher !== undefined) request.fetcher = fetcher;
  return readRefillChainState(request);
}

export async function claimStoredCoverRefill(input: {
  wallet: ReadyRefillWallet;
  sponsorUrl: string;
  helperAddress: string;
  recipient: string;
  stateId: string;
  knownStateIds: readonly string[];
  publicBalanceFri: string;
  shieldedBalanceFri: string;
  poolFeeFri: string;
  exposureCapFri: string;
  fetcher?: typeof fetch;
}): Promise<{
  transactionHash: string;
  noteId: string;
  exposure: CoverExposure;
}> {
  const knownStateIds = [...new Set(input.knownStateIds)];
  if (
    knownStateIds.length === 0 ||
    knownStateIds.length > 24 ||
    !knownStateIds.some((stateId) => BigInt(stateId) === BigInt(input.stateId))
  ) {
    throw new Error("The carried wallet's refill list is incomplete");
  }
  const [ticket, chainState] = await Promise.all([
    readCoverRefillTicket(input.stateId),
    readStoredRefillState(input.helperAddress, input.stateId, input.fetcher),
  ]);
  if (chainState === null) {
    throw new Error("This refill has not been funded yet");
  }
  if (chainState.status !== "funded") {
    throw new Error(`This refill is already ${chainState.status}`);
  }
  if (BigInt(chainState.expiry) < BigInt(Math.floor(Date.now() / 1_000))) {
    throw new Error("This refill expired before it could be claimed");
  }
  const expectedCommitment = computeRefillClaimCommitment(
    ticket.stateId,
    ticket.claimPublicKey,
  );
  if (BigInt(expectedCommitment) !== BigInt(chainState.claimCommitment)) {
    throw new Error("The funded refill does not match this cover ticket");
  }
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const otherClaimableAmounts = await Promise.all(
    knownStateIds
      .filter((stateId) => BigInt(stateId) !== BigInt(input.stateId))
      .map(async (stateId): Promise<string | null> => {
        const [otherTicket, otherState] = await Promise.all([
          readCoverRefillTicket(stateId),
          readStoredRefillState(input.helperAddress, stateId, input.fetcher),
        ]);
        if (
          otherState === null ||
          otherState.status !== "funded" ||
          BigInt(otherState.expiry) < now
        ) {
          return null;
        }
        const otherCommitment = computeRefillClaimCommitment(
          otherTicket.stateId,
          otherTicket.claimPublicKey,
        );
        if (BigInt(otherCommitment) !== BigInt(otherState.claimCommitment)) {
          throw new Error("A funded refill does not match this carried wallet");
        }
        return otherState.amountFri;
      }),
  );
  const exposure = computeCoverExposure({
    publicBalanceFri: input.publicBalanceFri,
    shieldedBalanceFri: input.shieldedBalanceFri,
    immediatelyClaimableAmountsFri: [
      chainState.amountFri,
      ...otherClaimableAmounts.filter((amount): amount is string => amount !== null),
    ],
    poolFeeFri: input.poolFeeFri,
    capFri: input.exposureCapFri,
  });
  if (!exposure.withinCap) {
    throw new Error("Claiming this refill would exceed the cover exposure cap");
  }
  const claimInput: Parameters<typeof submitSponsoredReadyRefillClaim>[0] = {
    wallet: input.wallet,
    sponsorUrl: input.sponsorUrl,
    helperAddress: input.helperAddress,
    recipient: input.recipient,
    stateId: input.stateId,
    nonce: createRefillReleaseNonce(),
    expiry: chainState.expiry,
    tokenAddress: chainState.tokenAddress,
    amountFri: chainState.amountFri,
    claimPrivateKey: ticket.claimPrivateKey,
    claimPublicKey: ticket.claimPublicKey,
  };
  if (input.fetcher !== undefined) claimInput.fetcher = input.fetcher;
  const result = await submitSponsoredReadyRefillClaim(claimInput);
  return {
    transactionHash: result.transactionHash,
    noteId: result.noteId,
    exposure,
  };
}

export async function refundStoredVaultRefill(input: {
  wallet: ReadyRefillWallet;
  poolAddress: string;
  helperAddress: string;
  recipient: string;
  stateId: string;
  fetcher?: typeof fetch;
}): Promise<{ transactionHash: string; noteId: string }> {
  const [ticket, chainState] = await Promise.all([
    readVaultRefillTicket(input.stateId),
    readStoredRefillState(input.helperAddress, input.stateId, input.fetcher),
  ]);
  if (chainState === null) {
    throw new Error("This refill has not been funded");
  }
  if (chainState.status !== "funded") {
    throw new Error(`This refill is already ${chainState.status}`);
  }
  if (BigInt(chainState.expiry) >= BigInt(Math.floor(Date.now() / 1_000))) {
    throw new Error("This refill is not refundable until after its expiry");
  }
  if (BigInt(ticket.refundPublicKey) !== BigInt(chainState.refundPublicKey)) {
    throw new Error("The funded refill does not match this vault ticket");
  }
  const refundInput: Parameters<typeof submitReadyRefillRefund>[0] = {
    wallet: input.wallet,
    poolAddress: input.poolAddress,
    helperAddress: input.helperAddress,
    recipient: input.recipient,
    stateId: input.stateId,
    nonce: createRefillReleaseNonce(),
    expiry: chainState.expiry,
    tokenAddress: chainState.tokenAddress,
    amountFri: chainState.amountFri,
    refundPrivateKey: ticket.refundPrivateKey,
    refundPublicKey: ticket.refundPublicKey,
  };
  const result = await submitReadyRefillRefund(refundInput);
  return {
    transactionHash: result.transactionHash,
    noteId: result.noteId,
  };
}
