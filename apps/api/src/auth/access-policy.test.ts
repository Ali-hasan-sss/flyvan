import { ROLE_PERMISSIONS } from "@flyvan/types";
import { describe, expect, it } from "vitest";
import { decisionFor } from "./access-policy";

describe("API access decisions", () => {
  it("rejects a missing or disabled session before checking permissions", () => {
    expect(
      decisionFor({
        authenticated: false,
        active: false,
        granted: ROLE_PERMISSIONS.PLATFORM_OWNER,
        required: ["USERS_MANAGE"],
      }),
    ).toBe("unauthenticated");
    expect(
      decisionFor({
        authenticated: true,
        active: false,
        granted: ROLE_PERMISSIONS.PLATFORM_OWNER,
        required: [],
      }),
    ).toBe("unauthenticated");
  });

  it("lets an owner manage users and refuses a dispatcher", () => {
    expect(
      decisionFor({
        authenticated: true,
        active: true,
        granted: ROLE_PERMISSIONS.PLATFORM_OWNER,
        required: ["USERS_MANAGE"],
      }),
    ).toBe("ok");
    expect(
      decisionFor({
        authenticated: true,
        active: true,
        granted: ROLE_PERMISSIONS.DISPATCHER,
        required: ["USERS_MANAGE"],
      }),
    ).toBe("forbidden");
    expect(
      decisionFor({
        authenticated: true,
        active: true,
        granted: ROLE_PERMISSIONS.ADMIN,
        required: ["USERS_MANAGE"],
      }),
    ).toBe("forbidden");
  });

  it("allows any active role to read its own session when no permission is required", () => {
    expect(
      decisionFor({
        authenticated: true,
        active: true,
        granted: ROLE_PERMISSIONS.DRIVER,
        required: [],
      }),
    ).toBe("ok");
  });
});
