import { Injectable } from "@nestjs/common";

export class RateLimitError extends Error {
  constructor() {
    super("RATE_LIMITED");
  }
}

export const LOGIN_ATTEMPT_LIMIT = 10;
export const REFRESH_ATTEMPT_LIMIT = 20;
export const ATTEMPT_WINDOW_MS = 60_000;

@Injectable()
export class AttemptLimiter {
  private readonly hits = new Map<string, number[]>();

  assertAllowed(key: string, limit: number, windowMs: number, now = Date.now()): void {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      throw new RateLimitError();
    }
    recent.push(now);
    this.hits.set(key, recent);
  }
}
