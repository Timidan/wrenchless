import { describe, expect, it } from "vitest";

import {
  assertPrivacyPoolAbi,
  assertRefillFundFinality,
  assertRegistrationFinality,
  StarknetRegistrationCanaryClient,
} from "./starknet-client.js";
import { RefillFundExecutionFailedError } from "./refill-inspect.js";

const POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const COVER = "0x123";
const RELAY = "0x789";
const VIEWING_PUBLIC_KEY = "0x111";
const TRANSACTION_HASH = "0xabc";
const VIEWING_KEY_SET_SELECTOR =
  "0x1321a492485b4f19851fb787ab3800a0030b595332cba93cd5fe40dfb5a4daf";
const REFILL_FUNDED_SELECTOR =
  "0x01d15bc8a081b7ee52a206bae640e41d99118e0266d5ad8efe94cb47d919de2a";

type AbiInput = { name: string };
type AbiFunction = {
  type: "function";
  name: string;
  inputs: AbiInput[];
};
type AbiInterface = {
  type: "interface";
  name: string;
  items: AbiFunction[];
};
type AbiVariant = { name: string; type: string };
type AbiEnum = {
  type: "enum";
  name: string;
  variants: AbiVariant[];
};
type AbiFixture = [AbiInterface, AbiEnum];

const SERVER_ACTION_VARIANTS = [
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
];

const validAbi: AbiFixture = [
  {
    type: "interface",
    name: "privacy::interface::IPrivacy",
    items: [
      {
        type: "function",
        name: "apply_actions",
        inputs: [{ name: "actions" }, { name: "proof" }],
      },
      {
        type: "function",
        name: "get_public_key",
        inputs: [{ name: "user" }],
      },
      { type: "function", name: "get_fee_amount", inputs: [] },
      { type: "function", name: "get_version", inputs: [] },
      { type: "function", name: "get_proof_validity_blocks", inputs: [] },
      { type: "function", name: "is_paused", inputs: [] },
    ],
  },
  {
    type: "enum",
    name: "privacy::actions::ServerAction",
    variants: SERVER_ACTION_VARIANTS.map((name) => ({ name, type: "felt252" })),
  },
];

describe("assertPrivacyPoolAbi", () => {
  it("accepts the required pool surface and exact server-action order", () => {
    expect(() => assertPrivacyPoolAbi(validAbi)).not.toThrow();
  });

  it("accepts an ABI returned as serialized JSON", () => {
    expect(() => assertPrivacyPoolAbi(JSON.stringify(validAbi))).not.toThrow();
  });

  it("rejects a pool without apply_actions", () => {
    const abi = structuredClone(validAbi);
    const iface = abi[0];
    iface.items = iface.items.filter((entry) => entry.name !== "apply_actions");

    expect(() => assertPrivacyPoolAbi(abi)).toThrow(
      "pool ABI is missing apply_actions",
    );
  });

  it("rejects a changed ServerAction discriminant order", () => {
    const abi = structuredClone(validAbi);
    const serverAction = abi[1];
    [serverAction.variants[0], serverAction.variants[1]] = [
      serverAction.variants[1]!,
      serverAction.variants[0]!,
    ];

    expect(() => assertPrivacyPoolAbi(abi)).toThrow(
      "pool ServerAction layout does not match the canary decoder",
    );
  });

  it("rejects an apply_actions signature with the wrong arity", () => {
    const abi = structuredClone(validAbi);
    const iface = abi[0];
    const applyActions = iface.items.find(
      (entry) => entry.name === "apply_actions",
    );
    if (applyActions === undefined) {
      throw new Error("test fixture is missing apply_actions");
    }
    applyActions.inputs = [{ name: "actions" }];

    expect(() => assertPrivacyPoolAbi(abi)).toThrow(
      "pool apply_actions signature is incompatible",
    );
  });
});

const finalityRequest = {
  transactionHash: TRANSACTION_HASH,
  poolAddress: POOL,
  coverAddress: COVER,
  relayAddress: RELAY,
  viewingPublicKey: VIEWING_PUBLIC_KEY,
};

