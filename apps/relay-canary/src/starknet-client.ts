import type {
  RegistrationCanaryArtifact,
  RegistrationRelayPlan,
} from "@wrenchless/canary-core";
import {
  Account,
  constants,
  isRPC08Plus_ResourceBoundsBN,
  RpcProvider,
  shortString,
  type ResourceBoundsBN,
} from "starknet";

import type {
  RegistrationCanaryClient,
  RelayFeeEstimate,
} from "./inspect.js";

const DRY_RUN_SIGNER = "0x1";
const U128_SHIFT = 128n;
const EXPECTED_SERVER_ACTION_VARIANTS = [
  "WriteOnce",
  "Append",
  "TransferFrom",
  "TransferTo",
  "EmitViewingKeySet",
  "EmitWithdrawal",
  "EmitDeposit",
  "EmitOpenNoteCreated",
  "EmitEncNoteCreated",
  "EmitNoteUsed",
  "Invoke",
  "InvokeWithComputation",
] as const;

type AbiRecord = Record<string, unknown>;

function parseAbi(abi: unknown): unknown[] {
  const parsed = typeof abi === "string" ? JSON.parse(abi) : abi;
  if (!Array.isArray(parsed)) {
    throw new Error("pool class does not expose a Cairo ABI array");
  }
  return parsed;
}

function collectAbiRecords(entries: readonly unknown[]): AbiRecord[] {
  const records: AbiRecord[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as AbiRecord;
    records.push(record);
    if (Array.isArray(record.items)) {
      records.push(...collectAbiRecords(record.items));
    }
  }
  return records;
}

function requireFunction(
  records: readonly AbiRecord[],
  name: string,
  inputCount: number,
): void {
  const entry = records.find(
    (record) => record.type === "function" && record.name === name,
  );
  if (entry === undefined) {
    throw new Error(`pool ABI is missing ${name}`);
  }
  if (!Array.isArray(entry.inputs) || entry.inputs.length !== inputCount) {
    throw new Error(`pool ${name} signature is incompatible`);
  }
}

