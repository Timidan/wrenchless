import { z } from "zod";

import {
  assertSelectedWalletAccount,
  type BrowserWallet,
} from "../../adapters/wallet";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
const READY_WALLET_API_VERSION = "0.10.3";
const signatureSchema = z
  .array(z.string().regex(/^0x[0-9a-fA-F]+$/))
  .min(1);

export function selectTravelSafeDeviceAccess(
  passkeysAvailable: boolean,
): "passkey" | "wallet" {
  return passkeysAvailable ? "passkey" : "wallet";
}

function canonicalAccount(value: string): string {
  let account: bigint;
  try {
    account = BigInt(value);
  } catch {
    throw new Error("The wallet returned an invalid account");
  }
  if (account <= 0n) throw new Error("The wallet returned an invalid account");
  return `0x${account.toString(16)}`;
}

function randomChallenge(): string {
  let challenge = 0n;
  while (challenge === 0n) {
    const bytes = crypto.getRandomValues(new Uint8Array(31));
    challenge = BigInt(
      `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    );
  }
  return `0x${challenge.toString(16)}`;
}

/**
 * Use the wallet's own confirmation screen when an embedded browser does not
 * expose WebAuthn. The signature is deliberately not stored or used as key
 * material; it proves a fresh confirmation before the local non-extractable
 * ticket key is opened.
 */
export async function confirmTravelSafeWalletAccess(
  wallet: BrowserWallet,
  expectedAccount: string,
): Promise<string> {
  const account = canonicalAccount(expectedAccount);
  assertSelectedWalletAccount(wallet, account);
  const chainId = await wallet.request<string>({
    type: "wallet_requestChainId",
  });
  if (chainId !== MAINNET_CHAIN_ID) {
    throw new Error("Switch the wallet to Starknet mainnet");
  }
  signatureSchema.parse(
    await wallet.request<unknown>({
      type: "wallet_signTypedData",
      params: {
        types: {
          StarknetDomain: [
            { name: "name", type: "shortstring" },
            { name: "version", type: "shortstring" },
            { name: "chainId", type: "shortstring" },
            { name: "revision", type: "shortstring" },
          ],
          TravelSafeAccess: [
            { name: "account", type: "ContractAddress" },
            { name: "challenge", type: "felt" },
          ],
        },
        primaryType: "TravelSafeAccess",
        domain: {
          name: "Wrenchless",
          version: "1",
          chainId,
          revision: "1",
        },
        message: {
          account,
          challenge: randomChallenge(),
        },
        api_version: READY_WALLET_API_VERSION,
      },
    }),
  );
  return account;
}
