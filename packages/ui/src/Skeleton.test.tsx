import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "./Skeleton.js";

describe("Skeleton", () => {
  it("reserves exactly the space its content will occupy", () => {
    render(<Skeleton width="120px" height="28px" />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "120px", height: "28px" });
  });

  it("announces itself as a pending region", () => {
    render(<Skeleton height="28px" label="Loading balance" />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading balance");
  });

  it("defaults to a neutral label that names no specific operation", () => {
    render(<Skeleton height="28px" />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading");
  });

  it("fills its container when no width is given", () => {
    render(<Skeleton height="28px" />);
    expect(screen.getByRole("status")).toHaveStyle({ width: "100%" });
  });
});
