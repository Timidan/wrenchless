import { formatTokenAmount, jsonValueSchema } from "@wrenchless/canary-core";
import { useCallback, useEffect, useRef, useState } from "react";

import { reasonFrom } from "../../adapters/amount";
import {
  assertSelectedWalletAccount,
  requestWalletAccount,
  type BrowserWallet,
} from "../../adapters/wallet";
import { WRENCHLESS_MAINNET } from "../../lib/product-config";
import {
  assertReadyPrivateContext,
  readReadyPoolFee,
  readReadyShieldedBalances,
} from "../../lib/ready-cover";
import {
  submitTravelSafeClaimEarly,
  type ReadyTravelSafeV3Wallet,
} from "../../lib/ready-travel-safe-v3";
import { readTransactionReceiptStatus } from "../../lib/refill-state";
import { assertPrivateReturnFeeReserve } from "../../lib/travel-safe-action-state";
import {
  inspectTravelSafeV3RescueAuthority,
  inspectTravelSafeV3RescueWords,
  type TravelSafeV3RescueAuthority,
  type TravelSafeV3RescueInspection,
} from "../../lib/travel-safe-rescue-v3";
import { TRAVEL_SAFE_TOKENS } from "../../lib/travel-safe-tokens";
import {
  createOrVerifyTravelSafePasskey,
} from "./travel-safe-device";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
const CONFIRMATION_WINDOW_MILLISECONDS = 5 * 60 * 1_000;

export type TravelSafeRescueSummary = {
  stateId: string;
  tokenSymbol: "STRK" | "USDC";
  amount: string;
  returnAt: string;
  blockNumber: string;
  status: "funded" | "claimed" | "refunded";
};

export type TravelSafeRescuePhase =
  | "entry"
  | "checking"
  | "review"
  | "connecting"
  | "ready"
  | "submitting"
  | "confirming"
  | "complete"
  | "return_open"
  | "failed";

export type TravelSafeRescueController = {
  model: {
    phase: TravelSafeRescuePhase;
    words: string;
    summary: TravelSafeRescueSummary | null;
    account: string | null;
    transactionHash: string | null;
    error: string | null;
    live: string | null;
  };
  actions: {
    setWords(words: string): void;
    inspect(): Promise<void>;
    connect(): Promise<void>;
    submit(): Promise<void>;
    check(): Promise<void>;
    reset(): void;
  };
};

function readyWallet(wallet: BrowserWallet): ReadyTravelSafeV3Wallet {
  return {
    async request(request) {
      return jsonValueSchema.parse(
        await wallet.request({ type: request.type, params: request.params }),
      );
    },
  };
}

function summary(inspection: TravelSafeV3RescueInspection): TravelSafeRescueSummary {
  const state = inspection.snapshot.state;
  if (state === null) throw new Error("The Trip Allowance is not onchain");
  return {
    stateId: state.stateId,
    tokenSymbol: inspection.token.symbol,
    amount: formatTokenAmount(
      BigInt(state.remainingAmount),
      inspection.token.decimals,
    ),
    returnAt: state.returnAt,
    blockNumber: inspection.snapshot.blockNumber,
    status: state.status,
  };
}

async function assertFeeReserve(wallet: BrowserWallet): Promise<void> {
  const [balances, fee] = await Promise.all([
    readReadyShieldedBalances({
      wallet,
      tokens: TRAVEL_SAFE_TOKENS,
      checkContext: false,
    }),
    readReadyPoolFee({
      poolAddress: WRENCHLESS_MAINNET.poolAddress,
      rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
    }),
  ]);
  const strk = balances.find((balance) => balance.token.symbol === "STRK");
  if (strk === undefined) throw new Error("Private STRK balance is unavailable");
  assertPrivateReturnFeeReserve({
    strkAvailable: strk.available,
    shieldedStrkBaseUnits: strk.shieldedBalanceBaseUnits,
    requiredBaseUnits: fee.poolFeeFri,
  });
}

function actionState(inspection: TravelSafeV3RescueInspection) {
  const state = inspection.snapshot.state;
  if (state === null) throw new Error("The Trip Allowance is not onchain");
  return {
    chainId: MAINNET_CHAIN_ID,
    helperAddress: WRENCHLESS_MAINNET.tripAllowanceHelperAddress!,
    stateId: state.stateId,
    nonce: state.nonce,
    tokenAddress: state.tokenAddress,
    remainingAmount: state.remainingAmount,
    firstReleaseAt: state.firstReleaseAt,
    returnAt: state.returnAt,
  };
}

