import { ec } from "starknet";
import { describe, expect, it } from "vitest";

import {
  computeRefillRefundHash,
  computeRefillReleaseHash,
  prepareRefillClaim,
  prepareRefillFund,
  prepareRefillRefund,
  submitRefillClaim,
  type PreparedStrk20Call,
  type RefillAction,
  type RefillPrepareWallet,
} from "./refill-claim.js";

const POOL = "0xabcd";
const HELPER = "0x1234";
const TOKEN = "0x333";
const RECIPIENT = "0x5678";
const STATE_ID = "0x111";
const NONCE = "0x222";
const EXPIRY = 1_800_003_600n;
const AMOUNT = 1_000n;
const CLAIM_PRIVATE_KEY = "0x12345";
const CLAIM_PUBLIC_KEY = ec.starkCurve.getStarkKey(CLAIM_PRIVATE_KEY);
const CLAIM_PUBLIC_POINT = ec.starkCurve.ProjectivePoint.fromPrivateKey(
  CLAIM_PRIVATE_KEY.slice(2).padStart(64, "0"),
).toRawBytes(true);
const REFUND_PRIVATE_KEY = "0x67890";
const REFUND_PUBLIC_KEY = ec.starkCurve.getStarkKey(REFUND_PRIVATE_KEY);
const REFUND_PUBLIC_POINT = ec.starkCurve.ProjectivePoint.fromPrivateKey(
  REFUND_PRIVATE_KEY.slice(2).padStart(64, "0"),
).toRawBytes(true);

function makePreparedCall(
  actions: RefillAction[],
  noteId: string,
  simulate: boolean,
): PreparedStrk20Call {
  const invoke = actions.find((action) => action.type === "invoke");
  if (invoke === undefined) {
    throw new Error("missing invoke action");
  }
  const helperCalldata = invoke.calldata.map((value) =>
    value === "${openNoteIds[0]}" ? noteId : value,
  );
  return {
    call: {
      contract_address: POOL,
      entry_point: "apply_actions",
      calldata: [
        "0x2",
        "0x7",
        "0x1",
        "0x2",
        "0x3",
        TOKEN,
        noteId,
        "0xa",
        HELPER,
        `0x${helperCalldata.length.toString(16)}`,
        ...helperCalldata,
        ...(simulate ? [] : ["0x1"]),
      ],
    },
    proof: {
      data: simulate ? "" : "proof",
      output: [],
      proof_facts: simulate ? [] : ["0x1"],
    },
  };
}

function makePreparedFundCall(
  actions: RefillAction[],
  withdrawalRecipient = HELPER,
): PreparedStrk20Call {
  const withdrawal = actions.find((action) => action.type === "withdraw");
  const invoke = actions.find((action) => action.type === "invoke");
  if (withdrawal === undefined || invoke === undefined) {
    throw new Error("missing FUND actions");
  }
  return {
    call: {
      contract_address: POOL,
      entry_point: "apply_actions",
      calldata: [
        "0x2",
        "0x3",
        withdrawalRecipient,
        withdrawal.token,
        withdrawal.amount,
        "0xa",
        invoke.contract,
        `0x${invoke.calldata.length.toString(16)}`,
        ...invoke.calldata,
        "0x1",
      ],
    },
    proof: {
      data: "proof",
      output: [],
      proof_facts: ["0x1"],
    },
  };
}

function makeWallet(realNoteId = "0x444"): RefillPrepareWallet {
  return {
    async strk20PrepareInvoke(actions, simulate = false) {
      return makePreparedCall(actions, simulate ? "0x444" : realNoteId, simulate);
    },
  };
}

