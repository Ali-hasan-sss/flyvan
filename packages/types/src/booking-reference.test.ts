import { describe, expect, it } from "vitest";
import { formatBookingReference, isBookingReference } from "./booking-reference";

describe("formatBookingReference", () => {
  it("uses the UTC calendar date and a zero-padded sequence", () => {
    const reference = formatBookingReference(new Date("2026-10-19T23:30:00.000Z"), 7);
    expect(reference).toBe("FV-20261019-0007");
    expect(isBookingReference(reference)).toBe(true);
  });

  it("rejects a non-positive sequence", () => {
    expect(() => formatBookingReference(new Date("2026-10-19T00:00:00.000Z"), 0)).toThrow(
      /sequence/,
    );
  });
});
