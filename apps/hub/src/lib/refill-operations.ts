import {
  chooseTravelSafeRelease,
  computeRefillRecoveryCommitment,
  deriveTravelSafeSecrets,
  type TravelSafeSecrets,
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
  estimateRelayedRefillFund,
  RelayedRefillFundError,
  submitRelayedRefillFund,
  type RelayedRefillFundEstimate,
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
  secrets: TravelSafeSecrets,
  state: RefillChainState,
): void {
  if (
    !sameFelt(ticket.stateId, state.stateId) ||
    !sameFelt(secrets.claimCommitment, state.claimCommitment) ||
    !sameFelt(
      computeRefillRecoveryCommitment(
        ticket.stateId,
        ticket.recoveryAccount,
        secrets.recoverySalt,
      ),
      state.recoveryCommitment,
    ) ||
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

export type PreparedTravelSafeFund = {
  artifact: Awaited<ReturnType<typeof prepareReadyRefillFundArtifact>>;
  estimate: RelayedRefillFundEstimate;
  proofExpiresAtBlock: string;
};

export async function prepareTravelSafeFund(input: {
  wallet: SelectedReadyWallet;
  readiness: TravelSafeReadiness;
  ticket: TravelSafeTicket;
  poolAddress: string;
  helperAddress: string;
  sponsorUrl: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<PreparedTravelSafeFund> {
  assertDestination(input.wallet, input.readiness.account);
  if (!sameFelt(input.ticket.recoveryAccount, input.readiness.account)) {
    throw new Error("Use the Ready account chosen for this Travel Safe");
  }
  const secrets = await deriveTravelSafeSecrets(input.ticket.recoveryPhrase);
  if (!sameFelt(secrets.stateId, input.ticket.stateId)) {
    throw new Error("This device's Travel Safe secret does not match its ticket");
  }
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
    claimCommitment: secrets.claimCommitment,
    recoveryCommitment: computeRefillRecoveryCommitment(
      input.ticket.stateId,
      input.ticket.recoveryAccount,
      secrets.recoverySalt,
    ),
    recoveryAccount: input.ticket.recoveryAccount,
    recoverySalt: secrets.recoverySalt,
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

  const estimateRequest: Parameters<typeof estimateRelayedRefillFund>[0] = {
    sponsorUrl: input.sponsorUrl,
    artifact,
  };
  if (input.fetcher !== undefined) estimateRequest.fetcher = input.fetcher;
  const estimate = await estimateRelayedRefillFund(estimateRequest);
  return { artifact, estimate, proofExpiresAtBlock };
}

export async function submitPreparedTravelSafeFund(input: {
  wallet: SelectedReadyWallet;
  readiness: TravelSafeReadiness;
  ticket: TravelSafeTicket;
  prepared: PreparedTravelSafeFund;
  helperAddress: string;
  sponsorUrl: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<{ transactionHash: string; final: boolean }> {
  assertDestination(input.wallet, input.readiness.account);
  if (!sameFelt(input.ticket.recoveryAccount, input.readiness.account)) {
    throw new Error("Use the Ready account chosen for this Travel Safe");
  }
  const artifact = input.prepared.artifact;
  if (
    !sameFelt(artifact.stateId, input.ticket.stateId) ||
    !sameFelt(artifact.recoveryAccount, input.ticket.recoveryAccount) ||
    !sameFelt(artifact.tokenAddress, input.ticket.tokenAddress) ||
    BigInt(artifact.amountFri) !== BigInt(input.ticket.amountFri) ||
    BigInt(artifact.expiry) !== BigInt(input.ticket.returnDateSeconds)
  ) {
    throw new Error("The prepared cost does not match this Travel Safe");
  }
  const current = await snapshot({
    helperAddress: input.helperAddress,
    stateId: input.ticket.stateId,
    rpcUrl: input.rpcUrl,
    fetcher: input.fetcher,
  });
  if (current.state !== null) {
    throw new Error("This Travel Safe state already exists onchain");
  }

  await transitionStoredTravelSafeTicket(
    input.ticket.stateId,
    "FUND_SUBMITTING",
    { fundProofExpiresAtBlock: input.prepared.proofExpiresAtBlock },
  );

  let result;
  try {
    const request: Parameters<typeof submitRelayedRefillFund>[0] = {
      sponsorUrl: input.sponsorUrl,
      artifact,
      acceptedMaxSpendFri: input.prepared.estimate.summary.maxSpendFri,
    };
    if (input.fetcher !== undefined) request.fetcher = input.fetcher;
    result = await submitRelayedRefillFund(request);
  } catch (error) {
    if (error instanceof RelayedRefillFundError && !error.ambiguous) {
      await transitionStoredTravelSafeTicket(
        input.ticket.stateId,
        "READY",
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
  if (!sameFelt(input.ticket.recoveryAccount, input.recipient)) {
    throw new Error("Use the Ready account chosen for this Travel Safe");
  }
  const secrets = await deriveTravelSafeSecrets(input.ticket.recoveryPhrase);
  if (!sameFelt(secrets.stateId, input.ticket.stateId)) {
    throw new Error("This device's Travel Safe secret does not match its ticket");
  }
  const current = await snapshot({
    helperAddress: input.helperAddress,
    stateId: input.ticket.stateId,
    rpcUrl: input.rpcUrl,
    fetcher: input.fetcher,
  });
  if (current.state === null) throw new Error("This Travel Safe was not funded");
  assertTicketMatchesState(input.ticket, secrets, current.state);
  if (current.state.status !== "funded") {
    await transitionStoredTravelSafeTicket(input.ticket.stateId, "TERMINAL");
    throw new Error(`This Travel Safe is already ${current.state.status}`);
  }
  const release = chooseTravelSafeRelease(
    current.state.returnDateSeconds,
    current.chainTimeSeconds,
  );

  await transitionStoredTravelSafeTicket(
    input.ticket.stateId,
    "RETURN_SUBMITTING",
  );
  const result =
    release === "claim"
      ? await submitReadyRefillClaim({
          wallet: input.wallet,
          poolAddress: input.poolAddress,
          helperAddress: input.helperAddress,
          recipient: input.recipient,
          stateId: current.state.stateId,
          nonce: createTravelSafeReleaseNonce(),
          returnDateSeconds: current.state.returnDateSeconds,
          tokenAddress: current.state.tokenAddress,
          amountFri: current.state.amountFri,
          claimPrivateKey: secrets.claimPrivateKey,
          claimPublicKey: secrets.claimPublicKey,
        })
      : await submitReadyRefillRefund({
          wallet: input.wallet,
          poolAddress: input.poolAddress,
          helperAddress: input.helperAddress,
          recipient: input.recipient,
          stateId: current.state.stateId,
          returnDateSeconds: current.state.returnDateSeconds,
          tokenAddress: current.state.tokenAddress,
          amountFri: current.state.amountFri,
          recoveryAccount: input.ticket.recoveryAccount,
          recoverySalt: secrets.recoverySalt,
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

export async function returnRecoveredTravelSafe(input: {
  wallet: SelectedReadyWallet;
  recipient: string;
  stateId: string;
  recoverySalt: string;
  poolAddress: string;
  helperAddress: string;
  tokenAddress: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<{ transactionHash: string; noteId: string; amountFri: string }> {
  assertDestination(input.wallet, input.recipient);
  const current = await snapshot({
    helperAddress: input.helperAddress,
    stateId: input.stateId,
    rpcUrl: input.rpcUrl,
    fetcher: input.fetcher,
  });
  const state = current.state;
  if (state === null || !sameFelt(state.tokenAddress, input.tokenAddress)) {
    throw new Error("No Travel Safe was found for this Ready account");
  }
  if (
    !sameFelt(
      state.recoveryCommitment,
      computeRefillRecoveryCommitment(
        state.stateId,
        input.recipient,
        input.recoverySalt,
      ),
    )
  ) {
    throw new Error("This Ready account cannot recover that Travel Safe");
  }
  if (state.status !== "funded") {
    throw new Error("This Travel Safe has already returned");
  }
  if (
    chooseTravelSafeRelease(
      state.returnDateSeconds,
      current.chainTimeSeconds,
    ) !== "refund"
  ) {
    throw new Error("This Travel Safe can be recovered with Ready after its return date");
  }
  const result = await submitReadyRefillRefund({
    wallet: input.wallet,
    poolAddress: input.poolAddress,
    helperAddress: input.helperAddress,
    recipient: input.recipient,
    stateId: state.stateId,
    returnDateSeconds: state.returnDateSeconds,
    tokenAddress: state.tokenAddress,
    amountFri: state.amountFri,
    recoveryAccount: input.recipient,
    recoverySalt: input.recoverySalt,
  });
  return {
    transactionHash: result.transactionHash,
    noteId: result.noteId,
    amountFri: state.amountFri,
  };
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
    !sameFelt(
      state.recoveryCommitment,
      computeRefillRecoveryCommitment(
        secrets.stateId,
        input.recipient,
        secrets.recoverySalt,
      ),
    ) ||
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
    returnDateSeconds: state.returnDateSeconds,
    tokenAddress: state.tokenAddress,
    amountFri: state.amountFri,
    recoveryAccount: input.recipient,
    recoverySalt: secrets.recoverySalt,
  });
  return {
    kind: "submitted",
    release: "refund",
    snapshot: current,
    transactionHash: result.transactionHash,
    noteId: result.noteId,
  };
}
