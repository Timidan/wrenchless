import {
  normalizeReadyRefillFundArtifact,
  prepareRefillFund,
  submitRefillRefund,
  type PreparedStrk20Call,
  type RefillAction,
  type RefillFundArtifact,
  type SubmittedRefillRefund,
} from "@wrenchless/canary-core";

import {
  submitSponsoredRefillClaim,
  type SubmitSponsoredRefillClaimInput,
} from "./sponsored-refill.js";

const READY_WALLET_API_VERSION = "0.10.3";
const MAINNET_CHAIN_ID = "0x534e5f4d41494e";

export type ReadyRefillWallet = {
  request<T>(request: { type: string; params?: unknown }): Promise<T>;
};

export type PrepareReadyRefillFundInput = {
  wallet: ReadyRefillWallet;
  poolAddress: string;
  helperAddress: string;
  stateId: string;
  claimCommitment: string;
  refundPublicKey: string;
  tokenAddress: string;
  amountFri: string;
  expiry: string;
  now?: Date;
};

export type SubmitReadyRefillRefundInput = {
  wallet: ReadyRefillWallet;
  poolAddress: string;
  helperAddress: string;
  recipient: string;
  stateId: string;
  nonce: string;
  expiry: string;
  tokenAddress: string;
  amountFri: string;
  refundPrivateKey: string;
  refundPublicKey: string;
};

export type SubmitSponsoredReadyRefillClaimInput = Omit<
  SubmitSponsoredRefillClaimInput,
  "fetcher"
> & {
  wallet: ReadyRefillWallet;
  fetcher?: typeof fetch;
};

async function assertReadyRefillCapabilities(
  wallet: ReadyRefillWallet,
): Promise<string> {
  const [chainId, versions] = await Promise.all([
    wallet.request<string>({ type: "wallet_requestChainId" }),
    wallet.request<readonly string[]>({ type: "wallet_supportedWalletApi" }),
  ]);
  if (chainId !== MAINNET_CHAIN_ID) {
    throw new Error("Ready X must be connected to Starknet mainnet");
  }
  if (!versions.includes(READY_WALLET_API_VERSION)) {
    throw new Error(
      `Ready X does not support Wallet API ${READY_WALLET_API_VERSION}`,
    );
  }
  return chainId;
}

export async function prepareReadyRefillFundArtifact(
  input: PrepareReadyRefillFundInput,
): Promise<RefillFundArtifact> {
  await assertReadyRefillCapabilities(input.wallet);
  const result = await prepareRefillFund({
    wallet: {
      async strk20PrepareInvoke(
        actions: RefillAction[],
        simulate = false,
      ): Promise<PreparedStrk20Call> {
        return input.wallet.request<PreparedStrk20Call>({
          type: "wallet_strk20PrepareInvoke",
          params: {
            actions,
            simulate,
            api_version: READY_WALLET_API_VERSION,
          },
        });
      },
    },
    poolAddress: input.poolAddress,
    helperAddress: input.helperAddress,
    stateId: input.stateId,
    claimCommitment: input.claimCommitment,
    refundPublicKey: input.refundPublicKey,
    token: input.tokenAddress,
    amount: input.amountFri,
    expiry: input.expiry,
  });

  return normalizeReadyRefillFundArtifact({
    poolAddress: input.poolAddress,
    helperAddress: input.helperAddress,
    stateId: input.stateId,
    claimCommitment: input.claimCommitment,
    refundPublicKey: input.refundPublicKey,
    tokenAddress: input.tokenAddress,
    amountFri: input.amountFri,
    expiry: input.expiry,
    createdAt: (input.now ?? new Date()).toISOString(),
    prepared: result.prepared,
  });
}

export async function submitReadyRefillRefund(
  input: SubmitReadyRefillRefundInput,
): Promise<SubmittedRefillRefund> {
  const chainId = await assertReadyRefillCapabilities(input.wallet);
  return submitRefillRefund({
    wallet: {
      async strk20PrepareInvoke(actions: RefillAction[], simulate = false) {
        return input.wallet.request<PreparedStrk20Call>({
          type: "wallet_strk20PrepareInvoke",
          params: {
            actions,
            simulate,
            api_version: READY_WALLET_API_VERSION,
          },
        });
      },
      async strk20InvokeTransaction(actions: RefillAction[]) {
        return input.wallet.request<{ transaction_hash: string }>({
          type: "wallet_strk20InvokeTransaction",
          params: {
            actions,
            api_version: READY_WALLET_API_VERSION,
          },
        });
      },
    },
    chainId,
    poolAddress: input.poolAddress,
    helperAddress: input.helperAddress,
    recipient: input.recipient,
    stateId: input.stateId,
    nonce: input.nonce,
    expiry: input.expiry,
    token: input.tokenAddress,
    amount: input.amountFri,
    refundPrivateKey: input.refundPrivateKey,
    refundPublicKey: input.refundPublicKey,
  });
}

export async function submitSponsoredReadyRefillClaim(
  input: SubmitSponsoredReadyRefillClaimInput,
) {
  await assertReadyRefillCapabilities(input.wallet);
  const sponsoredInput: SubmitSponsoredRefillClaimInput = {
    sponsorUrl: input.sponsorUrl,
    helperAddress: input.helperAddress,
    recipient: input.recipient,
    stateId: input.stateId,
    nonce: input.nonce,
    expiry: input.expiry,
    tokenAddress: input.tokenAddress,
    amountFri: input.amountFri,
    claimPrivateKey: input.claimPrivateKey,
    claimPublicKey: input.claimPublicKey,
  };
  if (input.fetcher !== undefined) {
    sponsoredInput.fetcher = input.fetcher;
  }
  return submitSponsoredRefillClaim(sponsoredInput);
}
