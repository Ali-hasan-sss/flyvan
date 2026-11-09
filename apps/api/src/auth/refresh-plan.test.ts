import { describe, expect, it } from "vitest";
import { planRefreshRotation, type RefreshState } from "./refresh-plan";

const now = new Date("2026-10-19T12:00:00.000Z");

function token(overrides: Partial<RefreshState> = {}): RefreshState {
  return {
    id: "token-1",
    userId: "user-1",
    tokenHash: "hash",
    expiresAt: new Date("2026-10-20T12:00:00.000Z"),
    revokedAt: null,
    replacedById: null,
    ...overrides,
  };
}

describe("refresh rotation plan", () => {
  it("rotates a live token for an active user", () => {
    expect(planRefreshRotation({ current: token(), now, userActive: true })).toEqual({
      action: "rotate",
      userId: "user-1",
      tokenId: "token-1",
    });
  });

  it("revokes the family when a replaced token is presented again", () => {
    expect(
      planRefreshRotation({
        current: token({ revokedAt: now, replacedById: "token-2" }),
        now,
        userActive: true,
      }).action,
    ).toBe("revoke-family");
  });

  it("rejects an expired token without treating it as theft", () => {
    expect(
      planRefreshRotation({
        current: token({ expiresAt: new Date("2026-10-19T11:00:00.000Z") }),
        now,
        userActive: true,
      }).action,
    ).toBe("reject");
  });

  it("revokes sessions when the account is no longer active", () => {
    expect(planRefreshRotation({ current: token(), now, userActive: false }).action).toBe(
      "revoke-family",
    );
  });
});
