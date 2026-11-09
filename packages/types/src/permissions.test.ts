import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, USER_ROLES } from "./permissions";

const forbidden = {
  DISPATCHER: [
    "FINANCE_APPROVE_SETTLEMENT",
    "FINANCE_RECORD_PAYMENT",
    "COMMISSION_POLICY_MANAGE",
    "DRIVER_COMMISSION_MANAGE",
    "CREDIT_LIMIT_MANAGE",
    "CREDIT_EXCEPTION_GRANT",
    "FARE_ADJUST",
    "USERS_MANAGE",
  ],
  DRIVER: ["TRIPS_VIEW_ALL", "BOOKINGS_MANAGE", "FINANCE_RECORD_PAYMENT", "FARE_ADJUST"],
  FINANCE: ["FARE_ADJUST", "FARE_LOCK", "CREDIT_LIMIT_MANAGE", "COMMISSION_POLICY_MANAGE"],
  ADMIN: [
    "FINANCE_APPROVE_SETTLEMENT",
    "CREDIT_LIMIT_MANAGE",
    "COMMISSION_POLICY_MANAGE",
    "DRIVER_COMMISSION_MANAGE",
    "USERS_MANAGE",
    "FARE_ADJUST",
  ],
} as const;

describe("role permission catalog", () => {
  it("covers every role and only known permissions", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...USER_ROLES].sort());

    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      expect(new Set(permissions).size).toBe(permissions.length);
      for (const permission of permissions) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it("gives the platform owner the full catalog", () => {
    expect(ROLE_PERMISSIONS.PLATFORM_OWNER).toEqual(PERMISSIONS);
  });

  it("keeps dispatch, finance, drivers, and admin inside the agreed boundaries", () => {
    for (const [role, blocked] of Object.entries(forbidden)) {
      const granted = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
      for (const permission of blocked) {
        expect(granted, role).not.toContain(permission);
      }
    }
  });
});
