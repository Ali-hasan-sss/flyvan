import { describe, expect, it } from "vitest";
import { readApiConfig } from "./config";

describe("readApiConfig", () => {
  it("reads the local connection settings", () => {
    expect(
      readApiConfig({
        DATABASE_URL: "postgresql://flyvan:flyvan@localhost:5432/flyvan",
        API_PORT: "3001",
        WEB_ORIGIN: "http://localhost:3000",
        JWT_ACCESS_SECRET: "local-test-secret-with-32-characters",
      }),
    ).toEqual({
      databaseUrl: "postgresql://flyvan:flyvan@localhost:5432/flyvan",
      port: 3001,
      webOrigin: "http://localhost:3000",
      accessTokenSecret: "local-test-secret-with-32-characters",
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 1_209_600,
    });
  });

  it("rejects a missing database url, an invalid port, and a short token secret", () => {
    expect(() => readApiConfig({})).toThrow(/DATABASE_URL/);
    expect(() =>
      readApiConfig({
        DATABASE_URL: "postgresql://localhost/flyvan",
        API_PORT: "0",
        JWT_ACCESS_SECRET: "local-test-secret-with-32-characters",
      }),
    ).toThrow(/API_PORT/);
    expect(() =>
      readApiConfig({
        DATABASE_URL: "postgresql://localhost/flyvan",
        JWT_ACCESS_SECRET: "too-short",
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });
});
