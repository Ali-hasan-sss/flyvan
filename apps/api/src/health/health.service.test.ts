import { describe, expect, it } from "vitest";
import { healthHttpStatus, readDatabaseStatus } from "./health-status";

describe("health probe", () => {
  it("reports the database as up only when the probe query succeeds", async () => {
    await expect(readDatabaseStatus(async () => 1)).resolves.toBe("up");
    await expect(
      readDatabaseStatus(async () => {
        throw new Error("connection refused");
      }),
    ).resolves.toBe("down");
  });

  it("returns 503 when the service is degraded", () => {
    expect(
      healthHttpStatus({
        status: "degraded",
        service: "flyvan-api",
        database: "down",
        phase: "finance",
      }),
    ).toBe(503);
  });
});
