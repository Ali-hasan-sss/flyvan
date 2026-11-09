import { describe, expect, it } from "vitest";
import { AttemptLimiter, RateLimitError } from "./attempt-limiter";

describe("attempt limiter", () => {
  it("blocks the next login attempt after the window fills", () => {
    const limiter = new AttemptLimiter();
    const now = 1_000_000;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limiter.assertAllowed("login:127.0.0.1", 3, 60_000, now + attempt);
    }
    expect(() => limiter.assertAllowed("login:127.0.0.1", 3, 60_000, now + 4)).toThrow(RateLimitError);
    expect(() => limiter.assertAllowed("login:127.0.0.1", 3, 60_000, now + 60_001)).not.toThrow();
  });
});