describe("refill FUND preparation", () => {
  it("rejects an encoded count that exceeds the remaining calldata", async () => {
    const wallet: RefillPrepareWallet = {
      async strk20PrepareInvoke() {
        return {
          call: {
            contract_address: POOL,
            entry_point: "apply_actions",
            calldata: ["0x1", "0xa", HELPER, "0x1fffffffffffff"],
          },
          proof: { data: "proof", output: [], proof_facts: ["0x1"] },
        };
      },
    };

    await expect(
      prepareRefillFund({
        wallet,
        poolAddress: POOL,
        helperAddress: HELPER,
        stateId: STATE_ID,
        claimCommitment: "0x777",
        refundPublicKey: REFUND_PUBLIC_KEY,
        token: TOKEN,
        amount: AMOUNT,
        expiry: EXPIRY,
      }),
    ).rejects.toThrow("length exceeds remaining calldata");
  });

  it("withdraws private STRK to the helper before the exact FUND invoke", async () => {
    let requestedActions: RefillAction[] = [];
    const wallet: RefillPrepareWallet = {
      async strk20PrepareInvoke(actions) {
        requestedActions = actions;
        return makePreparedFundCall(actions);
      },
    };

    await prepareRefillFund({
      wallet,
      poolAddress: POOL,
      helperAddress: HELPER,
      stateId: STATE_ID,
      claimCommitment: "0x777",
      refundPublicKey: REFUND_PUBLIC_KEY,
      token: TOKEN,
      amount: AMOUNT,
      expiry: EXPIRY,
    });

    expect(requestedActions).toEqual([
      {
        type: "withdraw",
        token: TOKEN,
        amount: "0x3e8",
        recipient: HELPER,
      },
      {
        type: "invoke",
        contract: HELPER,
        calldata: [
          "0x0",
          STATE_ID,
          "0x777",
          REFUND_PUBLIC_KEY,
          TOKEN,
          "0x3e8",
          `0x${EXPIRY.toString(16)}`,
        ],
      },
    ]);
  });

  it("rejects a proof that withdraws to a different recipient", async () => {
    const wallet: RefillPrepareWallet = {
      async strk20PrepareInvoke(actions) {
        return makePreparedFundCall(actions, "0x999");
      },
    };

    await expect(
      prepareRefillFund({
        wallet,
        poolAddress: POOL,
        helperAddress: HELPER,
        stateId: STATE_ID,
        claimCommitment: "0x777",
        refundPublicKey: REFUND_PUBLIC_KEY,
        token: TOKEN,
        amount: AMOUNT,
        expiry: EXPIRY,
      }),
    ).rejects.toThrow("withdrawal recipient does not match");
  });

  it("rejects a FUND proof with an extra server action", async () => {
    const wallet: RefillPrepareWallet = {
      async strk20PrepareInvoke(actions) {
        const prepared = makePreparedFundCall(actions);
        const calldata = prepared.call.calldata ?? [];
        prepared.call.calldata = [
          "0x3",
          ...calldata.slice(1, -1),
          "0x9",
          "0x0",
          calldata.at(-1) ?? "0x1",
        ];
        return prepared;
      },
    };

    await expect(
      prepareRefillFund({
        wallet,
        poolAddress: POOL,
        helperAddress: HELPER,
        stateId: STATE_ID,
        claimCommitment: "0x777",
        refundPublicKey: REFUND_PUBLIC_KEY,
        token: TOKEN,
        amount: AMOUNT,
        expiry: EXPIRY,
      }),
    ).rejects.toThrow("exactly two actions");
  });
});

