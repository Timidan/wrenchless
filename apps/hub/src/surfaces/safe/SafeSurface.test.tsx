import { describe, expect, it } from "vitest";

import { selectSafeSurfaceVersion } from "./SafeSurface";

describe("SafeSurface", () => {
  it("keeps fresh browsers usable when Trip Allowance is not configured", () => {
    expect(selectSafeSurfaceVersion(null, false)).toBe("v2");
  });
});
