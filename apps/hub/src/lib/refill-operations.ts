import {
  chooseTravelSafeRelease,
  deriveTravelSafeSecrets,
  type TravelSafeTicket,
} from "@wrenchless/canary-core";

import {
  prepareReadyRefillFundArtifact,
  submitReadyRefillClaim,
  submitReadyRefillRefund,
  type ReadyRefillWallet,
} from "./ready-refill.js";
import type { TravelSafeReadiness } from "./ready-private-setup.js";
import {
  readRefillChainSnapshot,
  readRefillProofExpiryBlock,
  type RefillChainSnapshot,
  type RefillChainState,
} from "./refill-state.js";
import {
  transitionStoredTravelSafeTicket,
} from "./refill-ticket.js";
import {
  RelayedRefillFundError,
  submitRelayedRefillFund,
} from "./relayed-refill.js";
import {
  createTravelSafeReleaseNonce,
  sameFelt,
  validateTravelSafeAmount,
  validateTravelSafeReturnDate,
} from "./travel-safe.js";

type SelectedReadyWallet = ReadyRefillWallet & { selectedAddress?: string };

function assertDestination(wallet: SelectedReadyWallet, account: string): void {
  if (wallet.selectedAddress === undefined || !sameFelt(wallet.selectedAddress, account)) {
    throw new Error("The selected Ready account changed. Review the destination again");
  }
}

function assertTicketMatchesState(
  ticket: TravelSafeTicket,
  state: RefillChainState,
): void {
  if (
    !sameFelt(ticket.stateId, state.stateId) ||
    !sameFelt(ticket.claimCommitment, state.claimCommitment) ||
    !sameFelt(ticket.refundPublicKey, state.refundPublicKey) ||
    !sameFelt(ticket.tokenAddress, state.tokenAddress) ||
    BigInt(ticket.amountFri) !== BigInt(state.amountFri) ||
    BigInt(ticket.returnDateSeconds) !== BigInt(state.returnDateSeconds)
  ) {
    throw new Error("The onchain Travel Safe does not match this device ticket");
  }
}

async function snapshot(input: {
  helperAddress: string;
  stateId: string;
  rpcUrl: string | undefined;
  fetcher: typeof fetch | undefined;
}): Promise<RefillChainSnapshot> {
  const request: Parameters<typeof readRefillChainSnapshot>[0] = {
    helperAddress: input.helperAddress,
    stateId: input.stateId,
  };
  if (input.rpcUrl !== undefined) request.rpcUrl = input.rpcUrl;
  if (input.fetcher !== undefined) request.fetcher = input.fetcher;
  return readRefillChainSnapshot(request);
}

