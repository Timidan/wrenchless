import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SquircleCard } from "./SquircleCard.js";

describe("SquircleCard", () => {
  it("renders its children", () => {
    render(<SquircleCard>Spending balance</SquircleCard>);
    expect(screen.getByText("Spending balance")).toBeInTheDocument();
  });

  it("is a div by default", () => {
    const { container } = render(<SquircleCard>x</SquircleCard>);
    expect(container.firstElementChild?.tagName).toBe("DIV");
  });

  it("can render as a section for landmark structure", () => {
    const { container } = render(<SquircleCard as="section">x</SquircleCard>);
    expect(container.firstElementChild?.tagName).toBe("SECTION");
  });

  it("marks the recessed inset variant", () => {
    const { container } = render(<SquircleCard inset>x</SquircleCard>);
    expect(container.firstElementChild).toHaveAttribute("data-inset", "true");
  });

  it("keeps caller class names alongside its own", () => {
    const { container } = render(
      <SquircleCard className="balance">x</SquircleCard>,
    );
    expect(container.firstElementChild?.className).toBe("ui-squircle balance");
  });
});
