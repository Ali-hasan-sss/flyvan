import { randomBytes } from "node:crypto";
import { hashToken, newRefreshSecret, readAccessSubject, signAccessToken } from "./tokens";
import type { IssuedSession, PublicUser, SessionUser } from "./public-user";
import { toPublicUser } from "./public-user";
import type { PasswordHasher } from "./password-hasher";
import type { SessionStore } from "./session-store";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("INVALID_CREDENTIALS");
  }
}

export type SessionOptions = {
  accessSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
};

export class SessionService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly store: SessionStore,
    private readonly passwords: PasswordHasher,
    private readonly options: SessionOptions,
  ) {}

  async login(identifier: string, password: string, now = new Date()): Promise<IssuedSession> {
    const user = await this.store.findUserByIdentifier(identifier);
    const hash = user?.passwordHash ?? (await this.placeholderHash());
    const matches = await this.passwords.verify(hash, password);
    if (!user || user.status !== "ACTIVE" || !matches) {
      throw new InvalidCredentialsError();
    }
    const refresh = this.nextRefresh(now);
    await this.store.createRefresh({
      id: refresh.id,
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
    });
    return this.issue(user, refresh.raw);
  }

  async refresh(rawRefreshToken: string, now = new Date()): Promise<IssuedSession> {
    const refresh = this.nextRefresh(now);
    const result = await this.store.rotateRefresh(hashToken(rawRefreshToken), refresh, now);
    if (result.status !== "rotated") {
      throw new InvalidCredentialsError();
    }
    return this.issue(result.user, refresh.raw);
  }

  async logout(rawRefreshToken: string, now = new Date()): Promise<void> {
    await this.store.revokeByHash(hashToken(rawRefreshToken), now);
  }

  async readAccess(token: string): Promise<PublicUser> {
    let userId: string;
    try {
      userId = readAccessSubject(token, this.options.accessSecret);
    } catch {
      throw new InvalidCredentialsError();
    }
    const user = await this.store.findUserById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new InvalidCredentialsError();
    }
    return toPublicUser(user);
  }

  private issue(user: SessionUser, refreshToken: string): IssuedSession {
    return {
      accessToken: signAccessToken({
        userId: user.id,
        secret: this.options.accessSecret,
        ttlSeconds: this.options.accessTtlSeconds,
      }),
      refreshToken,
      expiresIn: this.options.accessTtlSeconds,
      user: toPublicUser(user),
    };
  }

  private nextRefresh(now: Date): { id: string; raw: string; tokenHash: string; expiresAt: Date } {
    const created = newRefreshSecret();
    return {
      id: created.id,
      raw: created.raw,
      tokenHash: created.hash,
      expiresAt: new Date(now.getTime() + this.options.refreshTtlSeconds * 1000),
    };
  }

  private placeholderHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash(randomBytes(32).toString("hex"));
    return this.dummyHash;
  }
}
