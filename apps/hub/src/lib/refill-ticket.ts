import {
  computeRefillClaimCommitment,
  createRefillKeypair,
  createRefillTicketStore,
  generateRefillTicketSealingKey,
  type RefillTicketStore,
  type RefillTicket,
  type RefillTicketStatus,
} from "@wrenchless/canary-core";

const KEY_DATABASE = "wrenchless-local-secrets-v1";
const KEY_STORE = "keys";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;

export type CoverRefillRequest = {
  schemaVersion: "wrenchless.cover-refill-request.v1";
  stateId: string;
  claimCommitment: string;
  createdAt: string;
};

export type VaultRefillIntent = CoverRefillRequest & {
  refundPublicKey: string;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

async function openKeyDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(KEY_DATABASE, 1);
  request.addEventListener(
    "upgradeneeded",
    () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) {
        request.result.createObjectStore(KEY_STORE);
      }
    },
    { once: true },
  );
  return requestResult(request);
}

async function getOrCreateSealingKey(role: "cover" | "vault"): Promise<CryptoKey> {
  const database = await openKeyDatabase();
  try {
    const read = database.transaction(KEY_STORE, "readonly");
    const stored = await requestResult<CryptoKey | undefined>(
      read.objectStore(KEY_STORE).get(role),
    );
    if (stored !== undefined) return stored;

    const key = await generateRefillTicketSealingKey();
    const write = database.transaction(KEY_STORE, "readwrite");
    write.objectStore(KEY_STORE).add(key, role);
    await transactionComplete(write);
    return key;
  } finally {
    database.close();
  }
}

async function localTicketStore(
  role: "cover" | "vault",
): Promise<RefillTicketStore> {
  return createRefillTicketStore(localStorage, await getOrCreateSealingKey(role));
}

function randomStateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const candidate = BigInt(
    `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`,
  );
  return `0x${((candidate % (STARK_FIELD_PRIME - 1n)) + 1n).toString(16)}`;
}

export function createRefillReleaseNonce(): string {
  return randomStateId();
}

export async function createCoverRefillRequest(
  now = new Date(),
): Promise<CoverRefillRequest> {
  const stateId = randomStateId();
  const claim = createRefillKeypair();
  const timestamp = now.toISOString();
  await (await localTicketStore("cover")).saveNew({
    schemaVersion: "wrenchless.refill-ticket.v1",
    role: "cover",
    stateId,
    status: "CREATED",
    claimPrivateKey: claim.privateKey,
    claimPublicKey: claim.publicKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    schemaVersion: "wrenchless.cover-refill-request.v1",
    stateId,
    claimCommitment: computeRefillClaimCommitment(stateId, claim.publicKey),
    createdAt: timestamp,
  };
}

export async function createCoverRefillRequestBatch(
  count = 3,
): Promise<CoverRefillRequest[]> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 3) {
    throw new Error("Create between one and three restore requests");
  }
  const requests: CoverRefillRequest[] = [];
  for (let index = 0; index < count; index += 1) {
    requests.push(await createCoverRefillRequest());
  }
  return requests;
}

export async function readCoverRefillTicket(
  stateId: string,
): Promise<Extract<RefillTicket, { role: "cover" }>> {
  const ticket = await (await localTicketStore("cover")).get(stateId);
  if (ticket === null || ticket.role !== "cover") {
    throw new Error("cover refill ticket does not exist in this browser");
  }
  return ticket;
}

export async function readVaultRefillTicket(
  stateId: string,
): Promise<Extract<RefillTicket, { role: "vault" }>> {
  const ticket = await (await localTicketStore("vault")).get(stateId);
  if (ticket === null || ticket.role !== "vault") {
    throw new Error("vault refill ticket does not exist in this browser");
  }
  return ticket;
}

export async function readVaultRefillIntent(
  stateId: string,
): Promise<VaultRefillIntent> {
  const ticket = await readVaultRefillTicket(stateId);
  return {
    schemaVersion: "wrenchless.cover-refill-request.v1",
    stateId: ticket.stateId,
    claimCommitment: ticket.claimCommitment,
    createdAt: ticket.createdAt,
    refundPublicKey: ticket.refundPublicKey,
  };
}

export async function markCoverRefillClaimed(
  stateId: string,
  now = new Date(),
): Promise<Extract<RefillTicket, { role: "cover" }>> {
  const store = await localTicketStore("cover");
  let ticket = await store.get(stateId);
  if (ticket === null || ticket.role !== "cover") {
    throw new Error("cover refill ticket does not exist in this browser");
  }

  const timestamp = now.toISOString();
  while (ticket.status !== "CLAIMED") {
    let nextStatus: RefillTicketStatus;
    switch (ticket.status) {
      case "CREATED":
        nextStatus = "FUNDED";
        break;
      case "FUNDED":
        nextStatus = "CLAIMABLE";
        break;
      case "CLAIMABLE":
        nextStatus = "CLAIMING";
        break;
      case "CLAIMING":
        nextStatus = "CLAIMED";
        break;
      default:
        throw new Error(`cannot mark ${ticket.status} refill ticket as claimed`);
    }
    const transitioned = await store.transition(stateId, nextStatus, timestamp);
    if (transitioned.role !== "cover") {
      throw new Error("stored refill ticket changed roles");
    }
    ticket = transitioned;
  }
  return ticket;
}

function assertCoverRefillRequest(
  request: CoverRefillRequest,
): CoverRefillRequest {
  if (request.schemaVersion !== "wrenchless.cover-refill-request.v1") {
    throw new Error("unsupported cover refill request");
  }
  for (const [label, value] of [
    ["state ID", request.stateId],
    ["claim commitment", request.claimCommitment],
  ] as const) {
    if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) {
      throw new Error(`${label} is not a canonical felt`);
    }
    const parsed = BigInt(value);
    if (parsed === 0n || parsed >= STARK_FIELD_PRIME) {
      throw new Error(`${label} is outside the non-zero Stark field`);
    }
  }
  if (Number.isNaN(Date.parse(request.createdAt))) {
    throw new Error("cover refill request timestamp is invalid");
  }
  return request;
}

export async function createVaultRefillIntent(
  request: CoverRefillRequest,
  now = new Date(),
): Promise<VaultRefillIntent> {
  const coverRequest = assertCoverRefillRequest(request);
  const store = await localTicketStore("vault");
  const existing = await store.get(coverRequest.stateId);
  if (existing !== null) {
    if (
      existing.role !== "vault" ||
      BigInt(existing.claimCommitment) !== BigInt(coverRequest.claimCommitment)
    ) {
      throw new Error("A different restore request already uses this state ID");
    }
    return {
      ...coverRequest,
      refundPublicKey: existing.refundPublicKey,
    };
  }
  const refund = createRefillKeypair();
  const timestamp = now.toISOString();
  await store.saveNew({
    schemaVersion: "wrenchless.refill-ticket.v1",
    role: "vault",
    stateId: coverRequest.stateId,
    status: "CREATED",
    claimCommitment: coverRequest.claimCommitment,
    refundPrivateKey: refund.privateKey,
    refundPublicKey: refund.publicKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return { ...coverRequest, refundPublicKey: refund.publicKey };
}
