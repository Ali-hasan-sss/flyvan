export type RefreshState = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
};

export type RefreshPlan =
  | { action: "missing" }
  | { action: "reject" }
  | { action: "revoke-family"; userId: string }
  | { action: "rotate"; userId: string; tokenId: string };

export function planRefreshRotation(input: {
  current: RefreshState | null;
  now: Date;
  userActive: boolean;
}): RefreshPlan {
  if (!input.current) {
    return { action: "missing" };
  }
  if (input.current.revokedAt || input.current.replacedById) {
    return { action: "revoke-family", userId: input.current.userId };
  }
  if (input.current.expiresAt.getTime() <= input.now.getTime()) {
    return { action: "reject" };
  }
  if (!input.userActive) {
    return { action: "revoke-family", userId: input.current.userId };
  }
  return { action: "rotate", userId: input.current.userId, tokenId: input.current.id };
}
