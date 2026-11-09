import { describe, expect, it } from "vitest";
import { hasValidApprovalDocument } from "./approval-policy";

describe("approval documents", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");

  it("requires one approved document that has not expired", () => {
    expect(
      hasValidApprovalDocument([{ status: "PENDING", expiresOn: null }], now),
    ).toBe(false);
    expect(
      hasValidApprovalDocument(
        [{ status: "APPROVED", expiresOn: new Date("2026-10-19T00:00:00.000Z") }],
        now,
      ),
    ).toBe(false);
    expect(
      hasValidApprovalDocument(
        [{ status: "APPROVED", expiresOn: new Date("2026-10-20T00:00:00.000Z") }],
        now,
      ),
    ).toBe(true);
  });
});