function successfulReceipt() {
  return {
    transaction_hash: TRANSACTION_HASH,
    execution_status: "SUCCEEDED",
    finality_status: "ACCEPTED_ON_L2",
    block_number: 12_345,
    actual_fee: { amount: "0x22b1c8c1227a0000", unit: "FRI" },
    events: [
      {
        from_address: POOL,
        keys: [VIEWING_KEY_SET_SELECTOR, COVER, VIEWING_PUBLIC_KEY],
        data: ["0x222", "0x333", "0x444"],
      },
    ],
  };
}

const relayTransaction = {
  transaction_hash: TRANSACTION_HASH,
  type: "INVOKE",
  sender_address: RELAY,
};

describe("assertRegistrationFinality", () => {
  it("returns redacted public evidence for the exact finalized registration", () => {
    expect(
      assertRegistrationFinality({
        request: finalityRequest,
        receipt: successfulReceipt(),
        transaction: relayTransaction,
        registeredPublicKey: 0x111n,
      }),
    ).toEqual({
      transactionHash: TRANSACTION_HASH,
      blockNumber: "12345",
      finalityStatus: "ACCEPTED_ON_L2",
      executionStatus: "SUCCEEDED",
      senderAddress: RELAY,
      actualFeeFri: "2500000000000000000",
      viewingKeyUser: COVER,
      viewingPublicKey: VIEWING_PUBLIC_KEY,
    });
  });

  it("rejects a reverted transaction receipt", () => {
    expect(() =>
      assertRegistrationFinality({
        request: finalityRequest,
        receipt: {
          ...successfulReceipt(),
          execution_status: "REVERTED",
          revert_reason: "registration failed",
        },
        transaction: relayTransaction,
        registeredPublicKey: 0x111n,
      }),
    ).toThrow("registration transaction did not succeed");
  });

  it("rejects a transaction sent by the cover instead of the relay", () => {
    expect(() =>
      assertRegistrationFinality({
        request: finalityRequest,
        receipt: successfulReceipt(),
        transaction: { ...relayTransaction, sender_address: COVER },
        registeredPublicKey: 0x111n,
      }),
    ).toThrow("registration transaction sender does not match relay");
  });

  it("rejects a receipt without the exact pool ViewingKeySet event", () => {
    const receipt = successfulReceipt();
    receipt.events[0]!.keys[2] = "0x999";

    expect(() =>
      assertRegistrationFinality({
        request: finalityRequest,
        receipt,
        transaction: relayTransaction,
        registeredPublicKey: 0x111n,
      }),
    ).toThrow("receipt does not contain the expected ViewingKeySet event");
  });

  it("rejects finalized pool state that differs from the artifact", () => {
    expect(() =>
      assertRegistrationFinality({
        request: finalityRequest,
        receipt: successfulReceipt(),
        transaction: relayTransaction,
        registeredPublicKey: 0x999n,
      }),
    ).toThrow("finalized registration state does not match artifact");
  });
});

describe("StarknetRegistrationCanaryClient.waitForRegistrationFinality", () => {
  it("verifies the transaction and registration state at the receipt block", async () => {
    const stateReads: Array<{ block: number; calldata: string[] }> = [];
    const provider = {
      waitForTransaction: async () => successfulReceipt(),
      getTransactionByHash: async () => relayTransaction,
      callContract: async (
        call: { calldata: string[] },
        block: number,
      ) => {
        stateReads.push({ block, calldata: call.calldata });
        return [VIEWING_PUBLIC_KEY];
      },
    };
    // SAFETY: this test double implements every provider method exercised by this test.
    // SAFETY: this test double implements the sole provider method exercised here.
    const client = new StarknetRegistrationCanaryClient(
      "https://rpc.example.test",
      RELAY,
      // SAFETY: this test double implements the sole provider method exercised here.
      provider as never,
    );

    await expect(
      client.waitForRegistrationFinality(finalityRequest),
    ).resolves.toMatchObject({
      transactionHash: TRANSACTION_HASH,
      blockNumber: "12345",
      viewingPublicKey: VIEWING_PUBLIC_KEY,
    });
    expect(stateReads).toEqual([
      { block: 12_345, calldata: [COVER] },
    ]);
  });
});

