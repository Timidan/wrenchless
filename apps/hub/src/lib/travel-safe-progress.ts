export type TravelSafeFundMoment =
  | "approving"
  | "estimating"
  | "cost-ready"
  | "submitting"
  | "unknown"
  | "confirming"
  | "confirmed";

export type TravelSafeFundProgress = {
  message: string;
  money: "not-sent" | "unknown" | "submitted" | "locked";
  moneyLabel: string;
  working: boolean;
  steps: readonly {
    id: "check" | "approve" | "cost" | "submit" | "confirm";
    label: string;
    state: "complete" | "current" | "pending";
  }[];
};

const STEPS = [
  { id: "check", label: "Check" },
  { id: "approve", label: "Approve" },
  { id: "cost", label: "Cost" },
  { id: "submit", label: "Submit" },
  { id: "confirm", label: "Confirm" },
] as const;

const MOMENTS: Record<
  TravelSafeFundMoment,
  {
    current: number;
    message: string;
    money: TravelSafeFundProgress["money"];
    moneyLabel: string;
    working: boolean;
  }
> = {
  approving: {
    current: 1,
    message: "Approve the private action",
    money: "not-sent",
    moneyLabel: "No transaction sent",
    working: true,
  },
  estimating: {
    current: 2,
    message: "Checking the relay cost",
    money: "not-sent",
    moneyLabel: "No transaction sent",
    working: true,
  },
  "cost-ready": {
    current: 2,
    message: "Cost ready for review",
    money: "not-sent",
    moneyLabel: "No transaction sent",
    working: false,
  },
  submitting: {
    current: 3,
    message: "Sending this action once",
    money: "unknown",
    moneyLabel: "Checking whether it was sent",
    working: true,
  },
  unknown: {
    current: 3,
    message: "Checking Starknet before retry",
    money: "unknown",
    moneyLabel: "Submission status unknown",
    working: true,
  },
  confirming: {
    current: 4,
    message: "Waiting for Starknet confirmation",
    money: "submitted",
    moneyLabel: "Transaction submitted",
    working: true,
  },
  confirmed: {
    current: STEPS.length,
    message: "Safe locked",
    money: "locked",
    moneyLabel: "Safe locked",
    working: false,
  },
};

export function deriveTravelSafeFundProgress(
  moment: TravelSafeFundMoment,
): TravelSafeFundProgress {
  const current = MOMENTS[moment];
  return {
    message: current.message,
    money: current.money,
    moneyLabel: current.moneyLabel,
    working: current.working,
    steps: STEPS.map((step, index) => ({
      ...step,
      state:
        index < current.current
          ? "complete"
          : index === current.current
            ? "current"
            : "pending",
    })),
  };
}
