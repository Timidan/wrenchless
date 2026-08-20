import { describe, expect, it } from "vitest";

import { assertPrivacyPoolAbi } from "./starknet-client.js";

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

const validAbi = [
  {
    type: "interface",
    name: "privacy::interface::IPrivacy",
    items: [
      {
        type: "function",
        name: "apply_actions",
        inputs: [{}, {}],
      },
      { type: "function", name: "get_public_key", inputs: [{}] },
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
    const iface = abi[0] as { items: Array<{ name: string }> };
    iface.items = iface.items.filter((entry) => entry.name !== "apply_actions");

    expect(() => assertPrivacyPoolAbi(abi)).toThrow(
      "pool ABI is missing apply_actions",
    );
  });

  it("rejects a changed ServerAction discriminant order", () => {
    const abi = structuredClone(validAbi);
    const serverAction = abi[1] as {
      variants: Array<{ name: string; type: string }>;
    };
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
    const iface = abi[0] as {
      items: Array<{ name: string; inputs: unknown[] }>;
    };
    const applyActions = iface.items.find(
      (entry) => entry.name === "apply_actions",
    );
    if (applyActions === undefined) {
      throw new Error("test fixture is missing apply_actions");
    }
    applyActions.inputs = [{}];

    expect(() => assertPrivacyPoolAbi(abi)).toThrow(
      "pool apply_actions signature is incompatible",
    );
  });
});
