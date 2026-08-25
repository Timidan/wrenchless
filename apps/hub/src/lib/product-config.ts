export const WRENCHLESS_MAINNET = {
  chainId: "0x534e5f4d41494e",
  rpcUrl: "https://api.cartridge.gg/x/starknet/mainnet",
  poolAddress:
    "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  helperAddress:
    "0x018f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a",
  strkTokenAddress:
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
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
  sponsorUrl: serviceUrl(
    "VITE_SPONSOR_URL",
    import.meta.env.VITE_SPONSOR_URL,
    "http://localhost:8788",
  ),
} as const;
