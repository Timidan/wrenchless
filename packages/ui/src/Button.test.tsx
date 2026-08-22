import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button.js";

describe("Button", () => {
  it("renders its label and responds to a click", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Add to balance</Button>);

    await userEvent.click(
      screen.getByRole("button", { name: "Add to balance" }),
    );

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is a pill, not a rounded rectangle", () => {
    render(<Button>Send</Button>);
    expect(screen.getByRole("button").className).toContain("ui-button");
  });

  it("blocks interaction while loading and says so to assistive tech", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Send
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps its label mounted while loading so its width cannot change", () => {
    render(<Button loading>Send</Button>);
    expect(screen.getByRole("button")).toHaveTextContent("Send");
  });

  it("is reachable by keyboard", async () => {
    render(<Button>Send</Button>);
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
  });

  it("forwards a ref", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Send</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
