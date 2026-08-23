export const WRENCHLESS_MAINNET = {
  chainId: "0x534e5f4d41494e",
  rpcUrl: "https://api.cartridge.gg/x/starknet/mainnet",
  poolAddress:
    "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  helperAddress:
    "0x026ce951b858934b1ad832be2f93a102b9bf42deb5b824204278ed72b45fa828",
  strkTokenAddress:
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
} as const;

function serviceUrl(name: string, configured: string | undefined, developmentUrl: string): string {
  const value = configured?.trim() || developmentUrl;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP(S)`);
  }
  if (!import.meta.env.DEV && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS outside local development`);
  }
  return url.toString().replace(/\/$/, "");
}

export const WRENCHLESS_SERVICES = {
  mailboxUrl: serviceUrl(
    "VITE_MAILBOX_URL",
    import.meta.env.VITE_MAILBOX_URL,
    "http://localhost:8787",
  ),
  sponsorUrl: serviceUrl(
    "VITE_SPONSOR_URL",
    import.meta.env.VITE_SPONSOR_URL,
    "http://localhost:8788",
  ),
} as const;

/**
 * The one product threshold the carried wallet reads.
 *
 * "Running low" has to be a ratio rather than a figure, because the limit is
 * the person's own and a fixed number would be wrong for most of them. Two
 * fifths is where a wallet stops being able to cover an ordinary day's spending
 * without thinking about it.
 */
export const WRENCHLESS_PRODUCT = {
  lowBalanceRatio: 0.4,
} as const;
