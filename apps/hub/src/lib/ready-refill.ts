import {
  createRecoveryRegistrationTypedData,
  normalizeReadyRefillFundArtifact,
  prepareRefillFund,
  submitRefillClaim,
  submitRefillRefund,
  type PreparedStrk20Call,
  type RefillAction,
  type RefillFundArtifact,
  type SubmittedRefillRefund,
} from "@wrenchless/canary-core";

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
  recoveryCommitment: string;
  recoveryAccount: string;
  recoverySalt: string;
  tokenAddress: string;
  amountFri: string;
  returnDateSeconds: string;
  now?: Date;
  onStage?: (stage: "proof" | "recovery") => void;
};

export type SubmitReadyRefillRefundInput = {
  wallet: ReadyRefillWallet;
  poolAddress: string;
  helperAddress: string;
  recipient: string;
  stateId: string;
  returnDateSeconds: string;
  tokenAddress: string;
  amountFri: string;
  recoveryAccount: string;
  recoverySalt: string;
};

export type SubmitReadyRefillClaimInput = {
  wallet: ReadyRefillWallet;
  poolAddress: string;
  helperAddress: string;
  recipient: string;
  stateId: string;
  nonce: string;
  returnDateSeconds: string;
  tokenAddress: string;
  amountFri: string;
  claimPrivateKey: string;
  claimPublicKey: string;
};

async function assertReadyRefillCapabilities(
  wallet: ReadyRefillWallet,
): Promise<string> {
  const [chainId, versions] = await Promise.all([
    wallet.request<string>({ type: "wallet_requestChainId" }),
    wallet.request<readonly string[]>({ type: "wallet_supportedWalletApi" }),
  ]);
  if (chainId !== MAINNET_CHAIN_ID) {
    throw new Error("Switch the wallet to Starknet mainnet");
  }
  if (!versions.includes(READY_WALLET_API_VERSION)) {
    throw new Error("This wallet does not support private actions");
  }
  return chainId;
}

export async function prepareReadyRefillFundArtifact(
  input: PrepareReadyRefillFundInput,
): Promise<RefillFundArtifact> {
  const chainId = await assertReadyRefillCapabilities(input.wallet);
  input.onStage?.("proof");
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
    recoveryCommitment: input.recoveryCommitment,
    recoveryAccount: input.recoveryAccount,
    recoverySalt: input.recoverySalt,
    token: input.tokenAddress,
    amount: input.amountFri,
    expiry: input.returnDateSeconds,
  });
  input.onStage?.("recovery");
  const recoveryAuthorization = await input.wallet.request<string[]>({
    type: "wallet_signTypedData",
    params: {
      ...createRecoveryRegistrationTypedData({
        chainId,
        recoveryAccount: input.recoveryAccount,
        helperAddress: input.helperAddress,
        stateId: input.stateId,
        claimCommitment: input.claimCommitment,
        recoveryCommitment: input.recoveryCommitment,
        tokenAddress: input.tokenAddress,
        amountFri: input.amountFri,
        expiry: input.returnDateSeconds,
      }),
      api_version: READY_WALLET_API_VERSION,
    },
  });

  return normalizeReadyRefillFundArtifact({
    poolAddress: input.poolAddress,
    helperAddress: input.helperAddress,
    stateId: input.stateId,
    claimCommitment: input.claimCommitment,
    recoveryCommitment: input.recoveryCommitment,
    recoveryAccount: input.recoveryAccount,
    recoverySalt: input.recoverySalt,
    recoveryAuthorization,
    tokenAddress: input.tokenAddress,
    amountFri: input.amountFri,
    expiry: input.returnDateSeconds,
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
      async signTypedData(data) {
        return input.wallet.request<string[]>({
          type: "wallet_signTypedData",
          params: {
            ...data,
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
    expiry: input.returnDateSeconds,
    token: input.tokenAddress,
    amount: input.amountFri,
    recoveryAccount: input.recoveryAccount,
    recoverySalt: input.recoverySalt,
  });
}

export async function submitReadyRefillClaim(
  input: SubmitReadyRefillClaimInput,
) {
  const chainId = await assertReadyRefillCapabilities(input.wallet);
  return submitRefillClaim({
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
    expiry: input.returnDateSeconds,
    token: input.tokenAddress,
    amount: input.amountFri,
    claimPrivateKey: input.claimPrivateKey,
    claimPublicKey: input.claimPublicKey,
  });
}
