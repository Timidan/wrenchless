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

export type SafeShieldDeposit = {
  symbol: "STRK" | "USDC";
  tokenAddress: string;
  decimals: 18 | 6;
  amount: string;
  amountBaseUnits: string;
};

/**
 * The wallet-signed shield that must land before a FUND or TOP_UP can be
 * proven: ordinary balances moving into the private pool, one deposit per
 * token that falls short. `transactionHash` is set once the wallet has sent
 * it, so a retry waits on that transaction instead of asking for a second.
 */
export type SafeShieldStep = {
  purpose: "fund" | "top-up" | "action";
  tokenAddress: string;
  amountBaseUnits: string;
  topUpAmount: string | null;
  deposits: readonly SafeShieldDeposit[];
  transactionHash: string | null;
  /**
   * The deposit has left the wallet — proved either by the wallet's reply or
   * by the account's own balance falling on mainnet. Once true the step never
   * sends again; pressing it only checks. A wallet that goes quiet after the
   * user approves must not cost them a second deposit.
   */
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
  shield: SafeShieldStep | null;
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
  shieldNow(): Promise<void>;
  dismissShield(): void;
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
