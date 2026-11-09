import { describe, expect, it } from "vitest";
import { assertSeedAllowed } from "./seed-guard";

const valid = {
  NODE_ENV: "development",
  SEED_ENABLED: "true",
  SEED_OWNER_EMAIL: "owner@localhost.test",
  SEED_OWNER_PASSWORD: "local-dev-only-1",
};

describe("assertSeedAllowed", () => {
  it("accepts an explicit development seed without inventing a commission rate", () => {
    expect(assertSeedAllowed(valid)).toEqual({
      email: "owner@localhost.test",
      password: "local-dev-only-1",
      commissionRate: null,
      admin: null,
    });
  });

  it("refuses production even when the seed flag is set", () => {
    expect(() => assertSeedAllowed({ ...valid, NODE_ENV: "production" })).toThrow(/production/);
  });

  it("refuses to run unless the seed flag is exactly true", () => {
    expect(() => assertSeedAllowed({ ...valid, SEED_ENABLED: "false" })).toThrow(/SEED_ENABLED/);
  });

  it("requires an email and a password of at least 8 characters", () => {
    expect(() => assertSeedAllowed({ ...valid, SEED_OWNER_EMAIL: "" })).toThrow(/SEED_OWNER/);
    expect(() => assertSeedAllowed({ ...valid, SEED_OWNER_PASSWORD: "short" })).toThrow(/SEED_OWNER/);
    expect(assertSeedAllowed({ ...valid, SEED_OWNER_PASSWORD: "12345678" }).password).toBe("12345678");
  });

  it("accepts a separate development admin and rejects a short admin password", () => {
    expect(
      assertSeedAllowed({
        ...valid,
        SEED_ADMIN_EMAIL: "Admin@Localhost.Test",
        SEED_ADMIN_PASSWORD: "local-dev-admin-1",
      }).admin,
    ).toEqual({
      email: "admin@localhost.test",
      password: "local-dev-admin-1",
    });
    expect(() =>
      assertSeedAllowed({ ...valid, SEED_ADMIN_EMAIL: "admin@localhost.test", SEED_ADMIN_PASSWORD: "short" }),
    ).toThrow(/SEED_ADMIN/);
  });

  it("rejects a commission rate outside 0 to 100", () => {
    expect(() =>
      assertSeedAllowed({ ...valid, SEED_DEFAULT_COMMISSION_RATE: "120" }),
    ).toThrow(/COMMISSION_RATE/);
  });
});