describe("refill claim authorization", () => {
  it("matches the Cairo SNIP-12 release hash", () => {
    expect(
      computeRefillReleaseHash({
        chainId: "SN_SEPOLIA",
        helperAddress: HELPER,
        stateId: STATE_ID,
        nonce: NONCE,
        expiry: EXPIRY,
        token: TOKEN,
        amount: AMOUNT,
        noteId: "0x444",
      }),
    ).toBe(
      "0x21bd6f5d505c3f5cafc01adebd6d29b060a47e82cbcf857d9041739ecccbe8e",
    );
  });

  it("previews, signs, and verifies the exact prepared OPEN note", async () => {
    const result = await prepareRefillClaim({
      wallet: makeWallet(),
      chainId: "SN_SEPOLIA",
      poolAddress: POOL,
      helperAddress: HELPER,
      recipient: RECIPIENT,
      stateId: STATE_ID,
      nonce: NONCE,
      expiry: EXPIRY,
      token: TOKEN,
      amount: AMOUNT,
      claimPrivateKey: CLAIM_PRIVATE_KEY,
      claimPublicKey: CLAIM_PUBLIC_KEY,
    });

    expect(result.noteId).toBe("0x444");
    expect(
      ec.starkCurve.verify(
        new ec.starkCurve.Signature(
          BigInt(result.signature.r),
          BigInt(result.signature.s),
        ),
        computeRefillReleaseHash({
          chainId: "SN_SEPOLIA",
          helperAddress: HELPER,
          stateId: STATE_ID,
          nonce: NONCE,
          expiry: EXPIRY,
          token: TOKEN,
          amount: AMOUNT,
          noteId: result.noteId,
        }),
        CLAIM_PUBLIC_POINT,
      ),
    ).toBe(true);
  });

  it("submits the signed CLAIM through the privacy wallet relayer", async () => {
    let submittedActions: RefillAction[] = [];
    const result = await submitRefillClaim({
      wallet: {
        async strk20PrepareInvoke(actions, simulate = false) {
          expect(simulate).toBe(true);
          return makePreparedCall(actions, "0x444", true);
        },
        async strk20InvokeTransaction(actions) {
          submittedActions = actions;
          return { transaction_hash: "0xabc" };
        },
      },
      chainId: "SN_SEPOLIA",
      poolAddress: POOL,
      helperAddress: HELPER,
      recipient: RECIPIENT,
      stateId: STATE_ID,
      nonce: NONCE,
      expiry: EXPIRY,
      token: TOKEN,
      amount: AMOUNT,
      claimPrivateKey: CLAIM_PRIVATE_KEY,
      claimPublicKey: CLAIM_PUBLIC_KEY,
    });

    expect(result.transactionHash).toBe("0xabc");
    expect(result.noteId).toBe("0x444");
    expect(submittedActions[0]).toEqual({
      type: "transfer",
      token: TOKEN,
      amount: "OPEN",
      recipient: RECIPIENT,
    });
    expect(submittedActions[1]).toMatchObject({
      type: "invoke",
      contract: HELPER,
      calldata: [
        "0x1",
        STATE_ID,
        "${openNoteIds[0]}",
        NONCE,
        CLAIM_PUBLIC_KEY,
        result.signature.r,
        result.signature.s,
      ],
    });
  });

  it("discards a proof if the OPEN note changed after preview", async () => {
    await expect(
      prepareRefillClaim({
        wallet: makeWallet("0x445"),
        chainId: "SN_SEPOLIA",
        poolAddress: POOL,
        helperAddress: HELPER,
        recipient: RECIPIENT,
        stateId: STATE_ID,
        nonce: NONCE,
        expiry: EXPIRY,
        token: TOKEN,
        amount: AMOUNT,
        claimPrivateKey: CLAIM_PRIVATE_KEY,
        claimPublicKey: CLAIM_PUBLIC_KEY,
      }),
    ).rejects.toThrow("OPEN note changed after preview");
  });
});

describe("refill refund authorization", () => {
  it("matches the Cairo SNIP-12 refund hash", () => {
    expect(
      computeRefillRefundHash({
        chainId: "SN_SEPOLIA",
        helperAddress: HELPER,
        stateId: STATE_ID,
        nonce: NONCE,
        expiry: EXPIRY,
        token: TOKEN,
        amount: AMOUNT,
        noteId: "0x444",
      }),
    ).toBe(
      "0x5e6e9fb889a751e1ed2413ad8c6d9245f873bbd88b0634711b5cbe59f3cb408",
    );
  });

  it("previews, signs, and verifies the exact refund OPEN note", async () => {
    const result = await prepareRefillRefund({
      wallet: makeWallet(),
      chainId: "SN_SEPOLIA",
      poolAddress: POOL,
      helperAddress: HELPER,
      recipient: RECIPIENT,
      stateId: STATE_ID,
      nonce: NONCE,
      expiry: EXPIRY,
      token: TOKEN,
      amount: AMOUNT,
      refundPrivateKey: REFUND_PRIVATE_KEY,
      refundPublicKey: REFUND_PUBLIC_KEY,
    });

    expect(result.noteId).toBe("0x444");
    expect(
      ec.starkCurve.verify(
        new ec.starkCurve.Signature(
          BigInt(result.signature.r),
          BigInt(result.signature.s),
        ),
        computeRefillRefundHash({
          chainId: "SN_SEPOLIA",
          helperAddress: HELPER,
          stateId: STATE_ID,
          nonce: NONCE,
          expiry: EXPIRY,
          token: TOKEN,
          amount: AMOUNT,
          noteId: result.noteId,
        }),
        REFUND_PUBLIC_POINT,
      ),
    ).toBe(true);
  });

  it("discards a refund proof if the OPEN note changed after preview", async () => {
    await expect(
      prepareRefillRefund({
        wallet: makeWallet("0x445"),
        chainId: "SN_SEPOLIA",
        poolAddress: POOL,
        helperAddress: HELPER,
        recipient: RECIPIENT,
        stateId: STATE_ID,
        nonce: NONCE,
        expiry: EXPIRY,
        token: TOKEN,
        amount: AMOUNT,
        refundPrivateKey: REFUND_PRIVATE_KEY,
        refundPublicKey: REFUND_PUBLIC_KEY,
      }),
    ).rejects.toThrow("OPEN note changed after preview");
  });
});
