import { jsonValueSchema } from "@wrenchless/canary-core";
import { z } from "zod";

import type { BrowserWallet } from "../adapters/wallet";

const U128_MAX = (1n << 128n) - 1n;
const APPROVE_SELECTOR =
  "0x219209e083275171774dab1df80982e9df2096516f06319c5c6d71ae0a8480c";

const transactionSchema = z.object({
  transaction_hash: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

function canonicalFelt(value: string, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not a Starknet address`);
  }
  if (parsed <= 0n) throw new Error(`${label} is not a Starknet address`);
  return `0x${parsed.toString(16)}`;
}

/**
 * Let the privacy pool take exactly this much of one token, once.
 *
 * This is the only ordinary, public transaction Wrenchless ever asks for, and
 * it exists because shielding rides inside the funding transaction as an
 * ERC-20 `transferFrom` made by the pool. The amount is exact rather than
 * unlimited: an allowance that outlives the transaction it was for is a
 * standing permission nobody asked to keep.
 */
export async function approvePoolSpending(input: {
  wallet: BrowserWallet;
  tokenAddress: string;
  poolAddress: string;
  amountBaseUnits: string;
}): Promise<{ transactionHash: string }> {
  const amount = BigInt(input.amountBaseUnits);
  if (amount <= 0n) throw new Error("Nothing needs approving");
  if (amount > U128_MAX) throw new Error("That amount is too large to approve");
  const result = transactionSchema.parse(
    jsonValueSchema.parse(
      await input.wallet.request({
        type: "wallet_addInvokeTransaction",
        params: {
          calls: [
            {
              contract_address: canonicalFelt(input.tokenAddress, "token address"),
              entry_point: "approve",
              entrypoint: "approve",
              selector: APPROVE_SELECTOR,
              calldata: [
                canonicalFelt(input.poolAddress, "privacy pool"),
                `0x${amount.toString(16)}`,
                "0x0",
              ],
            },
          ],
        },
      }),
    ),
  );
  const hash = BigInt(result.transaction_hash);
  if (hash <= 0n) throw new Error("The wallet returned an invalid transaction");
  return { transactionHash: `0x${hash.toString(16)}` };
}
