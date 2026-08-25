import { describe, expect, it } from "vitest";

import {
  chooseTravelSafeRelease,
  deriveTravelSafeSecrets,
} from "./travel-safe.js";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("Travel Safe recovery authority", () => {
  it("derives stable local recovery authority from twelve words", async () => {
    await expect(deriveTravelSafeSecrets(PHRASE)).resolves.toEqual({
      stateId:
        "0x32ef0f64a7ead9b0fb9f3ccd6e7098b98b71aaaf6df4df0ccf5b2253b550a16",
      claimPrivateKey:
        "0x5483c5a0c18e332068abb37bcd35d76f483da443348a8e6423aa667fe0e33c9",
      claimPublicKey:
        "0x56cd39dbbeb912cd52a5dd41516ebd84e0e6c7826139caae1408b8672081dd7",
      claimCommitment:
        "0xb1d4e061176740b93444ad5c6be3ca7f00d5cad3228f6cb26c2ca67844b084",
      recoverySalt:
        "0x6679ef0440b68eb1fd5b372f2525586d623de00fd4b6f2eeaccc0c9da14659d",
    });
  });

  it("rejects invalid words without leaking which word failed", async () => {
    await expect(
      deriveTravelSafeSecrets("not twelve valid words"),
    ).rejects.toThrow("Enter a valid twelve-word recovery phrase");
  });

  it("uses CLAIM through the return boundary and REFUND only after it", () => {
    expect(chooseTravelSafeRelease("200", "200")).toBe("claim");
    expect(chooseTravelSafeRelease("200", "201")).toBe("refund");
  });
});