export function assertPrivacyPoolAbi(abi: unknown): void {
  let records: AbiRecord[];
  try {
    records = collectAbiRecords(parseAbi(abi));
  } catch (error) {
    throw new Error("pool class does not expose a readable Cairo ABI", {
      cause: error,
    });
  }

  requireFunction(records, "apply_actions", 2);
  requireFunction(records, "get_public_key", 1);
  requireFunction(records, "get_fee_amount", 0);
  requireFunction(records, "get_version", 0);
  requireFunction(records, "get_proof_validity_blocks", 0);
  requireFunction(records, "is_paused", 0);

  const serverAction = records.find(
    (record) =>
      record.type === "enum" &&
      typeof record.name === "string" &&
      record.name.endsWith("::ServerAction"),
  );
  if (serverAction === undefined || !Array.isArray(serverAction.variants)) {
    throw new Error("pool ABI is missing the ServerAction enum");
  }
  const actualVariants = serverAction.variants.map((variant) => {
    if (
      variant === null ||
      typeof variant !== "object" ||
      !("name" in variant) ||
      typeof variant.name !== "string"
    ) {
      throw new Error("pool ServerAction enum contains an invalid variant");
    }
    return variant.name;
  });
  if (
    actualVariants.length !== EXPECTED_SERVER_ACTION_VARIANTS.length ||
    actualVariants.some(
      (variant, index) => variant !== EXPECTED_SERVER_ACTION_VARIANTS[index],
    )
  ) {
    throw new Error(
      "pool ServerAction layout does not match the canary decoder",
    );
  }
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

function assertResourceBounds(value: unknown): asserts value is ResourceBoundsBN {
  if (
    value === null ||
    typeof value !== "object" ||
    !isRPC08Plus_ResourceBoundsBN(value as ResourceBoundsBN)
  ) {
    throw new Error("signed estimate returned incompatible resource bounds");
  }
}

export class StarknetRegistrationCanaryClient
  implements RegistrationCanaryClient
{
  private readonly provider: RpcProvider;

  constructor(
    rpcUrl: string,
    private readonly relayAddress: string,
  ) {
    this.provider = new RpcProvider({ nodeUrl: rpcUrl });
  }

  async assertPoolInterface(poolAddress: string): Promise<{
    chainId: "SN_MAIN";
    classHash: string;
  }> {
    const [chainId, classHash] = await Promise.all([
      this.provider.getChainId(),
      this.provider.getClassHashAt(poolAddress, "latest"),
    ]);
    if (chainId !== constants.StarknetChainId.SN_MAIN) {
      throw new Error(`RPC is not Starknet mainnet: ${chainId}`);
    }
    const contractClass = await this.provider.getClassByHash(classHash);
    if (!("abi" in contractClass)) {
      throw new Error("pool class response does not contain an ABI");
    }
    assertPrivacyPoolAbi(contractClass.abi);
    return { chainId: "SN_MAIN", classHash };
  }

  async readPoolVersion(poolAddress: string): Promise<string> {
    const result = await this.provider.callContract(
      { contractAddress: poolAddress, entrypoint: "get_version", calldata: [] },
      "latest",
    );
    const version = parseSingleFelt(result, "get_version");
    try {
      return shortString.decodeShortString(`0x${version.toString(16)}`);
    } catch (error) {
      throw new Error("pool returned an invalid short-string version", {
        cause: error,
      });
    }
  }

  async readLatestBlockNumber(): Promise<bigint> {
    return BigInt(await this.provider.getBlockNumber());
  }

  async readProofValidityBlocks(poolAddress: string): Promise<bigint> {
    return parseSingleFelt(
      await this.provider.callContract(
        {
          contractAddress: poolAddress,
          entrypoint: "get_proof_validity_blocks",
          calldata: [],
        },
        "latest",
      ),
      "get_proof_validity_blocks",
    );
  }

  async readBlockHash(blockNumber: bigint): Promise<string> {
    const block = await this.provider.getBlock(blockNumber);
    if (!("block_hash" in block) || typeof block.block_hash !== "string") {
      throw new Error("RPC returned a block without a canonical hash");
    }
    return block.block_hash;
  }

  async readPoolPaused(poolAddress: string): Promise<boolean> {
    const result = await this.provider.callContract(
      { contractAddress: poolAddress, entrypoint: "is_paused", calldata: [] },
      "latest",
    );
    const value = parseSingleFelt(result, "is_paused");
    if (value !== 0n && value !== 1n) {
      throw new Error("is_paused returned a non-boolean value");
    }
    return value === 1n;
  }

  async readPoolFeeFri(poolAddress: string): Promise<bigint> {
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

  async readCoverPublicKey(
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

  async readRelayBalanceFri(
    strkAddress: string,
    relayAddress: string,
  ): Promise<bigint> {
    return parseU256(
      await this.provider.callContract(
        {
          contractAddress: strkAddress,
          entrypoint: "balance_of",
          calldata: [relayAddress],
        },
        "latest",
      ),
      "STRK balance_of",
    );
  }

  private makeAccount(signer: string): Account {
    return new Account({
      provider: this.provider,
      address: this.relayAddress,
      signer,
    });
  }

  private async estimate(
    plan: RegistrationRelayPlan,
    artifact: RegistrationCanaryArtifact,
    signer: string,
    skipValidate: boolean,
  ): Promise<RelayFeeEstimate> {
    const estimate = await this.makeAccount(signer).estimateInvokeFee(
      plan.calls,
      {
        blockIdentifier: "latest",
        tip: 0n,
        proofFacts: artifact.proofFacts,
        proof: artifact.proof,
        skipValidate,
      },
    );
    return {
      overallFeeFri: estimate.overall_fee,
      resourceBounds: estimate.resourceBounds,
    };
  }

  async estimateUnsigned(
    plan: RegistrationRelayPlan,
    artifact: RegistrationCanaryArtifact,
  ): Promise<RelayFeeEstimate> {
    return this.estimate(plan, artifact, DRY_RUN_SIGNER, true);
  }

  async estimateSigned(
    plan: RegistrationRelayPlan,
    artifact: RegistrationCanaryArtifact,
    privateKey: string,
  ): Promise<RelayFeeEstimate> {
    return this.estimate(plan, artifact, privateKey, false);
  }

  async broadcast(
    plan: RegistrationRelayPlan,
    artifact: RegistrationCanaryArtifact,
    privateKey: string,
    resourceBounds: unknown,
  ): Promise<string> {
    assertResourceBounds(resourceBounds);
    const result = await this.makeAccount(privateKey).execute(plan.calls, {
      tip: 0n,
      proofFacts: artifact.proofFacts,
      proof: artifact.proof,
      resourceBounds,
    });
    return result.transaction_hash;
  }
}
