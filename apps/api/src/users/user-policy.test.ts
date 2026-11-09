import { describe, expect, it } from "vitest";
import type { PublicUser } from "../auth/public-user";
import { assertCanChangeRole, assertCanDisable, UserAdminError } from "./user-policy";

const owner: PublicUser = {
  id: "owner-1",
  email: "owner@localhost.test",
  phone: null,
  displayName: "المالك",
  role: "PLATFORM_OWNER",
  status: "ACTIVE",
};

describe("user administration policy", () => {
  it("refuses to disable the signed-in account or the last active owner", () => {
    expect(() => assertCanDisable(owner.id, owner, 2)).toThrow(UserAdminError);
    expect(() => assertCanDisable("owner-2", owner, 1)).toThrow(UserAdminError);
    expect(() => assertCanDisable("owner-2", owner, 2)).not.toThrow();
  });

  it("refuses a self role change and demoting the last active owner", () => {
    expect(() => assertCanChangeRole(owner.id, owner, "ADMIN", 2)).toThrow(UserAdminError);
    expect(() => assertCanChangeRole("owner-2", owner, "ADMIN", 1)).toThrow(UserAdminError);
    expect(() => assertCanChangeRole("owner-2", owner, "ADMIN", 2)).not.toThrow();
  });
});