export async function fundTravelSafe(input: {
  wallet: SelectedReadyWallet;
  readiness: TravelSafeReadiness;
  ticket: TravelSafeTicket;
  poolAddress: string;
  helperAddress: string;
  sponsorUrl: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<{ transactionHash: string; final: boolean }> {
  assertDestination(input.wallet, input.readiness.account);
  validateTravelSafeAmount(input.ticket.amountFri, input.readiness);
  const current = await snapshot({
    helperAddress: input.helperAddress,
    stateId: input.ticket.stateId,
    rpcUrl: input.rpcUrl,
    fetcher: input.fetcher,
  });
  validateTravelSafeReturnDate(
    input.ticket.returnDateSeconds,
    current.chainTimeSeconds,
  );
  if (current.state !== null) {
    throw new Error("This Travel Safe state already exists onchain");
  }

  const artifact = await prepareReadyRefillFundArtifact({
    wallet: input.wallet,
    poolAddress: input.poolAddress,
    helperAddress: input.helperAddress,
    stateId: input.ticket.stateId,
    claimCommitment: input.ticket.claimCommitment,
    refundPublicKey: input.ticket.refundPublicKey,
    tokenAddress: input.ticket.tokenAddress,
    amountFri: input.ticket.amountFri,
    returnDateSeconds: input.ticket.returnDateSeconds,
  });
  const proofExpiryRequest: Parameters<typeof readRefillProofExpiryBlock>[0] = {
    poolAddress: input.poolAddress,
    proofFacts: artifact.proofFacts,
  };
  if (input.rpcUrl !== undefined) proofExpiryRequest.rpcUrl = input.rpcUrl;
  if (input.fetcher !== undefined) proofExpiryRequest.fetcher = input.fetcher;
  const proofExpiresAtBlock = await readRefillProofExpiryBlock(
    proofExpiryRequest,
  );

  await transitionStoredTravelSafeTicket(
    input.ticket.stateId,
    "FUND_SUBMITTING",
    { fundProofExpiresAtBlock: proofExpiresAtBlock },
  );

  let result;
  try {
    const request: Parameters<typeof submitRelayedRefillFund>[0] = {
      sponsorUrl: input.sponsorUrl,
      artifact,
    };
    if (input.fetcher !== undefined) request.fetcher = input.fetcher;
    result = await submitRelayedRefillFund(request);
  } catch (error) {
    if (error instanceof RelayedRefillFundError && !error.ambiguous) {
      await transitionStoredTravelSafeTicket(
        input.ticket.stateId,
        "PHRASE_CONFIRMED",
        {
          fundProofExpiresAtBlock: null,
          fundTransactionHash: null,
        },
      );
    }
    throw error;
  }
  await transitionStoredTravelSafeTicket(
    input.ticket.stateId,
    "FUND_SUBMITTING",
    { fundTransactionHash: result.transactionHash },
  );
  return {
    transactionHash: result.transactionHash,
    final: result.status === "finalized",
  };
}

export async function returnTravelSafe(input: {
  wallet: SelectedReadyWallet;
  recipient: string;
  ticket: TravelSafeTicket;
  poolAddress: string;
  helperAddress: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<{ transactionHash: string; noteId: string }> {
  assertDestination(input.wallet, input.recipient);
  const current = await snapshot({
    helperAddress: input.helperAddress,
    stateId: input.ticket.stateId,
    rpcUrl: input.rpcUrl,
    fetcher: input.fetcher,
  });
  if (current.state === null) throw new Error("This Travel Safe was not funded");
  assertTicketMatchesState(input.ticket, current.state);
  if (current.state.status !== "funded") {
    await transitionStoredTravelSafeTicket(input.ticket.stateId, "TERMINAL");
    throw new Error(`This Travel Safe is already ${current.state.status}`);
  }
  if (
    chooseTravelSafeRelease(
      current.state.returnDateSeconds,
      current.chainTimeSeconds,
    ) !== "refund"
  ) {
    throw new Error("This Travel Safe cannot return before its return date");
  }

  await transitionStoredTravelSafeTicket(
    input.ticket.stateId,
    "RETURN_SUBMITTING",
  );
  const result = await submitReadyRefillRefund({
    wallet: input.wallet,
    poolAddress: input.poolAddress,
    helperAddress: input.helperAddress,
    recipient: input.recipient,
    stateId: current.state.stateId,
    nonce: createTravelSafeReleaseNonce(),
    returnDateSeconds: current.state.returnDateSeconds,
    tokenAddress: current.state.tokenAddress,
    amountFri: current.state.amountFri,
    refundPrivateKey: input.ticket.refundPrivateKey,
    refundPublicKey: input.ticket.refundPublicKey,
  });
  await transitionStoredTravelSafeTicket(
    input.ticket.stateId,
    "RETURN_SUBMITTING",
    { returnTransactionHash: result.transactionHash },
  );
  const submittedAt = await snapshot({
    helperAddress: input.helperAddress,
    stateId: input.ticket.stateId,
    rpcUrl: input.rpcUrl,
    fetcher: input.fetcher,
  });
  await transitionStoredTravelSafeTicket(
    input.ticket.stateId,
    "RETURN_SUBMITTING",
    { returnSubmittedAtBlock: submittedAt.blockNumber },
  );
  return { transactionHash: result.transactionHash, noteId: result.noteId };
}

export type TravelSafeRecoveryResult =
  | { kind: "already-claimed" | "already-refunded"; snapshot: RefillChainSnapshot }
  | {
      kind: "submitted";
      release: "claim" | "refund";
      snapshot: RefillChainSnapshot;
      transactionHash: string;
      noteId: string;
    }
  | {
      kind: "claimed" | "refunded";
      snapshot: RefillChainSnapshot;
      transactionHash: string;
      noteId: string;
    };

export async function recoverTravelSafe(input: {
  phrase: string;
  wallet: SelectedReadyWallet;
  recipient: string;
  poolAddress: string;
  helperAddress: string;
  tokenAddress: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<TravelSafeRecoveryResult> {
  assertDestination(input.wallet, input.recipient);
  const secrets = await deriveTravelSafeSecrets(input.phrase);
  const current = await snapshot({
    helperAddress: input.helperAddress,
    stateId: secrets.stateId,
    rpcUrl: input.rpcUrl,
    fetcher: input.fetcher,
  });
  const state = current.state;
  if (state === null) {
    throw new Error("No funded Travel Safe matches those words");
  }
  if (
    !sameFelt(state.claimCommitment, secrets.claimCommitment) ||
    !sameFelt(state.refundPublicKey, secrets.refundPublicKey) ||
    !sameFelt(state.tokenAddress, input.tokenAddress)
  ) {
    throw new Error("No funded Travel Safe matches those words");
  }
  if (state.status === "claimed") return { kind: "already-claimed", snapshot: current };
  if (state.status === "refunded") return { kind: "already-refunded", snapshot: current };

  const release = chooseTravelSafeRelease(
    state.returnDateSeconds,
    current.chainTimeSeconds,
  );
  const nonce = createTravelSafeReleaseNonce();
  if (release === "claim") {
    const result = await submitReadyRefillClaim({
      wallet: input.wallet,
      poolAddress: input.poolAddress,
      helperAddress: input.helperAddress,
      recipient: input.recipient,
      stateId: state.stateId,
      nonce,
      returnDateSeconds: state.returnDateSeconds,
      tokenAddress: state.tokenAddress,
      amountFri: state.amountFri,
      claimPrivateKey: secrets.claimPrivateKey,
      claimPublicKey: secrets.claimPublicKey,
    });
    return {
      kind: "submitted",
      release: "claim",
      snapshot: current,
      transactionHash: result.transactionHash,
      noteId: result.noteId,
    };
  }
  const result = await submitReadyRefillRefund({
    wallet: input.wallet,
    poolAddress: input.poolAddress,
    helperAddress: input.helperAddress,
    recipient: input.recipient,
    stateId: state.stateId,
    nonce,
    returnDateSeconds: state.returnDateSeconds,
    tokenAddress: state.tokenAddress,
    amountFri: state.amountFri,
    refundPrivateKey: secrets.refundPrivateKey,
    refundPublicKey: secrets.refundPublicKey,
  });
  return {
    kind: "submitted",
    release: "refund",
    snapshot: current,
    transactionHash: result.transactionHash,
    noteId: result.noteId,
  };
}
