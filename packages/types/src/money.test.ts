import { describe, expect, it } from "vitest";
import { allocatePayment, calculateCommissionAmount } from "./money";

describe("calculateCommissionAmount", () => {
  it("applies a whole-percent rate without binary float drift", () => {
    expect(calculateCommissionAmount("100.00", "10")).toBe("10.00");
    expect(calculateCommissionAmount("0.10", "10")).toBe("0.01");
  });

  it("rounds half away from zero to two decimal places", () => {
    expect(calculateCommissionAmount("10.05", "10")).toBe("1.01");
    expect(calculateCommissionAmount("33.35", "10")).toBe("3.34");
    expect(calculateCommissionAmount("33.33", "10")).toBe("3.33");
  });

  it("keeps a zero rate and a zero fare at zero", () => {
    expect(calculateCommissionAmount("250.00", "0")).toBe("0.00");
    expect(calculateCommissionAmount("0.00", "15")).toBe("0.00");
  });

  it("returns the fare when the rate is 100", () => {
    expect(calculateCommissionAmount("80.50", "100")).toBe("80.50");
  });

  it("accepts a rate with three decimal places", () => {
    expect(calculateCommissionAmount("100.00", "10.505")).toBe("10.51");
  });

  it("allocates a partial payment to the oldest obligation only", () => {
    expect(
      allocatePayment(
        [
          { id: "older", remaining: "10.00" },
          { id: "newer", remaining: "8.00" },
        ],
        "4.00",
      ),
    ).toEqual({ allocations: [{ id: "older", amount: "4.00" }], unapplied: "0.00" });
  });

  it("continues into the next obligation when the oldest one is covered", () => {
    expect(
      allocatePayment(
        [
          { id: "older", remaining: "10.00" },
          { id: "newer", remaining: "8.00" },
        ],
        "12.00",
      ),
    ).toEqual({
      allocations: [
        { id: "older", amount: "10.00" },
        { id: "newer", amount: "2.00" },
      ],
      unapplied: "0.00",
    });
  });

  it("carries an overpayment as unapplied credit after the obligations are covered", () => {
    expect(allocatePayment([{ id: "only", remaining: "10.00" }], "15.00")).toEqual({
      allocations: [{ id: "only", amount: "10.00" }],
      unapplied: "5.00",
    });
  });

  it("rejects negative amounts, rates above 100, and extra precision", () => {
    expect(() => calculateCommissionAmount("-1.00", "10")).toThrow(/fare/);
    expect(() => calculateCommissionAmount("10.00", "100.001")).toThrow(/rate/);
    expect(() => calculateCommissionAmount("10.00", "-1")).toThrow(/rate/);
    expect(() => calculateCommissionAmount("10.001", "10")).toThrow(/fare/);
  });
});
