import {
  computeTravelSafeV3ClaimCommitment,
  deriveTravelSafeSecrets,
} from "@wrenchless/canary-core";

import {
  readTravelSafeV3Snapshot,
  type TravelSafeV3Snapshot,
} from "./travel-safe-state-v3";
import { TRAVEL_SAFE_TOKENS } from "./travel-safe-tokens";

export type TravelSafeV3RescueAuthority = {
  stateId: string;
  claimPrivateKey: string;
  claimPublicKey: string;
};

export type TravelSafeV3RescueInspection = {
  authority: TravelSafeV3RescueAuthority;
  snapshot: TravelSafeV3Snapshot;
  token: (typeof TRAVEL_SAFE_TOKENS)[number];
  availability: "available" | "return_open" | "complete";
};

type SnapshotReader = typeof readTravelSafeV3Snapshot;

function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

function tokenFor(address: string): (typeof TRAVEL_SAFE_TOKENS)[number] {
  const token = TRAVEL_SAFE_TOKENS.find((candidate) =>
    sameFelt(candidate.address, address),
  );
  if (token === undefined) {
    throw new Error("This Trip Allowance uses an unsupported asset");
  }
  return token;
}

export async function inspectTravelSafeV3RescueAuthority(input: {
  authority: TravelSafeV3RescueAuthority;
  helperAddress: string;
  rpcUrl: string;
  readSnapshot?: SnapshotReader;
}): Promise<TravelSafeV3RescueInspection> {
  const snapshot = await (input.readSnapshot ?? readTravelSafeV3Snapshot)({
    helperAddress: input.helperAddress,
    stateId: input.authority.stateId,
    rpcUrl: input.rpcUrl,
  });
  const state = snapshot.state;
  const expectedCommitment = computeTravelSafeV3ClaimCommitment(
    input.authority.stateId,
    input.authority.claimPublicKey,
  );
  if (
    state === null ||
    !sameFelt(state.claimCommitment, expectedCommitment)
  ) {
    throw new Error("No Trip Allowance matches those recovery words");
  }
  const availability =
    state.status !== "funded"
      ? "complete"
      : BigInt(snapshot.chainTimeSeconds) <= BigInt(state.returnAt)
        ? "available"
        : "return_open";
  return {
    authority: input.authority,
    snapshot,
    token: tokenFor(state.tokenAddress),
    availability,
  };
}

export async function inspectTravelSafeV3RescueWords(input: {
  words: string;
  helperAddress: string;
  rpcUrl: string;
  readSnapshot?: SnapshotReader;
}): Promise<TravelSafeV3RescueInspection> {
  const secrets = await deriveTravelSafeSecrets(input.words);
  const authority: TravelSafeV3RescueAuthority = {
    stateId: secrets.stateId,
    claimPrivateKey: secrets.claimPrivateKey,
    claimPublicKey: secrets.claimPublicKey,
  };
  const inspectionInput: Parameters<
    typeof inspectTravelSafeV3RescueAuthority
  >[0] = {
    authority,
    helperAddress: input.helperAddress,
    rpcUrl: input.rpcUrl,
  };
  if (input.readSnapshot !== undefined) {
    inspectionInput.readSnapshot = input.readSnapshot;
  }
  return inspectTravelSafeV3RescueAuthority(inspectionInput);
}
