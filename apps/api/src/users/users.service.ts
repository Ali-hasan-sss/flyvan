import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { normalizeEmail, normalizePhone } from "../auth/identity";
import { Argon2PasswordHasher } from "../auth/argon2-password-hasher";
import type { PublicUser } from "../auth/public-user";
import { PrismaService } from "../prisma/prisma.service";
import {
  assertCanChangeRole,
  assertCanDisable,
  assertDisplayName,
  assertPassword,
  assertRole,
  UserAdminError,
} from "./user-policy";

type UserRow = {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  role: string;
  status: string;
  createdAt: Date;
};

export type StoredUser = PublicUser & { createdAt: string };

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: Argon2PasswordHasher,
  ) {}

  async list(page: number, pageSize: number): Promise<{ items: StoredUser[]; page: number; pageSize: number; total: number }> {
    const [total, rows] = await Promise.all([
      this.prisma.client.user.count(),
      this.prisma.client.user.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((row: UserRow) => toStoredUser(row)),
      page,
      pageSize,
      total,
    };
  }

  async get(id: string): Promise<StoredUser> {
    const user = await this.prisma.client.user.findUnique({ where: { id } });
    if (!user) {
      throw new UserAdminError("NOT_FOUND");
    }
    return toStoredUser(user);
  }

  async create(
    actorId: string,
    input: { displayName: string; role: string; password: string; email?: string; phone: string },
  ): Promise<StoredUser> {
    const displayName = assertDisplayName(input.displayName);
    const role = assertRole(input.role);
    assertPassword(input.password);
    const email = input.email === undefined ? null : normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    if (input.email !== undefined && !email) {
      throw new UserAdminError("EMAIL");
    }
    if (!phone) {
      throw new UserAdminError("PHONE");
    }

    const passwordHash = await this.passwords.hash(input.password);
    const id = randomUUID();
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id,
            email,
            phone,
            passwordHash,
            displayName,
            role,
            status: "ACTIVE",
          },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: "user.created",
            entityType: "User",
            entityId: user.id,
            after: snapshot(toStoredUser(user)),
          },
        });
        return user;
      });
      return toStoredUser(created);
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new UserAdminError("DUPLICATE");
      }
      throw error;
    }
  }

  async update(
    actorId: string,
    id: string,
    input: { displayName?: string; role?: string; password?: string },
  ): Promise<StoredUser> {
    if (input.displayName === undefined && input.role === undefined && input.password === undefined) {
      throw new UserAdminError("EMPTY");
    }
    const existing = await this.requireUser(id);
    const displayName = input.displayName === undefined ? existing.displayName : assertDisplayName(input.displayName);
    const role = input.role === undefined ? existing.role : assertRole(input.role);
    if (input.password !== undefined) {
      assertPassword(input.password);
    }
    const activeOwners = await this.prisma.client.user.count({
      where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
    });
    assertCanChangeRole(actorId, existing, role, activeOwners);
    const passwordHash = input.password === undefined ? undefined : await this.passwords.hash(input.password);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          displayName,
          role,
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      if (role !== existing.role || passwordHash) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: passwordHash && role === existing.role ? "user.password_changed" : "user.updated",
          entityType: "User",
          entityId: id,
          before: snapshot(existing),
          after: {
            ...snapshot(toStoredUser(user)),
            ...(passwordHash ? { passwordChanged: true } : {}),
          },
        },
      });
      return user;
    });
    return toStoredUser(updated);
  }

  async disable(actorId: string, id: string, reason: string): Promise<StoredUser> {
    const existing = await this.requireUser(id);
    const activeOwners = await this.prisma.client.user.count({
      where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
    });
    assertCanDisable(actorId, existing, activeOwners);
    const disabledAt = new Date();
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { status: "DISABLED", disabledAt, disabledReason: reason.trim() },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: disabledAt },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "user.disabled",
          entityType: "User",
          entityId: id,
          reason: reason.trim(),
          before: snapshot(existing),
          after: snapshot(toStoredUser(user)),
        },
      });
      return user;
    });
    return toStoredUser(updated);
  }

  async enable(actorId: string, id: string): Promise<StoredUser> {
    const existing = await this.requireUser(id);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { status: "ACTIVE", disabledAt: null, disabledReason: null },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "user.enabled",
          entityType: "User",
          entityId: id,
          before: snapshot(existing),
          after: snapshot(toStoredUser(user)),
        },
      });
      return user;
    });
    return toStoredUser(updated);
  }

  private async requireUser(id: string): Promise<PublicUser> {
    const user = await this.prisma.client.user.findUnique({ where: { id } });
    if (!user) {
      throw new UserAdminError("NOT_FOUND");
    }
    return toStoredUser(user);
  }
}

function toStoredUser(user: UserRow): StoredUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: assertRole(user.role),
    status: user.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    createdAt: user.createdAt.toISOString(),
  };
}

function snapshot(user: PublicUser): Record<string, string | null> {
  return {
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
  };
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}