describe("assertRefillFundFinality", () => {
  it("requires the relay sender, Funded event, and matching helper liability", () => {
    const helper = "0x456";
    const token = "0x4718";
    const request = {
      transactionHash: TRANSACTION_HASH,
      poolAddress: POOL,
      helperAddress: helper,
      relayAddress: RELAY,
      stateId: "0x111",
      claimCommitment: "0x222",
      recoveryCommitment: "0x333",
      tokenAddress: token,
      amountFri: "1000",
      expiry: "1800003600",
    };

    expect(
      assertRefillFundFinality({
        request,
        receipt: {
          transaction_hash: TRANSACTION_HASH,
          execution_status: "SUCCEEDED",
          finality_status: "ACCEPTED_ON_L2",
          block_number: 12_345,
          actual_fee: { amount: "0x64", unit: "FRI" },
          events: [
            {
              from_address: helper,
              keys: [REFILL_FUNDED_SELECTOR, request.stateId, token],
              data: [request.amountFri, request.expiry],
            },
          ],
        },
        transaction: relayTransaction,
        state: {
          claimCommitment: request.claimCommitment,
          recoveryCommitment: request.recoveryCommitment,
          tokenAddress: token,
          amountFri: 1000n,
          expiry: 1_800_003_600n,
          status: "Funded",
        },
        // Another ticket may finalize between preflight and this receipt.
        // This FUND is proven by its own state and event, not a stale global delta.
        totalLiabilityFri: 6000n,
        helperBalanceFri: 6000n,
      }),
    ).toMatchObject({
      transactionHash: TRANSACTION_HASH,
      senderAddress: RELAY,
      stateId: request.stateId,
      totalLiabilityFri: "6000",
    });
  });
});

describe("StarknetRegistrationCanaryClient.waitForRefillFundFinality", () => {
  it("preserves the actual network fee when a submitted FUND reverts", async () => {
    const provider = {
      waitForTransaction: async () => ({
        transaction_hash: TRANSACTION_HASH,
        execution_status: "REVERTED",
        finality_status: "ACCEPTED_ON_L2",
        block_number: 12_345,
        actual_fee: { amount: "0x64", unit: "FRI" },
        events: [],
      }),
    };
    const client = new StarknetRegistrationCanaryClient(
      "https://rpc.example.test",
      RELAY,
      // SAFETY: this test double implements the only provider call reached by a reverted receipt.
      provider as never,
    );

    await expect(
      client.waitForRefillFundFinality({
        transactionHash: TRANSACTION_HASH,
        poolAddress: POOL,
        helperAddress: "0x456",
        relayAddress: RELAY,
        stateId: "0x111",
        claimCommitment: "0x222",
        recoveryCommitment: "0x333",
        tokenAddress: "0x4718",
        amountFri: "1000",
        expiry: "1800003600",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RefillFundExecutionFailedError>>({
        name: "RefillFundExecutionFailedError",
        transactionHash: TRANSACTION_HASH,
        actualFeeFri: "100",
      }),
    );
  });

  it("bounds finality polling and preserves the submitted hash on timeout", async () => {
    let options: { retries?: number; retryInterval?: number } | undefined;
    const provider = {
      waitForTransaction: async (
        _hash: string,
        received: { retries?: number; retryInterval?: number },
      ) => {
        options = received;
        throw new Error("waitForTransaction timed-out with retries 200");
      },
    };
    // SAFETY: this test double implements the sole provider method exercised here.
    const client = new StarknetRegistrationCanaryClient(
      "https://rpc.example.test",
      RELAY,
      provider as never,
    );

    await expect(
      client.waitForRefillFundFinality({
        transactionHash: TRANSACTION_HASH,
        poolAddress: POOL,
        helperAddress: "0x456",
        relayAddress: RELAY,
        stateId: "0x111",
        claimCommitment: "0x222",
        recoveryCommitment: "0x333",
        tokenAddress: "0x4718",
        amountFri: "1000",
        expiry: "1800003600",
      }),
    ).rejects.toMatchObject({
      name: "RefillFundFinalityUnknownError",
      transactionHash: TRANSACTION_HASH,
    });
    expect(options).toMatchObject({ retries: 20, retryInterval: 2_500 });
  });
});
