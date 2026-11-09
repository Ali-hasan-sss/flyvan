import { describe, expect, it } from "vitest";
import { parseLoginIdentifier } from "./identity";
import type { PasswordHasher } from "./password-hasher";
import { planRefreshRotation, type RefreshState } from "./refresh-plan";
import type { SessionUser } from "./public-user";
import { InvalidCredentialsError, SessionService } from "./session.service";
import type { NewRefreshToken, RefreshRotation, SessionStore } from "./session-store";

const hasher: PasswordHasher = {
  async hash(plain) {
    return `hash:${plain}`;
  },
  async verify(passwordHash, plain) {
    return passwordHash === `hash:${plain}`;
  },
};

class MemorySessionStore implements SessionStore {
  readonly users: SessionUser[] = [];
  readonly tokens: RefreshState[] = [];

  async findUserByIdentifier(identifier: string): Promise<SessionUser | null> {
    const parsed = parseLoginIdentifier(identifier);
    if (!parsed) {
      return null;
    }
    return (
      this.users.find((user) =>
        parsed.kind === "email" ? user.email === parsed.value : user.phone === parsed.value,
      ) ?? null
    );
  }

  async findUserById(id: string): Promise<SessionUser | null> {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async createRefresh(token: NewRefreshToken): Promise<void> {
    this.tokens.push({ ...token, revokedAt: null, replacedById: null });
  }

  async rotateRefresh(
    currentHash: string,
    next: { id: string; tokenHash: string; expiresAt: Date },
    now: Date,
  ): Promise<RefreshRotation> {
    const current = this.tokens.find((token) => token.tokenHash === currentHash) ?? null;
    const user = current ? await this.findUserById(current.userId) : null;
    const plan = planRefreshRotation({
      current,
      now,
      userActive: user?.status === "ACTIVE",
    });
    if (plan.action === "revoke-family") {
      for (const token of this.tokens) {
        if (token.userId === plan.userId && !token.revokedAt) {
          token.revokedAt = now;
        }
      }
      return { status: "rejected" };
    }
    if (plan.action !== "rotate" || !user) {
      return { status: "rejected" };
    }
    this.tokens.push({
      id: next.id,
      userId: plan.userId,
      tokenHash: next.tokenHash,
      expiresAt: next.expiresAt,
      revokedAt: null,
      replacedById: null,
    });
    const previous = this.tokens.find((token) => token.id === plan.tokenId);
    if (previous) {
      previous.revokedAt = now;
      previous.replacedById = next.id;
    }
    return { status: "rotated", user };
  }

  async revokeByHash(tokenHash: string, now: Date): Promise<void> {
    const token = this.tokens.find((item) => item.tokenHash === tokenHash);
    if (token && !token.revokedAt) {
      token.revokedAt = now;
    }
  }
}

function serviceFor(store: MemorySessionStore): SessionService {
  return new SessionService(store, hasher, {
    accessSecret: "local-test-secret-with-32-characters",
    accessTtlSeconds: 900,
    refreshTtlSeconds: 1200,
  });
}

describe("sessions", () => {
  it("rejects a wrong password and a disabled account with the same error", async () => {
    const store = new MemorySessionStore();
    store.users.push({
      id: "user-1",
      email: "owner@localhost.test",
      phone: null,
      passwordHash: "hash:correct-password",
      displayName: "المالك",
      role: "PLATFORM_OWNER",
      status: "DISABLED",
    });
    const sessions = serviceFor(store);

    await expect(sessions.login("owner@localhost.test", "wrong-password")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(sessions.login("owner@localhost.test", "correct-password")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(sessions.login("missing@localhost.test", "correct-password")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it("rotates a refresh token once and revokes the family if the old token is reused", async () => {
    const store = new MemorySessionStore();
    store.users.push({
      id: "user-1",
      email: "driver@localhost.test",
      phone: "0999123456",
      passwordHash: "hash:correct-password",
      displayName: "السائق",
      role: "DRIVER",
      status: "ACTIVE",
    });
    const sessions = serviceFor(store);
    const first = await sessions.login("0999 123 456", "correct-password");
    const second = await sessions.refresh(first.refreshToken);

    expect(second.user.role).toBe("DRIVER");
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(sessions.readAccess(second.accessToken)).resolves.toMatchObject({ id: "user-1" });

    await expect(sessions.refresh(first.refreshToken)).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(sessions.refresh(second.refreshToken)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("stops accepting an access token after the account is disabled", async () => {
    const store = new MemorySessionStore();
    const user: SessionUser = {
      id: "user-1",
      email: "finance@localhost.test",
      phone: null,
      passwordHash: "hash:correct-password",
      displayName: "المالية",
      role: "FINANCE",
      status: "ACTIVE",
    };
    store.users.push(user);
    const sessions = serviceFor(store);
    const issued = await sessions.login("finance@localhost.test", "correct-password");
    user.status = "DISABLED";

    await expect(sessions.readAccess(issued.accessToken)).rejects.toBeInstanceOf(InvalidCredentialsError);
    await sessions.logout(issued.refreshToken);
    await expect(sessions.refresh(issued.refreshToken)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});