export function useTravelSafeRescueV3(): TravelSafeRescueController {
  const [phase, setPhase] = useState<TravelSafeRescuePhase>("entry");
  const [words, setWords] = useState("");
  const [currentSummary, setSummary] = useState<TravelSafeRescueSummary | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const authority = useRef<TravelSafeV3RescueAuthority | null>(null);
  const inspection = useRef<TravelSafeV3RescueInspection | null>(null);
  const wallet = useRef<BrowserWallet | null>(null);
  const submittedAt = useRef<number | null>(null);

  const inspect = useCallback(async (): Promise<void> => {
    const helperAddress = WRENCHLESS_MAINNET.tripAllowanceHelperAddress;
    const candidateWords = words;
    setWords("");
    setError(null);
    setPhase("checking");
    try {
      if (helperAddress === null) throw new Error("Rescue Mode is not available yet");
      const result = await inspectTravelSafeV3RescueWords({
        words: candidateWords,
        helperAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      authority.current =
        result.availability === "available" ? result.authority : null;
      inspection.current = result;
      setSummary(summary(result));
      setPhase(
        result.availability === "available"
          ? "review"
          : result.availability === "return_open"
            ? "return_open"
            : "complete",
      );
    } catch (cause) {
      authority.current = null;
      inspection.current = null;
      setError(reasonFrom(cause));
      setPhase("failed");
    }
  }, [words]);

  const connect = useCallback(async (): Promise<void> => {
    setError(null);
    setPhase("connecting");
    try {
      const connected = await requestWalletAccount();
      const context = await assertReadyPrivateContext(connected.wallet);
      await assertFeeReserve(connected.wallet);
      await createOrVerifyTravelSafePasskey(context.account);
      wallet.current = connected.wallet;
      setAccount(context.account);
      setPhase("ready");
    } catch (cause) {
      wallet.current = null;
      setAccount(null);
      setError(reasonFrom(cause));
      setPhase("review");
    }
  }, []);

  const check = useCallback(async (): Promise<void> => {
    const savedAuthority = authority.current;
    const hash = transactionHash;
    if (savedAuthority === null || hash === null) return;
    const helperAddress = WRENCHLESS_MAINNET.tripAllowanceHelperAddress;
    if (helperAddress === null) return;
    setLive("Checking Starknet");
    try {
      const fresh = await inspectTravelSafeV3RescueAuthority({
        authority: savedAuthority,
        helperAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      inspection.current = fresh;
      setSummary(summary(fresh));
      if (fresh.snapshot.state?.status !== "funded") {
        authority.current = null;
        submittedAt.current = null;
        setPhase("complete");
        setError(null);
        return;
      }
      const receipt = await readTransactionReceiptStatus({
        transactionHash: hash,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      if (receipt.name === "reverted") {
        setPhase("failed");
        setError(receipt.reason);
      } else if (
        receipt.name === "not-found" &&
        submittedAt.current !== null &&
        Date.now() - submittedAt.current >= CONFIRMATION_WINDOW_MILLISECONDS
      ) {
        setPhase("failed");
        setError("No onchain return was found. Check the words before trying again");
      } else {
        setPhase("confirming");
      }
    } catch {
      setPhase("confirming");
    } finally {
      setLive(null);
    }
  }, [transactionHash]);

  const submit = useCallback(async (): Promise<void> => {
    const savedAuthority = authority.current;
    const currentWallet = wallet.current;
    const expectedAccount = account;
    const helperAddress = WRENCHLESS_MAINNET.tripAllowanceHelperAddress;
    if (
      savedAuthority === null ||
      currentWallet === null ||
      expectedAccount === null ||
      helperAddress === null
    ) {
      setError("Connect the receiving wallet first");
      setPhase("review");
      return;
    }
    setError(null);
    setPhase("submitting");
    try {
      assertSelectedWalletAccount(currentWallet, expectedAccount);
      await assertFeeReserve(currentWallet);
      const fresh = await inspectTravelSafeV3RescueAuthority({
        authority: savedAuthority,
        helperAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      if (fresh.availability !== "available") {
        throw new Error("This Trip Allowance can no longer return early");
      }
      inspection.current = fresh;
      setSummary(summary(fresh));
      const result = await submitTravelSafeClaimEarly({
        wallet: readyWallet(currentWallet),
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        state: actionState(fresh),
        recipient: expectedAccount,
        claimPrivateKey: savedAuthority.claimPrivateKey,
        claimPublicKey: savedAuthority.claimPublicKey,
      });
      setTransactionHash(result.transactionHash);
      submittedAt.current = Date.now();
      setPhase("confirming");
    } catch (cause) {
      try {
        const fresh = await inspectTravelSafeV3RescueAuthority({
          authority: savedAuthority,
          helperAddress,
          rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
        });
        inspection.current = fresh;
        setSummary(summary(fresh));
        if (fresh.snapshot.state?.status !== "funded") {
          authority.current = null;
          submittedAt.current = null;
          setPhase("complete");
          return;
        }
      } catch {
        // Keep the original wallet error; it is the actionable failure.
      }
      setError(reasonFrom(cause));
      setPhase("failed");
    }
  }, [account]);

  useEffect(() => {
    if (phase !== "confirming" || transactionHash === null) return;
    const timer = window.setTimeout(() => void check(), 4_000);
    return () => window.clearTimeout(timer);
  }, [check, phase, transactionHash]);

  return {
    model: {
      phase,
      words,
      summary: currentSummary,
      account,
      transactionHash,
      error,
      live,
    },
    actions: {
      setWords,
      inspect,
      connect,
      submit,
      check,
      reset() {
        authority.current = null;
        inspection.current = null;
        wallet.current = null;
        setWords("");
        setSummary(null);
        setAccount(null);
        setTransactionHash(null);
        submittedAt.current = null;
        setError(null);
        setLive(null);
        setPhase("entry");
      },
    },
  };
}
