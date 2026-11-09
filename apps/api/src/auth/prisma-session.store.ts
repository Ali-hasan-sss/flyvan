import { Injectable } from "@nestjs/common";
import { USER_ROLES, type UserRole } from "@flyvan/types";
import { PrismaService } from "../prisma/prisma.service";
import { parseLoginIdentifier } from "./identity";
import { planRefreshRotation } from "./refresh-plan";
import type { SessionUser } from "./public-user";
import type { NewRefreshToken, RefreshRotation, SessionStore } from "./session-store";

type UserRow = {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  displayName: string;
  role: string;
  status: string;
};

@Injectable()
export class PrismaSessionStore implements SessionStore {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByIdentifier(identifier: string): Promise<SessionUser | null> {
    const parsed = parseLoginIdentifier(identifier);
    if (!parsed) {
      return null;
    }
    const user = await this.prisma.client.user.findFirst({
      where: parsed.kind === "email" ? { email: parsed.value } : { phone: parsed.value },
    });
    return user ? mapUser(user) : null;
  }

  async findUserById(id: string): Promise<SessionUser | null> {
    const user = await this.prisma.client.user.findUnique({ where: { id } });
    return user ? mapUser(user) : null;
  }

  async createRefresh(token: NewRefreshToken): Promise<void> {
    await this.prisma.client.refreshToken.create({
      data: {
        id: token.id,
        userId: token.userId,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
      },
    });
  }

  async rotateRefresh(
    currentHash: string,
    next: { id: string; tokenHash: string; expiresAt: Date },
    now: Date,
  ): Promise<RefreshRotation> {
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.refreshToken.findUnique({ where: { tokenHash: currentHash } });
      const user = current
        ? await tx.user.findUnique({ where: { id: current.userId } })
        : null;
      const plan = planRefreshRotation({
        current,
        now,
        userActive: user?.status === "ACTIVE",
      });

      if (plan.action === "revoke-family") {
        await tx.refreshToken.updateMany({
          where: { userId: plan.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { status: "rejected" };
      }
      if (plan.action !== "rotate" || !user) {
        return { status: "rejected" };
      }

      await tx.refreshToken.create({
        data: {
          id: next.id,
          userId: plan.userId,
          tokenHash: next.tokenHash,
          expiresAt: next.expiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: plan.tokenId },
        data: { revokedAt: now, replacedById: next.id },
      });
      return { status: "rotated", user: mapUser(user) };
    });
  }

  async revokeByHash(tokenHash: string, now: Date): Promise<void> {
    const current = await this.prisma.client.refreshToken.findUnique({ where: { tokenHash } });
    if (!current || current.revokedAt) {
      return;
    }
    await this.prisma.client.refreshToken.update({
      where: { id: current.id },
      data: { revokedAt: now },
    });
  }
}

function mapUser(user: UserRow): SessionUser {
  if (!isRole(user.role) || (user.status !== "ACTIVE" && user.status !== "DISABLED")) {
    throw new Error("Stored user role or status is not recognized.");
  }
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    passwordHash: user.passwordHash,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
  };
}

function isRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}
