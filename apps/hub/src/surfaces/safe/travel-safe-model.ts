import type { TravelSafeTicketV3 } from "@wrenchless/canary-core";

import type { TravelSafeV3Snapshot } from "../../lib/travel-safe-state-v3";

export type SafeAssetView = {
  symbol: "STRK" | "USDC";
  tokenAddress: string;
  decimals: 18 | 6;
  /** The private note the wallet reports, or "—" when it could not be read. */
  shieldedBalance: string;
  /** The ordinary balance still in the account, or "—" when unreadable. */
  publicBalance: string;
  /** Everything a plan can draw on: private plus ordinary, unreadable as 0. */
  totalBalance: string;
  hasPublicBalance: boolean;
  returnFeeStrk: string;
  /** Selectable: at least one of the two balances was read. */
  available: boolean;
  shieldedAvailable: boolean;
  publicAvailable: boolean;
};

/**
 * The one ordinary, public transaction the product asks for.
 *
 * Shielding now rides inside the funding transaction, as an ERC-20
 * `transferFrom` the pool performs — a deposit cannot be sent on its own,
 * because the pool refuses a bundle with no nullifier and no random as
 * NO_REPLAY_PROTECTION. What the pool still needs is permission to take the
 * money, and only the account can give that.
 */
export type SafeApprovalStep = {
  purpose: "fund" | "top-up";
  symbol: "STRK" | "USDC";
  tokenAddress: string;
  /** Exactly what the pool is being allowed to take, formatted. */
  amount: string;
  amountBaseUnits: string;
  /** The part being parked or added, formatted; "0" when none of it is. */
  towardAmount: string;
  /** The part that is the action fee, formatted; "0" when none of it is. */
  towardReserve: string;
  topUpAmount: string | null;
  transactionHash: string | null;
  /** Sent by reply or by an allowance that has already appeared onchain. */
  sent: boolean;
};

export type SafePlanDraft = {
  tokenAddress: string;
  parkAmount: string;
  keepAmount: string;
  dailyAmount: string;
  firstReleaseLocal: string;
  returnDateLocal: string;
  mode: "single" | "daily";
};

export type SafeActionState =
  | { name: "idle" }
  | { name: "preparing"; label: string }
  | { name: "wallet"; label: string }
  | { name: "submitted"; transactionHash: string }
  | { name: "confirming"; transactionHash: string }
  | { name: "confirmed"; transactionHash: string | null; label?: string }
  | { name: "failed"; message: string; retryable: boolean };

export type SafeReadinessCheck = {
  id: "wallet" | "passkey" | "setup" | "relay" | "fee" | "balance";
  label: string;
  status: "checking" | "ready" | "blocked";
  detail: string;
};

export type SafeReadiness = {
  status: "checking" | "ready" | "blocked";
  checks: readonly SafeReadinessCheck[];
};

export type SafeRecoveryDrill =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "valid" }
  | { status: "invalid"; message: string };

export type SafeV3Phase =
  | "loading"
  | "device-locked"
  | "empty"
  | "connect"
  | "readiness"
  | "plan"
  | "recovery"
  | "review"
  | "quote"
  | "active"
  | "terminal"
  | "unavailable";

export type TravelSafeV3Model = {
  version: "v3";
  phase: SafeV3Phase;
  walletAccount: string | null;
  assets: readonly SafeAssetView[];
  plan: SafePlanDraft;
  ticket: TravelSafeTicketV3 | null;
  snapshot: TravelSafeV3Snapshot | null;
  nextReleaseAt: string | null;
  readiness: SafeReadiness | null;
  approval: SafeApprovalStep | null;
  recoveryDrill: SafeRecoveryDrill;
  action: SafeActionState;
  recoveryWords: string | null;
  quote: {
    poolFeeFri: string;
    estimatedTransactionFeeFri: string;
    maxSpendFri: string;
  } | null;
  error: string | null;
  live: string | null;
};

export type TravelSafeV3Actions = {
  startCreate(): void;
  closeCreate(): void;
  connect(): Promise<void>;
  checkReadiness(): Promise<void>;
  continueFromReadiness(): void;
  selectAsset(tokenAddress: string): void;
  applyLockPreset(percent: 25 | 50 | 75 | 100): void;
  setPlanField<Field extends keyof SafePlanDraft>(
    field: Field,
    value: SafePlanDraft[Field],
  ): void;
  showRecoveryWords(): Promise<void>;
  setRecoveryWords(words: string): void;
  confirmRecoveryWords(): Promise<void>;
  prepareFund(): Promise<void>;
  /** Send the approval, wait for it, then carry on with what was interrupted. */
  approveNow(): Promise<void>;
  dismissApproval(): void;
  /** Stop waiting on a proof that has not come back. Nothing was sent. */
  cancelPreparation(): void;
  /** Abandon a planned but never funded Safe. Local state only. */
  discardUnfundedSafe(): Promise<void>;
  submitFund(): Promise<void>;
  releaseAvailable(): Promise<void>;
  prepareTopUp(amount: string): Promise<void>;
  submitTopUp(): Promise<void>;
  extendReturnDate(localDate: string): Promise<void>;
  bringBackEarly(words: string): Promise<void>;
  drillRecoveryWords(words: string): Promise<void>;
  resetRecoveryDrill(): void;
  returnNow(): Promise<void>;
  downloadReturnCalendarEvent(): void;
  clearTerminal(): Promise<void>;
  unlock(): Promise<void>;
  refresh(): Promise<void>;
};

export type TravelSafeV3Controller = {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
};
