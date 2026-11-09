import type { SessionUser } from "./public-user";

export type NewRefreshToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type RefreshRotation =
  | { status: "rotated"; user: SessionUser }
  | { status: "rejected" };

export interface SessionStore {
  findUserByIdentifier(identifier: string): Promise<SessionUser | null>;
  findUserById(id: string): Promise<SessionUser | null>;
  createRefresh(token: NewRefreshToken): Promise<void>;
  rotateRefresh(
    currentHash: string,
    next: { id: string; tokenHash: string; expiresAt: Date },
    now: Date,
  ): Promise<RefreshRotation>;
  revokeByHash(tokenHash: string, now: Date): Promise<void>;
}
