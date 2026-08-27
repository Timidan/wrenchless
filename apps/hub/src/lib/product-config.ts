const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;

function optionalAddress(name: string, configured: string | undefined): string | null {
  const value = configured?.trim();
  if (!value) return null;
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${name} must be a Starknet address`);
  }
  if (parsed <= 0n || parsed >= STARK_FIELD_PRIME) {
    throw new Error(`${name} must be a non-zero Starknet address`);
  }
  return `0x${parsed.toString(16)}`;
}

const LEGACY_TRAVEL_SAFE_HELPER =
  "0x018f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a";

export const WRENCHLESS_MAINNET = {
  chainId: "0x534e5f4d41494e",
  rpcUrl: "https://api.cartridge.gg/x/starknet/mainnet",
  poolAddress:
    "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  legacyHelperAddress: LEGACY_TRAVEL_SAFE_HELPER,
  tripAllowanceHelperAddress: optionalAddress(
    "VITE_TRAVEL_SAFE_V3_HELPER_ADDRESS",
    import.meta.env.VITE_TRAVEL_SAFE_V3_HELPER_ADDRESS,
  ),
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
