import { constants, RpcError, RpcProvider } from "starknet";

const U128_SHIFT = 128n;
const FRI_PER_STRK = 1_000_000_000_000_000_000n;

export type ReadyNextAction =
  | "fund_and_activate"
  | "activate_account"
  | "fund_registration_fee"
  | "enable_private_tokens"
  | "ready";

export type ReadyStatusInput = {
  accountDeployed: boolean;
  publicStrkBalanceFri: bigint;
  registrationFeeFri: bigint;
  viewingPublicKey: bigint;
};

export type ReadyStatusClient = {
  readChainId(): Promise<string>;
  readAccountDeployed(coverAddress: string): Promise<boolean>;
  readPublicStrkBalanceFri(
    strkAddress: string,
    coverAddress: string,
  ): Promise<bigint>;
  readRegistrationFeeFri(poolAddress: string): Promise<bigint>;
  readViewingPublicKey(
    poolAddress: string,
    coverAddress: string,
  ): Promise<bigint>;
};

export function chooseReadyNextAction(input: ReadyStatusInput): ReadyNextAction {
  if (!input.accountDeployed) {
    return input.publicStrkBalanceFri === 0n
      ? "fund_and_activate"
      : "activate_account";
  }
  if (input.viewingPublicKey !== 0n) {
    return "ready";
  }
  if (input.publicStrkBalanceFri < input.registrationFeeFri) {
    return "fund_registration_fee";
  }
  return "enable_private_tokens";
}

function formatStrk(value: bigint): string {
  const whole = value / FRI_PER_STRK;
  const fraction = (value % FRI_PER_STRK)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/u, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

function parseSingleFelt(result: readonly string[], label: string): bigint {
  if (result.length !== 1 || result[0] === undefined) {
    throw new Error(`${label} returned an incompatible value`);
  }
  return BigInt(result[0]);
}

function parseU256(result: readonly string[], label: string): bigint {
  if (result.length !== 2 || result[0] === undefined || result[1] === undefined) {
    throw new Error(`${label} returned an incompatible u256`);
  }
  return BigInt(result[0]) + (BigInt(result[1]) << U128_SHIFT);
}

function instructionFor(action: ReadyNextAction): string {
  switch (action) {
    case "fund_and_activate":
      return "Fund this address with public STRK, then activate the account in Ready X.";
    case "activate_account":
      return "Activate the account in Ready X before enabling private tokens.";
    case "fund_registration_fee":
      return "Add enough public STRK to cover the privacy registration fee.";
    case "enable_private_tokens":
      return "Open Ready X and choose Enable private tokens for this account.";
    case "ready":
      return "Ready X private tokens are enabled for this account.";
  }
}

export class StarknetReadyStatusClient implements ReadyStatusClient {
  private readonly provider: RpcProvider;

  constructor(rpcUrl: string, provider?: RpcProvider) {
    this.provider = provider ?? new RpcProvider({ nodeUrl: rpcUrl });
  }

  async readChainId(): Promise<string> {
    return this.provider.getChainId();
  }

  async readAccountDeployed(coverAddress: string): Promise<boolean> {
    try {
      await this.provider.getClassHashAt(coverAddress, "latest");
      return true;
    } catch (error) {
      if (error instanceof RpcError && error.isType("CONTRACT_NOT_FOUND")) {
        return false;
      }
      throw error;
    }
  }

  async readPublicStrkBalanceFri(
    strkAddress: string,
    coverAddress: string,
  ): Promise<bigint> {
    return parseU256(
      await this.provider.callContract(
        {
          contractAddress: strkAddress,
          entrypoint: "balance_of",
          calldata: [coverAddress],
        },
        "latest",
      ),
      "STRK balance_of",
    );
  }

  async readRegistrationFeeFri(poolAddress: string): Promise<bigint> {
    return parseSingleFelt(
      await this.provider.callContract(
        {
          contractAddress: poolAddress,
          entrypoint: "get_fee_amount",
          calldata: [],
        },
        "latest",
      ),
      "get_fee_amount",
    );
  }

  async readViewingPublicKey(
    poolAddress: string,
    coverAddress: string,
  ): Promise<bigint> {
    return parseSingleFelt(
      await this.provider.callContract(
        {
          contractAddress: poolAddress,
          entrypoint: "get_public_key",
          calldata: [coverAddress],
        },
        "latest",
      ),
      "get_public_key",
    );
  }
}

type InspectReadyStatusInput = {
  client: ReadyStatusClient;
  coverAddress: string;
  poolAddress: string;
  strkAddress: string;
};

export async function inspectReadyStatus(input: InspectReadyStatusInput) {
  const chainId = await input.client.readChainId();
  if (chainId !== constants.StarknetChainId.SN_MAIN) {
    throw new Error(`RPC is not Starknet mainnet: ${chainId}`);
  }

  const [accountDeployed, publicStrkBalanceFri, registrationFeeFri, viewingPublicKey] =
    await Promise.all([
      input.client.readAccountDeployed(input.coverAddress),
      input.client.readPublicStrkBalanceFri(input.strkAddress, input.coverAddress),
      input.client.readRegistrationFeeFri(input.poolAddress),
      input.client.readViewingPublicKey(input.poolAddress, input.coverAddress),
    ]);
  const registrationFeeShortfallFri =
    publicStrkBalanceFri < registrationFeeFri
      ? registrationFeeFri - publicStrkBalanceFri
      : 0n;
  const nextAction = chooseReadyNextAction({
    accountDeployed,
    publicStrkBalanceFri,
    registrationFeeFri,
    viewingPublicKey,
  });

  return {
    chainId: "SN_MAIN" as const,
    coverAddress: input.coverAddress,
    accountDeployed,
    publicStrkBalanceFri: publicStrkBalanceFri.toString(),
    publicStrkBalance: formatStrk(publicStrkBalanceFri),
    poolAddress: input.poolAddress,
    registrationFeeFri: registrationFeeFri.toString(),
    registrationFee: formatStrk(registrationFeeFri),
    registrationFeeShortfallFri: registrationFeeShortfallFri.toString(),
    registrationFeeShortfall: formatStrk(registrationFeeShortfallFri),
    registered: viewingPublicKey !== 0n,
    viewingPublicKey:
      viewingPublicKey === 0n ? null : `0x${viewingPublicKey.toString(16)}`,
    nextAction,
    instruction: instructionFor(nextAction),
  };
}
