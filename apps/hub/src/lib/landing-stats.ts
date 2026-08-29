import type { JsonValue } from "@wrenchless/canary-core";
import { z } from "zod";

import { WRENCHLESS_MAINNET } from "./product-config";

const TOTAL_LIABILITY_SELECTOR =
  "0x0136769ae7b737adccb9a12e601673e94dd57b286182e69f4efdbaf81d12b90b";
const LIABILITY_FOR_SELECTOR =
  "0x03483e5a045f4049719e263484a6dd1173ae01fadbc787303faaca61145595f5";
const U128_LIMIT = 1n << 128n;
const RPC_TIMEOUT_MILLISECONDS = 15_000;

const callResultSchema = z.array(z.string()).length(2);
const rpcErrorSchema = z.object({
  error: z.object({ code: z.number(), message: z.string() }),
  id: z.number(),
  jsonrpc: z.literal("2.0"),
});

function u256(result: string[], label: string): bigint {
  const lowValue = result[0];
  const highValue = result[1];
  if (lowValue === undefined || highValue === undefined) {
    throw new Error(`${label} returned an incomplete amount`);
  }
  let low: bigint;
  let high: bigint;
  try {
    low = BigInt(lowValue);
    high = BigInt(highValue);
  } catch {
    throw new Error(`${label} returned an invalid amount`);
  }
  if (low < 0n || low >= U128_LIMIT || high < 0n || high >= U128_LIMIT) {
    throw new Error(`${label} returned an invalid u256`);
  }
  return low + (high << 128n);
}

async function readLiability(input: {
  contractAddress: string;
  selector: string;
  calldata: string[];
  fetcher: typeof fetch;
}): Promise<bigint> {
  const response = await input.fetcher(WRENCHLESS_MAINNET.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "starknet_call",
      params: {
        block_id: "latest",
        request: {
          contract_address: input.contractAddress,
          entry_point_selector: input.selector,
          calldata: input.calldata,
        },
      },
    } satisfies JsonValue),
  });
  if (!response.ok) {
    throw new Error(`Landing statistic returned HTTP ${response.status}`);
  }
  const body = z
    .union([
      z.object({
        id: z.number(),
        jsonrpc: z.literal("2.0"),
        result: callResultSchema,
      }),
      rpcErrorSchema,
    ])
    .parse(await response.json());
  if (!("result" in body)) {
    throw new Error(`Landing statistic failed: ${body.error.message}`);
  }
  return u256(body.result, "Landing statistic");
}

export async function readParkedStrk(fetcher: typeof fetch = fetch): Promise<bigint> {
  const reads = [
    readLiability({
      contractAddress: WRENCHLESS_MAINNET.legacyHelperAddress,
      selector: TOTAL_LIABILITY_SELECTOR,
      calldata: [],
      fetcher,
    }),
  ];
  if (WRENCHLESS_MAINNET.tripAllowanceHelperAddress !== null) {
    reads.push(
      readLiability({
        contractAddress: WRENCHLESS_MAINNET.tripAllowanceHelperAddress,
        selector: LIABILITY_FOR_SELECTOR,
        calldata: [WRENCHLESS_MAINNET.strkTokenAddress],
        fetcher,
      }),
    );
  }
  const liabilities = await Promise.all(reads);
  return liabilities.reduce((total, liability) => total + liability, 0n);
}
